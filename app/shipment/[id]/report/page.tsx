'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'

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
}

interface ReportRow {
    item_number: string
    description: string | null
    expected: number | null
    sent: number
    received: number
    category: 'matched' | 'mismatch' | 'notSent' | 'notOnManifest'
}

// ─── Classification ───────────────────────────────────────────────────────────

function buildReport(
    manifestItems: ManifestItem[],
    mdLogs: ScanLog[],
    scLogs: ScanLog[]
): ReportRow[] {
    const mdTotals = new Map<string, number>()
    const scTotals = new Map<string, number>()

    for (const log of mdLogs) {
        mdTotals.set(log.item_number, (mdTotals.get(log.item_number) ?? 0) + log.quantity)
    }
    for (const log of scLogs) {
        scTotals.set(log.item_number, (scTotals.get(log.item_number) ?? 0) + log.quantity)
    }

    const rows: ReportRow[] = []
    const handledItems = new Set<string>()

    for (const item of manifestItems) {
        handledItems.add(item.item_number)
        const sent = mdTotals.get(item.item_number) ?? 0
        const received = scTotals.get(item.item_number) ?? 0
        const expected = item.expected_quantity

        let category: ReportRow['category']
        if (sent === 0 && received === 0) {
            category = 'notSent'
        } else if (sent === expected && received === expected) {
            category = 'matched'
        } else {
            category = 'mismatch'
        }

        rows.push({ item_number: item.item_number, description: item.description, expected, sent, received, category })
    }

    const allScannedItems = new Set([...mdTotals.keys(), ...scTotals.keys()])
    for (const itemNumber of allScannedItems) {
        if (handledItems.has(itemNumber)) continue
        rows.push({
            item_number: itemNumber,
            description: null,
            expected: null,
            sent: mdTotals.get(itemNumber) ?? 0,
            received: scTotals.get(itemNumber) ?? 0,
            category: 'notOnManifest',
        })
    }

    return rows
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function ReportPage() {
    const params = useParams()
    const router = useRouter()
    const shipmentId = params.id as string
    const supabase = createClient()

    const [loading, setLoading] = useState(true)
    const [userRole, setUserRole] = useState<string>('')
    const [shipmentDate, setShipmentDate] = useState<string>('')
    const [shipmentStatus, setShipmentStatus] = useState<string>('')
    const [shipmentNotes, setShipmentNotes] = useState<string | null>(null)
    const [report, setReport] = useState<ReportRow[]>([])

    useEffect(() => {
        async function load() {
            const { data: { user } } = await supabase.auth.getUser()
            if (!user) { router.push('/'); return }

            const { data: roleData } = await supabase
                .from('user_roles').select('role').eq('email', user.email).single()
            if (roleData) setUserRole(roleData.role)

            const { data: shipment } = await supabase
                .from('shipments').select('created_at, status, notes').eq('id', shipmentId).single()

            if (!shipment) { router.push('/'); return }

            if (shipment.status === 'active' || shipment.status === 'cancelled') {
                router.push(roleData?.role === 'southcarolina' ? '/dashboard/southcarolina' : '/dashboard/maryland')
                return
            }

            setShipmentDate(new Date(shipment.created_at).toLocaleDateString('en-US', {
                month: 'short', day: 'numeric', year: 'numeric'
            }))
            setShipmentStatus(shipment.status)
            setShipmentNotes(shipment.notes ?? null)

            const [manifestRes, mdLogsRes, scLogsRes] = await Promise.all([
                supabase.from('manifest_items').select('*').eq('shipment_id', shipmentId),
                supabase.from('scan_logs').select('*').eq('shipment_id', shipmentId).eq('scanned_by', 'maryland'),
                supabase.from('scan_logs').select('*').eq('shipment_id', shipmentId).eq('scanned_by', 'southcarolina'),
            ])

            setReport(buildReport(manifestRes.data ?? [], mdLogsRes.data ?? [], scLogsRes.data ?? []))
            setLoading(false)
        }
        load()
    }, [shipmentId])

    // ─── PDF Export ──────────────────────────────────────────────────────────────

    function downloadPDF() {
        const doc = new jsPDF()
        const mismatches = report.filter(r => r.category === 'mismatch')
        const notSent = report.filter(r => r.category === 'notSent')
        const notOnManifest = report.filter(r => r.category === 'notOnManifest')
        const matched = report.filter(r => r.category === 'matched')

        const discrepancies = mismatches.length + notOnManifest.length
        const isLivePreview = shipmentStatus === 'submitted'

        // Header
        doc.setFontSize(16)
        doc.setTextColor(20, 20, 20)
        doc.text('Shipment Comparison Report', 14, 18)

        doc.setFontSize(9)
        doc.setTextColor(100, 100, 100)
        doc.text(`Date: ${shipmentDate}`, 14, 26)
        doc.text(`Status: ${isLivePreview ? 'LIVE PREVIEW — SC HAS NOT CONFIRMED RECEIPT' : 'FINAL — RECEIPT CONFIRMED'}`, 14, 31)
        doc.text(`${matched.length} matched · ${discrepancies} discrepancies · ${notSent.length} not sent`, 14, 36)

        if (shipmentNotes) {
            doc.setTextColor(160, 130, 0)
            doc.text(`MD Note: ${shipmentNotes}`, 14, 42)
        }

        const columns = ['ITEM NO.', 'DESCRIPTION', 'EXPECTED', 'SENT (MD)', 'RECEIVED (SC)']
        let y = shipmentNotes ? 48 : 44

        function addSection(
            title: string,
            rows: ReportRow[],
            headColor: [number, number, number]
        ) {
            if (rows.length === 0) return
            doc.setFontSize(9)
            doc.setTextColor(...headColor)
            doc.text(`${title} (${rows.length})`, 14, y)
            y += 4

            autoTable(doc, {
                startY: y,
                head: [columns],
                body: rows.map(r => [
                    r.item_number,
                    r.description ?? '—',
                    r.expected !== null ? String(r.expected) : '—',
                    String(r.sent),
                    String(r.received),
                ]),
                styles: { fontSize: 8, cellPadding: 2 },
                headStyles: { fillColor: headColor, textColor: 255, fontStyle: 'bold' },
                margin: { left: 14, right: 14 },
                theme: 'grid',
            })

            y = (doc as any).lastAutoTable.finalY + 8
        }

        addSection('MISMATCHES', mismatches, [180, 40, 40])
        addSection('NOT SENT', notSent, [160, 120, 0])
        addSection('NOT ON MANIFEST', notOnManifest, [180, 40, 40])
        addSection('MATCHED', matched, [30, 140, 70])

        doc.save(`shipment-report-${shipmentDate.replace(/\s/g, '-')}.pdf`)
    }

    // ─── Loading ──────────────────────────────────────────────────────────────────

    if (loading) {
        return (
            <div style={{
                minHeight: '100vh', background: '#050505', display: 'flex',
                alignItems: 'center', justifyContent: 'center',
                fontFamily: 'var(--font-mono)', color: '#333', fontSize: '12px', letterSpacing: '0.1em'
            }}>
                LOADING REPORT...
            </div>
        )
    }

    // ─── Derived ──────────────────────────────────────────────────────────────────

    const dashboardPath = userRole === 'southcarolina' ? '/dashboard/southcarolina' : '/dashboard/maryland'
    const isLivePreview = shipmentStatus === 'submitted'

    const mismatches = report.filter(r => r.category === 'mismatch')
    const notSent = report.filter(r => r.category === 'notSent')
    const notOnManifest = report.filter(r => r.category === 'notOnManifest')
    const matched = report.filter(r => r.category === 'matched')
    const discrepancies = mismatches.length + notOnManifest.length

    // ─── Render ───────────────────────────────────────────────────────────────────

    return (
        <div style={{ minHeight: '100vh', background: '#050505', color: '#e0e0e0', fontFamily: 'var(--font-sans)' }}>
            <style>{`
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: #0a0a0a; }
        ::-webkit-scrollbar-thumb { background: #222; border-radius: 2px; }
      `}</style>

            {/* Header */}
            <div style={{
                borderBottom: '1px solid #111', padding: '16px 24px',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                background: '#080808', position: 'sticky', top: 0, zIndex: 10,
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
                    <button
                        onClick={() => router.push(dashboardPath)}
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
                        COMPARISON REPORT · {shipmentDate}
                    </span>
                    {isLivePreview && (
                        <span style={{
                            fontFamily: 'var(--font-mono)', fontSize: '10px', letterSpacing: '0.08em',
                            color: '#fbbf24', background: '#1a1400', border: '1px solid #fbbf2430',
                            padding: '2px 8px', borderRadius: '3px',
                        }}>
                            LIVE PREVIEW
                        </span>
                    )}
                </div>
                <button
                    onClick={downloadPDF}
                    style={{
                        background: '#0a1a2d', border: '1px solid #3b82f650',
                        color: '#60a5fa', padding: '7px 18px', borderRadius: '5px',
                        cursor: 'pointer', fontFamily: 'var(--font-mono)',
                        fontSize: '11px', letterSpacing: '0.06em',
                    }}
                >
                    DOWNLOAD PDF
                </button>
            </div>

            <div style={{ maxWidth: '960px', margin: '0 auto', padding: '24px 24px 80px' }}>

                {/* Summary bar */}
                <div style={{
                    display: 'flex', gap: '12px', marginBottom: '20px', flexWrap: 'wrap',
                }}>
                    {[
                        { label: 'MATCHED', value: matched.length, color: '#4ade80', bg: '#0a1a0f', border: '#4ade8030' },
                        { label: 'MISMATCHES', value: mismatches.length, color: '#ff6b6b', bg: '#1a0a0a', border: '#ff6b6b30' },
                        { label: 'NOT ON MANIFEST', value: notOnManifest.length, color: '#ff6b6b', bg: '#1a0a0a', border: '#ff6b6b30' },
                        { label: 'NOT SENT', value: notSent.length, color: '#fbbf24', bg: '#1a1400', border: '#fbbf2430' },
                    ].map(s => (
                        <div key={s.label} style={{
                            background: s.bg, border: `1px solid ${s.border}`,
                            borderRadius: '6px', padding: '12px 18px', flex: '1', minWidth: '120px',
                        }}>
                            <div style={{ fontFamily: 'var(--font-mono)', fontSize: '20px', color: s.color, fontWeight: 700 }}>
                                {s.value}
                            </div>
                            <div style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', color: s.color, letterSpacing: '0.1em', marginTop: '2px', opacity: 0.7 }}>
                                {s.label}
                            </div>
                        </div>
                    ))}
                </div>

                {/* MD note banner */}
                {shipmentNotes && (
                    <div style={{
                        background: '#12100a', border: '1px solid #fbbf2430',
                        borderRadius: '8px', padding: '14px 20px', marginBottom: '20px',
                    }}>
                        <div style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', letterSpacing: '0.1em', color: '#fbbf24', marginBottom: '6px' }}>
                            ⚠ NOTE FROM MARYLAND
                        </div>
                        <div style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', color: '#888', lineHeight: 1.6 }}>
                            {shipmentNotes}
                        </div>
                    </div>
                )}

                {/* All clear */}
                {discrepancies === 0 && notSent.length === 0 && (
                    <div style={{
                        background: '#0a1a0f', border: '1px solid #4ade8030',
                        borderRadius: '8px', padding: '20px', marginBottom: '20px', textAlign: 'center',
                        fontFamily: 'var(--font-mono)', fontSize: '12px', color: '#4ade80', letterSpacing: '0.08em',
                    }}>
                        ✓ ALL ITEMS MATCHED — NO DISCREPANCIES
                    </div>
                )}

                {/* Mismatches */}
                {mismatches.length > 0 && (
                    <ReportSection
                        label="MISMATCH"
                        count={mismatches.length}
                        color="#ff6b6b"
                        bg="#1a0808"
                        border="#ff6b6b20"
                        rows={mismatches}
                    />
                )}

                {/* Not sent */}
                {notSent.length > 0 && (
                    <ReportSection
                        label="NOT SENT"
                        count={notSent.length}
                        color="#fbbf24"
                        bg="#12100a"
                        border="#fbbf2420"
                        rows={notSent}
                    />
                )}

                {/* Not on manifest */}
                {notOnManifest.length > 0 && (
                    <ReportSection
                        label="NOT ON MANIFEST"
                        count={notOnManifest.length}
                        color="#ff6b6b"
                        bg="#1a0808"
                        border="#ff6b6b20"
                        rows={notOnManifest}
                    />
                )}

                {/* Matched */}
                {matched.length > 0 && (
                    <ReportSection
                        label="MATCHED"
                        count={matched.length}
                        color="#4ade80"
                        bg="#081208"
                        border="#4ade8020"
                        rows={matched}
                    />
                )}

            </div>
        </div>
    )
}

// ─── Report Section ───────────────────────────────────────────────────────────

function ReportSection({
    label, count, color, bg, border, rows
}: {
    label: string
    count: number
    color: string
    bg: string
    border: string
    rows: ReportRow[]
}) {
    return (
        <div style={{ marginBottom: '24px' }}>
            <div style={{
                fontFamily: 'var(--font-mono)', fontSize: '10px', letterSpacing: '0.12em',
                color, marginBottom: '8px',
            }}>
                {label} ({count})
            </div>
            <div style={{ background: '#080808', border: `1px solid ${border}`, borderRadius: '8px', overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                        <tr style={{ borderBottom: '1px solid #1a1a1a', background: bg }}>
                            {['ITEM NO.', 'DESCRIPTION', 'EXPECTED', 'SENT (MD)', 'RECEIVED (SC)'].map((h, i) => (
                                <th key={h} style={{
                                    padding: '9px 12px',
                                    fontFamily: 'var(--font-mono)', fontSize: '9px',
                                    letterSpacing: '0.08em', color: '#444', fontWeight: 400,
                                    textAlign: i >= 2 ? 'right' : 'left',
                                }}>
                                    {h}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map(row => (
                            <ReportRow key={row.item_number} row={row} color={color} />
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    )
}

// ─── Report Row ───────────────────────────────────────────────────────────────

function ReportRow({ row, color }: { row: ReportRow; color: string }) {
    const sentMismatch = row.expected !== null && row.sent !== row.expected
    const receivedMismatch = row.expected !== null && row.received !== row.expected
    const sentReceivedMismatch = row.sent !== row.received

    return (
        <tr style={{ borderBottom: '1px solid #111' }}>
            <td style={{ padding: '10px 12px', fontFamily: 'var(--font-mono)', fontSize: '12px', color: '#ccc' }}>
                {row.item_number}
            </td>
            <td style={{ padding: '10px 12px', fontSize: '12px', color: '#555', maxWidth: '220px' }}>
                {row.description ?? <span style={{ color: '#333', fontStyle: 'italic' }}>unknown item</span>}
            </td>
            <td style={{ padding: '10px 12px', fontFamily: 'var(--font-mono)', fontSize: '12px', color: '#555', textAlign: 'right' }}>
                {row.expected ?? '—'}
            </td>
            <td style={{
                padding: '10px 12px', fontFamily: 'var(--font-mono)', fontSize: '12px', textAlign: 'right',
                color: (sentMismatch || sentReceivedMismatch) ? color : '#fff',
                fontWeight: (sentMismatch || sentReceivedMismatch) ? 600 : 400,
            }}>
                {row.sent}
            </td>
            <td style={{
                padding: '10px 12px', fontFamily: 'var(--font-mono)', fontSize: '12px', textAlign: 'right',
                color: (receivedMismatch || sentReceivedMismatch) ? color : '#fff',
                fontWeight: (receivedMismatch || sentReceivedMismatch) ? 600 : 400,
            }}>
                {row.received}
            </td>
        </tr>
    )
}