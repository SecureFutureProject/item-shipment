'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'

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

function buildReport(manifestItems: ManifestItem[], mdLogs: ScanLog[], scLogs: ScanLog[]): ReportRow[] {
  const mdTotals = new Map<string, number>()
  const scTotals = new Map<string, number>()
  for (const log of mdLogs) mdTotals.set(log.item_number, (mdTotals.get(log.item_number) ?? 0) + log.quantity)
  for (const log of scLogs) scTotals.set(log.item_number, (scTotals.get(log.item_number) ?? 0) + log.quantity)
  const rows: ReportRow[] = []
  const handledItems = new Set<string>()
  for (const item of manifestItems) {
    handledItems.add(item.item_number)
    const sent = mdTotals.get(item.item_number) ?? 0
    const received = scTotals.get(item.item_number) ?? 0
    const expected = item.expected_quantity
    let category: ReportRow['category']
    if (sent === 0 && received === 0) category = 'notSent'
    else if (sent === expected && received === expected) category = 'matched'
    else category = 'mismatch'
    rows.push({ item_number: item.item_number, description: item.description, expected, sent, received, category })
  }
  const allScannedItems = new Set([...mdTotals.keys(), ...scTotals.keys()])
  for (const itemNumber of allScannedItems) {
    if (handledItems.has(itemNumber)) continue
    rows.push({ item_number: itemNumber, description: null, expected: null, sent: mdTotals.get(itemNumber) ?? 0, received: scTotals.get(itemNumber) ?? 0, category: 'notOnManifest' })
  }
  return rows
}

export default function ReportPage() {
  const params = useParams()
  const router = useRouter()
  const shipmentId = params.id as string
  const supabase = createClient()
  const mono = "var(--font-dm-mono), 'DM Mono', monospace"
  const syne = "var(--font-syne), 'Syne', sans-serif"

  const [loading, setLoading] = useState(true)
  const [userRole, setUserRole] = useState('')
  const [shipmentDate, setShipmentDate] = useState('')
  const [shipmentStatus, setShipmentStatus] = useState('')
  const [shipmentNotes, setShipmentNotes] = useState<string | null>(null)
  const [report, setReport] = useState<ReportRow[]>([])

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/'); return }
      const { data: roleData } = await supabase.from('user_roles').select('role').eq('email', user.email).single()
      if (roleData) setUserRole(roleData.role)
      const { data: shipment } = await supabase.from('shipments').select('created_at, status, notes').eq('id', shipmentId).single()
      if (!shipment) { router.push('/'); return }
      if (shipment.status === 'active' || shipment.status === 'cancelled') {
        router.push(roleData?.role === 'southcarolina' ? '/dashboard/southcarolina' : '/dashboard/maryland')
        return
      }
      setShipmentDate(new Date(shipment.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }))
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

  function downloadPDF() {
    const doc = new jsPDF()
    const mismatches = report.filter(r => r.category === 'mismatch')
    const notSent = report.filter(r => r.category === 'notSent')
    const notOnManifest = report.filter(r => r.category === 'notOnManifest')
    const matched = report.filter(r => r.category === 'matched')
    const isLivePreview = shipmentStatus === 'submitted'
    doc.setFontSize(16); doc.setTextColor(20, 20, 20)
    doc.text('Shipment Comparison Report', 14, 18)
    doc.setFontSize(9); doc.setTextColor(100, 100, 100)
    doc.text(`Date: ${shipmentDate}`, 14, 26)
    doc.text(`Status: ${isLivePreview ? 'LIVE PREVIEW — SC HAS NOT CONFIRMED RECEIPT' : 'FINAL — RECEIPT CONFIRMED'}`, 14, 31)
    doc.text(`${matched.length} matched · ${mismatches.length + notOnManifest.length} discrepancies · ${notSent.length} not sent`, 14, 36)
    if (shipmentNotes) { doc.setTextColor(160, 130, 0); doc.text(`MD Note: ${shipmentNotes}`, 14, 42) }
    const columns = ['ITEM NO.', 'DESCRIPTION', 'EXPECTED', 'SENT (MD)', 'RECEIVED (SC)']
    let y = shipmentNotes ? 48 : 44
    function addSection(title: string, rows: ReportRow[], headColor: [number, number, number]) {
      if (rows.length === 0) return
      doc.setFontSize(9); doc.setTextColor(...headColor)
      doc.text(`${title} (${rows.length})`, 14, y); y += 4
      autoTable(doc, {
        startY: y, head: [columns],
        body: rows.map(r => [r.item_number, r.description ?? '—', r.expected !== null ? String(r.expected) : '—', String(r.sent), String(r.received)]),
        styles: { fontSize: 8, cellPadding: 2 },
        headStyles: { fillColor: headColor, textColor: 255, fontStyle: 'bold' },
        margin: { left: 14, right: 14 }, theme: 'grid',
      })
      y = (doc as any).lastAutoTable.finalY + 8
    }
    addSection('MISMATCHES', mismatches, [180, 40, 40])
    addSection('NOT SENT', notSent, [160, 120, 0])
    addSection('NOT ON MANIFEST', notOnManifest, [180, 40, 40])
    addSection('MATCHED', matched, [30, 140, 70])
    doc.save(`shipment-report-${shipmentDate.replace(/\s/g, '-')}.pdf`)
  }

  if (loading) {
    return <div style={{ minHeight: '100vh', background: '#F5F5F3', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: mono, color: '#A0A0A0', fontSize: 13 }}>Loading report...</div>
  }

  const dashboardPath = userRole === 'southcarolina' ? '/dashboard/southcarolina' : '/dashboard/maryland'
  const isLivePreview = shipmentStatus === 'submitted'
  const mismatches = report.filter(r => r.category === 'mismatch')
  const notSent = report.filter(r => r.category === 'notSent')
  const notOnManifest = report.filter(r => r.category === 'notOnManifest')
  const matched = report.filter(r => r.category === 'matched')
  const discrepancies = mismatches.length + notOnManifest.length

  return (
    <div style={{ minHeight: '100vh', background: '#F5F5F3', fontFamily: mono }}>

      {/* Nav */}
      <div style={{ background: '#1A1A1A', borderBottom: '1px solid #2A2A2A', padding: '0 24px', height: '56px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'sticky', top: 0, zIndex: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <button onClick={() => router.push(dashboardPath)} style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer', fontFamily: mono, fontSize: 12, padding: 0 }}>← Dashboard</button>
          <span style={{ width: 1, height: 16, background: '#333' }} />
          <span style={{ fontFamily: mono, fontSize: 11, color: '#555', letterSpacing: '0.08em' }}>COMPARISON REPORT · {shipmentDate}</span>
          {isLivePreview && (
            <span style={{ fontFamily: mono, fontSize: 10, color: '#92661A', background: '#FEF3C7', border: '1px solid #FDE68A', padding: '2px 8px', borderRadius: 4 }}>LIVE PREVIEW</span>
          )}
        </div>
        <button onClick={downloadPDF} style={{ background: '#EFF6FF', border: '1px solid #BFDBFE', color: '#1E4D8C', padding: '7px 18px', borderRadius: 6, cursor: 'pointer', fontFamily: syne, fontWeight: 700, fontSize: 13 }}>
          Download PDF
        </button>
      </div>

      <div style={{ maxWidth: 960, margin: '0 auto', padding: '32px 24px 80px' }}>

        {/* Summary cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 24 }}>
          {[
            { label: 'Matched',        value: matched.length,        color: '#166534', bg: '#F0FDF4', border: '#BBF7D0' },
            { label: 'Mismatches',     value: mismatches.length,     color: '#B81A1A', bg: '#FEF2F2', border: '#FECACA' },
            { label: 'Not on Manifest',value: notOnManifest.length,  color: '#B81A1A', bg: '#FEF2F2', border: '#FECACA' },
            { label: 'Not Sent',       value: notSent.length,        color: '#92661A', bg: '#FEF3C7', border: '#FDE68A' },
          ].map(s => (
            <div key={s.label} style={{ background: s.bg, border: `1px solid ${s.border}`, borderRadius: 10, padding: '16px 18px' }}>
              <div style={{ fontFamily: syne, fontWeight: 700, fontSize: 28, color: s.color }}>{s.value}</div>
              <div style={{ fontFamily: mono, fontSize: 10, color: s.color, opacity: 0.8, marginTop: 2, letterSpacing: '0.06em' }}>{s.label}</div>
            </div>
          ))}
        </div>

        {/* MD note */}
        {shipmentNotes && (
          <div style={{ background: '#FEF3C7', border: '1px solid #FDE68A', borderRadius: 10, padding: '14px 20px', marginBottom: 20 }}>
            <div style={{ fontFamily: mono, fontSize: 10, letterSpacing: '0.1em', color: '#92661A', marginBottom: 6 }}>⚠ NOTE FROM MARYLAND</div>
            <div style={{ fontFamily: mono, fontSize: 13, color: '#555', lineHeight: 1.6 }}>{shipmentNotes}</div>
          </div>
        )}

        {/* All clear */}
        {discrepancies === 0 && notSent.length === 0 && (
          <div style={{ background: '#F0FDF4', border: '1px solid #BBF7D0', borderRadius: 10, padding: '20px', marginBottom: 20, textAlign: 'center', fontFamily: mono, fontSize: 13, color: '#166534' }}>
            ✓ All items matched — no discrepancies
          </div>
        )}

        {/* Sections */}
        {mismatches.length > 0 && <ReportSection label="Mismatch" count={mismatches.length} color="#B81A1A" bg="#FEF2F2" border="#FECACA" rows={mismatches} mono={mono} syne={syne} />}
        {notSent.length > 0 && <ReportSection label="Not Sent" count={notSent.length} color="#92661A" bg="#FEF3C7" border="#FDE68A" rows={notSent} mono={mono} syne={syne} />}
        {notOnManifest.length > 0 && <ReportSection label="Not on Manifest" count={notOnManifest.length} color="#B81A1A" bg="#FEF2F2" border="#FECACA" rows={notOnManifest} mono={mono} syne={syne} />}
        {matched.length > 0 && <ReportSection label="Matched" count={matched.length} color="#166534" bg="#F0FDF4" border="#BBF7D0" rows={matched} mono={mono} syne={syne} />}
      </div>
    </div>
  )
}

function ReportSection({ label, count, color, bg, border, rows, mono, syne }: {
  label: string; count: number; color: string; bg: string; border: string; rows: ReportRow[]; mono: string; syne: string
}) {
  return (
    <div style={{ marginBottom: 28 }}>
      <div style={{ fontFamily: mono, fontSize: 10, letterSpacing: '0.12em', color, marginBottom: 10, textTransform: 'uppercase' }}>{label} ({count})</div>
      <div style={{ background: '#fff', border: `1px solid ${border}`, borderRadius: 10, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: `1px solid ${border}`, background: bg }}>
              {['Item No.', 'Description', 'Expected', 'Sent (MD)', 'Received (SC)'].map((h, i) => (
                <th key={h} style={{ padding: '9px 14px', fontFamily: mono, fontSize: 9, letterSpacing: '0.08em', color, fontWeight: 500, textAlign: i >= 2 ? 'right' : 'left', opacity: 0.8 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(row => {
              const sentMismatch = row.expected !== null && row.sent !== row.expected
              const receivedMismatch = row.expected !== null && row.received !== row.expected
              const sentReceivedMismatch = row.sent !== row.received
              return (
                <tr key={row.item_number} style={{ borderBottom: '1px solid #F0F0EC' }}>
                  <td style={{ padding: '10px 14px', fontFamily: mono, fontSize: 12, color: '#1A1A1A' }}>{row.item_number}</td>
                  <td style={{ padding: '10px 14px', fontSize: 12, color: '#888', maxWidth: 220 }}>{row.description ?? <span style={{ color: '#C0C0BA', fontStyle: 'italic' }}>unknown item</span>}</td>
                  <td style={{ padding: '10px 14px', fontFamily: mono, fontSize: 12, color: '#A0A0A0', textAlign: 'right' }}>{row.expected ?? '—'}</td>
                  <td style={{ padding: '10px 14px', fontFamily: mono, fontSize: 12, textAlign: 'right', color: (sentMismatch || sentReceivedMismatch) ? color : '#1A1A1A', fontWeight: (sentMismatch || sentReceivedMismatch) ? 700 : 400 }}>{row.sent}</td>
                  <td style={{ padding: '10px 14px', fontFamily: mono, fontSize: 12, textAlign: 'right', color: (receivedMismatch || sentReceivedMismatch) ? color : '#1A1A1A', fontWeight: (receivedMismatch || sentReceivedMismatch) ? 700 : 400 }}>{row.received}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
