import { ArrowDownLeft, ArrowRight, ArrowUpRight, Maximize2, Network, Search, ZoomIn, ZoomOut } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'

const LAYERS = [
  { id: 'subject', label: 'INVESTIGATION SUBJECT', short: 'L0', color: '#ffc36e' },
  { id: 'collector', label: 'COLLECTOR CANDIDATES', short: 'L1', color: '#55d6a1' },
  { id: 'distributor', label: 'DISTRIBUTOR CANDIDATES', short: 'L2', color: '#a78bfa' },
  { id: 'terminal', label: 'CASH-OUT INDICATORS', short: 'L3', color: '#fb8b72' },
  { id: 'participant', label: 'OTHER PARTICIPANTS', short: 'L4', color: '#58d6df' },
]

const MAX_NODES = 1500

function endpointId(value) {
  return String(value?.id ?? value ?? '')
}

function formatMoney(value) {
  const amount = Number(value)
  if (!Number.isFinite(amount)) return 'Amount unavailable'
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(amount)
}

function accountLayer(node, rootId, depth) {
  if (node.id === rootId) return 'subject'
  if (node.layerCandidate === 'L1') return 'collector'
  if (node.layerCandidate === 'L2') return 'distributor'
  if (node.layerCandidate === 'L3') return 'terminal'
  if (depth <= 1) return 'collector'
  if (depth === 2) return 'distributor'
  if (depth >= 3) return 'participant'
  return 'participant'
}

export default function MoneyFlowGraph({
  nodes,
  links,
  selectedAccount,
  traceRootAccount = selectedAccount,
  maxHops = 4,
  onExpandAccount,
  onSelectAccount,
  onSelectTransaction,
}) {
  const viewportRef = useRef(null)
  const panPointerRef = useRef(null)
  const [search, setSearch] = useState('')
  const [suggestionsOpen, setSuggestionsOpen] = useState(false)
  const [activeSuggestion, setActiveSuggestion] = useState(0)
  const [selectedEdgeKey, setSelectedEdgeKey] = useState('')
  const [selectedNodeId, setSelectedNodeId] = useState('')
  const [showAllNodeTransactions, setShowAllNodeTransactions] = useState(false)
  const [outgoingPages, setOutgoingPages] = useState({})
  const [zoom, setZoom] = useState(0.82)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const graph = useMemo(() => {
    const rootId = String(selectedAccount ?? '')
    const nodeById = new Map(nodes.map((node) => [String(node.id), node]))
    const neighbors = new Map()
    const stats = new Map()
    const groupedLinks = new Map()

    nodes.forEach((node) => {
      stats.set(String(node.id), { incoming: 0, outgoing: 0 })
    })

    links.forEach((link) => {
      const source = endpointId(link.source)
      const target = endpointId(link.target)
      if (!nodeById.has(source) || !nodeById.has(target)) return

      if (!neighbors.has(source)) neighbors.set(source, new Set())
      neighbors.get(source).add(target)
      stats.get(source).outgoing += 1
      stats.get(target).incoming += 1
      const key = `${source}\u0000${target}`
      const group = groupedLinks.get(key) ?? {
        source,
        target,
        total: 0,
        count: 0,
      }
      group.total += Number(link.amount) || 0
      group.count += 1
      groupedLinks.set(key, group)
    })

    const depthById = new Map([[rootId, 0]])
    const queue = [rootId]
    for (let index = 0; index < queue.length; index += 1) {
      const current = queue[index]
      for (const next of neighbors.get(current) ?? []) {
        if (!depthById.has(next)) {
          depthById.set(next, depthById.get(current) + 1)
          queue.push(next)
        }
      }
    }

    const layers = new Map(LAYERS.map((layer) => [layer.id, []]))
    nodes.forEach((node) => {
      const id = String(node.id)
      const layer = accountLayer(node, rootId, depthById.get(id) ?? Infinity)
      layers.get(layer).push({ ...node, id, layer, depth: depthById.get(id) })
    })
    layers.forEach((layerNodes) => layerNodes.sort((a, b) => a.id.localeCompare(b.id)))

    const positionedNodes = []
    const positions = new Map()
    const layerById = new Map()
    const columnWidth = 270
    const rowHeight = 112
    const top = 82
    LAYERS.forEach((layer, column) => {
      const layerNodes = layers.get(layer.id)
      layerNodes.forEach((node, row) => {
        if (positionedNodes.length >= MAX_NODES) return
        const positioned = { ...node, x: 20 + column * columnWidth, y: top + row * rowHeight }
        positionedNodes.push(positioned)
        positions.set(node.id, positioned)
        layerById.set(node.id, node.layer)
      })
    })

    const visibleLinks = [...groupedLinks.values()]
      .filter((link) => positions.has(link.source) && positions.has(link.target))
      .map((link) => {
        const source = positions.get(link.source)
        const target = positions.get(link.target)
        const startX = source.x + 208
        const startY = source.y + 43
        const endX = target.x
        const endY = target.y + 43
        const curve = Math.max(35, (endX - startX) * 0.48)
        return {
          ...link,
          d: `M ${startX} ${startY} C ${startX + curve} ${startY}, ${endX - curve} ${endY}, ${endX} ${endY}`,
        }
      })
    const rowCount = Math.max(1, ...LAYERS.map((layer) => layers.get(layer.id).length))

    return {
      layers,
      positions,
      layerById,
      positionedNodes,
      visibleLinks,
      width: 20 + LAYERS.length * columnWidth,
      height: top + rowCount * rowHeight + 30,
      totalNodes: nodes.length,
      totalConnectionGroups: groupedLinks.size,
      stats,
    }
  }, [links, nodes, selectedAccount])

  const query = search.trim().toLowerCase()
  const accountSuggestions = useMemo(() => {
    if (!query) return []

    return graph.positionedNodes
      .filter((node) => node.id.toLowerCase().includes(query))
      .sort((a, b) => {
        const aStartsWith = a.id.toLowerCase().startsWith(query)
        const bStartsWith = b.id.toLowerCase().startsWith(query)
        return Number(bStartsWith) - Number(aStartsWith) || a.id.localeCompare(b.id)
      })
      .slice(0, 8)
  }, [graph.positionedNodes, query])
  const selectedEdge = graph.visibleLinks.find(
    (link) => `${link.source}\u0000${link.target}` === selectedEdgeKey
  )
  const selectedNode = graph.positionedNodes.find((node) => node.id === selectedNodeId)
  const selectedNodeTransactions = selectedNode
    ? links.filter((link) => (
      endpointId(link.source) === selectedNodeId || endpointId(link.target) === selectedNodeId
    ))
    : []
  const selectedNodeIncomingLinks = selectedNode
    ? links.filter((link) => endpointId(link.target) === selectedNodeId)
    : []
  const selectedNodeHop = selectedNodeId === String(traceRootAccount)
    ? 0
    : Math.min(
      ...selectedNodeIncomingLinks
        .map((link) => Number(link.hop))
        .filter((hop) => Number.isInteger(hop) && hop > 0),
      Number.POSITIVE_INFINITY,
    )
  const selectedNodeReceiptTime = selectedNodeHop > 0
    ? selectedNodeIncomingLinks
      .filter((link) => Number(link.hop) === selectedNodeHop && link.timestamp)
      .map((link) => String(link.timestamp))
      .sort()[0] ?? null
    : null
  const outgoingPageKey = `${selectedNodeId}\u0000${selectedNodeHop}\u0000${selectedNodeReceiptTime ?? ''}`
  const outgoingPage = outgoingPages[outgoingPageKey] ?? {
    offset: 0,
    hasMore: true,
    loading: false,
    error: '',
    fetched: 0,
    started: false,
  }
  const canExpandSelectedNode = Boolean(
    selectedNode
    && onExpandAccount
    && selectedNodeHop < maxHops
    && (selectedNodeHop === 0 || selectedNodeReceiptTime),
  )
  const hasSelectedEdge = Boolean(selectedEdge)
  const hasSelectedNode = Boolean(selectedNode)
  const connectedAccounts = selectedEdge
    ? new Set([selectedEdge.source, selectedEdge.target])
    : selectedNode
      ? new Set([
        selectedNodeId,
        ...selectedNodeTransactions.map((link) => endpointId(
          endpointId(link.source) === selectedNodeId ? link.target : link.source,
        )),
      ])
      : null
  const clearEdgeSelection = () => setSelectedEdgeKey('')
  const loadOutgoingPage = async () => {
    if (!canExpandSelectedNode || outgoingPage.loading || !outgoingPage.hasMore) return
    setOutgoingPages((current) => ({
      ...current,
      [outgoingPageKey]: { ...outgoingPage, loading: true, error: '' },
    }))
    try {
      const page = await onExpandAccount({
        accountId: selectedNodeId,
        receivedAt: selectedNodeReceiptTime,
        hop: selectedNodeHop,
        maxHops,
        offset: outgoingPage.offset,
      })
      setOutgoingPages((current) => ({
        ...current,
        [outgoingPageKey]: {
          offset: page.next_offset ?? outgoingPage.offset + page.transactions.length,
          hasMore: page.has_more,
          loading: false,
          error: '',
          fetched: outgoingPage.fetched + page.transactions.length,
          started: true,
        },
      }))
    } catch (error) {
      setOutgoingPages((current) => ({
        ...current,
        [outgoingPageKey]: {
          ...outgoingPage,
          loading: false,
          error: error.response?.data?.detail || error.message || 'Could not load outgoing transfers.',
          started: true,
        },
      }))
    }
  }
  const startPan = (event) => {
    if (event.button !== 0 || event.target.closest('button, input, .layered-flow-edge-hit')) return
    panPointerRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      panX: pan.x,
      panY: pan.y,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    event.currentTarget.style.cursor = 'grabbing'
  }
  const movePan = (event) => {
    const start = panPointerRef.current
    if (!start || start.pointerId !== event.pointerId) return
    setPan({
      x: start.panX + event.clientX - start.startX,
      y: start.panY + event.clientY - start.startY,
    })
  }
  const endPan = (event) => {
    if (panPointerRef.current?.pointerId !== event.pointerId) return
    panPointerRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    event.currentTarget.style.cursor = 'grab'
  }
  const zoomBy = (amount) => setZoom((current) => Math.max(0.45, Math.min(1.35, Number((current + amount).toFixed(2)))))
  const resetView = () => {
    setZoom(0.72)
    setPan({ x: 0, y: 0 })
  }
  const onWheel = (event) => {
    event.preventDefault()
    zoomBy(event.deltaY < 0 ? 0.06 : -0.06)
  }
  const selectAccountSuggestion = (node) => {
    setSearch(node.id)
    setSuggestionsOpen(false)
    setActiveSuggestion(0)
    setSelectedEdgeKey('')
    setSelectedNodeId('')
    onSelectAccount(node.id)
  }
  const handleAccountSearchKeyDown = (event) => {
    if (event.key === 'Escape') {
      setSuggestionsOpen(false)
      return
    }
    if (!suggestionsOpen || accountSuggestions.length === 0) return

    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActiveSuggestion((current) => (current + 1) % accountSuggestions.length)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveSuggestion((current) =>
        (current - 1 + accountSuggestions.length) % accountSuggestions.length
      )
    } else if (event.key === 'Enter') {
      event.preventDefault()
      selectAccountSuggestion(accountSuggestions[activeSuggestion])
    }
  }

  if (nodes.length === 0 || links.length === 0) {
    return (
      <div className="layered-flow-empty">
        <Network size={32} />
        <strong>No transaction flow to display</strong>
        <span>Load an account with traced transactions to explore its flow.</span>
      </div>
    )
  }

  return (
    <div className="layered-flow">
      <div className="layered-flow-toolbar">
        <div className="layered-flow-search-wrap">
          <label className="layered-flow-search">
            <Search size={14} />
            <input
              value={search}
              onChange={(event) => {
                setSearch(event.target.value)
                setActiveSuggestion(0)
                setSuggestionsOpen(true)
              }}
              onFocus={() => setSuggestionsOpen(true)}
              onKeyDown={handleAccountSearchKeyDown}
              onPointerDown={(event) => event.stopPropagation()}
              placeholder="Find an account..."
              aria-label="Find an account in the flow graph"
              aria-autocomplete="list"
              aria-controls="account-search-suggestions"
              aria-expanded={suggestionsOpen && Boolean(query)}
              aria-activedescendant={suggestionsOpen && accountSuggestions.length
                ? `account-suggestion-${activeSuggestion}`
                : undefined}
            />
          </label>
          {suggestionsOpen && query && (
            <div
              className="layered-flow-suggestions"
              id="account-search-suggestions"
              role="listbox"
              aria-label="Matching accounts"
            >
              {accountSuggestions.length ? (
                <>
                  <div className="layered-flow-suggestions-heading">
                    {accountSuggestions.length} matching account{accountSuggestions.length === 1 ? '' : 's'}
                  </div>
                  {accountSuggestions.map((node, index) => (
                    <button
                      type="button"
                      role="option"
                      aria-selected={index === activeSuggestion}
                      id={`account-suggestion-${index}`}
                      key={node.id}
                      onMouseEnter={() => setActiveSuggestion(index)}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => selectAccountSuggestion(node)}
                    >
                      <span className="layered-flow-suggestion-number">{index + 1}</span>
                      <span className="layered-flow-suggestion-copy">
                        <strong>{node.id}</strong>
                        <small>{node.layer.replace('-', ' ')} · {node.depth == null ? 'Not connected' : `Hop ${node.depth}`}</small>
                      </span>
                    </button>
                  ))}
                </>
              ) : (
                <div className="layered-flow-suggestions-empty">No matching accounts in this network.</div>
              )}
            </div>
          )}
        </div>
        <span className="layered-flow-zoom">{Math.round(zoom * 100)}%</span>
        <button type="button" onClick={() => zoomBy(-0.12)} aria-label="Zoom out graph"><ZoomOut size={15} /></button>
        <button type="button" onClick={() => zoomBy(0.12)} aria-label="Zoom in graph"><ZoomIn size={15} /></button>
        <button type="button" onClick={resetView} aria-label="Reset graph view"><Maximize2 size={15} /></button>
      </div>
      <div className="layered-flow-legend">
        {LAYERS.map((layer) => (
          <span key={layer.id} style={{ '--layer-color': layer.color }}>
            <i />
            {layer.short} {layer.label.toLowerCase()}
          </span>
        ))}
        <span className="layered-flow-caveat">Layer roles are heuristic candidates, not verified findings.</span>
      </div>

      <div
        className="layered-flow-viewport"
        ref={viewportRef}
        aria-label="Layered transaction flow graph"
        onPointerDown={startPan}
        onPointerMove={movePan}
        onPointerUp={endPan}
        onPointerCancel={endPan}
        onLostPointerCapture={(event) => {
          if (panPointerRef.current?.pointerId === event.pointerId) panPointerRef.current = null
          event.currentTarget.style.cursor = 'grab'
        }}
        onDoubleClick={() => window.getSelection()?.removeAllRanges()}
        onWheel={onWheel}
      >
        <div
          className="layered-flow-world"
          style={{
            width: graph.width,
            height: graph.height,
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            transformOrigin: '0 0',
          }}
        >
          {LAYERS.map((layer, column) => (
            <div
              key={layer.id}
              className="layered-flow-header"
              style={{ left: 20 + column * 270, '--layer-color': layer.color }}
            >
              <span>{layer.short}</span>
              <strong>{layer.label}</strong>
            </div>
          ))}

          <svg
            className="layered-flow-edges"
            width={graph.width}
            height={graph.height}
            aria-label="Transaction connections"
          >
            <defs>
              {LAYERS.map((layer) => (
                <g key={layer.id}>
                  <linearGradient id={`flow-${layer.id}`} x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" stopColor={layer.color} stopOpacity=".22" />
                    <stop offset="100%" stopColor={layer.color} stopOpacity=".8" />
                  </linearGradient>
                  <marker id={`arrow-${layer.id}`} markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
                    <path d="M0,0 L6,3 L0,6 z" fill={layer.color} />
                  </marker>
                </g>
              ))}
            </defs>
            {graph.visibleLinks.map((link, index) => {
              const colorLayer = graph.layerById.get(link.source) ?? 'participant'
              const edgeKey = `${link.source}\u0000${link.target}`
              const isSelected = edgeKey === selectedEdgeKey
              const isConnected = Boolean(connectedAccounts && (
                connectedAccounts.has(link.source) || connectedAccounts.has(link.target)
              ))
              const isSearchDimmed = Boolean(
                query
                && !link.source.toLowerCase().includes(query)
                && !link.target.toLowerCase().includes(query)
                && !isConnected
              )
              const edgeStateClass = hasSelectedEdge
                ? isSelected
                  ? 'is-selected'
                  : isConnected
                    ? 'is-connected'
                    : 'is-dimmed'
                : hasSelectedNode && isConnected
                  ? 'is-connected'
                  : ''
              return (
                <g key={edgeKey}>
                  <path
                    d={link.d}
                    className={`layered-flow-edge ${edgeStateClass} ${isSearchDimmed ? 'is-search-dimmed' : ''}`}
                    stroke={isSelected || isConnected ? '#f87171' : `url(#flow-${colorLayer})`}
                    markerEnd={`url(#arrow-${colorLayer})`}
                  />
                  {index % (graph.positionedNodes.length > 500 ? 37 : 7) === 0 && (
                    <circle
                      r="3"
                      className={`layered-flow-particle ${edgeStateClass}`}
                      fill={isSelected || isConnected
                        ? '#fca5a5'
                        : LAYERS.find((layer) => layer.id === colorLayer)?.color}
                    >
                      <animateMotion
                        dur={`${3 + (index % 4) * 0.5}s`}
                        repeatCount="indefinite"
                        path={link.d}
                      />
                    </circle>
                  )}
                  <path
                    d={link.d}
                    className={`layered-flow-edge-hit ${isSelected ? 'is-selected' : ''}`}
                    role="button"
                    tabIndex={0}
                    aria-pressed={isSelected}
                    onFocus={() => setSelectedEdgeKey(edgeKey)}
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={() => setSelectedEdgeKey(edgeKey)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        setSelectedEdgeKey(edgeKey)
                      }
                    }}
                    aria-label={`Highlight transfers from ${link.source} to ${link.target}, ${formatMoney(link.total)}`}
                  >
                    <title>{`${link.source} → ${link.target}: ${formatMoney(link.total)} (${link.count} transaction${link.count === 1 ? '' : 's'})`}</title>
                  </path>
                </g>
              )
            })}
          </svg>

          {graph.positionedNodes.map((node) => {
            const layer = LAYERS.find((item) => item.id === node.layer)
            const counts = graph.stats.get(node.id) ?? { incoming: 0, outgoing: 0 }
            const matches = !query || node.id.toLowerCase().includes(query)
            const isTransactionConnected = Boolean(connectedAccounts?.has(node.id))
            const isDimmed = hasSelectedEdge
              ? !isTransactionConnected
              : !matches
            return (
              <button
                key={node.id}
                type="button"
                className={`layered-flow-node ${node.id === String(selectedAccount) ? 'is-subject' : ''} ${node.id === selectedNodeId ? 'is-selected' : ''} ${isTransactionConnected ? 'is-transaction-connected' : ''} ${isDimmed ? 'is-dimmed' : ''}`}
                style={{ left: node.x, top: node.y, '--layer-color': layer?.color }}
                onPointerDown={(event) => event.stopPropagation()}
                onDoubleClick={(event) => {
                  event.preventDefault()
                  window.getSelection()?.removeAllRanges()
                }}
                onClick={() => {
                  setSelectedNodeId(node.id)
                  setSelectedEdgeKey('')
                  setShowAllNodeTransactions(false)
                }}
                title={`Show transactions involving ${node.id}`}
              >
                <span className="layered-flow-node-top">
                  <i>{layer?.short}</i>
                  <span>{counts.incoming} in <ArrowRight size={11} /> {counts.outgoing} out</span>
                </span>
                <strong>{node.id}</strong>
                <span className="layered-flow-node-role">
                  {node.id === selectedNodeId
                    ? 'Transactions selected'
                    : node.id === String(selectedAccount)
                      ? 'Investigation subject'
                      : `${layer?.label.toLowerCase()} · trace hop ${node.depth ?? '—'}`}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      <div className="layered-flow-status">
        <span><ArrowDownLeft size={13} /> {graph.totalNodes} accounts</span>
        <span><ArrowUpRight size={13} /> {links.length} transfers</span>
        <span>
          {selectedNode
            ? `Showing ${selectedNodeTransactions.length} transactions involving ${selectedNodeId}.`
            : selectedEdge
              ? `Highlighting transactions connected to ${selectedEdge.source} or ${selectedEdge.target}.`
              : 'Select an account to view its transactions, or select a route to highlight connected transfers.'}
        </span>
        {selectedEdge && (
          <button type="button" className="layered-flow-clear-selection" onClick={clearEdgeSelection}>
            Clear highlight
          </button>
        )}
        {graph.totalNodes > MAX_NODES && <span>Showing {MAX_NODES} accounts in this view.</span>}
        {graph.visibleLinks.length < graph.totalConnectionGroups && (
          <span>
            Showing {graph.visibleLinks.length} of {graph.totalConnectionGroups} route groups.
          </span>
        )}
      </div>
      {selectedNode && (
        <section className="graph-node-transactions" aria-label={`Transactions involving ${selectedNodeId}`}>
          <div className="graph-node-transactions-heading">
            <div>
              <strong>Transactions involving {selectedNodeId}</strong>
              <span>{selectedNodeTransactions.length} matching record{selectedNodeTransactions.length === 1 ? '' : 's'}</span>
            </div>
            <div className="graph-node-transactions-actions">
              <button type="button" onClick={() => onSelectAccount(selectedNodeId)}>
                Investigate account
              </button>
              <button
                type="button"
                className="graph-node-transactions-close"
                onClick={() => {
                  setSelectedNodeId('')
                  setShowAllNodeTransactions(false)
                }}
                aria-label="Close node transactions"
              >
                ×
              </button>
            </div>
          </div>
          {selectedNodeTransactions.length ? (
            <div className="graph-node-transactions-list">
              {(showAllNodeTransactions
                ? selectedNodeTransactions
                : selectedNodeTransactions.slice(0, 8)
              ).map((link, index) => {
                const source = endpointId(link.source)
                const target = endpointId(link.target)
                return (
                  <button
                    type="button"
                    className="graph-node-transaction"
                    key={`${link.transactionId ?? index}-${source}-${target}`}
                    onClick={() => onSelectTransaction?.({
                      transaction_id: link.transactionId,
                      sender_account: source,
                      receiver_account: target,
                      amount: link.amount,
                      timestamp: link.timestamp,
                      payment_mode: link.paymentMode,
                      narration: link.narration,
                      sender_ifsc: link.senderIfsc,
                      receiver_ifsc: link.receiverIfsc,
                      ip_address: link.ipAddress,
                      device_type: link.deviceType,
                      hop: link.hop,
                    })}
                  >
                    <span>
                      <strong>{link.transactionId ?? `Transaction ${index + 1}`}</strong>
                      <small>{source} → {target}</small>
                    </span>
                    <span className="graph-node-transaction-meta">
                      <strong>{formatMoney(link.amount)}</strong>
                      <small>{String(link.timestamp || link.paymentMode || 'Time unavailable')}</small>
                    </span>
                  </button>
                )
              })}
              {!showAllNodeTransactions && selectedNodeTransactions.length > 8 && (
                <button
                  type="button"
                  className="graph-node-transactions-more"
                  onClick={() => setShowAllNodeTransactions(true)}
                >
                  Show all {selectedNodeTransactions.length} transactions
                </button>
              )}
            </div>
          ) : (
            <p className="graph-node-transactions-empty">No transaction records are available for this account.</p>
          )}
          {onExpandAccount && (
            <div className="graph-node-outgoing-expansion">
              {canExpandSelectedNode ? (
                <>
                  <button
                    type="button"
                    className="graph-node-transactions-more"
                    onClick={loadOutgoingPage}
                    disabled={outgoingPage.loading || !outgoingPage.hasMore}
                  >
                    {outgoingPage.loading
                      ? 'Loading outgoing transfers…'
                      : outgoingPage.started
                        ? outgoingPage.hasMore && outgoingPage.offset > 0
                          ? 'Load next 100 outgoing transfers'
                          : outgoingPage.hasMore
                            ? 'Load outgoing transfers'
                            : 'No more outgoing transfers'
                        : 'Load outgoing transfers'}
                  </button>
                  {outgoingPage.started && (
                    <span>Fetched {outgoingPage.fetched} records for this account.</span>
                  )}
                </>
              ) : !Number.isFinite(selectedNodeHop) ? (
                <span>The trace depth for this account is unavailable.</span>
              ) : selectedNodeHop >= maxHops ? (
                <span>This account is already at the selected hop limit.</span>
              ) : (
                <span>Cannot continue this path because its receipt time is unavailable.</span>
              )}
              {outgoingPage.error && <span role="alert">{outgoingPage.error}</span>}
            </div>
          )}
        </section>
      )}
    </div>
  )
}
