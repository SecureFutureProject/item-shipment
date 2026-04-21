'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'

interface ManifestItem {
    id: string
    item_number: string
    description: string
    expected_quantity: number
}

interface Shipment {
    id: string
    created_at: string
    status: string
}

export default function ShipmentPage() {
    const { id } = useParams()
    const router = useRouter()
    const [shipment, setShipment] = useState<Shipment | null>(null)
    const [items, setItems] = useState<ManifestItem[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState('')

    useEffect(() => {
        async function load() {
            const supabase = createClient()

            const { data: shipmentData, error: shipmentError } = await supabase
                .from('shipments')
                .select('*')
                .eq('id', id)
                .single()

            if (shipmentError || !shipmentData) {
                setError('Shipment not found.')
                setLoading(false)
                return
            }

            const { data: itemsData, error: itemsError } = await supabase
                .from('manifest_items')
                .select('*')
                .eq('shipment_id', id)
                .order('item_number')

            if (itemsError) {
                setError('Could not load manifest items.')
                setLoading(false)
                return
            }

            setShipment(shipmentData)
            setItems(itemsData ?? [])
            setLoading(false)
        }

        load()
    }, [id])

    const formattedDate = shipment
        ? new Date(shipment.created_at).toLocaleDateString('en-US', {
            month: 'long', day: 'numeric', year: 'numeric',
            hour: '2-digit', minute: '2-digit',
        })
        : ''

    const totalItems = items.reduce((sum, i) => sum + i.expected_quantity, 0)

    return (
        <div style={{
            minHeight: '100vh',
            backgroundColor: '#0f1117',
            color: '#e8e8e8',
            fontFamily: "'DM Mono', monospace",
            padding: '40px 24px',
        }}>
            <style>{`
        * { box-sizing: border-box; }
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
      `}</style>

            <div style={{ maxWidth: 900, margin: '0 auto' }}>

                {/* Back button */}
                <button
                    onClick={() => router.push('/dashboard/maryland')}
                    style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer', fontSize: 13, padding: 0, marginBottom: 24, fontFamily: 'DM Mono, monospace' }}
                >
                    ← Back to dashboard
                </button>

                {loading && (
                    <div style={{ color: '#555', fontSize: 13 }}>Loading shipment...</div>
                )}

                {error && (
                    <div style={{ color: '#ff6b6b', fontSize: 13 }}>{error}</div>
                )}

                {!loading && shipment && (
                    <>
                        {/* Header */}
                        <div style={{ marginBottom: 32 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
                                <h1 style={{ fontFamily: "'Syne', sans-serif", fontSize: 28, fontWeight: 700, margin: 0, color: '#fff' }}>
                                    Shipment Manifest
                                </h1>
                                <span style={{
                                    background: 'rgba(200,169,110,0.15)',
                                    color: '#c8a96e',
                                    fontSize: 11,
                                    fontWeight: 600,
                                    padding: '4px 10px',
                                    borderRadius: 4,
                                    letterSpacing: '0.08em',
                                    textTransform: 'uppercase',
                                }}>
                                    {shipment.status}
                                </span>
                            </div>
                            <div style={{ color: '#555', fontSize: 12 }}>
                                Created {formattedDate} · {items.length} line items · {totalItems.toLocaleString()} units total
                            </div>
                        </div>

                        {/* Phase 4 notice */}
                        <div style={{
                            background: 'rgba(200,169,110,0.08)',
                            border: '1px solid rgba(200,169,110,0.2)',
                            borderRadius: 8,
                            padding: '14px 18px',
                            marginBottom: 28,
                            fontSize: 13,
                            color: '#c8a96e',
                        }}>
                            📦 Barcode scanning will be enabled in Phase 4. Below is your manifest — review it before scanning begins.
                        </div>

                        {/* Manifest table */}
                        <div style={{ border: '1px solid #222', borderRadius: 8, overflow: 'hidden' }}>
                            <div style={{ maxHeight: 600, overflowY: 'auto' }}>
                                <table>
                                    <thead style={{ position: 'sticky', top: 0, background: '#141418' }}>
                                        <tr>
                                            <th>#</th>
                                            <th>Item No.</th>
                                            <th>Description</th>
                                            <th style={{ textAlign: 'right' }}>Expected Qty</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {items.map((item, i) => (
                                            <tr key={item.id}>
                                                <td style={{ color: '#444', fontSize: 11 }}>{i + 1}</td>
                                                <td style={{ color: '#fff', fontWeight: 500 }}>{item.item_number}</td>
                                                <td style={{ color: '#888' }}>{item.description || '—'}</td>
                                                <td style={{ textAlign: 'right', color: '#c8a96e', fontWeight: 500 }}>
                                                    {item.expected_quantity.toLocaleString()}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </>
                )}
            </div>
        </div>
    )
}