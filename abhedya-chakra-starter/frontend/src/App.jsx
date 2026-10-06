
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import axios from 'axios'
import MoneyFlowGraph from './MoneyFlowGraph'
import {
  Activity,
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpRight,
  Search,
  Shield,
  Network,
  RefreshCw,
  Clock3,
  FileText,
  Database,
  ChevronLeft,
  ChevronRight,
  Globe2,
  CircleDollarSign,
  Play,
  Pause,
  Rewind,
  Upload,
  Maximize2,
  Minimize2,
  Mail,
  ExternalLink,
  Download,
} from 'lucide-react'
import './index.css'

const GlobalTraceGlobe = lazy(() => import('./GlobalTraceGlobe'))
const SLIDES = [
  { id: 'brief', label: 'Brief & timeline', description: 'Review the current account summary and replay traced activity.' },
  { id: 'money-flow', label: 'Money-flow analysis', description: 'Inspect the selected account’s connected transaction network.' },
  { id: 'account-intelligence', label: 'Account intelligence', description: 'Review risk indicators and transaction totals for the selected account.' },
  { id: 'global-trace', label: 'Global trace globe', description: 'Explore account nodes, schematic coordinates, and recorded transfer details.' },
  { id: 'case-reports', label: 'Transactions & reports', description: 'Inspect trace transactions and prepare evidence-backed draft reports.' },
  { id: 'anomalies', label: 'Anomaly detection', description: 'Review dataset-wide anomaly candidates and investigate accounts.' },
]

const api = axios.create({
  baseURL: '/api',
  timeout: 30000,
})


const fmtMoney = (value) => {
  if (value === null || value === undefined || value === '') return 'â€”'

  const number = Number(value)
  if (!Number.isFinite(number)) return 'â€”'

  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(number)
}

const fmtNumber = (value) => {
  const number = Number(value)
  return Number.isFinite(number)
    ? new Intl.NumberFormat('en-IN').format(number)
    : 'â€”'
}

const first = (obj, keys, fallback = null) => {
  for (const key of keys) {
    if (obj?.[key] !== undefined && obj?.[key] !== null) {
      return obj[key]
    }
  }
  return fallback
}

function getTransactionMinute(tx) {
  const timestamp = first(tx, [
    'Timestamp',
    'timestamp',
    'time',
    'transaction_timestamp',
    'datetime',
    'date',
  ], '')
  if (!timestamp) return null

  if (typeof timestamp === 'number') {
    const milliseconds = timestamp < 1e12 ? timestamp * 1000 : timestamp
    return Number.isFinite(milliseconds) ? Math.floor(milliseconds / 60000) : null
  }

  const value = String(timestamp).trim().replace(' ', 'T')
  const hasTimezone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value)
  const parsed = Date.parse(hasTimezone ? value : `${value}Z`)

  return Number.isFinite(parsed) ? Math.floor(parsed / 60000) : null
}

function formatTimelineMinute(minute) {
  return new Date(minute * 60000).toISOString().slice(0, 16).replace('T', ' ')
}

function escapeHtml(value) {
  const replacements = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }

  return String(value ?? 'Not available').replace(
    /[&<>"']/g,
    (character) => replacements[character]
  )
}

function normalizeTransactions(trace) {
  if (Array.isArray(trace)) return trace

  for (const key of ['transactions', 'edges', 'results', 'flows', 'data']) {
    if (Array.isArray(trace?.[key])) return trace[key]
  }

  return []
}

function transactionRisk(tx) {
  const reasons = []
  let score = 0
  const narration = String(first(tx, ['Narration', 'narration'], '')).toLowerCase()
  const device = String(first(tx, ['Device_Type', 'device_type'], '')).toLowerCase()
  const ipAddress = String(first(tx, ['IP_Address', 'ip_address'], ''))
  const hop = Number(first(tx, ['hop'], 0))

  if (/\b(crypto|p2p|cash.?out|atm|wallet|offshore)\b/i.test(narration)) {
    score += 30
    reasons.push('Narration contains a cash-out or high-risk activity keyword.')
  }
  if (['web_emulator', 'linux_script'].includes(device)) {
    score += 25
    reasons.push('Recorded device type matches a configured automation indicator.')
  }
  if (/^(185|194)\./.test(ipAddress)) {
    score += 20
    reasons.push('Recorded IP prefix matches a proxy-risk screening rule.')
  }
  if (Number.isFinite(hop) && hop >= 3) {
    score += 15
    reasons.push('Transfer appears at hop 3 or later in the bounded trace.')
  }

  return {
    score: Math.min(score, 90),
    reasons: reasons.length ? reasons : ['No configured transaction-level screening cues were triggered.'],
  }
}

const TRANSACTION_DETAIL_FIELDS = [
  { label: 'Transaction ID', keys: ['Transaction_ID', 'transaction_id', 'id'] },
  { label: 'Date and time', keys: ['Timestamp', 'timestamp', 'time'] },
  { label: 'Amount', keys: ['Amount', 'amount', 'value'] },
  { label: 'Sender account', keys: ['Sender_Account', 'sender_account', 'sender', 'source', 'from'] },
  { label: 'Sender IFSC', keys: ['Sender_IFSC', 'sender_ifsc'] },
  { label: 'Receiver account', keys: ['Receiver_Account', 'receiver_account', 'receiver', 'target', 'to'] },
  { label: 'Receiver IFSC', keys: ['Receiver_IFSC', 'receiver_ifsc'] },
  { label: 'Payment mode', keys: ['Payment_Mode', 'payment_mode', 'mode'] },
  { label: 'Narration', keys: ['Narration', 'narration'] },
  { label: 'IP address', keys: ['IP_Address', 'ip_address'] },
  { label: 'Device type', keys: ['Device_Type', 'device_type'] },
  { label: 'Trace hop', keys: ['hop'] },
]

function formatTransactionDetailValue(key, value) {
  if (value === null || value === undefined || value === '') return 'Not available'

  const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/g, '')
  if (normalizedKey === 'amount' || normalizedKey === 'value') {
    return fmtMoney(value)
  }

  if (['timestamp', 'time', 'datetime'].includes(normalizedKey)) {
    const date = new Date(value)
    if (Number.isFinite(date.getTime())) {
      return new Intl.DateTimeFormat('en-IN', {
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(date)
    }
  }

  if (Array.isArray(value)) {
    return value.map((item) => formatTransactionDetailValue('', item)).join(', ')
  }

  if (typeof value === 'object') {
    return Object.entries(value)
      .map(([name, item]) => `${formatTransactionDetailLabel(name)}: ${formatTransactionDetailValue(name, item)}`)
      .join(' · ')
  }

  return String(value)
}

function formatTransactionDetailLabel(key) {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase())
}

function getTransactionDetails(tx) {
  const fields = []
  const usedKeys = new Set()

  for (const field of TRANSACTION_DETAIL_FIELDS) {
    const key = field.keys.find((candidate) =>
      Object.prototype.hasOwnProperty.call(tx, candidate)
      && tx[candidate] !== null
      && tx[candidate] !== ''
    )

    if (!key) continue

    usedKeys.add(key)
    fields.push({
      label: field.label,
      value: formatTransactionDetailValue(key, tx[key]),
      prominent: field.label === 'Amount',
    })
  }

  for (const [key, value] of Object.entries(tx)) {
    if (usedKeys.has(key) || value === null || value === undefined || value === '') continue
    fields.push({
      label: formatTransactionDetailLabel(key),
      value: formatTransactionDetailValue(key, value),
    })
  }

  return fields
}

function normalizeGraph(trace, accountId) {
  const transactions = normalizeTransactions(trace)
  const nodeMap = new Map()
  const links = []

  const addNode = (id) => {
    if (id === undefined || id === null || id === '') return

    const key = String(id)
    if (!nodeMap.has(key)) nodeMap.set(key, { id: key })
  }

  addNode(accountId)

  transactions.forEach((tx, index) => {
    const source = first(tx, [
      'Sender_Account',
      'sender_account',
      'sender',
      'source',
      'from',
    ])

    const target = first(tx, [
      'Receiver_Account',
      'receiver_account',
      'receiver',
      'target',
      'to',
    ])

    if (source == null || target == null) return

    addNode(source)
    addNode(target)

    
 links.push({
  source: String(source),
  target: String(target),
  amount: first(tx, ['Amount', 'amount', 'value'], 0),
  timestamp: first(tx, ['Timestamp', 'timestamp', 'time'], ''),
  transactionId: first(
    tx,
    ['Transaction_ID', 'transaction_id', 'id'],
    index + 1
  ),
  paymentMode: first(tx, ['Payment_Mode', 'payment_mode'], ''),
  narration: first(tx, ['Narration', 'narration'], ''),
  senderIfsc: first(tx, ['Sender_IFSC', 'sender_ifsc'], ''),
  receiverIfsc: first(tx, ['Receiver_IFSC', 'receiver_ifsc'], ''),
  ipAddress: first(tx, ['IP_Address', 'ip_address'], ''),
  deviceType: first(tx, ['Device_Type', 'device_type'], ''),
  hop: first(tx, ['hop'], null),
  })
  })

  const nodes = [...nodeMap.values()]
  const nodeIds = new Set(nodes.map((node) => node.id))
  const incomingAccounts = new Map()
  const outgoingAccounts = new Map()
  const terminalIndicators = new Set()

  links.forEach((link) => {
    const sender = String(link.source)
    const receiver = String(link.target)
    if (!incomingAccounts.has(receiver)) incomingAccounts.set(receiver, new Set())
    if (!outgoingAccounts.has(sender)) outgoingAccounts.set(sender, new Set())
    incomingAccounts.get(receiver).add(sender)
    outgoingAccounts.get(sender).add(receiver)

    if (
      /\b(CRYPTO|P2P|CASH.?OUT|ATM|WALLET|OFFSHORE)\b/i.test(link.narration)
      || ['web_emulator', 'linux_script'].includes(String(link.deviceType).toLowerCase())
      || /^(185|194)\./.test(String(link.ipAddress))
    ) {
      terminalIndicators.add(sender)
    }
  })

  nodes.forEach((node) => {
    const fanIn = incomingAccounts.get(node.id)?.size ?? 0
    const fanOut = outgoingAccounts.get(node.id)?.size ?? 0
    node.layerCandidate = fanIn >= 5
      ? 'L1'
      : fanOut >= 3 && fanOut <= 7
        ? 'L2'
        : terminalIndicators.has(node.id)
          ? 'L3'
          : null
  })

  return {
    nodes,
    links: links.filter(
      (link) =>
        nodeIds.has(String(link.source?.id ?? link.source)) &&
        nodeIds.has(String(link.target?.id ?? link.target))
    ),
    rawTransactions: transactions,
  }
}

function isolateWeakComponent(graph, startId) {
  if (!startId || !graph.nodes.some((node) => node.id === startId)) {
    return graph
  }

  const adjacent = new Map()
  graph.links.forEach((link) => {
    const source = String(link.source?.id ?? link.source)
    const target = String(link.target?.id ?? link.target)
    if (!adjacent.has(source)) adjacent.set(source, [])
    if (!adjacent.has(target)) adjacent.set(target, [])
    adjacent.get(source).push(target)
    adjacent.get(target).push(source)
  })

  const accountIds = new Set([startId])
  const queue = [startId]
  for (let index = 0; index < queue.length; index += 1) {
    for (const neighbor of adjacent.get(queue[index]) ?? []) {
      if (!accountIds.has(neighbor)) {
        accountIds.add(neighbor)
        queue.push(neighbor)
      }
    }
  }

  const links = graph.links.filter((link) =>
    accountIds.has(String(link.source?.id ?? link.source))
    && accountIds.has(String(link.target?.id ?? link.target))
  )

  return {
    nodes: graph.nodes.filter((node) => accountIds.has(node.id)),
    links,
    rawTransactions: links.map((link) => ({
      transaction_id: link.transactionId,
      sender_account: String(link.source?.id ?? link.source),
      receiver_account: String(link.target?.id ?? link.target),
      amount: link.amount,
      timestamp: link.timestamp,
      payment_mode: link.paymentMode,
      narration: link.narration,
      sender_ifsc: link.senderIfsc,
      receiver_ifsc: link.receiverIfsc,
      ip_address: link.ipAddress,
      device_type: link.deviceType,
      hop: link.hop,
    })),
  }
}

function csvCell(value) {
  let text = value === null || value === undefined ? '' : String(value)
  if (/^[\t\r ]*[=+\-@]/.test(text)) text = `'${text}`
  return `"${text.replaceAll('"', '""')}"`
}

function StatCard({ icon: Icon, label, value, note }) {
  return (
    <div className="stat-card">
      <div className="stat-top">
        <span>{label}</span>
        <Icon size={18} />
      </div>
      <div className="stat-value">{value}</div>
      {note && <div className="stat-note">{note}</div>}
    </div>
  )
}

function RiskContext({ score, level, reason, onReview }) {
  return (
    <section className="risk-context-banner" aria-label="Investigation risk context">
      <div className="risk-context-score" data-risk-level={String(level).toLowerCase()}>
        <span>PRELIMINARY RISK</span>
        <strong>{Number.isFinite(score) ? score : 0}<small>/100</small></strong>
        <b>{level}</b>
      </div>
      <div className="risk-context-copy">
        <strong>Why this account is being reviewed</strong>
        <span>{reason}</span>
        <small>Automated indicators are investigative leads, not proof of wrongdoing.</small>
      </div>
      <button type="button" className="risk-context-link" onClick={onReview}>
        Review indicators <ChevronRight size={14} />
      </button>
    </section>
  )
}

function mergeTransactionsById(existing, added) {
  const transactions = normalizeTransactions(existing)
  const seenIds = new Set(transactions.map((tx) => first(
    tx,
    ['Transaction_ID', 'transaction_id', 'id'],
  )).filter((id) => id !== null && id !== undefined).map(String))

  added.forEach((tx) => {
    const id = first(tx, ['Transaction_ID', 'transaction_id', 'id'])
    if (id !== null && id !== undefined) {
      if (seenIds.has(String(id))) return
      seenIds.add(String(id))
    }
    transactions.push(tx)
  })

  return transactions
}

function App() {
  const uploadInputRef = useRef(null)
  const mainRef = useRef(null)
  const graphWrapRef = useRef(null)
  const globePanelRef = useRef(null)
  const slideRefs = useRef({})
  const slideProgressRef = useRef(null)
  const navigationFrameRef = useRef(0)
  const accountSearchTimerRef = useRef(null)
  const accountSearchRequestRef = useRef(0)
  const activeInvestigationIdRef = useRef('')
  const [query, setQuery] = useState('ICIC10000335')
  const [accountId, setAccountId] = useState('ICIC10000335')
  const [searchResults, setSearchResults] = useState([])
  const [accountSuggestionsOpen, setAccountSuggestionsOpen] = useState(false)
  const [accountSearchLoading, setAccountSearchLoading] = useState(false)
  const [activeAccountSuggestion, setActiveAccountSuggestion] = useState(0)
  const [account, setAccount] = useState(null)
  const [risk, setRisk] = useState(null)
  const [trace, setTrace] = useState(null)
  const [expandedTraceTransactions, setExpandedTraceTransactions] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [selectedTx, setSelectedTx] = useState(null)
  const [transactionSearch, setTransactionSearch] = useState('')
  const [transactionSuggestionsOpen, setTransactionSuggestionsOpen] = useState(false)
  const [activeTransactionSuggestion, setActiveTransactionSuggestion] = useState(0)
  const [ifscSearch, setIfscSearch] = useState('')
  const [ifscSuggestionsOpen, setIfscSuggestionsOpen] = useState(false)
  const [activeIfscSuggestion, setActiveIfscSuggestion] = useState(0)
  const [fullscreenTarget, setFullscreenTarget] = useState('')
  const [fullscreenError, setFullscreenError] = useState('')
  const [publicReport, setPublicReport] = useState({
    name: '',
    contactEmail: '',
    contactPhone: '',
    recipientEmail: '',
    incidentDate: '',
    amount: '',
    description: '',
  })
  const [publicReportError, setPublicReportError] = useState('')
  const [publicReportStatus, setPublicReportStatus] = useState('')
  const [isolatedAccount, setIsolatedAccount] = useState(null)
  const [isolationQuery, setIsolationQuery] = useState('')
  const [isolationError, setIsolationError] = useState('')
  const [maxHops, setMaxHops] = useState(4)
  const [activeSection, setActiveSection] = useState('brief')
  const [globeActivated, setGlobeActivated] = useState(false)
  const [anomalyRows, setAnomalyRows] = useState([])
  const [anomalyTotal, setAnomalyTotal] = useState(0)
  const [anomalyFlaggedTotal, setAnomalyFlaggedTotal] = useState(0)
  const [anomalyQuery, setAnomalyQuery] = useState('')
  const [anomalyInput, setAnomalyInput] = useState('')
  const [anomalyOffset, setAnomalyOffset] = useState(0)
  const [anomalyLoading, setAnomalyLoading] = useState(false)
  const [anomalyError, setAnomalyError] = useState('')

 const [timelineData, setTimelineData] = useState(null)
const [timelineMinuteOffset, setTimelineMinuteOffset] = useState(0)
const [timelinePlaying, setTimelinePlaying] = useState(false)
const [timelineSpeed, setTimelineSpeed] = useState(1)
const [timelineLoading, setTimelineLoading] = useState(false)
const [timelineError, setTimelineError] = useState('')
const [uploadingCsv, setUploadingCsv] = useState(false)
const [uploadMessage, setUploadMessage] = useState(null)
const [uploadHistory, setUploadHistory] = useState([])
const [uploadRollbackAvailable, setUploadRollbackAvailable] = useState(false)
const [rollingBackUpload, setRollingBackUpload] = useState(false)
const [uploadAuditError, setUploadAuditError] = useState('')

useEffect(() => {
  const updateFullscreenTarget = () => {
    const active = document.fullscreenElement
    setFullscreenTarget(active === graphWrapRef.current
      ? 'graph'
      : active === globePanelRef.current
        ? 'globe'
        : '')
  }
  document.addEventListener('fullscreenchange', updateFullscreenTarget)
  return () => document.removeEventListener('fullscreenchange', updateFullscreenTarget)
}, [])

const loadUploadHistory = useCallback(async () => {
  try {
    const { data } = await api.get('/ingestion/history')
    setUploadHistory(data.events ?? [])
    setUploadRollbackAvailable(Boolean(data.rollback_available))
    setUploadAuditError('')
  } catch (err) {
    setUploadAuditError(
      err.response?.data?.detail || err.message || 'Could not load CSV upload history.'
    )
  }
}, [])

useEffect(() => {
  loadUploadHistory()
}, [loadUploadHistory])

useEffect(() => {
  const section = document.getElementById('global-trace-section')
  if (!section) return undefined

  const observer = new IntersectionObserver((entries) => {
    if (entries.some((entry) => entry.isIntersecting)) {
      setGlobeActivated(true)
      observer.disconnect()
    }
  }, { rootMargin: '120px' })

  observer.observe(section)
  return () => observer.disconnect()
}, [])

useEffect(() => {
  const main = mainRef.current
  if (!main) return undefined
  let animationFrame = 0
  const updateActiveSlide = () => {
    window.cancelAnimationFrame(animationFrame)
    animationFrame = window.requestAnimationFrame(() => {
      const threshold = main.getBoundingClientRect().top + 170
      const currentSlide = SLIDES
        .map((slide) => ({
          id: slide.id,
          top: slideRefs.current[slide.id]?.getBoundingClientRect().top ?? Number.NEGATIVE_INFINITY,
        }))
        .filter((slide) => slide.top <= threshold)
        .at(-1)
      if (currentSlide) setActiveSection((current) =>
        current === currentSlide.id ? current : currentSlide.id)
    })
  }
  main.addEventListener('scroll', updateActiveSlide, { passive: true })
  updateActiveSlide()
  return () => {
    main.removeEventListener('scroll', updateActiveSlide)
    window.cancelAnimationFrame(animationFrame)
  }
}, [])

const timelineSteps = useMemo(() => {
  const minutes = normalizeTransactions(timelineData)
    .map(getTransactionMinute)
    .filter((minute) => minute !== null)
  return [...new Set(minutes)].sort((a, b) => a - b)
}, [timelineData])

const timelineBounds = useMemo(() => {
  return {
    start: timelineSteps[0] ?? null,
    end: timelineSteps[timelineSteps.length - 1] ?? null,
  }
}, [timelineSteps])

const timelineCheckpointCount = timelineSteps.length
const safeTimelineMinuteOffset = Math.min(
  timelineMinuteOffset,
  Math.max(0, timelineCheckpointCount - 1)
)
const timelineEndMinute = timelineBounds.start === null
  ? null
  : timelineSteps[safeTimelineMinuteOffset]

const timelineVisibleTransactions = useMemo(() => {
  return normalizeTransactions(timelineData).filter((tx) => {
    const minute = getTransactionMinute(tx)
    return timelineEndMinute !== null
      && minute !== null
      && minute <= timelineEndMinute
  })
}, [timelineData, timelineEndMinute])

  const displayTrace = timelineData
  ? timelineVisibleTransactions
  : trace

  const graphExpansionTransactions = useMemo(() => {
    if (!timelineData) return expandedTraceTransactions
    return expandedTraceTransactions.filter((tx) => {
      const minute = getTransactionMinute(tx)
      return timelineEndMinute !== null && minute !== null && minute <= timelineEndMinute
    })
  }, [expandedTraceTransactions, timelineData, timelineEndMinute])

  const expandedGraphTrace = useMemo(() => {
    if (!displayTrace || graphExpansionTransactions.length === 0) return displayTrace
    return {
      ...displayTrace,
      transactions: mergeTransactionsById(displayTrace, graphExpansionTransactions),
    }
  }, [displayTrace, graphExpansionTransactions])

  const fullGraph = useMemo(
    () => normalizeGraph(expandedGraphTrace, accountId),
    [expandedGraphTrace, accountId]
  )
  const graph = useMemo(
    () => isolateWeakComponent(fullGraph, isolatedAccount),
    [fullGraph, isolatedAccount]
  )

  const loadInvestigation = useCallback(async (id) => {
    const cleanId = id?.trim()
    if (!cleanId) return

    activeInvestigationIdRef.current = cleanId
    setExpandedTraceTransactions([])
    setLoading(true)
    setError('')
    setTimelineError('')
    setTimelinePlaying(false)
    setTimelineData(null)
    setSelectedTx(null)
    setIsolatedAccount(null)
    setIsolationError('')
    setAccountId(cleanId)
    setQuery(cleanId)

    const outcomes = await Promise.allSettled([
      api.get(`/accounts/${encodeURIComponent(cleanId)}`),
      api.get(`/investigations/risk/${encodeURIComponent(cleanId)}`),
      api.get(`/investigations/trace/${encodeURIComponent(cleanId)}`, {
        params: { max_hops: maxHops, limit: 10000 },
      }),
    ])

    const [accountResult, riskResult, traceResult] = outcomes

    setAccount(
      accountResult.status === 'fulfilled'
        ? accountResult.value.data
        : null
    )

    setRisk(
      riskResult.status === 'fulfilled'
        ? riskResult.value.data
        : null
    )

    const traceData = traceResult.status === 'fulfilled'
      ? traceResult.value.data
      : null
    setTrace(traceData)
    setTimelineData(traceData)
    setTimelineLoading(false)
    if (traceData) {
      const minutes = normalizeTransactions(traceData)
        .map(getTransactionMinute)
        .filter((minute) => minute !== null)
      setTimelineMinuteOffset(new Set(minutes).size > 0
        ? new Set(minutes).size - 1
        : 0)
    }

    // A missing account-summary response should not hide a successful
    // risk assessment or transaction trace.
    const failures = []

    if (traceResult.status === 'rejected') {
      failures.push(
        `Trace failed: ${
          traceResult.reason?.response?.data?.detail ||
          traceResult.reason?.message ||
          'Request failed'
        }`
      )
    }

    if (riskResult.status === 'rejected') {
      failures.push(
        `Risk assessment unavailable: ${
          riskResult.reason?.response?.data?.detail ||
          riskResult.reason?.message ||
          'Request failed'
        }`
      )
    }

    if (
      accountResult.status === 'rejected' &&
      riskResult.status === 'rejected' &&
      traceResult.status === 'rejected'
    ) {
      failures.push('All investigation requests failed.')
    }

    setError([...new Set(failures)].join(' â€¢ '))
    setLoading(false)
  }, [maxHops])

  const expandAccountOutgoing = useCallback(async ({
    accountId: sender,
    receivedAt,
    hop,
    maxHops: requestedMaxHops,
    offset,
  }) => {
    const rootId = activeInvestigationIdRef.current
    const params = {
      hop,
      max_hops: requestedMaxHops,
      offset,
      limit: 100,
    }
    if (receivedAt) params.received_at = receivedAt

    const { data } = await api.get(
      `/investigations/outgoing/${encodeURIComponent(sender)}`,
      { params }
    )
    if (activeInvestigationIdRef.current === rootId) {
      setExpandedTraceTransactions((current) => mergeTransactionsById(current, data.transactions))
    }
    return data
  }, [])

  useEffect(() => {
    loadInvestigation('ICIC10000335')
  }, [loadInvestigation])

    useEffect(() => {
    if (!timelinePlaying) return

    const timer = setInterval(() => {
      setTimelineMinuteOffset((offset) => {
        if (offset >= timelineCheckpointCount - 1) {
          setTimelinePlaying(false)
          return timelineCheckpointCount - 1
        }

        return offset + 1
      })
    }, 1200 / timelineSpeed)

    return () => clearInterval(timer)
  }, [timelinePlaying, timelineCheckpointCount, timelineSpeed])

  const fetchAccountSuggestions = async (searchQuery) => {
    const requestId = ++accountSearchRequestRef.current
    setAccountSearchLoading(true)
    try {
      const { data } = await api.get('/accounts/search', {
        params: { q: searchQuery, limit: 10 },
      })
      const results = Array.isArray(data) ? data : data.results || []
      if (requestId === accountSearchRequestRef.current) {
        setSearchResults(results)
        setAccountSearchLoading(false)
      }
    } catch (err) {
      if (requestId === accountSearchRequestRef.current) {
        setSearchResults([])
        setAccountSearchLoading(false)
        setError(err.response?.data?.detail || err.message || 'Search failed.')
      }
    }
  }

  const handleAccountQueryChange = (value) => {
    setQuery(value)
    setError('')
    setActiveAccountSuggestion(0)
    setAccountSuggestionsOpen(true)
    setSearchResults([])
    if (accountSearchTimerRef.current) clearTimeout(accountSearchTimerRef.current)
    accountSearchRequestRef.current += 1

    const searchQuery = value.trim()
    if (searchQuery.length < 3) {
      setAccountSearchLoading(false)
      return
    }

    setAccountSearchLoading(true)
    accountSearchTimerRef.current = setTimeout(() => {
      fetchAccountSuggestions(searchQuery)
    }, 220)
  }

  const searchAccounts = (event) => {
    event?.preventDefault()
    const searchQuery = query.trim()
    if (searchQuery.length < 3) {
      setError('Enter at least 3 characters to search.')
      return
    }

    if (accountSearchTimerRef.current) clearTimeout(accountSearchTimerRef.current)
    setError('')
    setAccountSuggestionsOpen(true)
    fetchAccountSuggestions(searchQuery)
  }

  const selectAccountSuggestion = (item) => {
    const id = first(item, ['account_id', 'Account_ID', 'Sender_Account', 'account', 'id'])
    if (!id) return

    setQuery(String(id))
    setAccountSuggestionsOpen(false)
    setSearchResults([])
    setError('')
    loadInvestigation(String(id))
  }

  const handleAccountSearchKeyDown = (event) => {
    if (event.key === 'Escape') {
      setAccountSuggestionsOpen(false)
      return
    }
    if (!accountSuggestionsOpen || searchResults.length === 0) return

    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActiveAccountSuggestion((current) => (current + 1) % searchResults.length)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveAccountSuggestion((current) =>
        (current - 1 + searchResults.length) % searchResults.length
      )
    } else if (event.key === 'Enter') {
      event.preventDefault()
      selectAccountSuggestion(searchResults[activeAccountSuggestion])
    }
  }

  const handleAccountSearchFocus = () => {
    setAccountSuggestionsOpen(true)
    const searchQuery = query.trim()
    if (searchQuery.length >= 3 && !searchResults.length && !accountSearchLoading) {
      if (accountSearchTimerRef.current) clearTimeout(accountSearchTimerRef.current)
      fetchAccountSuggestions(searchQuery)
    }
  }

  const isolateQueriedAccount = () => {
    const requestedAccount = isolationQuery.trim()
    if (!fullGraph.nodes.some((node) => node.id === requestedAccount)) {
      setIsolationError(
        'Enter an account present in the currently visible trace.'
      )
      return
    }
    setIsolationError('')
    setIsolatedAccount(requestedAccount)
  }

  const riskScore = Number(first(risk, ['risk_score', 'score'], 0))
  const riskLevel = first(risk, ['risk_level', 'level'], 'Not assessed')
  const layerName = first(risk, ['layer_name', 'suspected_layer'], 'Not classified')
  const indicators = first(risk, ['reasons', 'indicators', 'risk_indicators'], [])
  const txs = graph.rawTransactions
  const scoredTransactions = useMemo(() => txs.map((tx, index) => {
    const screening = transactionRisk(tx)
    return {
      transaction_id: first(tx, ['Transaction_ID', 'transaction_id', 'id'], `Row ${index + 1}`),
      timestamp: first(tx, ['Timestamp', 'timestamp', 'time'], ''),
      sender_account: first(tx, ['Sender_Account', 'sender_account', 'sender', 'source', 'from'], ''),
      receiver_account: first(tx, ['Receiver_Account', 'receiver_account', 'receiver', 'target', 'to'], ''),
      amount: first(tx, ['Amount', 'amount', 'value'], null),
      payment_mode: first(tx, ['Payment_Mode', 'payment_mode', 'mode'], ''),
      screening_score: screening.score,
      screening_reasons: screening.reasons,
      level: screening.score >= 60 ? 'high' : screening.score >= 30 ? 'medium' : 'low',
      transaction: tx,
    }
  }), [txs])
  const topScoredTransactions = useMemo(
    () => [...scoredTransactions]
      .sort((left, right) => right.screening_score - left.screening_score)
      .slice(0, 20),
    [scoredTransactions]
  )
  const transactionRiskCounts = useMemo(() => scoredTransactions.reduce(
    (counts, item) => ({ ...counts, [item.level]: counts[item.level] + 1 }),
    { high: 0, medium: 0, low: 0 }
  ), [scoredTransactions])
  const reportFigures = useMemo(() => {
    const steps = new Map()
    const accountsSeen = new Set()
    const outgoingAccounts = new Set()
    let directOutflow = 0
    let tracedValue = 0

    txs.forEach((tx) => {
      const amount = Number(first(tx, ['Amount', 'amount', 'value'], 0)) || 0
      const hop = Number(first(tx, ['hop'], 0))
      const sender = String(first(tx, ['Sender_Account', 'sender_account', 'sender'], ''))
      const receiver = String(first(tx, ['Receiver_Account', 'receiver_account', 'receiver'], ''))
      tracedValue += amount
      if (sender === accountId) directOutflow += amount
      if (sender) outgoingAccounts.add(sender)
      if (receiver && receiver !== accountId) accountsSeen.add(receiver)
      if (!Number.isInteger(hop) || hop < 1) return

      const step = steps.get(hop) ?? {
        hop,
        transactions: 0,
        amount: 0,
        accounts: new Map(),
      }
      step.transactions += 1
      step.amount += amount
      if (receiver) {
        const account = step.accounts.get(receiver) ?? {
          accountId: receiver,
          ifsc: first(tx, ['Receiver_IFSC', 'receiver_ifsc'], ''),
          amount: 0,
          timestamps: [],
          transactionIds: [],
        }
        account.amount += amount
        const timestamp = first(tx, ['Timestamp', 'timestamp', 'time'], '')
        if (timestamp) account.timestamps.push(String(timestamp))
        const transactionId = first(tx, ['Transaction_ID', 'transaction_id', 'id'])
        if (transactionId) account.transactionIds.push(String(transactionId))
        step.accounts.set(receiver, account)
      }
      steps.set(hop, step)
    })

    const deepestHop = Math.max(0, ...steps.keys())
    const potentialHoldingAccounts = [...(steps.get(deepestHop)?.accounts.values() ?? [])]
      .filter((item) => !outgoingAccounts.has(item.accountId))
      .map((item) => ({
        ...item,
        lastObservedAt: item.timestamps.sort().at(-1) ?? '',
      }))
      .sort((left, right) => right.amount - left.amount)

    return {
      directOutflow,
      tracedValue,
      downstreamAccounts: accountsSeen.size,
      transfersByHop: [...steps.values()]
        .sort((left, right) => left.hop - right.hop)
        .map((step) => ({
          hop: step.hop,
          transactions: step.transactions,
          amount: step.amount,
        })),
      potentialHoldingAccounts,
    }
  }, [accountId, txs])
  const transactionSuggestions = useMemo(() => {
    const needle = transactionSearch.trim().toLowerCase()
    if (!needle) return []

    return txs
      .map((tx, index) => ({ tx, index }))
      .filter(({ tx, index }) => {
        const fields = [
          first(tx, ['Transaction_ID', 'transaction_id', 'id'], `Row ${index + 1}`),
          first(tx, ['Sender_Account', 'sender_account', 'sender', 'source', 'from'], ''),
          first(tx, ['Receiver_Account', 'receiver_account', 'receiver', 'target', 'to'], ''),
          first(tx, ['Narration', 'narration'], ''),
          first(tx, ['Payment_Mode', 'payment_mode', 'mode'], ''),
          first(tx, ['Timestamp', 'timestamp', 'time'], ''),
          first(tx, ['Amount', 'amount', 'value'], ''),
          first(tx, ['Sender_IFSC', 'sender_ifsc'], ''),
          first(tx, ['Receiver_IFSC', 'receiver_ifsc'], ''),
        ]
        return fields.some((value) => String(value).toLowerCase().includes(needle))
      })
      .slice(0, 8)
  }, [transactionSearch, txs])
  const ifscSuggestions = useMemo(() => {
    const needle = ifscSearch.trim().toLowerCase()
    if (!needle) return []
    return txs
      .map((tx, index) => ({ tx, index }))
      .filter(({ tx }) => [
        first(tx, ['Sender_IFSC', 'sender_ifsc'], ''),
        first(tx, ['Receiver_IFSC', 'receiver_ifsc'], ''),
      ].some((value) => String(value).toLowerCase().includes(needle)))
      .slice(0, 8)
  }, [ifscSearch, txs])

  const toggleFullscreen = async (target) => {
    const element = target === 'graph' ? graphWrapRef.current : globePanelRef.current
    if (!element) return
    setFullscreenError('')
    try {
      if (document.fullscreenElement === element) {
        await document.exitFullscreen()
      } else {
        await element.requestFullscreen()
      }
    } catch (fullscreenFailure) {
      setFullscreenError(
        `Could not open ${target === 'graph' ? 'graph' : 'globe'} fullscreen: ${fullscreenFailure.message || 'fullscreen is unavailable.'}`
      )
    }
  }

  const selectTransactionSuggestion = (tx) => {
    setSelectedTx(tx)
    setTransactionSuggestionsOpen(false)
    setIfscSuggestionsOpen(false)
    setTransactionSearch(String(first(tx, ['Transaction_ID', 'transaction_id', 'id'], '')))
  }

  const updatePublicReport = (field) => (event) => {
    setPublicReport((current) => ({ ...current, [field]: event.target.value }))
    setPublicReportError('')
    setPublicReportStatus('')
  }

  const createPublicReportText = () => [
    'PUBLIC CYBERCRIME REPORT DRAFT — REVIEW BEFORE SUBMISSION',
    `Case reference: ABHIMANYU-${accountId}`,
    `Prepared: ${new Date().toLocaleString()}`,
    `Name: ${publicReport.name || 'Not provided'}`,
    `Contact email: ${publicReport.contactEmail || 'Not provided'}`,
    `Contact phone: ${publicReport.contactPhone || 'Not provided'}`,
    `Incident date: ${publicReport.incidentDate || 'Not provided'}`,
    `Reported amount (INR): ${publicReport.amount || 'Not provided'}`,
    '',
    'Incident description:',
    publicReport.description || 'Not provided',
    '',
    `Investigation account: ${accountId}`,
    `Visible trace records: ${txs.length}`,
    'This is an unverified draft. Review and submit through the official portal or another appropriate channel.',
  ].join('\n')

  const downloadPublicReportDraft = () => {
    if (!publicReport.description.trim()) {
      setPublicReportError('Add an incident description before preparing the draft.')
      return
    }
    const blob = new Blob([createPublicReportText()], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `abhimanyu-public-report-draft-${String(accountId).replace(/[^\w.-]/g, '_')}.txt`
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  const openEmailDraft = () => {
    setPublicReportStatus('')
    if (!publicReport.description.trim()) {
      setPublicReportError('Add an incident description before preparing the email.')
      return
    }
    const recipient = publicReport.recipientEmail.trim()
    if (recipient && !/^[^@\s]+@[^@\s]+$/.test(recipient)) {
      setPublicReportError('Enter a valid email recipient or leave the field blank.')
      return
    }
    setPublicReportError('')
    const reportText = createPublicReportText()
    const emailBody = reportText.length <= 1800
      ? reportText
      : [
        `Please review the attached full report draft for case ABHIMANYU-${accountId}.`,
        '',
        `Incident summary: ${publicReport.description.slice(0, 500)}`,
        '',
        'The complete report text can be copied with “Copy report text” or downloaded from Abhimanyu.',
      ].join('\n')
    const subject = `Cybercrime report draft - ABHIMANYU-${accountId}`
    const encodedRecipient = encodeURIComponent(recipient).replace(/%40/gi, '@')
    const mailto = `mailto:${encodedRecipient}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(emailBody)}`
    const link = document.createElement('a')
    link.href = mailto
    link.style.display = 'none'
    document.body.appendChild(link)
    link.click()
    link.remove()
    setPublicReportStatus(reportText.length > 1800
      ? 'A short email draft was prepared to avoid email-client URL limits. Download or copy the full report text to attach or paste it.'
      : '')
  }

  const copyPublicReportText = async () => {
    try {
      await navigator.clipboard.writeText(createPublicReportText())
      setPublicReportError('')
      setPublicReportStatus('Full public-report draft copied to the clipboard.')
    } catch (err) {
      setPublicReportError(`Could not copy the report text: ${err.message || 'clipboard access was denied.'}`)
    }
  }

  // The risk API returns statistics even when account summary is unavailable.
  const incoming = first(
    account,
    ['incoming_amount', 'total_incoming', 'inflow'],
    first(risk?.statistics, ['incoming_amount'], null)
  )

  const outgoing = first(
    account,
    ['outgoing_amount', 'total_outgoing', 'outflow'],
    first(risk?.statistics, ['outgoing_amount'], null)
  )

  const accountTxCount = first(
    account,
    ['transaction_count', 'total_transactions', 'tx_count'],
    null
  )

  const traceHops = first(trace, ['max_hops', 'hops'], maxHops)
  const truncated = first(displayTrace, ['truncated'], false)

  const toggleTimelinePlayback = () => {
    if (timelineSteps.length < 2 || timelineLoading) return

    if (timelinePlaying) {
      setTimelinePlaying(false)
      return
    }

    if (safeTimelineMinuteOffset >= timelineCheckpointCount - 1) {
      setTimelineMinuteOffset(0)
    }
    setTimelinePlaying(true)
  }

  const rewindTimelinePlayback = () => {
    setTimelinePlaying(false)
    setTimelineMinuteOffset(0)
  }

  const exportIsolatedSubgraph = () => {
    const nodeCandidates = new Map(
      graph.nodes.map((node) => [node.id, node.layerCandidate ?? ''])
    )
    const fields = [
      ['transaction_id', 'transaction_id'],
      ['sender_account', 'sender_account'],
      ['receiver_account', 'receiver_account'],
      ['amount', 'amount'],
      ['timestamp', 'timestamp'],
      ['payment_mode', 'payment_mode'],
      ['sender_ifsc', 'sender_ifsc'],
      ['receiver_ifsc', 'receiver_ifsc'],
      ['narration', 'narration'],
      ['ip_address', 'ip_address'],
      ['device_type', 'device_type'],
      ['hop', 'hop'],
      ['sender_layer_candidate', 'sender_layer_candidate'],
      ['receiver_layer_candidate', 'receiver_layer_candidate'],
    ]
    const rows = [
      ['selected_account', ...fields.map(([, header]) => header)],
      ...txs.map((transaction) =>
        [
          isolatedAccount,
          ...fields.map(([key]) => {
            if (key === 'sender_layer_candidate') {
              return nodeCandidates.get(transaction.sender_account) ?? ''
            }
            if (key === 'receiver_layer_candidate') {
              return nodeCandidates.get(transaction.receiver_account) ?? ''
            }
            return transaction[key] ?? ''
          }),
        ]
      ),
    ]
    const csv = rows.map((row) => row.map(csvCell).join(',')).join('\r\n')
    const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    const safeAccount = String(isolatedAccount).replace(/[^\w.-]/g, '_')
    anchor.href = url
    anchor.download = `abhimanyu-subgraph-${safeAccount}.csv`
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  const exportReport = () => {
    const report = {
      case_reference: `ABHIMANYU-${accountId}`,
      generated_at: new Date().toISOString(),
      timeline: {
        start: timelineBounds.start === null
          ? null
          : formatTimelineMinute(timelineBounds.start),
        end: timelineEndMinute === null
          ? null
          : formatTimelineMinute(timelineEndMinute),
        minute_offset: timelineEndMinute === null || timelineBounds.start === null
          ? 0
          : timelineEndMinute - timelineBounds.start,
        total_minutes: timelineBounds.start === null || timelineBounds.end === null
          ? 0
          : timelineBounds.end - timelineBounds.start + 1,
        transaction_time_checkpoints: timelineCheckpointCount,
        returned_transaction_count: txs.length,
      },
      account,
      preliminary_risk_assessment: risk,
      transaction_screening: scoredTransactions.map((item) => ({
        transaction_id: item.transaction_id,
        timestamp: item.timestamp,
        sender_account: item.sender_account,
        receiver_account: item.receiver_account,
        amount: item.amount,
        payment_mode: item.payment_mode,
        screening_score: item.screening_score,
        screening_reasons: item.screening_reasons,
        level: item.level,
      })),
      trace: displayTrace,
      disclaimer:
        'Automated indicators are investigative leads, not proof of criminal activity. Verify against original records.',
    }

    const blob = new Blob([JSON.stringify(report, null, 2)], {
      type: 'application/json',
    })

    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')

    anchor.href = url
    anchor.download = `abhimanyu-case-${accountId}.json`
    anchor.click()

    URL.revokeObjectURL(url)
  }

  const exportCaseDiary = async () => {
    try {
      const response = await api.post('/reports/case-diary', {
        victim_account: accountId,
        max_hops: maxHops,
      }, { timeout: 180000 })

      const report = response.data
      const blob = new Blob(
        [JSON.stringify(report, null, 2)],
        { type: 'application/json;charset=utf-8' }
      )

      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `abhimanyu-case-diary-${accountId}.json`
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()

      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (error) {
      console.error('Case diary generation failed:', error)
      const message =
        error.response?.data?.detail ||
        error.message ||
        'Unknown error'

      window.alert(`Could not generate case diary: ${message}`)
    }
  }

  const exportPrintableCaseDiary = async () => {
    try {
      const { data: report } = await api.post('/reports/case-diary', {
        victim_account: accountId,
        max_hops: maxHops,
      }, { timeout: 180000 })
      const caseDetails = report.case_details || {}
      const caseDetailText = (value) => value == null || value === ''
        ? 'To be completed from the official case record'
        : String(value)
      const reportedLossText =
        caseDetails.verified_reported_loss_inr != null &&
        Number.isFinite(Number(caseDetails.verified_reported_loss_inr))
        ? fmtMoney(caseDetails.verified_reported_loss_inr)
        : 'Not verified — enter from complaint and supporting records'
      const supportingEvidence =
        report.freeze_requisition_draft?.supporting_transaction_evidence
      const evidence = Array.isArray(supportingEvidence)
        ? [...supportingEvidence].sort((left, right) =>
          String(left.timestamp ?? '').localeCompare(String(right.timestamp ?? ''))
        )
        : []
      const accounts = report.freeze_requisition_draft?.accounts_for_authorized_review || []
      const accountsByLayer = report.accounts_by_layer || []
      const potentialHoldingAccounts = report.potential_holding_accounts || []
      const bankPackets = Object.values(
        report.freeze_requisition_draft?.requisitions_by_beneficiary_ifsc || {}
      )
      const tableRows = (rows) => rows.map((row) =>
        `<tr>${row.map((value) => `<td>${escapeHtml(value)}</td>`).join('')}</tr>`
      ).join('')
      const renderBarChart = (items, labelFor, valueFor, detailFor) => {
        if (!items.length) return '<p>No transfer details are available for this chart.</p>'
        const values = items.map((item) => Number(valueFor(item)) || 0)
        const maximum = Math.max(...values, 0)
        return `<div class="bar-chart">${items.map((item, index) => {
          const value = values[index]
          const width = maximum > 0 ? Math.max((value / maximum) * 100, value > 0 ? 1 : 0) : 0
          return `<div class="bar-row">
            <div class="bar-copy"><strong>${escapeHtml(labelFor(item))}</strong><span>${escapeHtml(detailFor(item))}</span></div>
            <div class="bar-track"><span class="bar-fill" style="width:${width}%"></span></div>
          </div>`
        }).join('')}</div>`
      }
      const transfersByStep = report.chart_data?.transfers_by_step || []
      const stepChart = renderBarChart(
        transfersByStep,
        (item) => `Step ${item.step ?? 'not recorded'}`,
        (item) => item.total_amount_inr,
        (item) => `${item.transactions} transfers · ${fmtMoney(item.total_amount_inr)}`
      )
      const summaryRows = tableRows([
        ['Amount sent directly from the account being reviewed', fmtMoney(report.observed_direct_victim_outflow_inr)],
        ['Reported / alleged victim loss', 'Not supplied — requires complainant and case-record verification'],
        ['Total loss confirmed by these records', 'No'],
        ['Gross value of all transfers shown', fmtMoney(report.sum_of_traced_transaction_values_inr)],
        ['Current account balances confirmed by these records', 'No'],
      ])
      const evidenceRows = evidence.length
        ? tableRows(evidence.map((item) => [
          item.timestamp,
          item.transaction_id,
          item.hop,
          item.sender_account,
          item.receiver_account,
          fmtMoney(item.amount),
        ]))
        : '<tr><td colspan="6">No transfer records were returned.</td></tr>'
      const accountRows = accounts.length
        ? tableRows(accounts.map((item) => [
          item.account_id,
          (item.transaction_ids || []).join(', '),
        ]))
        : '<tr><td colspan="2">No other accounts were found in this trace.</td></tr>'
      const layerRows = accountsByLayer.length
        ? tableRows(accountsByLayer.map((item) => [
          `Layer ${item.layer ?? 'not recorded'}`,
          item.account_id,
          item.beneficiary_ifsc || 'Not recorded',
          item.first_observed_at || 'Not recorded',
          item.last_observed_at || 'Not recorded',
          fmtMoney(item.observed_incoming_amount_inr),
          (item.transaction_ids || []).join(', '),
        ]))
        : '<tr><td colspan="7">No downstream account entries were returned.</td></tr>'
      const holdingRows = potentialHoldingAccounts.length
        ? tableRows(potentialHoldingAccounts.map((item) => [
          item.account_id,
          item.beneficiary_ifsc || 'Not recorded',
          (item.transaction_ids || []).join(', '),
          item.last_observed_at || 'Not recorded',
          fmtMoney(item.observed_incoming_amount_inr),
          'Not available — obtain live bank verification',
        ]))
        : '<tr><td colspan="6">No potential trace-leaf accounts were identified in the returned records.</td></tr>'
      const bankSections = bankPackets.length
        ? bankPackets.map((packet) => {
          const bankEvidence = packet.supporting_transactions || []
          const bankPrefix = String(packet.beneficiary_ifsc || '').slice(0, 4).toUpperCase()
          const bankNames = {
            SBIN: 'State Bank of India',
            HDFC: 'HDFC Bank',
            ICIC: 'ICICI Bank',
            PUNB: 'Punjab National Bank',
            UTIB: 'Axis Bank',
            KKBK: 'Kotak Mahindra Bank',
            BARB: 'Bank of Baroda',
            CNRB: 'Canara Bank',
            UBIN: 'Union Bank of India',
            YESB: 'Yes Bank',
            INDB: 'IndusInd Bank',
            BKID: 'Bank of India',
          }
          const bankName = bankNames[bankPrefix] || 'Bank name to be verified'
          const bankAccounts = packet.accounts_for_review || []
          const bankAccountRows = bankAccounts.length
            ? tableRows(bankAccounts.map((item) => [
              item.account_id,
              item.beneficiary_ifsc || packet.beneficiary_ifsc,
              (item.transaction_ids || []).join(', '),
            ]))
            : '<tr><td colspan="3">No beneficiary account details available.</td></tr>'
          return `<article class="bank-notice">
            <div class="notice-caption">INDIVIDUAL BANK REQUISITION · DRAFT</div>
            <h3>To: The Nodal Officer, ${escapeHtml(bankName)}</h3>
            <p class="meta">Official nodal address: To be verified from the bank’s current official directory before issue.</p>
            <p><strong>Subject:</strong> Request to preserve and produce specified transaction records; urgent account-status verification and any further lawful action only under separately cited authority.</p>
            <p><strong>Case reference:</strong> ABHIMANYU-${escapeHtml(report.victim_account)}<br>
              <strong>IFSC in returned records:</strong> ${escapeHtml(packet.beneficiary_ifsc)}<br>
              <strong>Records-production reference:</strong> ${escapeHtml(report.freeze_requisition_draft?.legal_basis?.records_production || 'Applicable provision to be verified and cited by issuing authority.')}</p>
            <p>Sir/Madam, the records listed below identify transactions routed to an account carrying the IFSC shown above. Please preserve the identified records and verify the account and its current status. The amounts below are historical transaction values in the supplied dataset; they are not a representation of current balance or available funds.</p>
            <table>
              <thead><tr><th>Beneficiary account</th><th>IFSC</th><th>Disputed / supporting transaction IDs</th></tr></thead>
              <tbody>${bankAccountRows}</tbody>
            </table>
            <table>
              <thead><tr><th>Transaction ID</th><th>Timestamp in source</th><th>Amount (INR)</th><th>Sender account</th><th>Beneficiary account</th></tr></thead>
              <tbody>${tableRows(bankEvidence.map((item) => [
                item.transaction_id,
                item.timestamp,
                fmtMoney(item.amount),
                item.sender_account,
                item.receiver_account,
              ]))}</tbody>
            </table>
            <p><strong>Requested records:</strong> transaction ledger and channel details for the listed IDs; account-opening/KYC and linked-account details as authorized; account status and bank-verified available balance with an as-of timestamp; and relevant audit records, subject to the authority cited in the issued notice.</p>
            <p><strong>Any debit freeze / restraint:</strong> This draft does not itself authorize a freeze. The issuing authority must cite the separate applicable statutory power, record case-specific grounds, and obtain required approval before requesting or directing any restraint.</p>
            <p>Please preserve relevant records pending the response period and instructions specified in the formally issued notice. Do not treat a trace association as a finding of wrongdoing.</p>
            <p>Yours faithfully,<br><br>____________________________<br>Authorized Investigating Officer<br>Name / Rank: To be completed<br>Police station / unit: To be completed<br>Official contact: To be completed<br>Case / FIR reference: To be completed<br>Date and official seal: To be completed</p>
          </article>`
        }).join('')
        : '<p>No bank codes were available in the returned records.</p>'
      const chronology = Array.isArray(report.chronological_narrative)
        ? report.chronological_narrative.map((entry) =>
          `<li><strong>${escapeHtml(entry.statement)}</strong><br><span class="meta">Supporting transaction ID(s): ${escapeHtml((entry.evidence_transaction_ids || []).join(', ') || 'Not recorded')}</span></li>`
        ).join('')
        : ''
      const aiSummary = report.ai_summary
        ? `<h2>Local AI-assisted summary — review required</h2><p>${escapeHtml(report.ai_summary)}</p>
            <p class="notice">Generated locally from aggregated record counts and amounts. It is not independently verified and is not a finding of wrongdoing.</p>`
        : `<h2>Local AI-assisted summary unavailable</h2>
            <p class="notice">The deterministic evidence summary is included. ${escapeHtml(report.narrative_generation?.fallback_reason || 'Start local Ollama and ensure the configured model is available to enable local AI wording.')}</p>`
      const actions = (report.freeze_requisition_draft?.requested_action_template || [])
        .map((action) => `<li>${escapeHtml(action)}</li>`)
        .join('')
      const requiredItems = (report.freeze_requisition_draft?.required_before_submission || [])
        .map((item) => `<li>${escapeHtml(item)}</li>`)
        .join('')
      const html = `<!doctype html>
        <html lang="en">
          <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <title>Investigation case diary — ${escapeHtml(report.victim_account)}</title>
            <style>
              :root { color-scheme: light; }
              * { box-sizing: border-box; }
              body { color: #192b3b; font: 14px/1.55 Arial, Helvetica, sans-serif; margin: 34px auto; max-width: 1080px; padding: 0 28px; }
              .masthead { display: flex; justify-content: space-between; align-items: flex-start; gap: 24px; padding: 0 0 22px; border-bottom: 3px solid #143b56; }
              .brand { color: #146b70; font-size: 11px; font-weight: 700; letter-spacing: .16em; text-transform: uppercase; }
              h1 { color: #143b56; font-size: 29px; letter-spacing: -.03em; margin: 8px 0; }
              h2 { color: #143b56; font-size: 18px; margin: 30px 0 12px; padding-bottom: 7px; border-bottom: 1px solid #d6e0e7; }
              h3 { color: #24546c; font-size: 14px; margin: 20px 0 7px; }
              p, li { line-height: 1.6; }
              .meta { color: #526577; font-size: 12px; }
              .draft-tag { flex: 0 0 auto; border: 1px solid #b57818; border-radius: 999px; color: #80500b; padding: 6px 11px; font-size: 10px; font-weight: 700; letter-spacing: .08em; }
              .case-meta { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; margin: 18px 0; }
              .case-meta div, .kpi { background: #f3f7f9; border: 1px solid #dbe5ea; border-radius: 8px; padding: 12px 14px; }
              .case-meta span, .kpi span { color: #5d7180; display: block; font-size: 10px; font-weight: 700; letter-spacing: .07em; text-transform: uppercase; }
              .case-meta strong, .kpi strong { color: #173c55; display: block; margin-top: 5px; overflow-wrap: anywhere; }
              .kpis { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; margin: 18px 0; }
              .kpi strong { font-size: 20px; }
              .kpi small { color: #687b89; display: block; margin-top: 4px; }
              .section-label { color: #147578; font-size: 10px; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; }
              .notice { background: #fff8e8; border-left: 4px solid #c28a22; color: #55451f; margin: 14px 0; padding: 11px 14px; }
              .summary { background: #f5f9fb; border: 1px solid #dce6ec; border-radius: 8px; padding: 14px 18px; }
              .chronology { display: grid; gap: 9px; padding-left: 24px; }
              .chronology li { padding: 9px 12px; border-left: 2px solid #2b8d88; background: #f5f9fb; }
              .bar-chart { display: grid; gap: 13px; }
              .bar-row { display: grid; grid-template-columns: minmax(150px, .8fr) 2fr; gap: 14px; align-items: center; }
              .bar-copy { display: flex; flex-direction: column; }
              .bar-copy span { color: #526577; font-size: 11px; }
              .bar-track { background: #e8eef2; border-radius: 99px; height: 13px; overflow: hidden; }
              .bar-fill { background: linear-gradient(90deg, #167b7a, #43a99a); border-radius: inherit; display: block; height: 100%; }
              table { border-collapse: collapse; margin-top: 10px; table-layout: auto; width: 100%; }
              th, td { border-bottom: 1px solid #dce4e9; padding: 9px 8px; text-align: left; vertical-align: top; overflow-wrap: anywhere; }
              th { background: #edf3f6; color: #345064; font-size: 10px; letter-spacing: .04em; text-transform: uppercase; }
              td { font-size: 11px; }
              .notice, table, .bar-row, .kpi { break-inside: avoid; }
              .footer { border-top: 1px solid #d6e0e7; color: #637582; font-size: 10px; margin-top: 30px; padding-top: 10px; }
              .bank-notice { border: 1px solid #c6d2da; border-top: 4px solid #174c69; border-radius: 5px; margin: 22px 0; padding: 18px; break-inside: avoid; }
              .notice-caption { color: #9a6713; font-size: 10px; font-weight: 700; letter-spacing: .12em; }
              .bank-notice h3 { color: #173c55; font-size: 16px; }
              @media (max-width: 700px) { body { padding: 0 14px; } .kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); } .case-meta { grid-template-columns: 1fr; } .bar-row { grid-template-columns: 1fr; gap: 5px; } .masthead { flex-direction: column; } }
              @media print { body { margin: 0; max-width: none; padding: 0; } h2 { break-after: avoid; } thead { display: table-header-group; } tr { break-inside: avoid; } }
            </style>
          </head>
          <body>
            <header class="masthead">
              <div>
                <div class="brand">Abhimanyu · Investigation workspace</div>
                <h1>Investigation case diary</h1>
                <div class="meta">Evidence summary and transaction register</div>
              </div>
              <span class="draft-tag">DRAFT · REVIEW REQUIRED</span>
            </header>
            <div class="case-meta">
              <div><span>Case reference</span><strong>ABHIMANYU-${escapeHtml(report.victim_account)}</strong></div>
              <div><span>Account under review</span><strong>${escapeHtml(report.victim_account)}</strong></div>
              <div><span>FIR / complaint reference</span><strong>${escapeHtml(caseDetailText(caseDetails.fir_or_complaint_number))}</strong></div>
              <div><span>Police station / unit</span><strong>${escapeHtml(caseDetailText(caseDetails.police_station_or_unit))}</strong></div>
              <div><span>Investigating officer</span><strong>${escapeHtml(caseDetailText(caseDetails.investigating_officer_name_rank))}</strong></div>
              <div><span>Verified reported loss</span><strong>${escapeHtml(reportedLossText)}</strong></div>
            </div>
            <div class="notice">${report.truncated ? 'PARTIAL TRACE — the query reached its configured limit. Additional transfers may exist and this report must not be treated as a complete network.' : 'Coverage note: this report summarizes the records returned for the configured trace. Confirm scope against source records.'}</div>
            <h2><span class="section-label">01 · Executive summary</span></h2>
            <div class="kpis">
              <div class="kpi"><span>Direct recorded outflow</span><strong>${escapeHtml(fmtMoney(report.observed_direct_victim_outflow_inr))}</strong><small>Sent from the account under review</small></div>
              <div class="kpi"><span>Transfers returned</span><strong>${escapeHtml(report.transactions_in_trace)}</strong><small>Within the returned trace</small></div>
              <div class="kpi"><span>Accounts observed</span><strong>${escapeHtml(accounts.length + 1)}</strong><small>Including the account under review</small></div>
              <div class="kpi"><span>Gross traced value</span><strong>${escapeHtml(fmtMoney(report.sum_of_traced_transaction_values_inr))}</strong><small>May count value at multiple hops</small></div>
            </div>
            <div class="summary">
              <strong>Record-based observations</strong>
              <ul>${(report.plain_language_summary || []).map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>
            </div>
            ${aiSummary}
            <h2><span class="section-label">02 · Transfer pattern</span></h2>
            <p>Recorded transaction value grouped by trace hop. This visualization describes record volume, not unique-fund tracing.</p>
            ${stepChart}
            <h2><span class="section-label">03 · Amount and limitations</span></h2>
            <table>
              <thead><tr><th>Measure</th><th>Observed value</th></tr></thead>
              <tbody>${summaryRows}</tbody>
            </table>
            <p class="notice">${escapeHtml(report.value_summary_note)}</p>
            <p class="meta">Generated (UTC): ${escapeHtml(report.generated_at_utc)} · Reported loss must be supplied and verified from complaint / bank evidence. Direct observed outflow is a dataset calculation, not a final loss finding.</p>
            <h2><span class="section-label">04 · Chronological case-diary entries</span></h2>
            <ol class="chronology">${chronology || '<li>No chronological entries are available.</li>'}</ol>
            <h2><span class="section-label">05 · Layer-wise accounts and exact observed transfers</span></h2>
            <p>Amounts below are summed from the returned transactions for each receiving account and layer. Timestamps and transaction references are copied from those records.</p>
            <table>
              <thead><tr><th>Layer</th><th>Receiving account</th><th>IFSC</th><th>First observed</th><th>Last observed</th><th>Observed inflow</th><th>Transaction IDs</th></tr></thead>
              <tbody>${layerRows}</tbody>
            </table>
            <h2><span class="section-label">06 · Potential trace-leaf / current-holding verification</span></h2>
            <p class="notice">These are potential trace leaves only: no later outgoing transfer appears in the deepest observed layer of this returned trace. This does not establish that funds remain there now. Request a bank-verified available balance and as-of time. Any immediate restraint requires separate statutory authority, recorded grounds, and competent approval.</p>
            <table>
              <thead><tr><th>Potential account</th><th>IFSC</th><th>Supporting IDs</th><th>Last observed receipt</th><th>Historical observed inflow</th><th>Current balance</th></tr></thead>
              <tbody>${holdingRows}</tbody>
            </table>
            <h2><span class="section-label">07 · Chronological transaction register</span></h2>
            <table>
              <thead><tr><th>Time in record</th><th>Reference</th><th>Hop</th><th>From account</th><th>To account</th><th>Amount</th></tr></thead>
              <tbody>${evidenceRows}</tbody>
            </table>
            <h2><span class="section-label">08 · Accounts identified for verification</span></h2>
            <p class="notice">Presence in this trace is not proof of wrongdoing. Verify each account and transaction with the relevant institution.</p>
            <table>
              <thead><tr><th>Account observed receiving a transfer</th><th>Supporting references</th></tr></thead>
              <tbody>${accountRows}</tbody>
            </table>
            <h2><span class="section-label">09 · Bank-wise records-production / preservation notices</span></h2>
            <p class="notice">Draft only. Nodal Officer details and bank identity must be verified from an official directory. Section 94 BNSS / Section 91 CrPC is referenced for production of records only, as applicable; it is not presented as a standalone account-freeze power. Any restraint authority must be separately cited and approved by the issuing authority.</p>
            ${bankSections}
            <h2><span class="section-label">10 · Review actions for authorized personnel</span></h2>
            <ul>${actions}</ul>
            <h3>Required checks before submission</h3>
            <ul>${requiredItems}</ul>
            <div class="notice">${escapeHtml(report.legal_notice_status)} No notice has been issued and no account has been frozen by this system.</div>
            <p class="footer">Prepared from returned transaction records. Validate all fields against original records and applicable legal authority. IP/device metadata is retained in the supporting JSON evidence export rather than foregrounded in this human-readable summary.</p>
          </body>
        </html>`
      const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `abhimanyu-printable-case-diary-${accountId}.html`
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (error) {
      console.error('Printable case diary export failed:', error)
      const message =
        error.response?.data?.detail ||
        error.message ||
        'Unknown error'
      window.alert(`Could not export printable case diary: ${message}`)
    }
  }

  const loadAnomalies = useCallback(async (pageOffset = anomalyOffset) => {
    setAnomalyLoading(true)
    setAnomalyError('')
    try {
      const response = await api.get('/anomalies', {
        params: { limit: 20, offset: pageOffset, q: anomalyQuery },
      })
      setAnomalyRows(response.data.results ?? [])
      setAnomalyTotal(response.data.total ?? 0)
      setAnomalyFlaggedTotal(response.data.flagged_total ?? 0)
    } catch (err) {
      setAnomalyError(
        err.response?.data?.detail || err.message || 'Could not load anomaly results.'
      )
    } finally {
      setAnomalyLoading(false)
    }
  }, [anomalyOffset, anomalyQuery])

  useEffect(() => {
    loadAnomalies()
  }, [loadAnomalies])

  const uploadCsv = async (event) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    if (!file.name.toLowerCase().endsWith('.csv')) {
      setUploadMessage({ type: 'error', text: 'Choose a CSV file ending in .csv.' })
      return
    }

    const confirmed = window.confirm(
      `Import ${file.name} (${fmtNumber(file.size)} bytes)?\n\nThis replaces the currently loaded transaction dataset.`
    )
    if (!confirmed) return

    const formData = new FormData()
    formData.append('file', file)
    setUploadingCsv(true)
    setUploadMessage(null)

    try {
      const { data } = await api.post('/ingestion/upload', formData, {
        timeout: 0,
      })
      setUploadMessage({
        type: 'success',
        text: `Loaded ${fmtNumber(data.rows)} rows from ${data.filename}; ${fmtNumber(data.unique_accounts)} accounts found.`,
      })
      await loadUploadHistory()
      setAnomalyOffset(0)
      await loadAnomalies(0)
      if (data.sample_account) {
        await loadInvestigation(data.sample_account)
      }
    } catch (err) {
      const message = err.response?.data?.detail || err.message || 'CSV upload failed.'
      setUploadMessage({ type: 'error', text: String(message) })
    } finally {
      setUploadingCsv(false)
    }
  }

  const rollbackCsvUpload = async () => {
    if (!window.confirm('Roll back the most recent CSV import and restore the previous dataset?')) return
    setRollingBackUpload(true)
    setUploadAuditError('')
    try {
      const { data } = await api.post('/ingestion/rollback')
      setUploadMessage({
        type: 'success',
        text: data.had_previous_dataset
          ? `Restored the dataset from before ${data.filename} (${fmtNumber(data.rows)} rows).`
          : `Removed ${data.filename}; there was no earlier dataset to restore.`,
      })
      if (data.sample_account) {
        await loadInvestigation(data.sample_account)
      } else {
        setAccountId('')
        setQuery('')
        setAccount(null)
        setRisk(null)
        setTrace(null)
        setTimelineData(null)
        setSelectedTx(null)
      }
      setAnomalyOffset(0)
      await loadAnomalies(0)
      await loadUploadHistory()
    } catch (err) {
      setUploadAuditError(
        err.response?.data?.detail || err.message || 'Could not roll back the CSV import.'
      )
    } finally {
      setRollingBackUpload(false)
    }
  }

  const navigateTo = (sectionId) => {
    setActiveSection(sectionId)
    const target = slideRefs.current[sectionId]
    const main = mainRef.current
    if (target && main) {
      window.cancelAnimationFrame(navigationFrameRef.current)
      navigationFrameRef.current = window.requestAnimationFrame(() => {
        const mainTop = main.getBoundingClientRect().top
        const targetTop = target.getBoundingClientRect().top
        main.scrollTo({
          top: main.scrollTop + targetTop - mainTop - 62,
          behavior: 'smooth',
        })
      })
    }
  }
  const activeSlideIndex = SLIDES.findIndex((slide) => slide.id === activeSection)
  const moveSlide = (delta) => {
    const nextSlide = SLIDES[Math.max(0, Math.min(SLIDES.length - 1, activeSlideIndex + delta))]
    if (nextSlide) navigateTo(nextSlide.id)
  }

  useEffect(() => {
    const navigation = slideProgressRef.current
    const activeStep = navigation?.querySelector('[aria-current="step"]')
    if (!navigation || !activeStep || navigation.scrollWidth <= navigation.clientWidth) return

    const stepLeft = activeStep.getBoundingClientRect().left
      - navigation.getBoundingClientRect().left + navigation.scrollLeft
    const stepRight = stepLeft + activeStep.offsetWidth
    const visibleLeft = navigation.scrollLeft
    const visibleRight = visibleLeft + navigation.clientWidth
    if (stepLeft < visibleLeft || stepRight > visibleRight) {
      navigation.scrollTo({
        left: stepLeft - (navigation.clientWidth - activeStep.offsetWidth) / 2,
        behavior: 'smooth',
      })
    }
  }, [activeSlideIndex])

  useEffect(() => {
    const handleSlideKeys = (event) => {
      if (
        event.target instanceof HTMLElement
        && (event.target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target.tagName))
      ) return

      if (event.key === 'ArrowRight') {
        navigateTo(SLIDES[Math.min(SLIDES.length - 1, activeSlideIndex + 1)].id)
      }
      if (event.key === 'ArrowLeft') {
        navigateTo(SLIDES[Math.max(0, activeSlideIndex - 1)].id)
      }
    }
    window.addEventListener('keydown', handleSlideKeys)
    return () => window.removeEventListener('keydown', handleSlideKeys)
  }, [activeSlideIndex])

  return (
    <div className="app-shell">
      <main ref={mainRef} className="main" id="money-flow-section" data-active-slide={activeSection}>
        <header className="topbar">
          <div>
            <div className="eyebrow">ABHIMANYU · CYBERCRIME INVESTIGATION PLATFORM</div>
            <h1>{SLIDES[activeSlideIndex]?.label || 'Money-flow intelligence'}</h1>
            <p>{SLIDES[activeSlideIndex]?.description || 'Trace transaction paths, examine account activity, and assemble case evidence.'}</p>
          </div>

          <div className="top-actions">
            <div className="slide-controls" aria-label="Slide navigation">
              <button
                type="button"
                className="icon-button"
                onClick={() => moveSlide(-1)}
                disabled={activeSlideIndex <= 0}
                aria-label="Previous slide"
                title="Previous slide (Left Arrow)"
              >
                <ChevronLeft size={17} />
              </button>
              <span className="slide-counter">
                {String(activeSlideIndex + 1).padStart(2, '0')} / {String(SLIDES.length).padStart(2, '0')}
                <strong>{SLIDES[activeSlideIndex]?.label}</strong>
              </span>
              <button
                type="button"
                className="icon-button"
                onClick={() => moveSlide(1)}
                disabled={activeSlideIndex >= SLIDES.length - 1}
                aria-label="Next slide"
                title="Next slide (Right Arrow)"
              >
                <ChevronRight size={17} />
              </button>
            </div>
            <span className="local-pill"><span /> LOCAL / OFFLINE DATA</span>
            <input
              ref={uploadInputRef}
              className="visually-hidden"
              type="file"
              accept=".csv,text/csv"
              onChange={uploadCsv}
              aria-label="Choose a transaction CSV file"
            />
            <button
              type="button"
              className="upload-button"
              onClick={() => uploadInputRef.current?.click()}
              disabled={uploadingCsv}
            >
              <Upload size={15} />
              {uploadingCsv ? 'Importing CSV...' : 'Import CSV'}
            </button>
            <button
              className="icon-button"
              onClick={() => loadInvestigation(accountId)}
              title="Refresh investigation"
              aria-label="Refresh investigation"
            >
              <RefreshCw size={17} />
            </button>
          </div>
        </header>

        {uploadMessage && (
          <div className={`upload-message ${uploadMessage.type}`} role={uploadMessage.type === 'error' ? 'alert' : 'status'}>
            <div>
              {uploadMessage.text}
              {uploadMessage.type === 'success' && uploadRollbackAvailable && (
                <button
                  type="button"
                  className="audit-inline-rollback"
                  onClick={rollbackCsvUpload}
                  disabled={rollingBackUpload || uploadingCsv}
                >
                  Roll back this upload
                </button>
              )}
            </div>
            <button
              type="button"
              onClick={() => setUploadMessage(null)}
              aria-label="Dismiss CSV import message"
            >
              ×
            </button>
          </div>
        )}

        <details className="upload-audit-panel">
          <summary>
            CSV upload audit trail
            <span>{uploadHistory.length} recorded action{uploadHistory.length === 1 ? '' : 's'}</span>
          </summary>
          {uploadAuditError && <div className="timeline-error" role="alert">{uploadAuditError}</div>}
          {uploadRollbackAvailable && (
            <button
              type="button"
              className="secondary-button audit-rollback"
              onClick={rollbackCsvUpload}
              disabled={rollingBackUpload || uploadingCsv}
            >
              <RefreshCw size={14} />
              {rollingBackUpload ? 'Restoring previous dataset...' : 'Roll back latest CSV upload'}
            </button>
          )}
          {uploadHistory.length ? (
            <div className="upload-audit-list">
              {uploadHistory.map((event, index) => (
                <div className="upload-audit-event" key={`${event.occurred_at}-${index}`}>
                  <strong>{event.action === 'rollback' ? 'ROLLBACK' : 'IMPORT'}</strong>
                  <span>{event.filename || 'CSV dataset'}</span>
                  <span>{fmtNumber(event.current_rows)} rows</span>
                  <time dateTime={event.occurred_at}>{new Date(event.occurred_at).toLocaleString()}</time>
                </div>
              ))}
            </div>
          ) : !uploadAuditError ? (
            <p className="transaction-search-hint">No CSV upload actions have been recorded yet.</p>
          ) : null}
        </details>

        {error && (
          <div className="error-banner" role="alert">
            <AlertTriangle size={17} />
            {error}
          </div>
        )}

        <nav ref={slideProgressRef} className="slide-progress" aria-label="Investigation flow">
          {SLIDES.map((slide, index) => (
            <button
              key={slide.id}
              type="button"
              className={`slide-progress-step ${index === activeSlideIndex ? 'active' : ''} ${index < activeSlideIndex ? 'complete' : ''}`}
              onClick={() => navigateTo(slide.id)}
              aria-current={index === activeSlideIndex ? 'step' : undefined}
              title={slide.label}
            >
              <span>{String(index + 1).padStart(2, '0')}</span>
              <strong>{slide.label}</strong>
            </button>
          ))}
        </nav>

        <div className="flow-slide-viewport">
          <div className="flow-slide-track">
        <section ref={(element) => { slideRefs.current.brief = element }} className={`flow-slide ${activeSection === 'brief' ? 'is-active' : ''}`} data-slide="brief">
        <RiskContext
          score={riskScore}
          level={riskLevel}
          reason={Array.isArray(indicators) && indicators.length
            ? String(typeof indicators[0] === 'string' ? indicators[0] : JSON.stringify(indicators[0]))
            : `Screening classifies this account as ${layerName}. Review the trace and source records for context.`}
          onReview={() => navigateTo('account-intelligence')}
        />
        <section className="search-panel">
          <div
            className="account-search-control"
            onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget)) {
                setAccountSuggestionsOpen(false)
              }
            }}
          >
          <form className="search-form" onSubmit={searchAccounts}>
            <Search size={19} />
            <input
              value={query}
              onChange={(event) => handleAccountQueryChange(event.target.value)}
              onFocus={handleAccountSearchFocus}
              onKeyDown={handleAccountSearchKeyDown}
              placeholder="Search account ID..."
              aria-label="Search account"
              aria-autocomplete="list"
              aria-controls="account-search-results"
              aria-expanded={accountSuggestionsOpen}
              aria-activedescendant={accountSuggestionsOpen && searchResults.length
                ? `account-search-result-${activeAccountSuggestion}`
                : undefined}
            />
            <button className="primary-button" type="submit">
              Search accounts
            </button>
          </form>

          {accountSuggestionsOpen && query.trim().length >= 3 && (
            <div className="account-search-dropdown" id="account-search-results" role="listbox" aria-label="Matching accounts">
              {accountSearchLoading ? (
                <div className="account-search-message">Searching accounts...</div>
              ) : searchResults.length > 0 ? (
                <>
                  <div className="account-search-dropdown-heading">
                    {searchResults.length} matching account{searchResults.length === 1 ? '' : 's'}
                  </div>
                  {searchResults.map((item, index) => {
                const id = first(item, [
                  'account_id', 'Account_ID', 'Sender_Account', 'account', 'id',
                ])

                return (
                  <button
                    type="button"
                    className="account-search-suggestion"
                    role="option"
                    aria-selected={index === activeAccountSuggestion}
                    id={`account-search-result-${index}`}
                    key={id || index}
                    onMouseEnter={() => setActiveAccountSuggestion(index)}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => selectAccountSuggestion(item)}
                  >
                    <span className="account-search-suggestion-number">{index + 1}</span>
                    <span className="account-search-suggestion-id"><Database size={14} /> {id || 'Unknown account'}</span>
                    <ChevronRight size={16} />
                  </button>
                )
                  })}
                </>
              ) : (
                <div className="account-search-message">No matching accounts found.</div>
              )}
            </div>
          )}
          </div>

          <div className="search-hint">
            Search by account identifier (minimum 3 characters).
          </div>
        </section>
        <section className="stats-grid">
          <StatCard
            icon={Shield}
            label="Preliminary risk score"
            value={`${Number.isFinite(riskScore) ? riskScore : 0}/100`}
            note={`Assessment: ${riskLevel}`}
          />
          <StatCard
            icon={Database}
            label="Transactions in view"
            value={fmtNumber(txs.length)}
            note={`Maximum hops: ${traceHops}`}
          />
          <StatCard
            icon={ArrowDownLeft}
            label="Total incoming"
            value={fmtMoney(incoming)}
            note="From account and risk statistics"
          />
          <StatCard
            icon={ArrowUpRight}
            label="Total outgoing"
            value={fmtMoney(outgoing)}
            note="From account and risk statistics"
          />
        </section>

        <section className="panel timeline-panel" data-slide="brief">
          <div className="panel-heading">
            <div>
              <div className="panel-title">
                <Clock3 size={17} />
                Transaction timeline
              </div>
              <div className="panel-subtitle">
                  Progressively reveal traced transactions at each active minute
              </div>
            </div>

            <div className="timeline-controls">
              <button
                type="button"
                className="secondary-button timeline-rewind"
                onClick={rewindTimelinePlayback}
                disabled={timelineLoading || safeTimelineMinuteOffset === 0}
                aria-label="Rewind transaction timeline to the beginning"
                title="Rewind to the beginning"
              >
                <Rewind size={15} />
                Rewind
              </button>
              <button
                type="button"
                className="secondary-button timeline-speed"
                onClick={() => setTimelineSpeed((speed) => (speed === 1 ? 2 : speed === 2 ? 4 : 1))}
                aria-label={`Playback speed ${timelineSpeed}x. Switch speed`}
                aria-pressed={timelineSpeed > 1}
                title="Cycle playback speed: 1×, 2×, 4×"
              >
                {timelineSpeed}×
              </button>
              <button
                type="button"
                className="secondary-button timeline-play"
                onClick={toggleTimelinePlayback}
                disabled={timelineLoading || timelineSteps.length < 2}
              >
                {timelinePlaying ? <Pause size={15} /> : <Play size={15} />}
                {timelinePlaying ? 'Pause' : 'Play'}
              </button>
            </div>
          </div>

          <div className="timeline-content">
            <div className="timeline-dates">
              <span>
                {timelineBounds.start === null
                  ? 'No timestamped transactions'
                  : formatTimelineMinute(timelineBounds.start)}
              </span>
              <strong>
                Through {timelineEndMinute === null
                  ? '—'
                  : formatTimelineMinute(timelineEndMinute)}
              </strong>
              <span>
                {timelineBounds.end === null
                  ? '—'
                  : formatTimelineMinute(timelineBounds.end)}
              </span>
            </div>

            <input
              className="timeline-slider"
              type="range"
              min={0}
              max={Math.max(0, timelineCheckpointCount - 1)}
              step={1}
              value={safeTimelineMinuteOffset}
              onChange={(event) => {
                setTimelinePlaying(false)
                setTimelineMinuteOffset(Number(event.target.value))
              }}
              disabled={timelineLoading || timelineSteps.length < 2}
              aria-label="Timeline transaction-time checkpoint"
            />

            <div className="timeline-footer">
              <span>
                {timelineSteps.length > 1
                  ? `Checkpoint ${safeTimelineMinuteOffset + 1} of ${timelineSteps.length}`
                  : timelineSteps.length === 1
                    ? '1 transaction-time checkpoint'
                    : 'No transaction-time checkpoints'}
              </span>
              <span>
                {timelineLoading
                  ? 'Loading transactionsâ€¦'
                  : `${fmtNumber(txs.length)} transactions in range`}
              </span>
            </div>

            {timelineError && (
              <div className="timeline-error">
                <AlertTriangle size={14} />
                {timelineError}
              </div>
            )}

            <div className="timeline-note">
              This timeline filters transactions in the selected account's trace.
              It does not independently scan every row in the dataset. Slider
              steps move between minutes that contain transactions, skipping
              empty time gaps.
            </div>
          </div>
        </section>

        </section>

        <section ref={(element) => { slideRefs.current['money-flow'] = element }} className={`flow-slide ${activeSection === 'money-flow' ? 'is-active' : ''}`} data-slide="money-flow">
          <div className="panel graph-panel">
            <div className="panel-heading">
              <div>
                <div className="panel-title">
                  <Network size={17} /> Transaction network
                </div>
                <div className="panel-subtitle">
                  {isolatedAccount
                    ? `Weakly connected component containing ${isolatedAccount}`
                    : 'Click an account to isolate its connected component'}
                </div>
              </div>

              <div className="graph-actions">
                <input
                  className="graph-isolate-input"
                  aria-label="Account in visible graph"
                  value={isolationQuery}
                  onChange={(event) => setIsolationQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') isolateQueriedAccount()
                  }}
                  placeholder="Account in graph"
                />
                <button
                  type="button"
                  className="secondary-button"
                  onClick={isolateQueriedAccount}
                  disabled={!isolationQuery.trim()}
                >
                  Isolate account
                </button>
                {isolatedAccount && (
                  <>
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={exportIsolatedSubgraph}
                      disabled={graph.links.length === 0}
                    >
                      Export subgraph CSV
                    </button>
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => {
                        setIsolatedAccount(null)
                        setIsolationError('')
                      }}
                    >
                      Clear isolation
                    </button>
                  </>
                )}
              <label className="hop-select">
                HOPS
                <select
                  value={maxHops}
                  onChange={(event) => {
                    setMaxHops(Number(event.target.value))
                    setTimelinePlaying(false)
                  }}
                >
                  {[1, 2, 3, 4].map((number) => (
                    <option key={number} value={number}>{number}</option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className="secondary-button"
                onClick={() => toggleFullscreen('graph')}
                aria-label={fullscreenTarget === 'graph' ? 'Exit graph fullscreen' : 'View graph fullscreen'}
              >
                {fullscreenTarget === 'graph' ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
                {fullscreenTarget === 'graph' ? 'Exit fullscreen' : 'Fullscreen'}
              </button>
              </div>
            </div>

            <div className="graph-wrap" ref={graphWrapRef}>
              {fullscreenTarget === 'graph' && (
                <>
                  <button
                    type="button"
                    className="secondary-button fullscreen-exit-button"
                    onClick={() => toggleFullscreen('graph')}
                    aria-label="Exit graph fullscreen"
                  >
                    <Minimize2 size={15} /> Exit fullscreen
                  </button>
                  <div
                    className="fullscreen-timeline-controls"
                    aria-label="Transaction network playback controls"
                    onPointerDown={(event) => event.stopPropagation()}
                  >
                    <span className="fullscreen-timeline-progress">
                      Checkpoint {timelineSteps.length ? safeTimelineMinuteOffset + 1 : 0} / {timelineSteps.length}
                      {' · '}{fmtNumber(txs.length)} transactions
                    </span>
                    <div className="timeline-controls">
                      <button
                        type="button"
                        className="secondary-button timeline-rewind"
                        onClick={rewindTimelinePlayback}
                        disabled={timelineLoading || safeTimelineMinuteOffset === 0}
                        aria-label="Rewind transaction network to the beginning"
                        title="Rewind to the beginning"
                      >
                        <Rewind size={15} />
                        Rewind
                      </button>
                      <button
                        type="button"
                        className="secondary-button timeline-speed"
                        onClick={() => setTimelineSpeed((speed) => (speed === 1 ? 2 : speed === 2 ? 4 : 1))}
                        aria-label={`Playback speed ${timelineSpeed}x. Switch speed`}
                        aria-pressed={timelineSpeed > 1}
                        title="Cycle playback speed: 1×, 2×, 4×"
                      >
                        {timelineSpeed}×
                      </button>
                      <button
                        type="button"
                        className="secondary-button timeline-play"
                        onClick={toggleTimelinePlayback}
                        disabled={timelineLoading || timelineSteps.length < 2}
                        aria-label={timelinePlaying ? 'Pause transaction network playback' : 'Play transaction network playback'}
                      >
                        {timelinePlaying ? <Pause size={15} /> : <Play size={15} />}
                        {timelinePlaying ? 'Pause' : 'Play'}
                      </button>
                    </div>
                  </div>
                </>
              )}
              {graph.nodes.length > 1 && graph.links.length > 0 ? (
                <MoneyFlowGraph
                  key={accountId}
                  nodes={graph.nodes}
                  links={graph.links}
                  selectedAccount={isolatedAccount || accountId}
                  traceRootAccount={accountId}
                  maxHops={maxHops}
                  onExpandAccount={expandAccountOutgoing}
                  onSelectAccount={(id) => {
                    setIsolatedAccount(id)
                    setIsolationQuery(id)
                    setIsolationError('')
                  }}
                  onSelectTransaction={setSelectedTx}
                />
              ) : (
                <div className="empty-graph">
                  <Network size={36} />
                  <strong>
                    {loading || timelineLoading
                      ? 'Tracing transaction pathsâ€¦'
                      : 'No graph edges available'}
                  </strong>
                  <span>
                    {displayTrace
                      ? 'No recognizable sender/receiver edges were returned for this range.'
                      : 'Load an account to view its transaction network.'}
                  </span>
                </div>
              )}
            </div>

            {trace?.truncated && (
              <div className="timeline-note">
                The initial trace reached its transaction cap. Select an account
                in the graph to load its outgoing transfers in pages of 100.
                Downstream pages respect the recorded receipt time; the overall
                trace remains marked incomplete because not every branch is
                automatically expanded.
              </div>
            )}
            {fullscreenError && <div className="timeline-error" role="alert">{fullscreenError}</div>}
            <div className="timeline-note">
              Layer colors are heuristics computed from this visible trace only; they are not validated ground-truth labels.
            </div>
            {isolatedAccount && (
              <div className="timeline-note">
                Isolation and export use only this currently visible, time-filtered trace.
              </div>
            )}
            {isolationError && (
              <div className="timeline-error" role="alert">
                <AlertTriangle size={14} />
                {isolationError}
              </div>
            )}
          </div>
        </section>

        <section ref={(element) => { slideRefs.current['account-intelligence'] = element }} className={`flow-slide ${activeSection === 'account-intelligence' ? 'is-active' : ''}`} data-slide="account-intelligence">
          <div
            className="panel account-panel"
            id="account-intelligence-section"
          >
            <div className="panel-heading">
              <div>
                <div className="panel-title">
                  <Activity size={17} /> Account intelligence
                </div>
                <div className="panel-subtitle">Current investigation subject</div>
              </div>
              {loading && <RefreshCw className="spin" size={17} />}
            </div>

            <div className="account-id">{accountId}</div>

            <div className="risk-row">
              <div
                className="risk-gauge"
                style={{
                  '--score': `${Math.max(0, Math.min(100, riskScore)) * 3.6}deg`,
                }}
              >
                <div><strong>{riskScore}</strong><span>/100</span></div>
              </div>
              <div>
                <div className="risk-label">{riskLevel}</div>
                <div className="muted">{layerName}</div>
                <div className="muted">Heuristic assessment; not a finding of guilt</div>
              </div>
            </div>

            <div className="detail-list">
              <div>
                <span>Account transactions</span>
                <strong>{fmtNumber(accountTxCount)}</strong>
              </div>
              <div>
                <span>Incoming amount</span>
                <strong>{fmtMoney(incoming)}</strong>
              </div>
              <div>
                <span>Outgoing amount</span>
                <strong>{fmtMoney(outgoing)}</strong>
              </div>
              <div>
                <span>Trace truncated</span>
                <strong>{truncated ? 'Yes' : 'No'}</strong>
              </div>
            </div>

            <div className="section-mini-title">RISK INDICATORS</div>

            {Array.isArray(indicators) && indicators.length > 0 ? (
              <ul className="indicator-list">
                {indicators.map((indicator, index) => (
                  <li key={index}>
                    <AlertTriangle size={14} />
                    {typeof indicator === 'string'
                      ? indicator
                      : JSON.stringify(indicator)}
                  </li>
                ))}
              </ul>
            ) : (
              <div className="muted empty-indicators">
                No indicator list was returned by the API.
              </div>
            )}
          </div>
        </section>

        <section ref={(element) => { slideRefs.current['global-trace'] = element }} className={`flow-slide ${activeSection === 'global-trace' ? 'is-active' : ''}`} data-slide="global-trace">
        <section className="panel global-trace-panel" id="global-trace-section" ref={globePanelRef}>
          <div className="panel-heading">
            <div>
              <div className="panel-title">
                <Globe2 size={17} /> Global trace globe
              </div>
              <div className="panel-subtitle">
                Interactive 3D view of transfers in the selected account trace.
              </div>
            </div>
            <span className="count-pill">{fmtNumber(graph.links.length)} plotted routes</span>
            <button
              type="button"
              className="secondary-button"
              onClick={() => toggleFullscreen('globe')}
              aria-label={fullscreenTarget === 'globe' ? 'Exit globe fullscreen' : 'View globe fullscreen'}
            >
              {fullscreenTarget === 'globe' ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
              {fullscreenTarget === 'globe' ? 'Exit fullscreen' : 'Fullscreen'}
            </button>
          </div>
          {globeActivated ? (
            <Suspense fallback={<div className="globe-loading">Loading interactive globe...</div>}>
              <GlobalTraceGlobe
                links={graph.links}
                selectedAccount={isolatedAccount || accountId}
                onSelectAccount={(id) => {
                  setIsolatedAccount(id)
                  setIsolationQuery(id)
                  setIsolationError('')
                }}
              />
            </Suspense>
          ) : (
            <div className="globe-loading">
              <Globe2 size={19} />
              The interactive globe loads when this section comes into view.
            </div>
          )}
          {fullscreenError && <div className="timeline-error" role="alert">{fullscreenError}</div>}
        </section>
        </section>

        <section ref={(element) => { slideRefs.current['case-reports'] = element }} className={`flow-slide ${activeSection === 'case-reports' ? 'is-active' : ''}`} data-slide="case-reports">
        <section className="panel transactions-panel">
          <div className="panel-heading">
            <div>
              <div className="panel-title">
                <Clock3 size={17} /> Timeline transactions
              </div>
              <div className="panel-subtitle">
                {timelineBounds.start === null
                  ? 'No timestamped transactions'
                  : `${formatTimelineMinute(timelineBounds.start)} – ${formatTimelineMinute(timelineEndMinute)}`}
              </div>
            </div>
            <span className="count-pill">{fmtNumber(txs.length)} records</span>
          </div>

          <div className={`transaction-search ${transactionSuggestionsOpen && transactionSearch.trim() ? 'has-open-suggestions' : ''}`}>
            <label htmlFor="transaction-search-input">Find a transaction</label>
            <input
              id="transaction-search-input"
              type="search"
              role="combobox"
              aria-haspopup="listbox"
              aria-autocomplete="list"
              aria-expanded={Boolean(transactionSuggestionsOpen && transactionSearch.trim())}
              aria-controls="transaction-search-suggestions"
              aria-activedescendant={transactionSuggestionsOpen && transactionSuggestions[activeTransactionSuggestion]
                ? `transaction-option-${activeTransactionSuggestion}`
                : undefined}
              value={transactionSearch}
              onChange={(event) => {
                setTransactionSearch(event.target.value)
                setActiveTransactionSuggestion(0)
                setTransactionSuggestionsOpen(true)
              }}
              onFocus={() => setTransactionSuggestionsOpen(true)}
              onBlur={() => window.setTimeout(() => setTransactionSuggestionsOpen(false), 120)}
              onKeyDown={(event) => {
                if (event.key === 'ArrowDown' && transactionSuggestions.length) {
                  event.preventDefault()
                  setTransactionSuggestionsOpen(true)
                  setActiveTransactionSuggestion((index) => Math.min(index + 1, transactionSuggestions.length - 1))
                } else if (event.key === 'ArrowUp' && transactionSuggestions.length) {
                  event.preventDefault()
                  setActiveTransactionSuggestion((index) => Math.max(index - 1, 0))
                } else if (event.key === 'Enter' && transactionSuggestionsOpen && transactionSuggestions[activeTransactionSuggestion]) {
                  event.preventDefault()
                  selectTransactionSuggestion(transactionSuggestions[activeTransactionSuggestion].tx)
                } else if (event.key === 'Escape') {
                  setTransactionSuggestionsOpen(false)
                }
              }}
              placeholder="ID, account, narration, amount, or payment mode"
            />
            {transactionSuggestionsOpen && transactionSearch.trim() && (
              <div className="transaction-suggestions" id="transaction-search-suggestions" role="listbox">
                {transactionSuggestions.length ? transactionSuggestions.map(({ tx, index }, optionIndex) => {
                  const screening = transactionRisk(tx)
                  const screeningLevel = screening.score >= 60 ? 'high' : screening.score >= 30 ? 'medium' : 'low'
                  return (
                    <button
                      type="button"
                      role="option"
                      aria-selected={optionIndex === activeTransactionSuggestion}
                      id={`transaction-option-${optionIndex}`}
                      key={`${first(tx, ['Transaction_ID', 'transaction_id', 'id'], index)}-${index}`}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => selectTransactionSuggestion(tx)}
                    >
                      <strong>{String(first(tx, ['Transaction_ID', 'transaction_id', 'id'], `Row ${index + 1}`))}</strong>
                      <span className="transaction-suggestion-details">
                        {String(first(tx, ['Sender_Account', 'sender_account', 'sender', 'source', 'from'], 'Unknown sender'))}
                        {' → '}
                        {String(first(tx, ['Receiver_Account', 'receiver_account', 'receiver', 'target', 'to'], 'Unknown receiver'))}
                        {' · '}
                        {fmtMoney(first(tx, ['Amount', 'amount', 'value']))}
                      </span>
                      <span className={`transaction-risk risk-${screeningLevel}`}>
                        {screeningLevel} · {screening.score}% <small>heuristic</small>
                      </span>
                    </button>
                  )
                }) : (
                  <div className="transaction-suggestions-empty">No matching transactions in the visible trace.</div>
                )}
              </div>
            )}
            <span className="transaction-search-hint">Search suggestions use the currently visible trace only.</span>
          </div>

          <div className="transaction-search ifsc-search">
            <label htmlFor="ifsc-search-input">Find transactions by IFSC code</label>
            <input
              id="ifsc-search-input"
              type="search"
              role="combobox"
              aria-haspopup="listbox"
              aria-autocomplete="list"
              aria-expanded={Boolean(ifscSuggestionsOpen && ifscSearch.trim())}
              aria-controls="ifsc-search-suggestions"
              aria-activedescendant={ifscSuggestionsOpen && ifscSuggestions[activeIfscSuggestion]
                ? `ifsc-option-${activeIfscSuggestion}`
                : undefined}
              value={ifscSearch}
              onChange={(event) => {
                setIfscSearch(event.target.value)
                setActiveIfscSuggestion(0)
                setIfscSuggestionsOpen(true)
              }}
              onFocus={() => setIfscSuggestionsOpen(true)}
              onBlur={() => window.setTimeout(() => setIfscSuggestionsOpen(false), 120)}
              onKeyDown={(event) => {
                if (event.key === 'ArrowDown' && ifscSuggestions.length) {
                  event.preventDefault()
                  setIfscSuggestionsOpen(true)
                  setActiveIfscSuggestion((index) => Math.min(index + 1, ifscSuggestions.length - 1))
                } else if (event.key === 'ArrowUp' && ifscSuggestions.length) {
                  event.preventDefault()
                  setActiveIfscSuggestion((index) => Math.max(index - 1, 0))
                } else if (event.key === 'Enter' && ifscSuggestionsOpen && ifscSuggestions[activeIfscSuggestion]) {
                  event.preventDefault()
                  selectTransactionSuggestion(ifscSuggestions[activeIfscSuggestion].tx)
                } else if (event.key === 'Escape') {
                  setIfscSuggestionsOpen(false)
                }
              }}
              placeholder="Enter full or partial sender/receiver IFSC"
            />
            {ifscSuggestionsOpen && ifscSearch.trim() && (
              <div className="transaction-suggestions" id="ifsc-search-suggestions" role="listbox">
                {ifscSuggestions.length ? ifscSuggestions.map(({ tx, index }, optionIndex) => (
                  <button
                    type="button"
                    role="option"
                    aria-selected={optionIndex === activeIfscSuggestion}
                    id={`ifsc-option-${optionIndex}`}
                    key={`${first(tx, ['Transaction_ID', 'transaction_id', 'id'], index)}-${index}`}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => selectTransactionSuggestion(tx)}
                  >
                    <strong>{String(first(tx, ['Transaction_ID', 'transaction_id', 'id'], `Row ${index + 1}`))}</strong>
                    <span className="transaction-suggestion-details">
                      Sender IFSC: {String(first(tx, ['Sender_IFSC', 'sender_ifsc'], 'Unavailable'))}
                      {' · Receiver IFSC: '}
                      {String(first(tx, ['Receiver_IFSC', 'receiver_ifsc'], 'Unavailable'))}
                    </span>
                    <span className="transaction-suggestion-details">
                      {String(first(tx, ['Sender_Account', 'sender_account'], 'Unknown sender'))}
                      {' → '}
                      {String(first(tx, ['Receiver_Account', 'receiver_account'], 'Unknown receiver'))}
                    </span>
                  </button>
                )) : (
                  <div className="transaction-suggestions-empty">No matching IFSC codes in the visible trace.</div>
                )}
              </div>
            )}
            <span className="transaction-search-hint">Matches sender or receiver IFSC in the visible transaction trace.</span>
          </div>

          {timelineLoading ? (
            <div className="empty-table">Loading timeline transactionsâ€¦</div>
          ) : txs.length === 0 ? (
            <div className="empty-table">No transactions were returned for this time range.</div>
          ) : (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Transaction</th>
                    <th>Timestamp</th>
                    <th>Sender</th>
                    <th>Receiver</th>
                    <th>Amount</th>
                    <th>Payment mode</th>
                    <th>Risk screening</th>
                  </tr>
                </thead>
                <tbody>
                  {txs.slice(0, 200).map((tx, index) => {
                    const id = first(tx, ['Transaction_ID', 'transaction_id', 'id'], `Row ${index + 1}`)
                    const time = first(tx, ['Timestamp', 'timestamp', 'time'], 'â€”')
                    const sender = first(tx, ['Sender_Account', 'sender_account', 'sender', 'source', 'from'], 'â€”')
                    const receiver = first(tx, ['Receiver_Account', 'receiver_account', 'receiver', 'target', 'to'], 'â€”')
                    const amount = first(tx, ['Amount', 'amount', 'value'])
                    const mode = first(tx, ['Payment_Mode', 'payment_mode', 'mode'], 'â€”')
                    const screening = transactionRisk(tx)
                    const screeningLevel = screening.score >= 60 ? 'high' : screening.score >= 30 ? 'medium' : 'low'

                    return (
                      <tr
                        key={`${id}-${index}`}
                        onClick={() => setSelectedTx(tx)}
                        className="clickable-row"
                      >
                        <td className="mono">{id}</td>
                        <td>{String(time)}</td>
                        <td className="mono">{String(sender)}</td>
                        <td className="mono">{String(receiver)}</td>
                        <td className="amount">{fmtMoney(amount)}</td>
                        <td>{String(mode)}</td>
                        <td>
                          <span className={`transaction-risk risk-${screeningLevel}`}>
                            {screeningLevel} · {screening.score}% <small>heuristic</small>
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>

              {txs.length > 200 && (
                <div className="table-foot">
                  Showing 200 of {txs.length} records for browser responsiveness.
                </div>
              )}
            </div>
          )}
        </section>

        <section className="panel reports-panel" id="case-reports-section">
          <div className="panel-heading">
            <div>
              <div className="panel-title">
                <FileText size={17} /> Case reports
              </div>
              <div className="panel-subtitle">
                Module D case-officer review: evidence chronology, potential trace leaves, and bank-wise records-production drafts.
              </div>
            </div>
          </div>

          <div className="detail-list">
            <div><span>Case reference</span><strong>ABHIMANYU-{accountId}</strong></div>
            <div><span>Trace coverage</span><strong>{truncated ? 'Partial · review required' : 'Returned records'}</strong></div>
            <div><span>Risk review status</span><strong>{riskLevel} · preliminary</strong></div>
          </div>

          <p className="timeline-note">
            Evidence-led overview of the records returned by this trace. Automated
            indicators are preliminary screening cues, not proof or calibrated
            probabilities. Verify source records before formal use.
          </p>

          <section className="case-report-overview" aria-labelledby="case-report-overview-heading">
            <div className="case-report-section-heading">
              <span>01</span>
              <div>
                <h3 id="case-report-overview-heading">Investigation overview</h3>
                <p>Observed transaction activity in the current trace</p>
              </div>
            </div>
            <div className="case-report-kpis">
              <article>
                <span>Direct recorded outflow</span>
                <strong>{fmtMoney(reportFigures.directOutflow)}</strong>
                <small>From the investigation account</small>
              </article>
              <article>
                <span>Transfers in trace</span>
                <strong>{fmtNumber(txs.length)}</strong>
                <small>{truncated ? 'Trace is incomplete' : 'Returned records'}</small>
              </article>
              <article>
                <span>Accounts observed downstream</span>
                <strong>{fmtNumber(reportFigures.downstreamAccounts)}</strong>
                <small>Distinct receiving accounts</small>
              </article>
              <article>
                <span>Potential trace leaves</span>
                <strong>{fmtNumber(reportFigures.potentialHoldingAccounts.length)}</strong>
                <small>Prioritize for live bank verification</small>
              </article>
              <article>
                <span>Gross traced value</span>
                <strong>{fmtMoney(reportFigures.tracedValue)}</strong>
                <small>May count the same funds at multiple hops</small>
              </article>
            </div>
            <div className="case-report-chart">
              <div className="case-report-section-heading compact">
                <span>02</span>
                <div>
                  <h3>Observed activity by trace hop</h3>
                  <p>Transfer count and recorded value; not proof of fund attribution</p>
                </div>
              </div>
              {reportFigures.transfersByHop.length ? (
                <div className="case-report-hop-chart">
                  {reportFigures.transfersByHop.map((step) => {
                    const maxAmount = Math.max(
                      ...reportFigures.transfersByHop.map((item) => item.amount),
                      1,
                    )
                    return (
                      <div className="case-report-hop-row" key={step.hop}>
                        <div className="case-report-hop-label">
                          <strong>Hop {step.hop}</strong>
                          <span>{fmtNumber(step.transactions)} transfer{step.transactions === 1 ? '' : 's'}</span>
                        </div>
                        <div className="case-report-hop-track" aria-label={`${fmtMoney(step.amount)} at hop ${step.hop}`}>
                          <span style={{ width: `${Math.max((step.amount / maxAmount) * 100, step.amount > 0 ? 1 : 0)}%` }} />
                        </div>
                        <strong className="case-report-hop-value">{fmtMoney(step.amount)}</strong>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <p className="case-report-empty">No hop-level transfer records are available.</p>
              )}
            </div>
            <div className="case-report-chart">
              <div className="case-report-section-heading compact">
                <span>03</span>
                <div>
                  <h3>Potential trace leaves for urgent review</h3>
                  <p>Accounts with no later outgoing record in the deepest observed hop</p>
                </div>
              </div>
              <p className="case-report-caveat">
                These are not verified current holding accounts. Trace inflow is
                historical transaction value, not available balance. Request a
                current bank status/balance check; any restraint requires separate
                legal authority and approval.
              </p>
              {reportFigures.potentialHoldingAccounts.length ? (
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Potential account</th>
                        <th>IFSC in record</th>
                        <th>Last observed receipt</th>
                        <th>Observed inflow</th>
                        <th>Supporting transaction IDs</th>
                        <th>Current balance</th>
                      </tr>
                    </thead>
                    <tbody>
                      {reportFigures.potentialHoldingAccounts.slice(0, 20).map((item) => (
                        <tr key={`${item.accountId}-${item.ifsc}`}>
                          <td className="mono">{item.accountId}</td>
                          <td className="mono">{item.ifsc || 'Not recorded'}</td>
                          <td>{item.lastObservedAt || 'Not recorded'}</td>
                          <td className="amount">{fmtMoney(item.amount)}</td>
                          <td className="mono">{item.transactionIds.join(', ')}</td>
                          <td>Not verified</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {reportFigures.potentialHoldingAccounts.length > 20 && (
                    <div className="table-foot">
                      Showing 20 of {fmtNumber(reportFigures.potentialHoldingAccounts.length)} potential trace leaves. The printable diary contains all returned candidates.
                    </div>
                  )}
                </div>
              ) : (
                <p className="case-report-empty">No potential trace-leaf accounts were identified in the current returned trace.</p>
              )}
            </div>
            <p className="case-report-caveat">
              No confirmed loss or current account balance is established by these records.
              Gross value can count transfers more than once as value moves between accounts.
            </p>
          </section>

          <section className="report-transaction-risk" aria-label="Transaction screening summary">
            <div className="case-report-section-heading">
              <span>04</span>
              <div>
                <h3>Transaction screening review</h3>
                <p>Highest-ranked visible records for analyst review</p>
              </div>
            </div>
            <div className="transaction-risk-summary">
              <span><strong>{fmtNumber(transactionRiskCounts.high)}</strong> high screening</span>
              <span><strong>{fmtNumber(transactionRiskCounts.medium)}</strong> medium screening</span>
              <span><strong>{fmtNumber(transactionRiskCounts.low)}</strong> low screening</span>
            </div>
            {topScoredTransactions.length ? (
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Transaction risk summary</th>
                      <th>Sender → receiver</th>
                      <th>Amount</th>
                      <th>Transaction screening index</th>
                      <th>Screening cues</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topScoredTransactions.map((item) => (
                      <tr
                        key={`${item.transaction_id}-${item.timestamp}`}
                        className="clickable-row"
                        onClick={() => setSelectedTx(item.transaction)}
                      >
                        <td className="mono">{item.transaction_id}</td>
                        <td className="mono">{item.sender_account} → {item.receiver_account}</td>
                        <td className="amount">{fmtMoney(item.amount)}</td>
                        <td>
                          <span className={`transaction-risk risk-${item.level}`}>
                            {item.level} · {item.screening_score}% <small>heuristic</small>
                          </span>
                        </td>
                        <td className="risk-cues-cell">{item.screening_reasons.join(' ')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {scoredTransactions.length > topScoredTransactions.length && (
                  <div className="table-foot">
                    Showing the 20 highest-scoring transactions of {fmtNumber(scoredTransactions.length)} visible records. Export case JSON for the full screening list.
                  </div>
                )}
              </div>
            ) : (
              <div className="empty-table">No transaction screening records are available for this trace.</div>
            )}
          </section>

          <button
            type="button"
            className="secondary-button report-button"
            onClick={exportReport}
          >
            <FileText size={16} /> Export case JSON
          </button>

          <button
            type="button"
            className="secondary-button report-button"
            onClick={exportCaseDiary}
          >
            <FileText size={16} /> Generate Case Diary & Bank Notice Drafts
          </button>

          <button
            type="button"
            className="secondary-button report-button"
            onClick={exportPrintableCaseDiary}
          >
            <FileText size={16} /> Download Professional Case Diary (HTML)
          </button>

          <section className="public-report-panel" aria-labelledby="public-report-heading">
            <div className="panel-title" id="public-report-heading">
              <FileText size={17} /> Public report draft
            </div>
            <p className="timeline-note">
              Prepare a local draft, then review it and submit it yourself. Nothing is filed or emailed automatically.
            </p>
            <div className="public-report-form">
              <label>
                Your name (optional)
                <input value={publicReport.name} onChange={updatePublicReport('name')} autoComplete="name" />
              </label>
              <label>
                Contact email (optional)
                <input type="email" value={publicReport.contactEmail} onChange={updatePublicReport('contactEmail')} autoComplete="email" />
              </label>
              <label>
                Contact phone (optional)
                <input type="tel" value={publicReport.contactPhone} onChange={updatePublicReport('contactPhone')} autoComplete="tel" />
              </label>
              <label>
                Email recipient (optional; only if known)
                <input type="email" value={publicReport.recipientEmail} onChange={updatePublicReport('recipientEmail')} placeholder="Leave blank to choose in your mail app" />
              </label>
              <label>
                Incident date (optional)
                <input type="date" value={publicReport.incidentDate} onChange={updatePublicReport('incidentDate')} />
              </label>
              <label>
                Reported amount in INR (optional)
                <input inputMode="decimal" value={publicReport.amount} onChange={updatePublicReport('amount')} />
              </label>
              <label className="public-report-description">
                What happened? <span>Do not include passwords, PINs, or full card details.</span>
                <textarea
                  value={publicReport.description}
                  onChange={updatePublicReport('description')}
                  rows={5}
                  maxLength={5000}
                  required
                />
              </label>
            </div>
            {publicReportError && <div className="timeline-error" role="alert">{publicReportError}</div>}
            {publicReportStatus && <p className="report-disclaimer" role="status">{publicReportStatus}</p>}
            <div className="public-report-actions">
              <button type="button" className="secondary-button" onClick={downloadPublicReportDraft}>
                <Download size={15} /> Download draft
              </button>
              <button type="button" className="secondary-button" onClick={openEmailDraft}>
                <Mail size={15} /> Open email draft
              </button>
              <button type="button" className="secondary-button" onClick={copyPublicReportText}>
                <FileText size={15} /> Copy report text
              </button>
              <a
                className="secondary-button"
                href="https://cybercrime.gov.in/"
                target="_blank"
                rel="noopener noreferrer"
              >
                <ExternalLink size={15} /> India cybercrime portal
              </a>
            </div>
            <p className="report-disclaimer">
              The portal link opens the official National Cyber Crime Reporting Portal. Verify details and follow the portal's instructions to submit. The draft is not an FIR and this app does not file or send it.
            </p>
          </section>
        </section>

        <footer>
          <span>ABHIMANYU · LOCAL INVESTIGATION WORKSPACE</span>
          <span>Automated indicators are leads; verify against original evidence.</span>
        </footer>
        </section>

        <section ref={(element) => { slideRefs.current.anomalies = element }} className={`flow-slide ${activeSection === 'anomalies' ? 'is-active' : ''}`} data-slide="anomalies">
        <section className="panel reports-panel" id="anomalies-section" data-slide="anomalies">
          <div className="panel-title">
            <div>
              <h2><AlertTriangle size={18} /> Anomaly Detection</h2>
              <p>Accounts ranked by the unsupervised anomaly detector.</p>
            </div>
            <button
              type="button"
              className="secondary-button"
              onClick={() => loadAnomalies()}
              disabled={anomalyLoading}
            >
              <RefreshCw size={15} /> {anomalyLoading ? 'Loading...' : 'Refresh'}
            </button>
          </div>

          <div className="stats-grid">
            <StatCard icon={Database} label="Accounts matched" value={fmtNumber(anomalyTotal)} />
            <StatCard icon={AlertTriangle} label="Flagged accounts" value={fmtNumber(anomalyFlaggedTotal)} note="Across the full dataset" />
          </div>

          <form
            className="search-bar"
            onSubmit={(event) => {
              event.preventDefault()
              setAnomalyOffset(0)
              setAnomalyQuery(anomalyInput.trim())
            }}
          >
            <input
              type="text"
              value={anomalyInput}
              onChange={(event) => setAnomalyInput(event.target.value)}
              placeholder="Search by account ID..."
              aria-label="Search anomaly account ID"
            />
            <button type="submit" className="primary-button">
              <Search size={16} /> Search
            </button>
          </form>

          {anomalyError && <div className="error-message">{anomalyError}</div>}

          <p className="stat-note">
            Anomaly scores are investigative leads, not proof of fraud or mule activity.
          </p>

          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Account ID</th>
                  <th>Anomaly score</th>
                  <th>Status</th>
                  <th>Model</th>
                  <th>Interpretation</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {anomalyRows.map((item) => (
                  <tr key={item.account_id}>
                    <td>{item.account_id}</td>
                    <td>{Number(item.anomaly_score).toFixed(4)}</td>
                    <td>
                      <span className="risk-badge">
                        {item.anomaly_flag ? 'Flagged' : 'Not flagged'}
                      </span>
                    </td>
                    <td>{item.model_type}</td>
                    <td>{item.interpretation}</td>
                    <td>
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={() => loadInvestigation(item.account_id)}
                      >
                        Investigate <ChevronRight size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
                {!anomalyLoading && anomalyRows.length === 0 && (
                  <tr>
                    <td colSpan={6} className="empty-table">
                      {anomalyError ? 'Unable to load results.' : 'No matching accounts found.'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="table-foot">
            <span>
              Showing {anomalyTotal === 0 ? 0 : anomalyOffset + 1}
              {'–'}{Math.min(anomalyOffset + anomalyRows.length, anomalyTotal)}
              {' '}of {fmtNumber(anomalyTotal)}
            </span>
            <div>
              <button
                type="button"
                className="secondary-button"
                disabled={anomalyOffset === 0 || anomalyLoading}
                onClick={() => setAnomalyOffset(Math.max(0, anomalyOffset - 20))}
              >
                Previous
              </button>
              <button
                type="button"
                className="secondary-button"
                disabled={anomalyOffset + 20 >= anomalyTotal || anomalyLoading}
                onClick={() => setAnomalyOffset(anomalyOffset + 20)}
              >
                Next
              </button>
            </div>
          </div>
        </section>
        </section>

        {selectedTx && (
          <div className="modal-backdrop" onClick={() => setSelectedTx(null)}>
            <div className="tx-modal" onClick={(event) => event.stopPropagation()}>
              <button
                className="modal-close"
                onClick={() => setSelectedTx(null)}
                aria-label="Close transaction details"
              >
                ×
              </button>
              <div className="panel-title">
                <CircleDollarSign size={18} /> Transaction details
              </div>
              <div className="transaction-detail-grid">
                {getTransactionDetails(selectedTx).map(({ label, value, prominent }) => (
                  <div className={`transaction-detail${prominent ? ' transaction-detail-prominent' : ''}`} key={label}>
                    <span>{label}</span>
                    <strong>{value}</strong>
                  </div>
                ))}
              </div>
              <div className="transaction-modal-risk">
                <strong>Transaction screening index: {transactionRisk(selectedTx).score}%</strong>
                <span>Uncalibrated heuristic, not a probability or finding of wrongdoing.</span>
                <ul>
                  {transactionRisk(selectedTx).reasons.map((reason) => <li key={reason}>{reason}</li>)}
                </ul>
              </div>
            </div>
          </div>
        )}

        </div>
        </div>
      </main>
    </div>
  )
}

export default App
