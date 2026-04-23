'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'

interface Shipment {
  id: string
  created_at: string
  status: string
  submitted_at: string | null
  item_count?: number
}

function formatDate(ts: string) {
  return new Date(ts).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

function statusColor(status: string) {
  if (status === 'submitted') return '#6ec8a9'
  if (status === 'received') return '#6e9ec8'
  return '#888'
}

interface ShipmentCardProps {
  s: Shipment
  onOpen: (id: string) => void
  onReport: (id: string) => void
}

function ShipmentCard({ s, onOpen, onReport }: ShipmentCardProps) {
  return (
    <div style={{
      border: '1px solid #222',
      borderRadius: 8,
      padding: '18px 20px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 16,
    }}>
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
            textTransform: 'uppercase' as const,
            color: statusColor(s.status),
            background: `${statusColor(s.status)}18`,
          }}>
            {s.status === 'submitted' ? 'INCOMING' : 'RECEIVED'}
          </span>
        </div>
        <div style={{ color: '#555', fontSize: 12 }}>
          {s.item_count} line items
        </div>
      </div>

      <div style={{ flexShrink: 0, display: 'flex', gap: 8 }}>
        {s.status === 'submitted' && (
          <>
            <button
              onClick={() => onOpen(s.id)}
              style={{
                background: 'transparent', border: '1px solid #333',
                color: '#6ec8a9', padding: '8px 16px', borderRadius: 6,
                fontSize: 12, cursor: 'pointer',
                fontFamily: 'var(--font-dm-mono), monospace',
              }}
            >
              Receive →
            </button>
            <button
              onClick={() => onReport(s.id)}
              style={{
                background: 'transparent', border: '1px solid #1a2a3a',
                color: '#60a5fa', padding: '8px 16px', borderRadius: 6,
                fontSize: 12, cursor: 'pointer',
                fontFamily: 'var(--font-dm-mono), monospace',
              }}
            >
              Report →
            </button>
          </>
        )}
        {s.status === 'received' && (
          <>
            <button
              onClick={() => onOpen(s.id)}
              style={{
                background: 'transparent', border: '1px solid #222',
                color: '#444', padding: '8px 16px', borderRadius: 6,
                fontSize: 12, cursor: 'pointer',
                fontFamily: 'var(--font-dm-mono), monospace',
              }}
            >
              View →
            </button>
            <button
              onClick={() => onReport(s.id)}
              style={{
                background: 'transparent', border: '1px solid #1a2a3a',
                color: '#60a5fa', padding: '8px 16px', borderRadius: 6,
                fontSize: 12, cursor: 'pointer',
                fontFamily: 'var(--font-dm-mono), monospace',
              }}
            >
              Report →
            </button>
          </>
        )}
      </div>
    </div>
  )
}

export default function SouthCarolinaDashboard() {
  const router = useRouter()
  const [shipments, setShipments] = useState<Shipment[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      const supabase = createClient()

      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/'); return }

      const { data: roleData } = await supabase
        .from('user_roles')
        .select('role')
        .eq('email', user.email)
        .single()
      if (!roleData || roleData.role !== 'southcarolina') { router.push('/'); return }

      const { data, error } = await supabase
        .from('shipments')
        .select('id, created_at, status, submitted_at')
        .in('status', ['submitted', 'received'])
        .order('created_at', { ascending: false })

      if (error || !data) { setLoading(false); return }

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
    load()
  }, [router])

  async function handleLogout() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/')
  }

  const incoming = shipments.filter(s => s.status === 'submitted')
  const received = shipments.filter(s => s.status === 'received')

  return (
    <div style={{
      minHeight: '100vh', backgroundColor: '#0f1117',
      color: '#e8e8e8', fontFamily: 'var(--font-dm-mono), monospace',
      padding: '40px 24px',
    }}>
      <style>{`* { box-sizing: border-box; }`}</style>
      <div style={{ maxWidth: 900, margin: '0 auto' }}>

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 40 }}>
          <div>
            <h1 style={{ fontFamily: 'var(--font-syne), sans-serif', fontSize: 28, fontWeight: 700, margin: 0, color: '#fff' }}>
              South Carolina
            </h1>
            <p style={{ color: '#555', fontSize: 13, marginTop: 6 }}>Receiver dashboard</p>
          </div>
          <button
            onClick={handleLogout}
            style={{
              background: 'transparent', color: '#555', border: '1px solid #222',
              padding: '12px 20px', fontFamily: 'var(--font-dm-mono), monospace',
              fontSize: 13, borderRadius: 6, cursor: 'pointer',
            }}
          >
            Log out
          </button>
        </div>

        {loading && <div style={{ color: '#555', fontSize: 13 }}>Loading shipments...</div>}

        {!loading && (
          <>
            {/* Incoming */}
            <div style={{ marginBottom: 40 }}>
              <div style={{ fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#555', marginBottom: 14 }}>
                Incoming Shipments ({incoming.length})
              </div>
              {incoming.length === 0 ? (
                <div style={{ color: '#333', fontSize: 13, padding: '24px 0' }}>
                  No incoming shipments — Maryland has not submitted anything yet.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {incoming.map(s => (
                    <ShipmentCard key={s.id} s={s}
                      onOpen={id => router.push(`/shipment/${id}`)}
                      onReport={id => router.push(`/shipment/${id}/report`)}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* Received */}
            {received.length > 0 && (
              <div>
                <div style={{ fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#555', marginBottom: 14 }}>
                  Received Shipments ({received.length})
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {received.map(s => (
                    <ShipmentCard key={s.id} s={s}
                      onOpen={id => router.push(`/shipment/${id}`)}
                      onReport={id => router.push(`/shipment/${id}/report`)}
                    />
                  ))}
                </div>
              </div>
            )}

            {shipments.length === 0 && (
              <div style={{ color: '#333', fontSize: 13, padding: '24px 0' }}>
                No shipments yet.
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}