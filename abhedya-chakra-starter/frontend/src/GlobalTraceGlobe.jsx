import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { Activity, Globe2, LocateFixed, Radio } from 'lucide-react'

const ACCOUNT_ROLES = {
  selected: { label: 'Selected account', color: '#ffc36e', hex: 0xffc36e },
  collector: { label: 'Collector candidate', color: '#55d6a1', hex: 0x55d6a1 },
  distributor: { label: 'Distributor candidate', color: '#a78bfa', hex: 0xa78bfa },
  terminal: { label: 'Terminal indicator', color: '#fb8b72', hex: 0xfb8b72 },
  participant: { label: 'Other participant', color: '#58d6df', hex: 0x58d6df },
}

const TRACE_LAYERS = [
  { label: 'L0 · Subject', color: '#ffc36e', hex: 0xffc36e },
  { label: 'L1 · First hop', color: '#55d6a1', hex: 0x55d6a1 },
  { label: 'L2 · Second hop', color: '#a78bfa', hex: 0xa78bfa },
  { label: 'L3 · Third hop', color: '#fb8b72', hex: 0xfb8b72 },
  { label: 'L4 · Further hops', color: '#58d6df', hex: 0x58d6df },
]

function hashFor(value) {
  const text = String(value)
  let hash = 2166136261
  for (let i = 0; i < text.length; i += 1) {
    hash = Math.imul(hash ^ text.charCodeAt(i), 16777619) >>> 0
  }
  return hash
}

function coordinatesFor(value) {
  const hash = hashFor(value)
  return {
    latitude: ((hash % 14000) / 100) - 70,
    longitude: (((hash >>> 8) % 36000) / 100) - 180,
  }
}

function stablePoint(coordinates) {
  const { latitude, longitude } = coordinates
  const phi = (90 - latitude) * (Math.PI / 180)
  const theta = (longitude + 180) * (Math.PI / 180)
  return new THREE.Vector3(
    -(Math.sin(phi) * Math.cos(theta)),
    Math.cos(phi),
    Math.sin(phi) * Math.sin(theta),
  )
}

function accountId(value) {
  return String(value?.id ?? value ?? '')
}

function money(value) {
  const amount = Number(value)
  if (!Number.isFinite(amount)) return 'Amount unavailable'
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(amount)
}

function getAccountRoles(routes, selectedAccount) {
  const incoming = new Map()
  const outgoing = new Map()
  const terminalIndicators = new Set()

  routes.forEach((route) => {
    if (!incoming.has(route.targetId)) incoming.set(route.targetId, new Set())
    if (!outgoing.has(route.sourceId)) outgoing.set(route.sourceId, new Set())
    incoming.get(route.targetId).add(route.sourceId)
    outgoing.get(route.sourceId).add(route.targetId)

    if (
      /\b(CRYPTO|P2P|CASH.?OUT|ATM|WALLET|OFFSHORE)\b/i.test(route.narration ?? '')
      || /^(web_emulator|linux_script)$/i.test(route.deviceType ?? '')
    ) {
      terminalIndicators.add(route.sourceId)
    }
  })

  const roles = new Map()
  const selectedId = String(selectedAccount ?? '')
  const accounts = new Set([...incoming.keys(), ...outgoing.keys()])
  accounts.forEach((id) => {
    if (id === selectedId) {
      roles.set(id, 'selected')
      return
    }

    const inboundCount = incoming.get(id)?.size ?? 0
    const outboundCount = outgoing.get(id)?.size ?? 0
    if (terminalIndicators.has(id)) roles.set(id, 'terminal')
    else if (inboundCount >= 3) roles.set(id, 'collector')
    else if (outboundCount >= 3) roles.set(id, 'distributor')
    else roles.set(id, 'participant')
  })
  return roles
}

function addTraceLayers(routes, selectedAccount) {
  const depthByAccount = new Map([[String(selectedAccount ?? ''), 0]])
  const outgoing = new Map()
  routes.forEach((route) => {
    if (!outgoing.has(route.sourceId)) outgoing.set(route.sourceId, [])
    outgoing.get(route.sourceId).push(route.targetId)
  })

  const queue = [String(selectedAccount ?? '')]
  for (let index = 0; index < queue.length; index += 1) {
    const source = queue[index]
    for (const target of outgoing.get(source) ?? []) {
      if (depthByAccount.has(target)) continue
      depthByAccount.set(target, depthByAccount.get(source) + 1)
      queue.push(target)
    }
  }

  return routes.map((route) => {
    const sourceDepth = depthByAccount.get(route.sourceId)
    const targetDepth = depthByAccount.get(route.targetId)
    const graphHop = Number(route.hop)
    const depth = targetDepth ?? (
      sourceDepth !== undefined ? sourceDepth + 1
        : Number.isInteger(graphHop) && graphHop > 0 ? graphHop
          : TRACE_LAYERS.length - 1
    )
    const layerIndex = Math.max(0, Math.min(TRACE_LAYERS.length - 1, depth))
    return { ...route, layerIndex }
  })
}

export default function GlobalTraceGlobe({ links = [], selectedAccount, onSelectAccount }) {
  const mountRef = useRef(null)
  const onSelectAccountRef = useRef(onSelectAccount)
  const selectedLinkRef = useRef(null)
  const routeLinesRef = useRef([])
  const [selectedLink, setSelectedLink] = useState(null)
  useEffect(() => {
    onSelectAccountRef.current = onSelectAccount
  }, [onSelectAccount])
  const routes = useMemo(() => addTraceLayers(
    links.slice(0, 600).map((link) => ({
      ...link,
      sourceId: accountId(link.source),
      targetId: accountId(link.target),
    })).filter((link) => link.sourceId && link.targetId),
    selectedAccount,
  ), [links, selectedAccount])
  const accounts = useMemo(() => {
    const ids = new Set()
    routes.forEach((route) => {
      ids.add(route.sourceId)
      ids.add(route.targetId)
    })
    return [...ids]
  }, [routes])
  const accountCoordinates = useMemo(
    () => new Map(accounts.map((id) => [id, coordinatesFor(id)])),
    [accounts],
  )
  const accountRoles = useMemo(
    () => getAccountRoles(routes, selectedAccount),
    [routes, selectedAccount],
  )
  useEffect(() => {
    const selectedIndex = selectedLink === null
      ? -1
      : Math.min(selectedLink, routes.length - 1)
    selectedLinkRef.current = selectedIndex
    const selectedRoute = routes[selectedIndex]
    routeLinesRef.current.forEach(({ line, glow }, index) => {
      const route = routes[index]
      const isConnected = selectedRoute && route && (
        route.sourceId === selectedRoute.sourceId
        || route.sourceId === selectedRoute.targetId
        || route.targetId === selectedRoute.sourceId
        || route.targetId === selectedRoute.targetId
      )
      line.material.color.setHex(index === selectedIndex
        ? 0xffbf69
        : TRACE_LAYERS[route?.layerIndex ?? TRACE_LAYERS.length - 1].hex)
      glow.material.color.setHex(index === selectedIndex ? 0xffd17e : 0x78dcf2)
      glow.material.opacity = index === selectedIndex ? 0.82 : isConnected ? 0.42 : 0
    })
  }, [accountRoles, routes, selectedLink])
  const selectedRoute = selectedLink === null ? null : routes[Math.min(selectedLink, routes.length - 1)]
  const plottedAccount = selectedAccount
  const plottedCoordinates = plottedAccount
    ? accountCoordinates.get(String(plottedAccount)) ?? coordinatesFor(plottedAccount)
    : null
  const observedIps = [...new Set(
    routes
      .filter((route) => (route.sourceId === plottedAccount || route.targetId === plottedAccount) && route.ipAddress)
      .map((route) => String(route.ipAddress)),
  )]
  const selectedIp = selectedRoute?.ipAddress
    && (selectedRoute.sourceId === plottedAccount || selectedRoute.targetId === plottedAccount)
    ? String(selectedRoute.ipAddress)
    : observedIps[0]
  const otherIpCount = Math.max(0, observedIps.length - (selectedIp && observedIps.includes(selectedIp) ? 1 : 0))

  useEffect(() => {
    const container = mountRef.current
    if (!container) return undefined

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 1000)
    camera.position.set(0, 0, 265)

    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    renderer.setClearColor(0x000000, 0)
    container.appendChild(renderer.domElement)

    const world = new THREE.Group()
    scene.add(world)
    const radius = 82

    const sphere = new THREE.Mesh(
      new THREE.SphereGeometry(radius, 64, 48),
      new THREE.MeshBasicMaterial({ color: 0x081725, transparent: true, opacity: 0.94 }),
    )
    world.add(sphere)

    const grid = new THREE.Mesh(
      new THREE.SphereGeometry(radius + 0.4, 36, 24),
      new THREE.MeshBasicMaterial({
        color: 0x2b607a,
        wireframe: true,
        transparent: true,
        opacity: 0.26,
      }),
    )
    world.add(grid)

    const orbit = new THREE.Mesh(
      new THREE.TorusGeometry(radius + 17, 0.35, 6, 140),
      new THREE.MeshBasicMaterial({ color: 0x43b9dc, transparent: true, opacity: 0.35 }),
    )
    orbit.rotation.x = Math.PI * 0.42
    orbit.rotation.y = Math.PI * 0.12
    world.add(orbit)

    const starPositions = []
    for (let i = 0; i < 900; i += 1) {
      const hash = hashFor(`star-${i}`)
      const point = stablePoint({
        latitude: ((hash % 14000) / 100) - 70,
        longitude: (((hash >>> 8) % 36000) / 100) - 180,
      }).multiplyScalar(230 + ((i * 37) % 90))
      starPositions.push(point.x, point.y, point.z)
    }
    const starsGeometry = new THREE.BufferGeometry()
    starsGeometry.setAttribute('position', new THREE.Float32BufferAttribute(starPositions, 3))
    const stars = new THREE.Points(
      starsGeometry,
      new THREE.PointsMaterial({ color: 0x7daec2, size: 0.8, transparent: true, opacity: 0.55 }),
    )
    scene.add(stars)

    const nodePoints = []
    const nodeColors = []
    accounts.forEach((id) => {
      const point = stablePoint(accountCoordinates.get(id)).multiplyScalar(radius + 1.5)
      nodePoints.push(point.x, point.y, point.z)
      const color = new THREE.Color(ACCOUNT_ROLES[accountRoles.get(id) ?? 'participant'].hex)
      nodeColors.push(color.r, color.g, color.b)
    })
    const nodesGeometry = new THREE.BufferGeometry()
    nodesGeometry.setAttribute('position', new THREE.Float32BufferAttribute(nodePoints, 3))
    nodesGeometry.setAttribute('color', new THREE.Float32BufferAttribute(nodeColors, 3))
    const nodes = new THREE.Points(
      nodesGeometry,
      new THREE.PointsMaterial({
        size: 3.1,
        vertexColors: true,
        transparent: true,
        opacity: 0.95,
        sizeAttenuation: false,
      }),
    )
    world.add(nodes)
    const raycaster = new THREE.Raycaster()
    raycaster.params.Points.threshold = 3.5

    const routeLines = []
    routes.forEach((route, index) => {
      const start = stablePoint(accountCoordinates.get(route.sourceId)).multiplyScalar(radius + 1.5)
      const end = stablePoint(accountCoordinates.get(route.targetId)).multiplyScalar(radius + 1.5)
      const middleDirection = start.clone().add(end)
      if (middleDirection.lengthSq() < 0.0001) middleDirection.set(0, 1, 0)
      const middle = middleDirection.normalize().multiplyScalar(
        radius + 12 + route.layerIndex * 3.4 + (index % 5) * 1.3,
      )
      const curve = new THREE.QuadraticBezierCurve3(start, middle, end)
      const geometry = new THREE.TubeGeometry(curve, 28, 0.34, 5, false)
      const glowGeometry = new THREE.TubeGeometry(curve, 28, 1.15, 5, false)
      const material = new THREE.MeshBasicMaterial({
        color: TRACE_LAYERS[route.layerIndex].hex,
        transparent: true,
        opacity: 0.78,
        depthWrite: false,
      })
      const glowMaterial = new THREE.MeshBasicMaterial({
        color: 0x78dcf2,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      })
      const line = new THREE.Mesh(geometry, material)
      const glow = new THREE.Mesh(glowGeometry, glowMaterial)
      line.renderOrder = 2
      glow.renderOrder = 1
      world.add(line)
      world.add(glow)
      routeLines.push({ line, glow })
    })
    routeLinesRef.current = routeLines

    let width = 0
    let height = 0
    const resize = () => {
      width = container.clientWidth
      height = container.clientHeight
      if (width === 0 || height === 0) return
      renderer.setSize(width, height)
      camera.aspect = width / height
      camera.updateProjectionMatrix()
    }
    const observer = new ResizeObserver(resize)
    observer.observe(container)
    resize()

    let dragging = false
    let moved = false
    let activePointerId = null
    let previousX = 0
    let previousY = 0
    const onPointerDown = (event) => {
      if (event.button !== 0) return
      dragging = true
      moved = false
      activePointerId = event.pointerId
      previousX = event.clientX
      previousY = event.clientY
      renderer.domElement.style.cursor = 'grabbing'
      renderer.domElement.setPointerCapture(event.pointerId)
    }
    const onPointerMove = (event) => {
      if (!dragging) return
      const deltaX = event.clientX - previousX
      const deltaY = event.clientY - previousY
      if (Math.abs(deltaX) + Math.abs(deltaY) > 2) moved = true
      world.rotation.y += deltaX * 0.006
      world.rotation.x = THREE.MathUtils.clamp(world.rotation.x + deltaY * 0.006, -1.35, 1.35)
      previousX = event.clientX
      previousY = event.clientY
    }
    const finishPointer = (event, shouldSelect) => {
      if (!dragging) return
      dragging = false
      activePointerId = null
      renderer.domElement.style.cursor = 'grab'
      if (renderer.domElement.hasPointerCapture(event.pointerId)) {
        renderer.domElement.releasePointerCapture(event.pointerId)
      }
      if (!shouldSelect || moved) return
      const bounds = renderer.domElement.getBoundingClientRect()
      const pointer = new THREE.Vector2(
        ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
        -((event.clientY - bounds.top) / bounds.height) * 2 + 1,
      )
      raycaster.setFromCamera(pointer, camera)
      const hit = raycaster.intersectObject(nodes)[0]
      if (hit?.index == null) return
      const account = accounts[hit.index]
      if (account) {
        const routeIndex = routes.findIndex(
          (route) => route.sourceId === account || route.targetId === account,
        )
        if (routeIndex >= 0) setSelectedLink(routeIndex)
        onSelectAccountRef.current?.(account)
      }
    }
    const onPointerUp = (event) => finishPointer(event, true)
    const onPointerCancel = (event) => finishPointer(event, false)
    const onLostPointerCapture = (event) => {
      if (activePointerId !== event.pointerId) return
      dragging = false
      activePointerId = null
      renderer.domElement.style.cursor = 'grab'
    }
    const onWindowBlur = () => {
      dragging = false
      activePointerId = null
      renderer.domElement.style.cursor = 'grab'
    }
    renderer.domElement.addEventListener('pointerdown', onPointerDown)
    renderer.domElement.addEventListener('pointermove', onPointerMove)
    renderer.domElement.addEventListener('pointerup', onPointerUp)
    renderer.domElement.addEventListener('pointercancel', onPointerCancel)
    renderer.domElement.addEventListener('lostpointercapture', onLostPointerCapture)
    window.addEventListener('blur', onWindowBlur)

    let frame = 0
    let animationId = 0
    const animate = () => {
      animationId = window.requestAnimationFrame(animate)
      if (!dragging) world.rotation.y += 0.0009
      frame += 1
      const activeRoute = routes[selectedLinkRef.current]
      routeLines.forEach(({ line, glow }, index) => {
        const route = routes[index]
        const isSelected = index === selectedLinkRef.current
        const isConnected = activeRoute && route && (
          route.sourceId === activeRoute.sourceId
          || route.sourceId === activeRoute.targetId
          || route.targetId === activeRoute.sourceId
          || route.targetId === activeRoute.targetId
        )
        line.material.opacity = selectedLinkRef.current < 0
          ? 0.72 + (Math.sin(frame * 0.025 + index) + 1) * 0.08
          : isSelected ? 1 : isConnected ? 0.92 : 0.09
        glow.material.opacity = isSelected ? 0.82 : isConnected ? 0.38 : 0
      })
      renderer.render(scene, camera)
    }
    animate()

    return () => {
      window.cancelAnimationFrame(animationId)
      observer.disconnect()
      renderer.domElement.removeEventListener('pointerdown', onPointerDown)
      renderer.domElement.removeEventListener('pointermove', onPointerMove)
      renderer.domElement.removeEventListener('pointerup', onPointerUp)
      renderer.domElement.removeEventListener('pointercancel', onPointerCancel)
      renderer.domElement.removeEventListener('lostpointercapture', onLostPointerCapture)
      window.removeEventListener('blur', onWindowBlur)
      if (activePointerId !== null && renderer.domElement.hasPointerCapture(activePointerId)) {
        renderer.domElement.releasePointerCapture(activePointerId)
      }
      dragging = false
      activePointerId = null
      renderer.domElement.style.cursor = 'grab'
      routeLinesRef.current = []
      scene.traverse((object) => {
        object.geometry?.dispose()
        if (Array.isArray(object.material)) object.material.forEach((material) => material.dispose())
        else object.material?.dispose()
      })
      renderer.dispose()
      renderer.domElement.remove()
    }
  }, [accounts, routes, accountRoles, accountCoordinates])

  const chooseRoute = (route, index) => {
    setSelectedLink(index)
    onSelectAccount?.(route.sourceId)
  }

  return (
    <div className="globe-layout">
      <div className="globe-visual">
        <div className="globe-status"><Radio size={14} /> TRACE ROUTES · {routes.length}</div>
        <div className="globe-canvas" ref={mountRef} aria-label="Interactive 3D transaction flow globe" />
        {routes.length === 0 && (
          <div className="globe-empty">
            <Globe2 size={28} />
            <strong>No trace routes to plot</strong>
            <span>Search for an account with transaction activity to populate the globe.</span>
          </div>
        )}
        {plottedCoordinates && (
          <div className="globe-coordinate-card">
            <div className="globe-coordinate-heading">
              <LocateFixed size={14} />
              <span>SELECTED PLOT · SCHEMATIC</span>
            </div>
            <strong className="globe-coordinate-account">{plottedAccount}</strong>
            <div className="globe-coordinate-values">
              <span>LAT <strong>{plottedCoordinates.latitude.toFixed(4)}°</strong></span>
              <span>LON <strong>{plottedCoordinates.longitude.toFixed(4)}°</strong></span>
            </div>
            <div className="globe-coordinate-ip">
              <span>Recorded IP on connected transfers</span>
              <strong>
                {selectedIp || 'Not present in trace'}
                {otherIpCount > 0 ? ` · +${otherIpCount} more` : ''}
              </strong>
            </div>
          </div>
        )}
        <div className="globe-hint"><LocateFixed size={13} /> Drag to rotate · Account roles are trace heuristics</div>
      </div>
      <aside className="globe-details">
        <div className="globe-detail-heading">
          <div className="globe-detail-icon"><Globe2 size={17} /></div>
          <div>
            <strong>Global trace</strong>
            <span>Account-to-account movement</span>
          </div>
        </div>
        <div className="globe-metrics">
          <div><span>ACCOUNTS</span><strong>{accounts.length}</strong></div>
          <div><span>TRANSFERS</span><strong>{routes.length}</strong></div>
        </div>
        <div className="globe-route-title"><Activity size={14} /> TRACE ROUTES</div>
        <div className="globe-legend" aria-label="Transaction hop layer legend">
          {TRACE_LAYERS.map((layer) => (
            <span key={layer.label}>
              <i style={{ '--role-color': layer.color }} />
              {layer.label}
            </span>
          ))}
        </div>
        <div className="globe-route-list">
          {routes.slice(0, 10).map((route, index) => (
            <button
              type="button"
              className={`globe-route ${selectedLink === index ? 'selected' : ''}`}
              key={`${route.transactionId ?? index}-${route.sourceId}-${route.targetId}`}
              onClick={() => chooseRoute(route, index)}
            >
              <span
                className="route-dot"
                style={{ '--role-color': TRACE_LAYERS[route.layerIndex].color }}
              />
              <span className="route-accounts">
                <strong>{route.sourceId}</strong>
                <span>
                  L{route.layerIndex} · {route.sourceId}
                  {' → '}{route.targetId}
                </span>
              </span>
              <span className="route-amount">{money(route.amount)}</span>
            </button>
          ))}
          {routes.length > 10 && (
            <div className="globe-more">Showing 10 of {routes.length} plotted transfers</div>
          )}
        </div>
        {selectedRoute && (
          <div className="globe-transaction-detail">
            <div className="globe-route-title"><Activity size={14} /> SELECTED TRANSFER</div>
            <div className="globe-detail-row">
              <span>Transaction</span><strong>{selectedRoute.transactionId ?? 'Not provided'}</strong>
            </div>
            <div className="globe-detail-row">
              <span>Plot coordinates</span>
              <strong>
                {selectedRoute.sourceId}: {accountCoordinates.get(selectedRoute.sourceId).latitude.toFixed(2)}°, {accountCoordinates.get(selectedRoute.sourceId).longitude.toFixed(2)}°
                {' → '}
                {selectedRoute.targetId}: {accountCoordinates.get(selectedRoute.targetId).latitude.toFixed(2)}°, {accountCoordinates.get(selectedRoute.targetId).longitude.toFixed(2)}°
              </strong>
            </div>
            <div className="globe-detail-row">
              <span>Observed IP</span>
              <strong>{selectedRoute.ipAddress || 'Not present in this record'}</strong>
            </div>
            <div className="globe-detail-row">
              <span>Purpose / narration</span>
              <strong>{selectedRoute.narration?.trim() || 'Not provided in this record'}</strong>
            </div>
            <div className="globe-detail-row">
              <span>Payment mode</span><strong>{selectedRoute.paymentMode || 'Not provided'}</strong>
            </div>
            <div className="globe-detail-row">
              <span>Device type</span><strong>{selectedRoute.deviceType || 'Not provided'}</strong>
            </div>
            <p className="globe-record-note">
              IP and narration are displayed as supplied by the transaction record.
              They do not establish location, user identity, or actual transfer purpose.
            </p>
          </div>
        )}
        <p className="globe-disclaimer">
          Schematic visualization only. Coordinates are layout positions, not geolocation.
          Account role colors are heuristic candidates from this trace; verify all
          evidence independently.
        </p>
      </aside>
    </div>
  )
}
