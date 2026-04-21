'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'

interface Shipment {
  id: string
  created_at: string
  status: string
  item_count?: number
}

export default function MarylandDashboard() {
  const router = useRouter()
  const [shipments, setShipments] = useState<Shipment[]>([])
  const [loading, setLoading] = useState(true)
  const [cancelling, setCancelling] = useState<string | null>(null)

  async function loadShipments() {
    const supabase = createClient()

    const { data, error } = await supabase
      .from('shipments')
      .select('id, created_at, status')
      .order('created_at', { ascending: false })

    if (error || !data) {
      setLoading(false)
      return
    }

    // Get item counts for each shipment
    const withCounts = await Promise.all(
      data.map(async (s) => {
        const { count } = await supabase
          .from('manifest_items')
          .select('*', { count: 'exact', head: true })
          .eq('shipment_id', s.id)
        return { ...s, item_count: count ?? 0 }
      })
    )

    setShipments(withCounts)
    setLoading(false)
  }

  useEffect(() => {
    loadShipments()
  }, [])

  async function handleCancel(id: string) {
    if (!confirm('Cancel this shipment? This cannot be undone.')) return
    setCancelling(id)
    const supabase = createClient()
    await supabase
      .from('shipments')
      .update({ status: 'cancelled' })
      .eq('id', id)
    await loadShipments()
    setCancelling(null)
  }

  async function handleLogout() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/')
  }

  const active = shipments.filter(s => s.status === 'active')
  const completed = shipments.filter(s => s.status !== 'active')

  function formatDate(ts: string) {
    return new Date(ts).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    })
  }

  function statusColor(status: string) {
    if (status === 'active') return '#c8a96e'
    if (status === 'cancelled') return '#555'
    if (status === 'submitted') return '#6ec8a9'
    if (status === 'received') return '#6e9ec8'
    return '#888'
  }

  function ShipmentCard({ s }: { s: Shipment }) {
    return (
      <div style={{
        border: '1px solid #222',
        borderRadius: 8,
        padding: '18px 20px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 16,
        cursor: s.status === 'active' ? 'pointer' : 'default',
        transition: 'border-color 0.2s',
      }}
        onMouseEnter={e => { if (s.status === 'active') (e.currentTarget as HTMLDivElement).style.borderColor = '#444' }}
        onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.borderColor = '#222' }}
        onClick={() => { if (s.status === 'active') router.push(`/shipment/${s.id}`) }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
            <span style={{ color: '#fff', fontSize: 13, fontWeight: 500 }}>
              {formatDate(s.created_at)}
            </span>
            <span style={{
              fontSize: 10,
              fontWeight: 600,
              padding: '2px 8px',
              borderRadius: 3,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: statusColor(s.status),
              background: `${statusColor(s.status)}18`,
            }}>
              {s.status}
            </span>
          </div>
          <div style={{ color: '#555', fontSize: 12 }}>
            {s.item_count} line items
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
          {s.status === 'active' && (
            <>
              <button
                onClick={e => { e.stopPropagation(); router.push(`/shipment/${s.id}`) }}
                style={{
                  background: 'transparent',
                  border: '1px solid #333',
                  color: '#c8a96e',
                  padding: '8px 16px',
                  borderRadius: 6,
                  fontSize: 12,
                  cursor: 'pointer',
                  fontFamily: 'var(--font-dm-mono), monospace',
                }}
              >
                Open →
              </button>
              <button
                onClick={e => { e.stopPropagation(); handleCancel(s.id) }}
                disabled={cancelling === s.id}
                style={{
                  background: 'transparent',
                  border: '1px solid #2a1a1a',
                  color: '#664444',
                  padding: '8px 16px',
                  borderRadius: 6,
                  fontSize: 12,
                  cursor: 'pointer',
                  fontFamily: 'var(--font-dm-mono), monospace',
                  opacity: cancelling === s.id ? 0.5 : 1,
                }}
              >
                {cancelling === s.id ? 'Cancelling...' : 'Cancel'}
              </button>
            </>
          )}
        </div>
      </div>
    )
  }

  return (
    <div style={{
      minHeight: '100vh',
      backgroundColor: '#0f1117',
      color: '#e8e8e8',
      fontFamily: 'var(--font-dm-mono), monospace',
      padding: '40px 24px',
    }}>
      <style>{`
        * { box-sizing: border-box; }
      `}</style>

      <div style={{ maxWidth: 900, margin: '0 auto' }}>

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 40 }}>
          <div>
            <h1 style={{ fontFamily: 'var(--font-syne), sans-serif', fontSize: 28, fontWeight: 700, margin: 0, color: '#fff' }}>
              Maryland
            </h1>
            <p style={{ color: '#555', fontSize: 13, marginTop: 6 }}>
              Sender dashboard
            </p>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button
              onClick={() => router.push('/shipment/new')}
              style={{
                background: '#c8a96e',
                color: '#0f1117',
                border: 'none',
                padding: '12px 24px',
                fontFamily: 'var(--font-syne), sans-serif',
                fontWeight: 700,
                fontSize: 14,
                borderRadius: 6,
                cursor: 'pointer',
              }}
            >
              + New Shipment
            </button>
            <button
              onClick={handleLogout}
              style={{
                background: 'transparent',
                color: '#555',
                border: '1px solid #222',
                padding: '12px 20px',
                fontFamily: 'var(--font-dm-mono), monospace',
                fontSize: 13,
                borderRadius: 6,
                cursor: 'pointer',
              }}
            >
              Log out
            </button>
          </div>
        </div>

        {loading && <div style={{ color: '#555', fontSize: 13 }}>Loading shipments...</div>}

        {!loading && (
          <>
            {/* Active shipments */}
            <div style={{ marginBottom: 40 }}>
              <div style={{ fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#555', marginBottom: 14 }}>
                Active Shipments ({active.length})
              </div>
              {active.length === 0 ? (
                <div style={{ color: '#333', fontSize: 13, padding: '24px 0' }}>
                  No active shipments — start one with the button above.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {active.map(s => <ShipmentCard key={s.id} s={s} />)}
                </div>
              )}
            </div>

            {/* Completed / other shipments */}
            {completed.length > 0 && (
              <div>
                <div style={{ fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#555', marginBottom: 14 }}>
                  Past Shipments ({completed.length})
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {completed.map(s => <ShipmentCard key={s.id} s={s} />)}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}