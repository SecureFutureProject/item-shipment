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

    function findColumn(headers: string[], variants: string[]): number {
        return headers.findIndex(h =>
            variants.some(v => h.trim().toLowerCase().includes(v.toLowerCase()))
        )
    }

    function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
        setError('')
        setParsed(null)
        const file = e.target.files?.[0]
        if (!file) return

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

                // Always use the first (and only) sheet
                const sheetName = workbook.SheetNames[0]
                const sheet = workbook.Sheets[sheetName]
                const rows: string[][] = XLSX.utils.sheet_to_json(sheet, { header: 1 })

                if (rows.length < 2) {
                    setError('The file appears to be empty or has no data rows.')
                    return
                }

                const headers = rows[0].map(h => String(h ?? ''))

                // Flexible column detection
                const itemCol = findColumn(headers, ['item no', 'item number', 'item_no', 'itemno'])
                const descCol = findColumn(headers, ['description', 'desc', 'name'])
                const qtyCol = findColumn(headers, ['quantity', 'qty', 'quant'])

                if (itemCol === -1) {
                    setError('Could not find an "Item No" column. Please check your file headers.')
                    return
                }
                if (qtyCol === -1) {
                    setError('Could not find a "Quantity" column. Please check your file headers.')
                    return
                }

                const result: ManifestRow[] = []

                for (let i = 1; i < rows.length; i++) {
                    const row = rows[i]

                    // Skip fully empty rows
                    if (!row || row.every(cell => cell === undefined || cell === null || String(cell).trim() === '')) {
                        continue
                    }

                    const rawItem = String(row[itemCol] ?? '').trim()
                    const rawDesc = descCol !== -1 ? String(row[descCol] ?? '').trim() : ''
                    const rawQty = String(row[qtyCol] ?? '').replace(/,/g, '').trim()

                    if (!rawItem) {
                        setError(`Row ${i + 1} is missing an Item Number. Please fix your file and re-upload.`)
                        return
                    }

                    const qty = parseInt(rawQty, 10)
                    if (isNaN(qty) || qty <= 0) {
                        setError(`Row ${i + 1} has an invalid quantity "${row[qtyCol]}". All quantities must be positive numbers.`)
                        return
                    }

                    result.push({
                        item_number: rawItem,
                        description: rawDesc,
                        expected_quantity: qty,
                    })
                }

                if (result.length === 0) {
                    setError('No valid data rows found in the file.')
                    return
                }

                setParsed(result)
            } catch {
                setError('Could not read the file. Make sure it is a valid .xlsx Excel file.')
            }
        }

        reader.readAsArrayBuffer(file)
    }

    async function handleConfirm() {
        if (!parsed) return
        setSaving(true)

        const supabase = createClient()
        const { data: { user } } = await supabase.auth.getUser()

        if (!user) {
            setError('You must be logged in to create a shipment.')
            setSaving(false)
            return
        }

        // Create the shipment record
        const { data: shipment, error: shipmentError } = await supabase
            .from('shipments')
            .insert({ created_by: user.email, status: 'active' })
            .select()
            .single()

        if (shipmentError || !shipment) {
            setError('Failed to create shipment. Please try again.')
            setSaving(false)
            return
        }

        // Insert all manifest items
        const items = parsed.map(row => ({
            shipment_id: shipment.id,
            item_number: row.item_number,
            description: row.description,
            expected_quantity: row.expected_quantity,
        }))

        const { error: itemsError } = await supabase
            .from('manifest_items')
            .insert(items)

        if (itemsError) {
            setError('Failed to save manifest items. Please try again.')
            setSaving(false)
            return
        }

        router.push(`/shipment/${shipment.id}`)
    }

    return (
        <div style={{
            minHeight: '100vh',
            backgroundColor: '#0f1117',
            color: '#e8e8e8',
            fontFamily: "'DM Mono', monospace",
            padding: '40px 24px',
        }}>
            <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@300;400;500&family=Syne:wght@600;700&display=swap');
        * { box-sizing: border-box; }
        .upload-zone {
          border: 1.5px dashed #333;
          border-radius: 8px;
          padding: 48px;
          text-align: center;
          cursor: pointer;
          transition: border-color 0.2s, background 0.2s;
        }
        .upload-zone:hover {
          border-color: #c8a96e;
          background: rgba(200,169,110,0.04);
        }
        .btn-primary {
          background: #c8a96e;
          color: #0f1117;
          border: none;
          padding: 14px 32px;
          font-family: 'Syne', sans-serif;
          font-weight: 700;
          font-size: 15px;
          border-radius: 6px;
          cursor: pointer;
          transition: opacity 0.2s;
        }
        .btn-primary:hover { opacity: 0.85; }
        .btn-primary:disabled { opacity: 0.4; cursor: not-allowed; }
        .btn-secondary {
          background: transparent;
          color: #888;
          border: 1px solid #333;
          padding: 14px 32px;
          font-family: 'Syne', sans-serif;
          font-weight: 600;
          font-size: 15px;
          border-radius: 6px;
          cursor: pointer;
          transition: border-color 0.2s, color 0.2s;
        }
        .btn-secondary:hover { border-color: #888; color: #e8e8e8; }
        table { width: 100%; border-collapse: collapse; }
        th {
          text-align: left;
          padding: 10px 16px;
          font-size: 11px;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          color: #888;
          border-bottom: 1px solid #222;
        }
        td {
          padding: 12px 16px;
          font-size: 13px;
          border-bottom: 1px solid #1a1a1a;
          color: #ccc;
        }
        tr:last-child td { border-bottom: none; }
        tr:hover td { background: rgba(255,255,255,0.02); }
        .error-box {
          background: rgba(220,53,53,0.1);
          border: 1px solid rgba(220,53,53,0.3);
          border-radius: 6px;
          padding: 14px 18px;
          color: #ff6b6b;
          font-size: 13px;
          margin-bottom: 24px;
        }
      `}</style>

            <div style={{ maxWidth: 900, margin: '0 auto' }}>

                {/* Header */}
                <div style={{ marginBottom: 40 }}>
                    <button
                        onClick={() => router.push('/dashboard/maryland')}
                        style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer', fontSize: 13, padding: 0, marginBottom: 24, fontFamily: 'DM Mono, monospace' }}
                    >
                        ← Back to dashboard
                    </button>
                    <h1 style={{ fontFamily: "'Syne', sans-serif", fontSize: 28, fontWeight: 700, margin: 0, color: '#fff' }}>
                        New Shipment
                    </h1>
                    <p style={{ color: '#666', fontSize: 13, marginTop: 8 }}>
                        Upload the Excel manifest to begin. One sheet, Item No + Description + Quantity.
                    </p>
                </div>

                {/* Error */}
                {error && <div className="error-box">⚠ {error}</div>}

                {/* Upload zone */}
                {!parsed && (
                    <div
                        className="upload-zone"
                        onClick={() => fileInputRef.current?.click()}
                    >
                        <div style={{ fontSize: 32, marginBottom: 12 }}>📂</div>
                        <div style={{ fontFamily: "'Syne', sans-serif", fontWeight: 600, fontSize: 16, color: '#fff', marginBottom: 8 }}>
                            Click to select Excel file
                        </div>
                        <div style={{ fontSize: 12, color: '#555' }}>
                            .xlsx files only — one sheet, Item No + Quantity columns required
                        </div>
                        <input
                            ref={fileInputRef}
                            type="file"
                            accept=".xlsx"
                            onChange={handleFile}
                            style={{ display: 'none' }}
                        />
                    </div>
                )}

                {/* Preview table */}
                {parsed && (
                    <>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                            <div>
                                <div style={{ fontFamily: "'Syne', sans-serif", fontWeight: 600, fontSize: 16, color: '#fff' }}>
                                    {fileName}
                                </div>
                                <div style={{ fontSize: 12, color: '#c8a96e', marginTop: 4 }}>
                                    {parsed.length} line items parsed — review before confirming
                                </div>
                            </div>
                            <button
                                className="btn-secondary"
                                onClick={() => {
                                    setParsed(null)
                                    setFileName('')
                                    setError('')
                                    if (fileInputRef.current) fileInputRef.current.value = ''
                                }}
                            >
                                Change file
                            </button>
                        </div>

                        <div style={{ border: '1px solid #222', borderRadius: 8, overflow: 'hidden', marginBottom: 32 }}>
                            <div style={{ maxHeight: 480, overflowY: 'auto' }}>
                                <table>
                                    <thead style={{ position: 'sticky', top: 0, background: '#141418' }}>
                                        <tr>
                                            <th>#</th>
                                            <th>Item No.</th>
                                            <th>Description</th>
                                            <th style={{ textAlign: 'right' }}>Qty</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {parsed.map((row, i) => (
                                            <tr key={i}>
                                                <td style={{ color: '#444', fontSize: 11 }}>{i + 1}</td>
                                                <td style={{ color: '#fff', fontWeight: 500 }}>{row.item_number}</td>
                                                <td style={{ color: '#888' }}>{row.description || '—'}</td>
                                                <td style={{ textAlign: 'right', color: '#c8a96e', fontWeight: 500 }}>
                                                    {row.expected_quantity.toLocaleString()}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>

                        <div style={{ display: 'flex', gap: 12 }}>
                            <button
                                className="btn-primary"
                                onClick={handleConfirm}
                                disabled={saving}
                            >
                                {saving ? 'Creating shipment...' : `Confirm & Create Shipment →`}
                            </button>
                            <button
                                className="btn-secondary"
                                onClick={() => router.push('/dashboard/maryland')}
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