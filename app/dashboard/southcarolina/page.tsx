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

function StatusPill({ status }: { status: string }) {
  const map: Record<string, { label: string; color: string; bg: string; border: string }> = {
    submitted: { label: 'Incoming', color: '#1E4D8C', bg: '#EFF6FF', border: '#BFDBFE' },
    received:  { label: 'Received', color: '#166534', bg: '#F0FDF4', border: '#BBF7D0' },
  }
  const s = map[status] ?? map.received
  return (
    <span style={{ display: 'inline-block', padding: '3px 10px', borderRadius: '20px', fontSize: '11px', fontWeight: 600, letterSpacing: '0.03em', color: s.color, background: s.bg, border: `1px solid ${s.border}`, fontFamily: "var(--font-dm-mono), 'DM Mono', monospace" }}>
      {s.label}
    </span>
  )
}

function ShipmentCard({ s, onOpen, onReport }: { s: Shipment; onOpen: (id: string) => void; onReport: (id: string) => void }) {
  const mono = "var(--font-dm-mono), 'DM Mono', monospace"
  const syne = "var(--font-syne), 'Syne', sans-serif"
  const isIncoming = s.status === 'submitted'
  return (
    <div style={{ background: '#FFFFFF', border: `1px solid ${isIncoming ? '#BFDBFE' : '#E2E2DC'}`, borderRadius: '10px', padding: '20px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6, flexWrap: 'wrap' }}>
          <span style={{ fontFamily: syne, fontWeight: 700, fontSize: 15, color: '#1A1A1A' }}>{formatDate(s.created_at)}</span>
          <StatusPill status={s.status} />
        </div>
        <div style={{ fontFamily: mono, fontSize: 12, color: '#888' }}>{s.item_count} line items</div>
      </div>
      <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
        <button onClick={() => onOpen(s.id)} style={{ padding: '8px 16px', borderRadius: 6, fontSize: 12, cursor: 'pointer', fontFamily: mono, fontWeight: 500, background: isIncoming ? '#0057B8' : '#F5F5F3', color: isIncoming ? '#fff' : '#444', border: isIncoming ? 'none' : '1px solid #E2E2DC' }}>
          {isIncoming ? 'Receive →' : 'View →'}
        </button>
        <button onClick={() => onReport(s.id)} style={{ padding: '8px 16px', borderRadius: 6, fontSize: 12, cursor: 'pointer', fontFamily: mono, fontWeight: 500, background: '#EFF6FF', color: '#1E4D8C', border: '1px solid #BFDBFE' }}>Report →</button>
      </div>
    </div>
  )
}

export default function SouthCarolinaDashboard() {
  const router = useRouter()
  const [shipments, setShipments] = useState<Shipment[]>([])
  const [loading, setLoading] = useState(true)
  const mono = "var(--font-dm-mono), 'DM Mono', monospace"
  const syne = "var(--font-syne), 'Syne', sans-serif"

  useEffect(() => {
    async function load() {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/'); return }
      const { data: roleData } = await supabase.from('user_roles').select('role').eq('email', user.email).single()
      if (!roleData || roleData.role !== 'southcarolina') { router.push('/'); return }
      const { data, error } = await supabase.from('shipments').select('id, created_at, status, submitted_at').in('status', ['submitted', 'received']).order('created_at', { ascending: false })
      if (error || !data) { setLoading(false); return }
      const withCounts = await Promise.all(data.map(async (s) => {
        const { count } = await supabase.from('manifest_items').select('*', { count: 'exact', head: true }).eq('shipment_id', s.id)
        return { ...s, item_count: count ?? 0 }
      }))
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
    <div style={{ minHeight: '100vh', background: '#F5F5F3', fontFamily: mono }}>
      <div style={{ background: '#1A1A1A', borderBottom: '1px solid #2A2A2A', padding: '0 32px', height: '56px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'sticky', top: 0, zIndex: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <span style={{ fontFamily: syne, fontWeight: 800, fontSize: 16, color: '#fff' }}>Shipment Scanner</span>
          <span style={{ width: 1, height: 16, background: '#333' }} />
          <span style={{ fontSize: 11, color: '#555', letterSpacing: '0.1em', textTransform: 'uppercase' }}>South Carolina · Receiver</span>
        </div>
        <button onClick={handleLogout} style={{ background: 'transparent', color: '#666', border: '1px solid #333', padding: '6px 16px', borderRadius: 6, fontSize: 12, fontFamily: mono, cursor: 'pointer' }}>Log out</button>
      </div>

      <div style={{ maxWidth: 860, margin: '0 auto', padding: '40px 24px 80px' }}>
        <div style={{ marginBottom: 32 }}>
          <h1 style={{ fontFamily: syne, fontWeight: 700, fontSize: 28, color: '#1A1A1A', margin: 0 }}>South Carolina</h1>
          <p style={{ color: '#888', fontSize: 13, marginTop: 4, fontFamily: mono }}>Receiver dashboard</p>
        </div>

        {!loading && shipments.length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12, marginBottom: 32 }}>
            {[
              { label: 'Incoming', value: incoming.length, color: '#1E4D8C', bg: '#EFF6FF', border: '#BFDBFE' },
              { label: 'Received', value: received.length, color: '#166534', bg: '#F0FDF4', border: '#BBF7D0' },
            ].map(s => (
              <div key={s.label} style={{ background: s.bg, border: `1px solid ${s.border}`, borderRadius: 10, padding: '16px 20px' }}>
                <div style={{ fontFamily: syne, fontWeight: 700, fontSize: 28, color: s.color }}>{s.value}</div>
                <div style={{ fontFamily: mono, fontSize: 11, color: s.color, opacity: 0.8, marginTop: 2, letterSpacing: '0.06em' }}>{s.label}</div>
              </div>
            ))}
          </div>
        )}

        {loading && <div style={{ color: '#888', fontSize: 13, padding: '40px 0', textAlign: 'center' }}>Loading shipments...</div>}

        {!loading && (
          <>
            <div style={{ marginBottom: 40 }}>
              <div style={{ fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#A0A0A0', marginBottom: 12, fontFamily: mono }}>Incoming Shipments ({incoming.length})</div>
              {incoming.length === 0 ? (
                <div style={{ background: '#fff', border: '1px solid #E2E2DC', borderRadius: 10, padding: '32px 24px', textAlign: 'center', color: '#A0A0A0', fontSize: 13, fontFamily: mono }}>No incoming shipments — Maryland has not submitted anything yet.</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {incoming.map(s => <ShipmentCard key={s.id} s={s} onOpen={id => router.push(`/shipment/${id}`)} onReport={id => router.push(`/shipment/${id}/report`)} />)}
                </div>
              )}
            </div>
            {received.length > 0 && (
              <div>
                <div style={{ fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#A0A0A0', marginBottom: 12, fontFamily: mono }}>Received Shipments ({received.length})</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {received.map(s => <ShipmentCard key={s.id} s={s} onOpen={id => router.push(`/shipment/${id}`)} onReport={id => router.push(`/shipment/${id}/report`)} />)}
                </div>
              </div>
            )}
            {shipments.length === 0 && (
              <div style={{ background: '#fff', border: '1px solid #E2E2DC', borderRadius: 10, padding: '32px 24px', textAlign: 'center', color: '#A0A0A0', fontSize: 13, fontFamily: mono }}>No shipments yet.</div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
