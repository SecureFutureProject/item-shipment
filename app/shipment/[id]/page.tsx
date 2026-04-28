'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'

interface ManifestItem {
  id: string
  item_number: string
  description: string | null
  expected_quantity: number
}

interface ScanLog {
  id: string
  item_number: string
  quantity: number
  scanned_by: string
  scanned_at: string
}

interface RunningTotal {
  item_number: string
  description: string | null
  expected: number | null
  scanned: number
  isOnManifest: boolean
}

type ScanState =
  | { phase: 'idle' }
  | { phase: 'hasPart'; partNumber: string }
  | { phase: 'hasQty'; quantity: number }
  | { phase: 'highQtyWarning'; partNumber: string; quantity: number }

type StatusDisplay =
  | { kind: 'waiting' }
  | { kind: 'hasPart'; partNumber: string; onManifest: boolean; description: string | null }
  | { kind: 'hasQty'; quantity: number }
  | { kind: 'error' }
  | { kind: 'highQty'; quantity: number }

interface ConfirmCard {
  itemNumber: string
  description: string | null
  quantityScanned: number
  runningTotal: number
  expected: number | null
  logId: string
}

function classifyScan(raw: string, manifestItems: ManifestItem[]): 'partNumber' | 'quantity' {
  const trimmed = raw.trim()
  if (manifestItems.some(m => m.item_number === trimmed)) return 'partNumber'
  const n = Number(trimmed)
  if (Number.isInteger(n) && n > 0 && trimmed.length >= 5) return 'partNumber'
  if (Number.isInteger(n) && n > 0) return 'quantity'
  return 'partNumber'
}

function getStatus(total: RunningTotal): 'unknown' | 'over' | 'complete' | 'inProgress' | 'notStarted' {
  if (!total.isOnManifest) return 'unknown'
  if (total.expected === null) return 'unknown'
  if (total.scanned > total.expected) return 'over'
  if (total.scanned === total.expected && total.scanned > 0) return 'complete'
  if (total.scanned > 0) return 'inProgress'
  return 'notStarted'
}

function sortTotals(totals: RunningTotal[]): RunningTotal[] {
  const order = { unknown: 0, over: 1, inProgress: 2, complete: 3, notStarted: 4 }
  return [...totals].sort((a, b) => order[getStatus(a)] - order[getStatus(b)])
}

function buildRunningTotals(manifestItems: ManifestItem[], scanLogs: ScanLog[]): RunningTotal[] {
  const totalsMap = new Map<string, RunningTotal>()
  for (const item of manifestItems) {
    totalsMap.set(item.item_number, { item_number: item.item_number, description: item.description, expected: item.expected_quantity, scanned: 0, isOnManifest: true })
  }
  for (const log of scanLogs) {
    const existing = totalsMap.get(log.item_number)
    if (existing) { existing.scanned += log.quantity }
    else { totalsMap.set(log.item_number, { item_number: log.item_number, description: null, expected: null, scanned: log.quantity, isOnManifest: false }) }
  }
  return sortTotals(Array.from(totalsMap.values()))
}

function StatusBadge({ status }: { status: ReturnType<typeof getStatus> }) {
  const map = {
    unknown:    { label: 'UNKNOWN',     color: '#B81A1A', bg: '#FEF2F2', border: '#FECACA' },
    over:       { label: 'OVER',        color: '#B81A1A', bg: '#FEF2F2', border: '#FECACA' },
    complete:   { label: 'COMPLETE',    color: '#166534', bg: '#F0FDF4', border: '#BBF7D0' },
    inProgress: { label: 'IN PROGRESS', color: '#92661A', bg: '#FEF3C7', border: '#FDE68A' },
    notStarted: { label: 'NOT STARTED', color: '#A0A0A0', bg: '#F5F5F3', border: '#E2E2DC' },
  }
  const s = map[status]
  return (
    <span style={{ fontSize: 10, letterSpacing: '0.08em', padding: '2px 8px', borderRadius: 20, background: s.bg, color: s.color, border: `1px solid ${s.border}`, whiteSpace: 'nowrap', fontFamily: "var(--font-dm-mono), 'DM Mono', monospace" }}>
      {s.label}
    </span>
  )
}

export default function ShipmentScanPage() {
  const params = useParams()
  const router = useRouter()
  const shipmentId = params.id as string
  const supabase = createClient()
  const mono = "var(--font-dm-mono), 'DM Mono', monospace"
  const syne = "var(--font-syne), 'Syne', sans-serif"

  const [manifestItems, setManifestItems] = useState<ManifestItem[]>([])
  const [scanLogs, setScanLogs] = useState<ScanLog[]>([])
  const [shipmentDate, setShipmentDate] = useState('')
  const [shipmentStatus, setShipmentStatus] = useState('active')
  const [shipmentNotes, setShipmentNotes] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [userRole, setUserRole] = useState('maryland')
  const [scanState, setScanState] = useState<ScanState>({ phase: 'idle' })
  const [statusDisplay, setStatusDisplay] = useState<StatusDisplay>({ kind: 'waiting' })
  const [confirmCard, setConfirmCard] = useState<ConfirmCard | null>(null)
  const [lastEntry, setLastEntry] = useState<{ itemNumber: string; quantity: number; logId: string } | null>(null)
  const [showSubmitModal, setShowSubmitModal] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const inputRef = useRef<HTMLInputElement>(null)
  const confirmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const scanStateRef = useRef<ScanState>({ phase: 'idle' })
  const manifestItemsRef = useRef<ManifestItem[]>([])

  useEffect(() => { scanStateRef.current = scanState }, [scanState])
  useEffect(() => { manifestItemsRef.current = manifestItems }, [manifestItems])
  useEffect(() => {
    if (showSubmitModal) { document.body.style.overflow = 'hidden' }
    else { document.body.style.overflow = '' }
    return () => { document.body.style.overflow = '' }
  }, [showSubmitModal])

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/'); return }
      const { data: roleData } = await supabase.from('user_roles').select('role').eq('email', user.email).single()
      if (roleData) setUserRole(roleData.role)
      const { data: shipment } = await supabase.from('shipments').select('created_at, status, notes').eq('id', shipmentId).single()
      if (shipment) {
        setShipmentDate(new Date(shipment.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }))
        setShipmentStatus(shipment.status)
        setShipmentNotes(shipment.notes ?? null)
      }
      const { data: items } = await supabase.from('manifest_items').select('*').eq('shipment_id', shipmentId)
      if (items) setManifestItems(items)
      const { data: logs } = await supabase.from('scan_logs').select('*').eq('shipment_id', shipmentId).order('scanned_at', { ascending: true })
      if (logs) {
        setScanLogs(logs)
        const myLogs = logs.filter(l => l.scanned_by === (roleData?.role ?? 'maryland'))
        if (myLogs.length > 0) {
          const last = myLogs[myLogs.length - 1]
          setLastEntry({ itemNumber: last.item_number, quantity: last.quantity, logId: last.id })
        }
      }
      setLoading(false)
    }
    load()
  }, [shipmentId])

  const focusInput = useCallback(() => { inputRef.current?.focus() }, [])
  useEffect(() => { if (!loading) focusInput() }, [loading])
  useEffect(() => {
    const handleClick = () => focusInput()
    document.addEventListener('click', handleClick)
    return () => document.removeEventListener('click', handleClick)
  }, [focusInput])

  const triggerError = useCallback(() => {
    setScanState({ phase: 'idle' })
    setStatusDisplay({ kind: 'error' })
    setTimeout(() => setStatusDisplay({ kind: 'waiting' }), 3000)
  }, [])

  const logPair = useCallback(async (partNumber: string, quantity: number) => {
    const manifestItem = manifestItemsRef.current.find(m => m.item_number === partNumber)
    const { data: inserted, error } = await supabase.from('scan_logs').insert({ shipment_id: shipmentId, item_number: partNumber, quantity, scanned_by: userRole }).select().single()
    if (error || !inserted) { triggerError(); return }
    setScanLogs(prev => {
      const next = [...prev, inserted]
      const total = next.filter(l => l.item_number === partNumber && l.scanned_by === userRole).reduce((sum, l) => sum + l.quantity, 0)
      setConfirmCard({ itemNumber: partNumber, description: manifestItem?.description ?? null, quantityScanned: quantity, runningTotal: total, expected: manifestItem?.expected_quantity ?? null, logId: inserted.id })
      setLastEntry({ itemNumber: partNumber, quantity, logId: inserted.id })
      return next
    })
    setScanState({ phase: 'idle' })
    setStatusDisplay({ kind: 'waiting' })
    if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current)
    confirmTimerRef.current = setTimeout(() => { setConfirmCard(null); focusInput() }, 5000)
  }, [shipmentId, userRole, supabase, triggerError, focusInput])

  const handleHighQuantity = useCallback((partNumber: string, qty: number) => {
    setScanState({ phase: 'highQtyWarning', partNumber, quantity: qty })
    setStatusDisplay({ kind: 'highQty', quantity: qty })
  }, [])

  const handleScan = useCallback(async (raw: string) => {
    const trimmed = raw.trim()
    if (!trimmed) return
    const current = scanStateRef.current
    if (current.phase === 'highQtyWarning') return
    const type = classifyScan(trimmed, manifestItemsRef.current)
    if (current.phase === 'idle') {
      if (type === 'partNumber') {
        const onManifest = manifestItemsRef.current.some(m => m.item_number === trimmed)
        const description = manifestItemsRef.current.find(m => m.item_number === trimmed)?.description ?? null
        setScanState({ phase: 'hasPart', partNumber: trimmed })
        setStatusDisplay({ kind: 'hasPart', partNumber: trimmed, onManifest, description })
      } else {
        setScanState({ phase: 'hasQty', quantity: Number(trimmed) })
        setStatusDisplay({ kind: 'hasQty', quantity: Number(trimmed) })
      }
      return
    }
    if (current.phase === 'hasPart') {
      if (type === 'partNumber') { triggerError(); return }
      const qty = Number(trimmed)
      if (qty >= 500) { handleHighQuantity(current.partNumber, qty); return }
      await logPair(current.partNumber, qty)
      return
    }
    if (current.phase === 'hasQty') {
      if (type === 'quantity') { triggerError(); return }
      const qty = current.quantity
      if (qty >= 500) { handleHighQuantity(trimmed, qty); return }
      await logPair(trimmed, qty)
      return
    }
  }, [logPair, triggerError, handleHighQuantity])

  const onInputKeyDown = useCallback(async (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      const val = inputRef.current?.value ?? ''
      if (inputRef.current) inputRef.current.value = ''
      await handleScan(val)
    }
  }, [handleScan])

  const confirmHighQty = useCallback(async () => {
    const current = scanStateRef.current
    if (current.phase !== 'highQtyWarning') return
    await logPair(current.partNumber, current.quantity)
  }, [logPair])

  const cancelHighQty = useCallback(() => {
    setScanState({ phase: 'idle' })
    setStatusDisplay({ kind: 'waiting' })
    focusInput()
  }, [focusInput])

  const undoLast = useCallback(async () => {
    if (!lastEntry) return
    const { error } = await supabase.from('scan_logs').delete().eq('id', lastEntry.logId)
    if (error) return
    setScanLogs(prev => {
      const next = prev.filter(l => l.id !== lastEntry.logId)
      const myLogs = next.filter(l => l.scanned_by === userRole)
      if (myLogs.length > 0) {
        const newLast = myLogs[myLogs.length - 1]
        setLastEntry({ itemNumber: newLast.item_number, quantity: newLast.quantity, logId: newLast.id })
      } else { setLastEntry(null) }
      return next
    })
    setConfirmCard(null)
    if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current)
    focusInput()
  }, [lastEntry, userRole, supabase, focusInput])

  const handleSubmit = useCallback(async () => {
    setIsSubmitting(true)
    const isSC = userRole === 'southcarolina'
    const newStatus = isSC ? 'received' : 'submitted'
    const updatePayload = isSC ? { status: newStatus } : { status: newStatus, submitted_at: new Date().toISOString() }
    const { error } = await supabase.from('shipments').update(updatePayload).eq('id', shipmentId)
    if (error) { setIsSubmitting(false); return }
    router.push(isSC ? '/dashboard/southcarolina' : '/dashboard/maryland')
  }, [shipmentId, userRole, supabase, router])

  const isSC = userRole === 'southcarolina'
  const myLogs = scanLogs.filter(l => l.scanned_by === userRole)
  const runningTotals = buildRunningTotals(manifestItems, myLogs)
  const unknownItems = runningTotals.filter(t => !t.isOnManifest)
  const knownItems = runningTotals.filter(t => t.isOnManifest)
  const grouped = {
    over: knownItems.filter(t => getStatus(t) === 'over'),
    inProgress: knownItems.filter(t => getStatus(t) === 'inProgress'),
    complete: knownItems.filter(t => getStatus(t) === 'complete'),
    notStarted: knownItems.filter(t => getStatus(t) === 'notStarted'),
  }
  const unscannedItems = knownItems.filter(t => t.scanned === 0)
  const isReadOnly = isSC ? shipmentStatus !== 'submitted' : shipmentStatus !== 'active'
  const completedItems = grouped.complete.length
  const totalItems = manifestItems.length
  const dashboardPath = isSC ? '/dashboard/southcarolina' : '/dashboard/maryland'

  function renderStatusDisplay() {
    switch (statusDisplay.kind) {
      case 'waiting':
        return (
          <div>
            <div style={{ fontSize: 13, color: '#A0A0A0', fontFamily: mono, letterSpacing: '0.05em', marginBottom: 4 }}>WAITING FOR SCAN</div>
            <div style={{ fontSize: 13, color: '#C0C0BA', fontFamily: mono }}>Scan part number or quantity barcode</div>
          </div>
        )
      case 'hasPart':
        return (
          <div>
            <div style={{ fontSize: 11, color: '#A0A0A0', fontFamily: mono, letterSpacing: '0.08em', marginBottom: 6 }}>PART NUMBER SCANNED</div>
            <div style={{ fontSize: 28, fontFamily: syne, fontWeight: 700, color: '#1A1A1A', marginBottom: 4 }}>{statusDisplay.partNumber}</div>
            {statusDisplay.description && <div style={{ fontSize: 13, color: '#888', fontFamily: mono, marginBottom: 4 }}>{statusDisplay.description}</div>}
            {!statusDisplay.onManifest && <div style={{ fontSize: 12, color: '#B81A1A', fontFamily: mono }}>⚠ Not on manifest</div>}
            <div style={{ fontSize: 12, color: '#0057B8', fontFamily: mono, marginTop: 6 }}>→ Now scan quantity barcode</div>
          </div>
        )
      case 'hasQty':
        return (
          <div>
            <div style={{ fontSize: 11, color: '#A0A0A0', fontFamily: mono, letterSpacing: '0.08em', marginBottom: 6 }}>QUANTITY SCANNED</div>
            <div style={{ fontSize: 28, fontFamily: syne, fontWeight: 700, color: '#1A1A1A', marginBottom: 6 }}>{statusDisplay.quantity}</div>
            <div style={{ fontSize: 12, color: '#0057B8', fontFamily: mono }}>→ Now scan part number barcode</div>
          </div>
        )
      case 'error':
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 24 }}>⚠</span>
            <div>
              <div style={{ fontSize: 15, fontFamily: syne, fontWeight: 700, color: '#B81A1A', marginBottom: 2 }}>Scan Error</div>
              <div style={{ fontSize: 13, color: '#888', fontFamily: mono }}>Please scan again from the beginning</div>
            </div>
          </div>
        )
      case 'highQty':
        return (
          <div>
            <div style={{ fontSize: 13, color: '#92661A', fontFamily: mono, marginBottom: 10 }}>⚠ Quantity {statusDisplay.quantity} — is this correct or a wrong scan?</div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={confirmHighQty} style={{ padding: '8px 20px', background: '#F0FDF4', border: '1px solid #BBF7D0', color: '#166534', borderRadius: 6, cursor: 'pointer', fontFamily: mono, fontSize: 12 }}>Yes, log it</button>
              <button onClick={cancelHighQty} style={{ padding: '8px 20px', background: '#F5F5F3', border: '1px solid #E2E2DC', color: '#555', borderRadius: 6, cursor: 'pointer', fontFamily: mono, fontSize: 12 }}>Clear, scan again</button>
            </div>
          </div>
        )
    }
  }

  function renderConfirmCard() {
    if (!confirmCard) return null
    const { itemNumber, description, quantityScanned, runningTotal, expected } = confirmCard
    const isComplete = expected !== null && runningTotal === expected
    const isOver = expected !== null && runningTotal > expected
    const overBy = isOver ? runningTotal - (expected ?? 0) : 0
    const borderColor = isOver ? '#FECACA' : isComplete ? '#BBF7D0' : '#FDE68A'
    const bgColor = isOver ? '#FEF2F2' : isComplete ? '#F0FDF4' : '#FEF3C7'
    return (
      <div style={{ background: bgColor, border: `1px solid ${borderColor}`, borderRadius: 10, padding: '16px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 20, marginBottom: 12 }}>
        <div>
          <div style={{ fontFamily: syne, fontWeight: 700, fontSize: 16, color: '#1A1A1A', marginBottom: 4 }}>
            {itemNumber}
            {description && <span style={{ fontFamily: mono, fontWeight: 400, fontSize: 12, color: '#888', marginLeft: 10 }}>{description}</span>}
          </div>
          <div style={{ fontFamily: mono, fontSize: 12, color: '#555', marginBottom: 4 }}>
            Scanned: <strong>{quantityScanned}</strong> · Total: <strong>{runningTotal}</strong>{expected !== null && <span style={{ color: '#A0A0A0' }}> of {expected}</span>}
          </div>
          <div style={{ fontFamily: mono, fontSize: 11 }}>
            {isOver && <span style={{ color: '#B81A1A' }}>⚠ Over by {overBy}</span>}
            {isComplete && <span style={{ color: '#166534' }}>✓ Complete</span>}
            {!isOver && !isComplete && expected !== null && <span style={{ color: '#92661A' }}>{expected - runningTotal} remaining</span>}
            {expected === null && <span style={{ color: '#B81A1A' }}>Not on manifest</span>}
          </div>
        </div>
        <button onClick={undoLast} style={{ padding: '8px 16px', background: '#fff', border: '1px solid #E2E2DC', color: '#555', borderRadius: 6, cursor: 'pointer', fontFamily: mono, fontSize: 11, whiteSpace: 'nowrap', flexShrink: 0 }}>Undo</button>
      </div>
    )
  }

  function TotalsRow({ total }: { total: RunningTotal }) {
    const status = getStatus(total)
    const isHighlighted = statusDisplay.kind === 'hasPart' && statusDisplay.partNumber === total.item_number
    const rowBg = isHighlighted ? '#EFF6FF' : status === 'complete' ? '#F0FDF4' : status === 'over' ? '#FEF2F2' : status === 'inProgress' ? '#FEF9EC' : 'transparent'
    return (
      <tr style={{ background: rowBg, borderBottom: '1px solid #F0F0EC' }}>
        <td style={{ padding: '10px 14px', fontFamily: mono, fontSize: 12, color: '#1A1A1A' }}>{total.item_number}</td>
        <td style={{ padding: '10px 14px', fontSize: 12, color: '#888', maxWidth: 200 }}>{total.description ?? <span style={{ color: '#C0C0BA', fontStyle: 'italic' }}>unknown</span>}</td>
        <td style={{ padding: '10px 14px', fontFamily: mono, fontSize: 12, color: '#A0A0A0', textAlign: 'right' }}>{total.expected ?? '—'}</td>
        <td style={{ padding: '10px 14px', fontFamily: mono, fontSize: 13, color: '#1A1A1A', textAlign: 'right', fontWeight: 600 }}>{total.scanned}</td>
        <td style={{ padding: '10px 14px', textAlign: 'right' }}><StatusBadge status={status} /></td>
      </tr>
    )
  }

  function SectionHeader({ label, color, count }: { label: string; color: string; count: number }) {
    if (count === 0) return null
    return (
      <tr>
        <td colSpan={5} style={{ padding: '8px 14px 4px', fontSize: 10, fontFamily: mono, letterSpacing: '0.1em', color, background: '#FAFAFA', borderBottom: '1px solid #F0F0EC' }}>
          {label} ({count})
        </td>
      </tr>
    )
  }

  function renderSubmitModal() {
    if (!showSubmitModal) return null
    const modalTitle = isSC ? 'Confirm Receipt' : 'Submit Shipment'
    const confirmLabel = isSC ? 'Confirm Receipt' : 'Confirm & Submit'

    return (
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}
        onClick={e => { if (e.target === e.currentTarget) { setShowSubmitModal(false); focusInput() } }}>
        <div style={{ background: '#fff', border: '1px solid #E2E2DC', borderRadius: 12, padding: '32px', width: 500, maxWidth: '90vw', maxHeight: '80vh', overflowY: 'auto' }}>
          <div style={{ fontFamily: syne, fontWeight: 700, fontSize: 20, color: '#1A1A1A', marginBottom: 20 }}>{modalTitle}</div>

          {unscannedItems.length > 0 && (
            <div style={{ background: '#FEF3C7', border: '1px solid #FDE68A', borderRadius: 8, padding: '14px 16px', marginBottom: 12 }}>
              <div style={{ fontFamily: mono, fontSize: 11, letterSpacing: '0.08em', color: '#92661A', marginBottom: 8 }}>⚠ {unscannedItems.length} ITEMS NOT SCANNED</div>
              {unscannedItems.map(item => <div key={item.item_number} style={{ fontFamily: mono, fontSize: 11, color: '#666', padding: '2px 0' }}>{item.item_number}{item.description && <span style={{ color: '#A0A0A0', marginLeft: 8 }}>{item.description}</span>}</div>)}
            </div>
          )}
          {grouped.over.length > 0 && (
            <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, padding: '14px 16px', marginBottom: 12 }}>
              <div style={{ fontFamily: mono, fontSize: 11, letterSpacing: '0.08em', color: '#B81A1A', marginBottom: 8 }}>✕ {grouped.over.length} ITEMS OVER-SCANNED</div>
              {grouped.over.map(item => <div key={item.item_number} style={{ fontFamily: mono, fontSize: 11, color: '#666', padding: '2px 0' }}>{item.item_number}<span style={{ color: '#B81A1A', marginLeft: 8 }}>scanned {item.scanned}, expected {item.expected}</span></div>)}
            </div>
          )}
          {grouped.inProgress.length > 0 && (
            <div style={{ background: '#FEF3C7', border: '1px solid #FDE68A', borderRadius: 8, padding: '14px 16px', marginBottom: 12 }}>
              <div style={{ fontFamily: mono, fontSize: 11, letterSpacing: '0.08em', color: '#92661A', marginBottom: 8 }}>⚠ {grouped.inProgress.length} ITEMS PARTIALLY SCANNED</div>
              {grouped.inProgress.map(item => <div key={item.item_number} style={{ fontFamily: mono, fontSize: 11, color: '#666', padding: '2px 0' }}>{item.item_number}<span style={{ color: '#92661A', marginLeft: 8 }}>{item.scanned} of {item.expected}</span></div>)}
            </div>
          )}
          {unknownItems.length > 0 && (
            <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, padding: '14px 16px', marginBottom: 12 }}>
              <div style={{ fontFamily: mono, fontSize: 11, letterSpacing: '0.08em', color: '#B81A1A', marginBottom: 8 }}>✕ {unknownItems.length} ITEMS NOT ON MANIFEST</div>
              {unknownItems.map(item => <div key={item.item_number} style={{ fontFamily: mono, fontSize: 11, color: '#666', padding: '2px 0' }}>{item.item_number}<span style={{ color: '#A0A0A0', marginLeft: 8 }}>qty: {item.scanned}</span></div>)}
            </div>
          )}
          {unscannedItems.length === 0 && unknownItems.length === 0 && grouped.over.length === 0 && grouped.inProgress.length === 0 && (
            <div style={{ background: '#F0FDF4', border: '1px solid #BBF7D0', borderRadius: 8, padding: '14px 16px', marginBottom: 12, fontFamily: mono, fontSize: 12, color: '#166534' }}>
              ✓ All manifest items scanned — no issues found
            </div>
          )}
          <div style={{ fontFamily: mono, fontSize: 11, color: '#A0A0A0', marginBottom: 20, lineHeight: 1.6 }}>
            Warnings are non-blocking. You may {isSC ? 'confirm receipt' : 'submit'} with open items. This action cannot be undone.
          </div>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button onClick={() => { setShowSubmitModal(false); focusInput() }} disabled={isSubmitting} style={{ padding: '10px 20px', background: '#F5F5F3', border: '1px solid #E2E2DC', color: '#555', borderRadius: 6, cursor: 'pointer', fontFamily: mono, fontSize: 12 }}>Cancel</button>
            <button onClick={handleSubmit} disabled={isSubmitting} style={{ padding: '10px 20px', background: isSubmitting ? '#A0C4F0' : '#0057B8', border: 'none', color: '#fff', borderRadius: 6, cursor: isSubmitting ? 'default' : 'pointer', fontFamily: syne, fontWeight: 700, fontSize: 13 }}>
              {isSubmitting ? 'Submitting...' : confirmLabel}
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', background: '#F5F5F3', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: mono, color: '#A0A0A0', fontSize: 13 }}>
        Loading shipment...
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100vh', background: '#F5F5F3', fontFamily: mono }}>
      <style>{`@keyframes slideIn { from { opacity:0; transform:translateY(-6px); } to { opacity:1; transform:translateY(0); } } * { box-sizing:border-box; }`}</style>

      {!isReadOnly && (
        <input ref={inputRef} onKeyDown={onInputKeyDown} style={{ position: 'fixed', top: 0, left: 0, width: 1, height: 1, opacity: 0, pointerEvents: 'none' }} autoFocus autoComplete="off" tabIndex={-1} />
      )}

      {renderSubmitModal()}

      {/* Nav */}
      <div style={{ background: '#1A1A1A', borderBottom: '1px solid #2A2A2A', padding: '0 24px', height: '56px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'sticky', top: 0, zIndex: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <button onClick={() => router.push(dashboardPath)} style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer', fontFamily: mono, fontSize: 12, padding: 0 }}>← Dashboard</button>
          <span style={{ width: 1, height: 16, background: '#333' }} />
          <span style={{ fontFamily: mono, fontSize: 11, color: '#555', letterSpacing: '0.08em' }}>SHIPMENT · {shipmentDate}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
          <span style={{ fontFamily: mono, fontSize: 11, color: '#555' }}>{completedItems}/{totalItems} complete</span>
          <span style={{ fontFamily: mono, fontSize: 11, color: '#555' }}>{myLogs.length} scans</span>
          {!isReadOnly && (
            <button onClick={() => setShowSubmitModal(true)} style={{ background: '#0057B8', border: 'none', color: '#fff', padding: '7px 18px', borderRadius: 6, cursor: 'pointer', fontFamily: syne, fontWeight: 700, fontSize: 13 }}>
              {isSC ? 'Confirm Receipt' : 'Submit Shipment'}
            </button>
          )}
        </div>
      </div>

      <div style={{ maxWidth: 960, margin: '0 auto', padding: '24px 24px 80px' }}>

        {/* MD note banner for SC */}
        {isSC && shipmentNotes && (
          <div style={{ background: '#FEF3C7', border: '1px solid #FDE68A', borderRadius: 10, padding: '14px 20px', marginBottom: 16 }}>
            <div style={{ fontFamily: mono, fontSize: 10, letterSpacing: '0.1em', color: '#92661A', marginBottom: 6 }}>⚠ NOTE FROM MARYLAND</div>
            <div style={{ fontFamily: mono, fontSize: 13, color: '#555', lineHeight: 1.6 }}>{shipmentNotes}</div>
          </div>
        )}

        {/* Read-only banner */}
        {isReadOnly && (
          <div style={{ background: '#fff', border: '1px solid #E2E2DC', borderRadius: 10, padding: '16px 20px', marginBottom: 24, fontFamily: mono, fontSize: 13, color: '#888', textAlign: 'center' }}>
            {shipmentStatus === 'submitted' && !isSC && 'Shipment submitted — awaiting South Carolina receipt'}
            {shipmentStatus === 'received' && '✓ Shipment received — closed'}
            {shipmentStatus === 'cancelled' && 'Shipment cancelled'}
            {shipmentStatus === 'active' && isSC && 'Shipment not yet submitted by Maryland'}
          </div>
        )}

        {/* Scan area */}
        {!isReadOnly && (
          <>
            <div style={{ background: '#fff', border: '1px solid #E2E2DC', borderRadius: 10, padding: '24px 28px', marginBottom: 12 }}>
              <div style={{ fontSize: 10, fontFamily: mono, letterSpacing: '0.12em', color: '#C0C0BA', marginBottom: 14, textTransform: 'uppercase' }}>Scan Area</div>
              <div style={{ minHeight: 72, display: 'flex', alignItems: 'center' }}>{renderStatusDisplay()}</div>
            </div>

            {confirmCard && <div style={{ animation: 'slideIn 0.2s ease' }}>{renderConfirmCard()}</div>}

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24, padding: '10px 16px', background: '#fff', border: '1px solid #E2E2DC', borderRadius: 8 }}>
              <div style={{ fontFamily: mono, fontSize: 12, color: '#888' }}>
                {lastEntry ? <>Last scan: <span style={{ color: '#1A1A1A', fontWeight: 600 }}>{lastEntry.itemNumber}</span> × <span style={{ color: '#1A1A1A', fontWeight: 600 }}>{lastEntry.quantity}</span></> : 'No scans yet'}
              </div>
              <button onClick={undoLast} disabled={!lastEntry} style={{ background: lastEntry ? '#F5F5F3' : 'transparent', border: `1px solid ${lastEntry ? '#E2E2DC' : '#F0F0EC'}`, color: lastEntry ? '#555' : '#C0C0BA', padding: '6px 14px', borderRadius: 6, cursor: lastEntry ? 'pointer' : 'default', fontFamily: mono, fontSize: 11 }}>
                Undo last entry
              </button>
            </div>
          </>
        )}

        {/* Running totals */}
        <div style={{ fontSize: 10, fontFamily: mono, letterSpacing: '0.12em', color: '#A0A0A0', marginBottom: 10, textTransform: 'uppercase' }}>
          Running Totals {isSC && '(your scans)'}
        </div>
        <div style={{ background: '#fff', border: '1px solid #E2E2DC', borderRadius: 10, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #E2E2DC', background: '#FAFAFA' }}>
                {['Item No.', 'Description', 'Expected', 'Scanned', 'Status'].map((h, i) => (
                  <th key={h} style={{ padding: '10px 14px', fontFamily: mono, fontSize: 10, letterSpacing: '0.08em', color: '#A0A0A0', fontWeight: 500, textAlign: i >= 2 && i <= 3 ? 'right' : 'left' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {unknownItems.length > 0 && (<><SectionHeader label="NOT ON MANIFEST" color="#B81A1A" count={unknownItems.length} />{unknownItems.map(t => <TotalsRow key={t.item_number} total={t} />)}</>)}
              {grouped.over.length > 0 && (<><SectionHeader label="OVER-SCANNED" color="#B81A1A" count={grouped.over.length} />{grouped.over.map(t => <TotalsRow key={t.item_number} total={t} />)}</>)}
              {grouped.inProgress.length > 0 && (<><SectionHeader label="IN PROGRESS" color="#92661A" count={grouped.inProgress.length} />{grouped.inProgress.map(t => <TotalsRow key={t.item_number} total={t} />)}</>)}
              {grouped.complete.length > 0 && (<><SectionHeader label="COMPLETE" color="#166534" count={grouped.complete.length} />{grouped.complete.map(t => <TotalsRow key={t.item_number} total={t} />)}</>)}
              {grouped.notStarted.length > 0 && (<><SectionHeader label="NOT STARTED" color="#A0A0A0" count={grouped.notStarted.length} />{grouped.notStarted.map(t => <TotalsRow key={t.item_number} total={t} />)}</>)}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
