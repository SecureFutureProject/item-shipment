'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'

interface Shipment {
  id: string
  created_at: string
  status: string
  submitted_at: string | null
  notes: string | null
  item_count?: number
}

function formatDate(ts: string) {
  return new Date(ts).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

function isWithin12Hours(submittedAt: string | null): boolean {
  if (!submittedAt) return false
  return Date.now() - new Date(submittedAt).getTime() < 12 * 60 * 60 * 1000
}

function hoursRemaining(submittedAt: string): number {
  return Math.max(0, Math.ceil((12 * 60 * 60 * 1000 - (Date.now() - new Date(submittedAt).getTime())) / 3600000))
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, { label: string; color: string; bg: string; border: string }> = {
    active:    { label: 'Active',       color: '#92661A', bg: '#FEF3C7', border: '#FDE68A' },
    submitted: { label: 'Awaiting SC',  color: '#1E4D8C', bg: '#EFF6FF', border: '#BFDBFE' },
    received:  { label: 'Received',     color: '#166534', bg: '#F0FDF4', border: '#BBF7D0' },
    cancelled: { label: 'Cancelled',    color: '#6B6B6B', bg: '#F3F4F6', border: '#E5E7EB' },
  }
  const s = map[status] ?? map.cancelled
  return (
    <span style={{
      display: 'inline-block', padding: '3px 10px', borderRadius: '20px',
      fontSize: '11px', fontWeight: 600, letterSpacing: '0.03em',
      color: s.color, background: s.bg, border: `1px solid ${s.border}`,
      fontFamily: "var(--font-dm-mono), 'DM Mono', monospace",
    }}>
      {s.label}
    </span>
  )
}

function ShipmentCard({ s, cancelling, savingNote, savedNote, noteValue, onNoteChange, onSaveNote, onCancel, onOpen, onReport }: {
  s: Shipment; cancelling: string | null; savingNote: string | null; savedNote: string | null
  noteValue: string; onNoteChange: (id: string, val: string) => void
  onSaveNote: (id: string) => void; onCancel: (id: string) => void
  onOpen: (id: string) => void; onReport: (id: string) => void
}) {
  const canEditNote = s.status === 'submitted' && isWithin12Hours(s.submitted_at)
  const showNote = s.status === 'submitted' || s.status === 'received'
  const isActive = s.status === 'active'
  const mono = "var(--font-dm-mono), 'DM Mono', monospace"
  const syne = "var(--font-syne), 'Syne', sans-serif"

  return (
    <div style={{ background: '#FFFFFF', border: '1px solid #E2E2DC', borderRadius: '10px', padding: '20px 24px' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6, flexWrap: 'wrap' }}>
            <span style={{ fontFamily: syne, fontWeight: 700, fontSize: 15, color: '#1A1A1A' }}>{formatDate(s.created_at)}</span>
            <StatusPill status={s.status} />
          </div>
          <div style={{ fontFamily: mono, fontSize: 12, color: '#888' }}>
            {s.item_count} line items
            {s.submitted_at && s.status === 'submitted' && isWithin12Hours(s.submitted_at) && (
              <span style={{ color: '#0057B8', marginLeft: 10 }}>· note editable for {hoursRemaining(s.submitted_at)}h</span>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexShrink: 0, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          {isActive && (
            <>
              <button onClick={() => onOpen(s.id)} style={{ padding: '8px 16px', borderRadius: 6, fontSize: 12, cursor: 'pointer', fontFamily: mono, fontWeight: 500, background: '#0057B8', color: '#fff', border: 'none' }}>Open →</button>
              <button onClick={() => onCancel(s.id)} disabled={cancelling === s.id} style={{ padding: '8px 16px', borderRadius: 6, fontSize: 12, cursor: 'pointer', fontFamily: mono, fontWeight: 500, background: '#FEF2F2', color: '#B81A1A', border: '1px solid #FECACA', opacity: cancelling === s.id ? 0.5 : 1 }}>{cancelling === s.id ? 'Cancelling...' : 'Cancel'}</button>
            </>
          )}
          {(s.status === 'submitted' || s.status === 'received') && (
            <>
              <button onClick={() => onOpen(s.id)} style={{ padding: '8px 16px', borderRadius: 6, fontSize: 12, cursor: 'pointer', fontFamily: mono, fontWeight: 500, background: '#F5F5F3', color: '#444', border: '1px solid #E2E2DC' }}>View →</button>
              <button onClick={() => onReport(s.id)} style={{ padding: '8px 16px', borderRadius: 6, fontSize: 12, cursor: 'pointer', fontFamily: mono, fontWeight: 500, background: '#EFF6FF', color: '#1E4D8C', border: '1px solid #BFDBFE' }}>Report →</button>
            </>
          )}
        </div>
      </div>
      {showNote && (
        <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid #F0F0EC' }}>
          <div style={{ fontFamily: mono, fontSize: 10, letterSpacing: '0.1em', color: '#A0A0A0', marginBottom: 8, textTransform: 'uppercase' }}>
            {canEditNote ? 'Note to SC (editable for 12h after submission)' : 'Note to SC'}
          </div>
          {canEditNote ? (
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
              <textarea value={noteValue} onChange={e => onNoteChange(s.id, e.target.value)} placeholder="e.g. Item 48894 scanned but forgot to pack" rows={2}
                style={{ flex: 1, background: '#FAFAFA', border: '1px solid #E2E2DC', borderRadius: 6, color: '#1A1A1A', fontSize: 12, fontFamily: mono, padding: '8px 12px', resize: 'vertical', outline: 'none' }} />
              <button onClick={() => onSaveNote(s.id)} disabled={savingNote === s.id} style={{ padding: '8px 16px', borderRadius: 6, fontSize: 11, cursor: 'pointer', fontFamily: mono, whiteSpace: 'nowrap', fontWeight: 500, background: savedNote === s.id ? '#F0FDF4' : '#F5F5F3', color: savedNote === s.id ? '#166534' : '#444', border: `1px solid ${savedNote === s.id ? '#BBF7D0' : '#E2E2DC'}` }}>
                {savingNote === s.id ? 'Saving...' : savedNote === s.id ? '✓ Saved' : 'Save note'}
              </button>
            </div>
          ) : (
            <div style={{ fontSize: 12, fontFamily: mono, color: s.notes ? '#555' : '#C0C0BA', fontStyle: s.notes ? 'normal' : 'italic' }}>
              {s.notes || 'No note left'}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function MarylandDashboard() {
  const router = useRouter()
  const [shipments, setShipments] = useState<Shipment[]>([])
  const [loading, setLoading] = useState(true)
  const [cancelling, setCancelling] = useState<string | null>(null)
  const [noteValues, setNoteValues] = useState<Record<string, string>>({})
  const [savingNote, setSavingNote] = useState<string | null>(null)
  const [savedNote, setSavedNote] = useState<string | null>(null)
  const mono = "var(--font-dm-mono), 'DM Mono', monospace"
  const syne = "var(--font-syne), 'Syne', sans-serif"

  async function loadShipments() {
    const supabase = createClient()
    const { data, error } = await supabase.from('shipments').select('id, created_at, status, submitted_at, notes').order('created_at', { ascending: false })
    if (error || !data) { setLoading(false); return }
    const withCounts = await Promise.all(data.map(async (s) => {
      const { count } = await supabase.from('manifest_items').select('*', { count: 'exact', head: true }).eq('shipment_id', s.id)
      return { ...s, item_count: count ?? 0 }
    }))
    setShipments(withCounts)
    const notes: Record<string, string> = {}
    withCounts.forEach(s => { notes[s.id] = s.notes ?? '' })
    setNoteValues(notes)
    setLoading(false)
  }

  useEffect(() => { loadShipments() }, [])

  async function handleCancel(id: string) {
    if (!confirm('Cancel this shipment? This cannot be undone.')) return
    setCancelling(id)
    const supabase = createClient()
    await supabase.from('shipments').update({ status: 'cancelled' }).eq('id', id)
    await loadShipments()
    setCancelling(null)
  }

  async function handleSaveNote(id: string) {
    setSavingNote(id)
    const supabase = createClient()
    await supabase.from('shipments').update({ notes: noteValues[id] ?? '' }).eq('id', id)
    setSavingNote(null)
    setSavedNote(id)
    setTimeout(() => setSavedNote(null), 2000)
  }

  async function handleLogout() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/')
  }

  const active = shipments.filter(s => s.status === 'active')
  const past = shipments.filter(s => s.status !== 'active')
  const submitted = shipments.filter(s => s.status === 'submitted').length
  const received = shipments.filter(s => s.status === 'received').length

  return (
    <div style={{ minHeight: '100vh', background: '#F5F5F3', fontFamily: mono }}>
      <div style={{ background: '#1A1A1A', borderBottom: '1px solid #2A2A2A', padding: '0 32px', height: '56px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'sticky', top: 0, zIndex: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <span style={{ fontFamily: syne, fontWeight: 800, fontSize: 16, color: '#fff' }}>Shipment Scanner</span>
          <span style={{ width: 1, height: 16, background: '#333' }} />
          <span style={{ fontSize: 11, color: '#555', letterSpacing: '0.1em', textTransform: 'uppercase' }}>Maryland · Sender</span>
        </div>
        <button onClick={handleLogout} style={{ background: 'transparent', color: '#666', border: '1px solid #333', padding: '6px 16px', borderRadius: 6, fontSize: 12, fontFamily: mono, cursor: 'pointer' }}>Log out</button>
      </div>

      <div style={{ maxWidth: 860, margin: '0 auto', padding: '40px 24px 80px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 32 }}>
          <div>
            <h1 style={{ fontFamily: syne, fontWeight: 700, fontSize: 28, color: '#1A1A1A', margin: 0 }}>Maryland</h1>
            <p style={{ color: '#888', fontSize: 13, marginTop: 4, fontFamily: mono }}>Sender dashboard</p>
          </div>
          <button onClick={() => router.push('/shipment/new')} style={{ background: '#0057B8', color: '#fff', border: 'none', padding: '12px 24px', borderRadius: 8, fontFamily: syne, fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>+ New Shipment</button>
        </div>

        {!loading && shipments.length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 32 }}>
            {[
              { label: 'Active', value: active.length, color: '#92661A', bg: '#FEF3C7', border: '#FDE68A' },
              { label: 'Awaiting SC', value: submitted, color: '#1E4D8C', bg: '#EFF6FF', border: '#BFDBFE' },
              { label: 'Received', value: received, color: '#166534', bg: '#F0FDF4', border: '#BBF7D0' },
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
              <div style={{ fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#A0A0A0', marginBottom: 12, fontFamily: mono }}>Active Shipments ({active.length})</div>
              {active.length === 0 ? (
                <div style={{ background: '#fff', border: '1px solid #E2E2DC', borderRadius: 10, padding: '32px 24px', textAlign: 'center', color: '#A0A0A0', fontSize: 13, fontFamily: mono }}>No active shipments — start one with the button above.</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {active.map(s => (
                    <ShipmentCard key={s.id} s={s} cancelling={cancelling} savingNote={savingNote} savedNote={savedNote}
                      noteValue={noteValues[s.id] ?? ''} onNoteChange={(id, val) => setNoteValues(prev => ({ ...prev, [id]: val }))}
                      onSaveNote={handleSaveNote} onCancel={handleCancel}
                      onOpen={id => router.push(`/shipment/${id}`)} onReport={id => router.push(`/shipment/${id}/report`)} />
                  ))}
                </div>
              )}
            </div>
            {past.length > 0 && (
              <div>
                <div style={{ fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#A0A0A0', marginBottom: 12, fontFamily: mono }}>Past Shipments ({past.length})</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {past.map(s => (
                    <ShipmentCard key={s.id} s={s} cancelling={cancelling} savingNote={savingNote} savedNote={savedNote}
                      noteValue={noteValues[s.id] ?? ''} onNoteChange={(id, val) => setNoteValues(prev => ({ ...prev, [id]: val }))}
                      onSaveNote={handleSaveNote} onCancel={handleCancel}
                      onOpen={id => router.push(`/shipment/${id}`)} onReport={id => router.push(`/shipment/${id}/report`)} />
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
