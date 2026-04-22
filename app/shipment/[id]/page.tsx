'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'

// ─── Types ────────────────────────────────────────────────────────────────────

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
    expected: number | null   // null = unknown item
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

// ─── Helpers ──────────────────────────────────────────────────────────────────

function classifyScan(raw: string): 'partNumber' | 'quantity' {
    const trimmed = raw.trim()
    const n = Number(trimmed)
    if (Number.isInteger(n) && n > 0 && n < 500) return 'quantity'
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

    // seed with manifest
    for (const item of manifestItems) {
        totalsMap.set(item.item_number, {
            item_number: item.item_number,
            description: item.description,
            expected: item.expected_quantity,
            scanned: 0,
            isOnManifest: true,
        })
    }

    // accumulate scans
    for (const log of scanLogs) {
        const existing = totalsMap.get(log.item_number)
        if (existing) {
            existing.scanned += log.quantity
        } else {
            // unknown item
            const unknown = totalsMap.get(log.item_number)
            if (unknown) {
                unknown.scanned += log.quantity
            } else {
                totalsMap.set(log.item_number, {
                    item_number: log.item_number,
                    description: null,
                    expected: null,
                    scanned: log.quantity,
                    isOnManifest: false,
                })
            }
        }
    }

    return sortTotals(Array.from(totalsMap.values()))
}

// ─── Status badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: ReturnType<typeof getStatus> }) {
    const map = {
        unknown: { label: 'UNKNOWN', bg: '#3d1515', color: '#ff6b6b', border: '#ff6b6b40' },
        over: { label: 'OVER', bg: '#3d1515', color: '#ff6b6b', border: '#ff6b6b40' },
        complete: { label: 'COMPLETE', bg: '#0f2d1a', color: '#4ade80', border: '#4ade8040' },
        inProgress: { label: 'IN PROGRESS', bg: '#2d2200', color: '#fbbf24', border: '#fbbf2440' },
        notStarted: { label: 'NOT STARTED', bg: '#1a1a1a', color: '#666', border: '#33333380' },
    }
    const s = map[status]
    return (
        <span style={{
            fontSize: '10px',
            fontFamily: 'var(--font-mono)',
            letterSpacing: '0.08em',
            padding: '2px 8px',
            borderRadius: '3px',
            background: s.bg,
            color: s.color,
            border: `1px solid ${s.border}`,
            whiteSpace: 'nowrap',
        }}>
            {s.label}
        </span>
    )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function ShipmentScanPage() {
    const params = useParams()
    const router = useRouter()
    const shipmentId = params.id as string
    const supabase = createClient()

    // data
    const [manifestItems, setManifestItems] = useState<ManifestItem[]>([])
    const [scanLogs, setScanLogs] = useState<ScanLog[]>([])
    const [shipmentDate, setShipmentDate] = useState<string>('')
    const [loading, setLoading] = useState(true)
    const [userRole, setUserRole] = useState<string>('maryland')

    // scan state
    const [scanState, setScanState] = useState<ScanState>({ phase: 'idle' })
    const [statusDisplay, setStatusDisplay] = useState<StatusDisplay>({ kind: 'waiting' })
    const [confirmCard, setConfirmCard] = useState<ConfirmCard | null>(null)
    const [lastEntry, setLastEntry] = useState<{ itemNumber: string; quantity: number; logId: string } | null>(null)

    // refs
    const inputRef = useRef<HTMLInputElement>(null)
    const confirmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const scanStateRef = useRef<ScanState>({ phase: 'idle' })

    // keep ref in sync
    useEffect(() => { scanStateRef.current = scanState }, [scanState])

    // ── Load data ──────────────────────────────────────────────────────────────

    useEffect(() => {
        async function load() {
            const { data: { user } } = await supabase.auth.getUser()
            if (!user) { router.push('/'); return }

            const { data: roleData } = await supabase
                .from('user_roles')
                .select('role')
                .eq('email', user.email)
                .single()
            if (roleData) setUserRole(roleData.role)

            const { data: shipment } = await supabase
                .from('shipments')
                .select('created_at, status')
                .eq('id', shipmentId)
                .single()
            if (shipment) {
                setShipmentDate(new Date(shipment.created_at).toLocaleDateString('en-US', {
                    month: 'short', day: 'numeric', year: 'numeric'
                }))
            }

            const { data: items } = await supabase
                .from('manifest_items')
                .select('*')
                .eq('shipment_id', shipmentId)
            if (items) setManifestItems(items)

            const { data: logs } = await supabase
                .from('scan_logs')
                .select('*')
                .eq('shipment_id', shipmentId)
                .order('scanned_at', { ascending: true })
            if (logs) {
                setScanLogs(logs)
                if (logs.length > 0) {
                    const last = logs[logs.length - 1]
                    setLastEntry({ itemNumber: last.item_number, quantity: last.quantity, logId: last.id })
                }
            }

            setLoading(false)
        }
        load()
    }, [shipmentId])

    // ── Focus management ───────────────────────────────────────────────────────

    const focusInput = useCallback(() => {
        inputRef.current?.focus()
    }, [])

    useEffect(() => {
        if (!loading) focusInput()
    }, [loading])

    useEffect(() => {
        const handleClick = () => focusInput()
        document.addEventListener('click', handleClick)
        return () => document.removeEventListener('click', handleClick)
    }, [focusInput])

    // ── Scan processing ────────────────────────────────────────────────────────

    const triggerError = useCallback(() => {
        setScanState({ phase: 'idle' })
        setStatusDisplay({ kind: 'error' })
        setTimeout(() => setStatusDisplay({ kind: 'waiting' }), 3000)
    }, [])

    const logPair = useCallback(async (partNumber: string, quantity: number) => {
        const manifestItem = manifestItems.find(m => m.item_number === partNumber)

        const { data: inserted, error } = await supabase
            .from('scan_logs')
            .insert({
                shipment_id: shipmentId,
                item_number: partNumber,
                quantity,
                scanned_by: userRole,
            })
            .select()
            .single()

        if (error || !inserted) {
            triggerError()
            return
        }

        setScanLogs(prev => {
            const next = [...prev, inserted]
            // calc running total for this item
            const total = next
                .filter(l => l.item_number === partNumber)
                .reduce((sum, l) => sum + l.quantity, 0)

            setConfirmCard({
                itemNumber: partNumber,
                description: manifestItem?.description ?? null,
                quantityScanned: quantity,
                runningTotal: total,
                expected: manifestItem?.expected_quantity ?? null,
                logId: inserted.id,
            })

            setLastEntry({ itemNumber: partNumber, quantity, logId: inserted.id })
            return next
        })

        setScanState({ phase: 'idle' })
        setStatusDisplay({ kind: 'waiting' })

        // auto-clear confirm card after 5s
        if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current)
        confirmTimerRef.current = setTimeout(() => {
            setConfirmCard(null)
            focusInput()
        }, 5000)
    }, [manifestItems, shipmentId, userRole, supabase, triggerError, focusInput])

    const handleScan = useCallback(async (raw: string) => {
        const trimmed = raw.trim()
        if (!trimmed) return

        const current = scanStateRef.current

        // ── high qty confirm mode ──
        if (current.phase === 'highQtyWarning') {
            // user typed something — ignore, handled by buttons
            return
        }

        const type = classifyScan(trimmed)

        if (current.phase === 'idle') {
            if (type === 'partNumber') {
                const onManifest = manifestItems.some(m => m.item_number === trimmed)
                const description = manifestItems.find(m => m.item_number === trimmed)?.description ?? null
                setScanState({ phase: 'hasPart', partNumber: trimmed })
                setStatusDisplay({ kind: 'hasPart', partNumber: trimmed, onManifest, description })
            } else {
                // got a quantity first
                setScanState({ phase: 'hasQty', quantity: Number(trimmed) })
                setStatusDisplay({ kind: 'hasQty', quantity: Number(trimmed) })
            }
            return
        }

        if (current.phase === 'hasPart') {
            if (type === 'partNumber') {
                // two part numbers in a row → error
                triggerError()
                return
            }
            // got quantity
            const qty = Number(trimmed)
            if (qty >= 500) {
                setScanState({ phase: 'highQtyWarning', partNumber: current.partNumber, quantity: qty })
                setStatusDisplay({ kind: 'highQty', quantity: qty })
                return
            }
            await logPair(current.partNumber, qty)
            return
        }

        if (current.phase === 'hasQty') {
            if (type === 'quantity') {
                // two quantities in a row → error
                triggerError()
                return
            }
            // got part number — pair assembled (qty came first)
            const qty = current.quantity
            if (qty >= 500) {
                setScanState({ phase: 'highQtyWarning', partNumber: trimmed, quantity: qty })
                setStatusDisplay({ kind: 'highQty', quantity: qty })
                return
            }
            await logPair(trimmed, qty)
            return
        }
    }, [manifestItems, logPair, triggerError])

    const onInputKeyDown = useCallback(async (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') {
            const val = inputRef.current?.value ?? ''
            if (inputRef.current) inputRef.current.value = ''
            await handleScan(val)
        }
    }, [handleScan])

    // ── High qty confirm / cancel ──────────────────────────────────────────────

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

    // ── Undo ───────────────────────────────────────────────────────────────────

    const undoLast = useCallback(async () => {
        if (!lastEntry) return
        const { error } = await supabase
            .from('scan_logs')
            .delete()
            .eq('id', lastEntry.logId)

        if (error) return

        setScanLogs(prev => {
            const next = prev.filter(l => l.id !== lastEntry.logId)
            if (next.length > 0) {
                const newLast = next[next.length - 1]
                setLastEntry({ itemNumber: newLast.item_number, quantity: newLast.quantity, logId: newLast.id })
            } else {
                setLastEntry(null)
            }
            return next
        })

        setConfirmCard(null)
        if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current)
        focusInput()
    }, [lastEntry, supabase, focusInput])

    // ── Derived data ───────────────────────────────────────────────────────────

    const runningTotals = buildRunningTotals(manifestItems, scanLogs)
    const unknownItems = runningTotals.filter(t => !t.isOnManifest)
    const knownItems = runningTotals.filter(t => t.isOnManifest)

    const grouped = {
        over: knownItems.filter(t => getStatus(t) === 'over'),
        inProgress: knownItems.filter(t => getStatus(t) === 'inProgress'),
        complete: knownItems.filter(t => getStatus(t) === 'complete'),
        notStarted: knownItems.filter(t => getStatus(t) === 'notStarted'),
    }

    // ── Status display text ───────────────────────────────────────────────────

    function renderStatusDisplay() {
        switch (statusDisplay.kind) {
            case 'waiting':
                return (
                    <div style={{ color: '#555', fontFamily: 'var(--font-mono)', fontSize: '13px', letterSpacing: '0.05em' }}>
                        WAITING FOR SCAN — SCAN PART NUMBER OR QUANTITY BARCODE
                    </div>
                )
            case 'hasPart':
                return (
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: '13px' }}>
                        <span style={{ color: '#fbbf24' }}>PART: </span>
                        <span style={{ color: '#fff', letterSpacing: '0.08em' }}>{statusDisplay.partNumber}</span>
                        {statusDisplay.description && (
                            <span style={{ color: '#666', marginLeft: '12px' }}>{statusDisplay.description}</span>
                        )}
                        {!statusDisplay.onManifest && (
                            <span style={{ color: '#ff6b6b', marginLeft: '12px' }}>⚠ NOT ON MANIFEST</span>
                        )}
                        <div style={{ color: '#555', marginTop: '4px', fontSize: '11px' }}>
                            NOW SCAN QUANTITY BARCODE
                        </div>
                    </div>
                )
            case 'hasQty':
                return (
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: '13px' }}>
                        <span style={{ color: '#fbbf24' }}>QTY: </span>
                        <span style={{ color: '#fff', letterSpacing: '0.08em' }}>{statusDisplay.quantity}</span>
                        <div style={{ color: '#555', marginTop: '4px', fontSize: '11px' }}>
                            NOW SCAN PART NUMBER BARCODE
                        </div>
                    </div>
                )
            case 'error':
                return (
                    <div style={{ color: '#ff6b6b', fontFamily: 'var(--font-mono)', fontSize: '13px', letterSpacing: '0.05em' }}>
                        ✕ SCAN ERROR — PLEASE SCAN AGAIN
                    </div>
                )
            case 'highQty':
                return (
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: '13px' }}>
                        <div style={{ color: '#fbbf24', marginBottom: '10px' }}>
                            ⚠ QUANTITY {statusDisplay.quantity} SEEMS HIGH — IS THIS CORRECT?
                        </div>
                        <div style={{ display: 'flex', gap: '10px' }}>
                            <button onClick={confirmHighQty} style={{
                                background: '#1a3d1a', border: '1px solid #4ade8060', color: '#4ade80',
                                padding: '6px 16px', borderRadius: '4px', cursor: 'pointer',
                                fontFamily: 'var(--font-mono)', fontSize: '11px', letterSpacing: '0.05em'
                            }}>
                                YES, LOG IT
                            </button>
                            <button onClick={cancelHighQty} style={{
                                background: '#1a1a1a', border: '1px solid #33333380', color: '#888',
                                padding: '6px 16px', borderRadius: '4px', cursor: 'pointer',
                                fontFamily: 'var(--font-mono)', fontSize: '11px', letterSpacing: '0.05em'
                            }}>
                                CLEAR, SCAN AGAIN
                            </button>
                        </div>
                    </div>
                )
        }
    }

    // ── Confirm card ──────────────────────────────────────────────────────────

    function renderConfirmCard() {
        if (!confirmCard) return null
        const { itemNumber, description, quantityScanned, runningTotal, expected, logId } = confirmCard
        const isComplete = expected !== null && runningTotal === expected
        const isOver = expected !== null && runningTotal > expected
        const overBy = isOver ? runningTotal - (expected ?? 0) : 0

        return (
            <div style={{
                background: '#0f0f0f',
                border: `1px solid ${isOver ? '#ff6b6b40' : isComplete ? '#4ade8040' : '#fbbf2440'}`,
                borderRadius: '8px',
                padding: '16px 20px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '20px',
                animation: 'slideIn 0.2s ease',
            }}>
                <div>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: '15px', color: '#fff', marginBottom: '4px' }}>
                        {itemNumber}
                        {description && <span style={{ color: '#666', marginLeft: '12px', fontSize: '12px' }}>{description}</span>}
                    </div>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', color: '#888' }}>
                        SCANNED: <span style={{ color: '#fff' }}>{quantityScanned}</span>
                        <span style={{ margin: '0 10px', color: '#333' }}>|</span>
                        TOTAL: <span style={{ color: '#fff' }}>{runningTotal}</span>
                        {expected !== null && <span style={{ color: '#555' }}> of {expected}</span>}
                    </div>
                    <div style={{ marginTop: '6px', fontSize: '11px', fontFamily: 'var(--font-mono)' }}>
                        {isOver && <span style={{ color: '#ff6b6b' }}>⚠ OVER BY {overBy}</span>}
                        {isComplete && <span style={{ color: '#4ade80' }}>✓ COMPLETE</span>}
                        {!isOver && !isComplete && expected !== null && (
                            <span style={{ color: '#fbbf24' }}>IN PROGRESS — {expected - runningTotal} REMAINING</span>
                        )}
                        {expected === null && <span style={{ color: '#ff6b6b' }}>NOT ON MANIFEST</span>}
                    </div>
                </div>
                <button onClick={undoLast} style={{
                    background: '#1a1a1a',
                    border: '1px solid #33333380',
                    color: '#888',
                    padding: '8px 14px',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    fontFamily: 'var(--font-mono)',
                    fontSize: '10px',
                    letterSpacing: '0.05em',
                    whiteSpace: 'nowrap',
                    flexShrink: 0,
                }}>
                    UNDO
                </button>
            </div>
        )
    }

    // ── Table row ─────────────────────────────────────────────────────────────

    function TotalsRow({ total }: { total: RunningTotal }) {
        const status = getStatus(total)
        const isHighlighted = statusDisplay.kind === 'hasPart' && statusDisplay.partNumber === total.item_number

        const rowBg = isHighlighted
            ? '#1a1500'
            : status === 'complete' ? '#0a1a0f'
                : status === 'over' ? '#1a0a0a'
                    : status === 'inProgress' ? '#151000'
                        : 'transparent'

        return (
            <tr style={{
                background: rowBg,
                transition: 'background 0.3s ease',
                borderBottom: '1px solid #1a1a1a',
            }}>
                <td style={{ padding: '10px 12px', fontFamily: 'var(--font-mono)', fontSize: '12px', color: '#ccc' }}>
                    {total.item_number}
                </td>
                <td style={{ padding: '10px 12px', fontSize: '12px', color: '#666', maxWidth: '200px' }}>
                    {total.description ?? <span style={{ color: '#333', fontStyle: 'italic' }}>unknown item</span>}
                </td>
                <td style={{ padding: '10px 12px', fontFamily: 'var(--font-mono)', fontSize: '12px', color: '#555', textAlign: 'right' }}>
                    {total.expected ?? '—'}
                </td>
                <td style={{ padding: '10px 12px', fontFamily: 'var(--font-mono)', fontSize: '13px', color: '#fff', textAlign: 'right', fontWeight: 600 }}>
                    {total.scanned}
                </td>
                <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                    <StatusBadge status={status} />
                </td>
            </tr>
        )
    }

    function SectionHeader({ label, color, count }: { label: string; color: string; count: number }) {
        if (count === 0) return null
        return (
            <tr>
                <td colSpan={5} style={{
                    padding: '8px 12px 4px',
                    fontSize: '10px',
                    fontFamily: 'var(--font-mono)',
                    letterSpacing: '0.1em',
                    color,
                    borderBottom: '1px solid #1a1a1a',
                    background: '#080808',
                }}>
                    {label} ({count})
                </td>
            </tr>
        )
    }

    // ── Render ────────────────────────────────────────────────────────────────

    if (loading) {
        return (
            <div style={{
                minHeight: '100vh', background: '#050505', display: 'flex',
                alignItems: 'center', justifyContent: 'center',
                fontFamily: 'var(--font-mono)', color: '#333', fontSize: '12px', letterSpacing: '0.1em'
            }}>
                LOADING SHIPMENT...
            </div>
        )
    }

    const scannedCount = scanLogs.length
    const totalItems = manifestItems.length
    const completedItems = grouped.complete.length

    return (
        <div style={{
            minHeight: '100vh',
            background: '#050505',
            color: '#e0e0e0',
            fontFamily: 'var(--font-sans)',
        }}>
            <style>{`
        @keyframes slideIn {
          from { opacity: 0; transform: translateY(-6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: #0a0a0a; }
        ::-webkit-scrollbar-thumb { background: #222; border-radius: 2px; }
      `}</style>

            {/* Hidden scanner input — always in DOM, always focused */}
            <input
                ref={inputRef}
                onKeyDown={onInputKeyDown}
                style={{
                    position: 'fixed',
                    top: 0, left: 0,
                    width: '1px', height: '1px',
                    opacity: 0,
                    pointerEvents: 'none',
                }}
                autoFocus
                autoComplete="off"
                tabIndex={-1}
            />

            {/* Header */}
            <div style={{
                borderBottom: '1px solid #111',
                padding: '16px 24px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                background: '#080808',
                position: 'sticky',
                top: 0,
                zIndex: 10,
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
                    <button
                        onClick={() => router.push('/dashboard/maryland')}
                        style={{
                            background: 'none', border: 'none', color: '#555',
                            cursor: 'pointer', fontFamily: 'var(--font-mono)',
                            fontSize: '11px', letterSpacing: '0.08em', padding: 0,
                        }}
                    >
                        ← DASHBOARD
                    </button>
                    <span style={{ color: '#1a1a1a' }}>|</span>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: '#444', letterSpacing: '0.08em' }}>
                        SHIPMENT · {shipmentDate}
                    </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: '#333' }}>
                        {completedItems}/{totalItems} ITEMS COMPLETE
                    </span>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: '#333' }}>
                        {scannedCount} SCANS LOGGED
                    </span>
                </div>
            </div>

            <div style={{ maxWidth: '960px', margin: '0 auto', padding: '24px 24px 80px' }}>

                {/* Scan area */}
                <div style={{
                    background: '#0a0a0a',
                    border: '1px solid #1a1a1a',
                    borderRadius: '8px',
                    padding: '20px 24px',
                    marginBottom: '12px',
                }}>
                    <div style={{
                        fontSize: '10px',
                        fontFamily: 'var(--font-mono)',
                        letterSpacing: '0.12em',
                        color: '#333',
                        marginBottom: '12px',
                    }}>
                        SCAN AREA
                    </div>
                    <div style={{ minHeight: '52px', display: 'flex', alignItems: 'center' }}>
                        {renderStatusDisplay()}
                    </div>
                </div>

                {/* Confirm card */}
                {confirmCard && (
                    <div style={{ marginBottom: '12px', animation: 'slideIn 0.2s ease' }}>
                        {renderConfirmCard()}
                    </div>
                )}

                {/* Undo last entry */}
                <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    marginBottom: '24px',
                    padding: '10px 16px',
                    background: '#080808',
                    border: '1px solid #111',
                    borderRadius: '6px',
                }}>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: '#444' }}>
                        {lastEntry
                            ? <>LAST SCAN: <span style={{ color: '#666' }}>{lastEntry.itemNumber}</span> × <span style={{ color: '#666' }}>{lastEntry.quantity}</span></>
                            : 'NO SCANS YET'
                        }
                    </div>
                    <button
                        onClick={undoLast}
                        disabled={!lastEntry}
                        style={{
                            background: lastEntry ? '#1a1a1a' : 'transparent',
                            border: `1px solid ${lastEntry ? '#2a2a2a' : '#111'}`,
                            color: lastEntry ? '#888' : '#2a2a2a',
                            padding: '5px 14px',
                            borderRadius: '4px',
                            cursor: lastEntry ? 'pointer' : 'default',
                            fontFamily: 'var(--font-mono)',
                            fontSize: '10px',
                            letterSpacing: '0.08em',
                        }}
                    >
                        UNDO LAST ENTRY
                    </button>
                </div>

                {/* Running totals table */}
                <div style={{
                    fontSize: '10px',
                    fontFamily: 'var(--font-mono)',
                    letterSpacing: '0.12em',
                    color: '#333',
                    marginBottom: '10px',
                }}>
                    RUNNING TOTALS
                </div>

                <div style={{
                    background: '#080808',
                    border: '1px solid #111',
                    borderRadius: '8px',
                    overflow: 'hidden',
                }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead>
                            <tr style={{ borderBottom: '1px solid #1a1a1a' }}>
                                {['ITEM NO.', 'DESCRIPTION', 'EXPECTED', 'SCANNED', 'STATUS'].map((h, i) => (
                                    <th key={h} style={{
                                        padding: '10px 12px',
                                        fontFamily: 'var(--font-mono)',
                                        fontSize: '10px',
                                        letterSpacing: '0.08em',
                                        color: '#333',
                                        fontWeight: 400,
                                        textAlign: i >= 2 && i <= 3 ? 'right' : 'left',
                                    }}>
                                        {h}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {/* Unknown items */}
                            {unknownItems.length > 0 && (
                                <>
                                    <SectionHeader label="NOT ON MANIFEST" color="#ff6b6b" count={unknownItems.length} />
                                    {unknownItems.map(t => <TotalsRow key={t.item_number} total={t} />)}
                                </>
                            )}

                            {/* Over */}
                            {grouped.over.length > 0 && (
                                <>
                                    <SectionHeader label="OVER-SCANNED" color="#ff6b6b" count={grouped.over.length} />
                                    {grouped.over.map(t => <TotalsRow key={t.item_number} total={t} />)}
                                </>
                            )}

                            {/* In progress */}
                            {grouped.inProgress.length > 0 && (
                                <>
                                    <SectionHeader label="IN PROGRESS" color="#fbbf24" count={grouped.inProgress.length} />
                                    {grouped.inProgress.map(t => <TotalsRow key={t.item_number} total={t} />)}
                                </>
                            )}

                            {/* Complete */}
                            {grouped.complete.length > 0 && (
                                <>
                                    <SectionHeader label="COMPLETE" color="#4ade80" count={grouped.complete.length} />
                                    {grouped.complete.map(t => <TotalsRow key={t.item_number} total={t} />)}
                                </>
                            )}

                            {/* Not started */}
                            {grouped.notStarted.length > 0 && (
                                <>
                                    <SectionHeader label="NOT STARTED" color="#444" count={grouped.notStarted.length} />
                                    {grouped.notStarted.map(t => <TotalsRow key={t.item_number} total={t} />)}
                                </>
                            )}
                        </tbody>
                    </table>
                </div>

            </div>
        </div>
    )
}