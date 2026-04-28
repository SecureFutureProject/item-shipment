'use client'

import { useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import * as XLSX from 'xlsx'
import { createClient } from '@/lib/supabase'

interface ManifestRow {
  item_number: string
  description: string
  expected_quantity: number
}

export default function NewShipmentPage() {
  const router = useRouter()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [parsed, setParsed] = useState<ManifestRow[] | null>(null)
  const [fileName, setFileName] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [dragOver, setDragOver] = useState(false)

  const mono = "var(--font-dm-mono), 'DM Mono', monospace"
  const syne = "var(--font-syne), 'Syne', sans-serif"

  function findColumn(headers: string[], variants: string[]): number {
    return headers.findIndex(h => variants.some(v => h.trim().toLowerCase().includes(v.toLowerCase())))
  }

  function processFile(file: File) {
    setError('')
    setParsed(null)
    if (!file.name.endsWith('.xlsx')) {
      setError('Invalid file type. Please upload a .xlsx Excel file.')
      return
    }
    setFileName(file.name)
    const reader = new FileReader()
    reader.onload = (evt) => {
      try {
        const data = new Uint8Array(evt.target?.result as ArrayBuffer)
        const workbook = XLSX.read(data, { type: 'array' })
        const sheetName = workbook.SheetNames[0]
        const sheet = workbook.Sheets[sheetName]
        const rows: string[][] = XLSX.utils.sheet_to_json(sheet, { header: 1 })
        if (rows.length < 2) { setError('The file appears to be empty or has no data rows.'); return }
        const headers = rows[0].map(h => String(h ?? ''))
        const itemCol = findColumn(headers, ['item no', 'item number', 'item_no', 'itemno'])
        const descCol = findColumn(headers, ['description', 'desc', 'name'])
        const qtyCol = findColumn(headers, ['quantity', 'qty', 'quant'])
        if (itemCol === -1) { setError('Could not find an "Item No" column. Please check your file headers.'); return }
        if (qtyCol === -1) { setError('Could not find a "Quantity" column. Please check your file headers.'); return }
        const result: ManifestRow[] = []
        for (let i = 1; i < rows.length; i++) {
          const row = rows[i]
          if (!row || row.every(cell => cell === undefined || cell === null || String(cell).trim() === '')) continue
          const rawItem = String(row[itemCol] ?? '').trim()
          const rawDesc = descCol !== -1 ? String(row[descCol] ?? '').trim() : ''
          const rawQty = String(row[qtyCol] ?? '').replace(/,/g, '').trim()
          if (!rawItem) { setError(`Row ${i + 1} is missing an Item Number.`); return }
          const qty = parseInt(rawQty, 10)
          if (isNaN(qty) || qty <= 0) { setError(`Row ${i + 1} has an invalid quantity "${row[qtyCol]}".`); return }
          result.push({ item_number: rawItem, description: rawDesc, expected_quantity: qty })
        }
        if (result.length === 0) { setError('No valid data rows found in the file.'); return }
        setParsed(result)
      } catch { setError('Could not read the file. Make sure it is a valid .xlsx Excel file.') }
    }
    reader.readAsArrayBuffer(file)
  }

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) processFile(file)
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files?.[0]
    if (file) processFile(file)
  }

  async function handleConfirm() {
    if (!parsed) return
    setSaving(true)
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setError('You must be logged in to create a shipment.'); setSaving(false); return }
    const { data: shipment, error: shipmentError } = await supabase
      .from('shipments').insert({ created_by: user.email, status: 'active' }).select().single()
    if (shipmentError || !shipment) { setError('Failed to create shipment. Please try again.'); setSaving(false); return }
    const items = parsed.map(row => ({
      shipment_id: shipment.id,
      item_number: row.item_number,
      description: row.description,
      expected_quantity: row.expected_quantity,
    }))
    const { error: itemsError } = await supabase.from('manifest_items').insert(items)
    if (itemsError) { setError('Failed to save manifest items. Please try again.'); setSaving(false); return }
    router.push(`/shipment/${shipment.id}`)
  }

  return (
    <div style={{ minHeight: '100vh', background: '#F5F5F3', fontFamily: mono }}>

      {/* Nav */}
      <div style={{ background: '#1A1A1A', borderBottom: '1px solid #2A2A2A', padding: '0 32px', height: '56px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'sticky', top: 0, zIndex: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <span style={{ fontFamily: syne, fontWeight: 800, fontSize: 16, color: '#fff' }}>Shipment Scanner</span>
          <span style={{ width: 1, height: 16, background: '#333' }} />
          <span style={{ fontSize: 11, color: '#555', letterSpacing: '0.1em', textTransform: 'uppercase' }}>New Shipment</span>
        </div>
        <button onClick={() => router.push('/dashboard/maryland')} style={{ background: 'transparent', color: '#666', border: '1px solid #333', padding: '6px 16px', borderRadius: 6, fontSize: 12, fontFamily: mono, cursor: 'pointer' }}>← Dashboard</button>
      </div>

      <div style={{ maxWidth: 860, margin: '0 auto', padding: '40px 24px 80px' }}>

        {/* Header */}
        <div style={{ marginBottom: 36 }}>
          <h1 style={{ fontFamily: syne, fontWeight: 700, fontSize: 28, color: '#1A1A1A', margin: 0 }}>New Shipment</h1>
          <p style={{ color: '#888', fontSize: 13, marginTop: 6, fontFamily: mono }}>
            Upload your Excel manifest to begin. One sheet — Item No + Description + Quantity.
          </p>
        </div>

        {/* Error */}
        {error && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, fontSize: 13, color: '#B81A1A', marginBottom: 24, fontFamily: mono }}>
            <span>⚠</span><span>{error}</span>
          </div>
        )}

        {/* Upload zone */}
        {!parsed && (
          <div
            onClick={() => fileInputRef.current?.click()}
            onDragOver={e => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            style={{
              border: `2px dashed ${dragOver ? '#0057B8' : '#D8D8D2'}`,
              borderRadius: 12,
              padding: '60px 40px',
              textAlign: 'center',
              cursor: 'pointer',
              background: dragOver ? '#EFF6FF' : '#FFFFFF',
              transition: 'all 0.15s',
            }}
          >
            <div style={{ fontSize: 40, marginBottom: 16 }}>📂</div>
            <div style={{ fontFamily: syne, fontWeight: 700, fontSize: 18, color: '#1A1A1A', marginBottom: 8 }}>
              Click to select Excel file
            </div>
            <div style={{ fontSize: 12, color: '#A0A0A0', fontFamily: mono }}>
              or drag and drop here · .xlsx files only
            </div>
            <div style={{ marginTop: 20, display: 'inline-block', padding: '10px 24px', background: '#0057B8', color: '#fff', borderRadius: 6, fontSize: 13, fontFamily: syne, fontWeight: 700 }}>
              Browse files
            </div>
            <input ref={fileInputRef} type="file" accept=".xlsx" onChange={handleFile} style={{ display: 'none' }} />
          </div>
        )}

        {/* Format hint */}
        {!parsed && (
          <div style={{ marginTop: 16, padding: '14px 18px', background: '#fff', border: '1px solid #E2E2DC', borderRadius: 8, display: 'flex', gap: 16, alignItems: 'flex-start' }}>
            <span style={{ fontSize: 16, flexShrink: 0 }}>ℹ️</span>
            <div style={{ fontSize: 12, color: '#888', fontFamily: mono, lineHeight: 1.7 }}>
              <strong style={{ color: '#555' }}>Expected format:</strong> One sheet, data starts on row 1.<br />
              Column A: Item Number · Column B: Description · Column C: Quantity
            </div>
          </div>
        )}

        {/* Preview */}
        {parsed && (
          <>
            {/* File info bar */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, padding: '14px 20px', background: '#fff', border: '1px solid #E2E2DC', borderRadius: 10 }}>
              <div>
                <div style={{ fontFamily: syne, fontWeight: 700, fontSize: 15, color: '#1A1A1A' }}>{fileName}</div>
                <div style={{ fontFamily: mono, fontSize: 12, color: '#0057B8', marginTop: 3 }}>
                  {parsed.length} line items parsed — review before confirming
                </div>
              </div>
              <button
                onClick={() => { setParsed(null); setFileName(''); setError(''); if (fileInputRef.current) fileInputRef.current.value = '' }}
                style={{ padding: '8px 16px', background: '#F5F5F3', color: '#555', border: '1px solid #E2E2DC', borderRadius: 6, fontSize: 12, fontFamily: mono, cursor: 'pointer' }}
              >
                Change file
              </button>
            </div>

            {/* Table */}
            <div style={{ background: '#fff', border: '1px solid #E2E2DC', borderRadius: 10, overflow: 'hidden', marginBottom: 24 }}>
              <div style={{ maxHeight: 440, overflowY: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: '#F5F5F3', borderBottom: '1px solid #E2E2DC', position: 'sticky', top: 0 }}>
                      {['#', 'Item No.', 'Description', 'Qty'].map((h, i) => (
                        <th key={h} style={{ padding: '10px 16px', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#888', fontWeight: 500, textAlign: i === 3 ? 'right' : 'left', fontFamily: mono }}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {parsed.map((row, i) => (
                      <tr key={i} style={{ borderBottom: '1px solid #F0F0EC' }}>
                        <td style={{ padding: '11px 16px', fontSize: 11, color: '#C0C0BA', fontFamily: mono }}>{i + 1}</td>
                        <td style={{ padding: '11px 16px', fontSize: 13, color: '#1A1A1A', fontWeight: 500, fontFamily: mono }}>{row.item_number}</td>
                        <td style={{ padding: '11px 16px', fontSize: 13, color: '#888' }}>{row.description || '—'}</td>
                        <td style={{ padding: '11px 16px', fontSize: 13, color: '#0057B8', fontWeight: 600, textAlign: 'right', fontFamily: mono }}>{row.expected_quantity.toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Actions */}
            <div style={{ display: 'flex', gap: 12 }}>
              <button
                onClick={handleConfirm}
                disabled={saving}
                style={{ padding: '13px 28px', background: saving ? '#A0C4F0' : '#0057B8', color: '#fff', border: 'none', borderRadius: 8, fontFamily: syne, fontWeight: 700, fontSize: 14, cursor: saving ? 'not-allowed' : 'pointer' }}
              >
                {saving ? 'Creating shipment...' : `Confirm & Create Shipment →`}
              </button>
              <button
                onClick={() => router.push('/dashboard/maryland')}
                style={{ padding: '13px 24px', background: '#fff', color: '#555', border: '1px solid #E2E2DC', borderRadius: 8, fontFamily: syne, fontWeight: 600, fontSize: 14, cursor: 'pointer' }}
              >
                Cancel
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
