'use client'

import { useEffect, useState } from 'react'
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

function statusColor(status: string) {
  if (status === 'active') return '#c8a96e'
  if (status === 'cancelled') return '#555'
  if (status === 'submitted') return '#6ec8a9'
  if (status === 'received') return '#6e9ec8'
  return '#888'
}

function isWithin12Hours(submittedAt: string | null): boolean {
  if (!submittedAt) return false
  const submitted = new Date(submittedAt).getTime()
  return Date.now() - submitted < 12 * 60 * 60 * 1000
}

function hoursRemaining(submittedAt: string): number {
  const submitted = new Date(submittedAt).getTime()
  return Math.max(0, Math.ceil((12 * 60 * 60 * 1000 - (Date.now() - submitted)) / 3600000))
}

interface ShipmentCardProps {
  s: Shipment
  cancelling: string | null
  savingNote: string | null
  savedNote: string | null
  noteValue: string
  onNoteChange: (id: string, val: string) => void
  onSaveNote: (id: string) => void
  onCancel: (id: string) => void
  onOpen: (id: string) => void
}

function ShipmentCard({
  s, cancelling, savingNote, savedNote,
  noteValue, onNoteChange, onSaveNote, onCancel, onOpen,
}: ShipmentCardProps) {
  const canEditNote = s.status === 'submitted' && isWithin12Hours(s.submitted_at)
  const showNote = s.status === 'submitted' || s.status === 'received'

  return (
    <div style={{
      border: '1px solid #222',
      borderRadius: 8,
      padding: '18px 20px',
      transition: 'border-color 0.2s',
    }}>
      {/* Top row */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 16,
        cursor: s.status === 'active' ? 'pointer' : 'default',
      }}
        onClick={() => { if (s.status === 'active') onOpen(s.id) }}
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
              textTransform: 'uppercase' as const,
              color: statusColor(s.status),
              background: `${statusColor(s.status)}18`,
            }}>
              {s.status === 'submitted' ? 'SUBMITTED — AWAITING SC' : s.status}
            </span>
          </div>
          <div style={{ color: '#555', fontSize: 12 }}>
            {s.item_count} line items
            {s.submitted_at && s.status === 'submitted' && isWithin12Hours(s.submitted_at) && (
              <span style={{ color: '#444', marginLeft: 10, fontSize: 11 }}>
                · note editable for {hoursRemaining(s.submitted_at)}h
              </span>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
          {s.status === 'active' && (
            <>
              <button
                onClick={e => { e.stopPropagation(); onOpen(s.id) }}
                style={{
                  background: 'transparent', border: '1px solid #333',
                  color: '#c8a96e', padding: '8px 16px', borderRadius: 6,
                  fontSize: 12, cursor: 'pointer',
                  fontFamily: 'var(--font-dm-mono), monospace',
                }}
              >
                Open →
              </button>
              <button
                onClick={e => { e.stopPropagation(); onCancel(s.id) }}
                disabled={cancelling === s.id}
                style={{
                  background: 'transparent', border: '1px solid #2a1a1a',
                  color: '#664444', padding: '8px 16px', borderRadius: 6,
                  fontSize: 12, cursor: 'pointer',
                  fontFamily: 'var(--font-dm-mono), monospace',
                  opacity: cancelling === s.id ? 0.5 : 1,
                }}
              >
                {cancelling === s.id ? 'Cancelling...' : 'Cancel'}
              </button>
            </>
          )}
          {s.status === 'submitted' && (
            <button
              onClick={() => onOpen(s.id)}
              style={{
                background: 'transparent', border: '1px solid #333',
                color: '#6ec8a9', padding: '8px 16px', borderRadius: 6,
                fontSize: 12, cursor: 'pointer',
                fontFamily: 'var(--font-dm-mono), monospace',
              }}
            >
              View →
            </button>
          )}
        </div>
      </div>

      {/* Note field */}
      {showNote && (
        <div style={{ marginTop: 14, borderTop: '1px solid #1a1a1a', paddingTop: 14 }}>
          <div style={{
            fontSize: 10, letterSpacing: '0.08em', color: '#444', marginBottom: 8,
            fontFamily: 'var(--font-dm-mono), monospace',
          }}>
            {canEditNote ? 'NOTE TO SC (editable for 12h after submission)' : 'NOTE TO SC'}
          </div>
          {canEditNote ? (
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
              <textarea
                value={noteValue}
                onChange={e => onNoteChange(s.id, e.target.value)}
                placeholder="e.g. Item 48894 scanned but forgot to pack — do not look for it"
                rows={2}
                style={{
                  flex: 1, background: '#0a0a0a', border: '1px solid #2a2a2a',
                  borderRadius: 5, color: '#ccc', fontSize: 12,
                  fontFamily: 'var(--font-dm-mono), monospace',
                  padding: '8px 12px', resize: 'vertical' as const, outline: 'none',
                }}
              />
              <button
                onClick={() => onSaveNote(s.id)}
                disabled={savingNote === s.id}
                style={{
                  background: savedNote === s.id ? '#0f2d1a' : '#1a1a1a',
                  border: `1px solid ${savedNote === s.id ? '#4ade8050' : '#2a2a2a'}`,
                  color: savedNote === s.id ? '#4ade80' : '#888',
                  padding: '8px 16px', borderRadius: 5, fontSize: 11,
                  cursor: savingNote === s.id ? 'default' : 'pointer',
                  fontFamily: 'var(--font-dm-mono), monospace',
                  whiteSpace: 'nowrap' as const, letterSpacing: '0.05em',
                }}
              >
                {savingNote === s.id ? 'SAVING...' : savedNote === s.id ? '✓ SAVED' : 'SAVE NOTE'}
              </button>
            </div>
          ) : (
            <div style={{
              fontSize: 12, color: s.notes ? '#666' : '#333',
              fontFamily: 'var(--font-dm-mono), monospace',
              fontStyle: s.notes ? 'normal' : 'italic',
            }}>
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

  async function loadShipments() {
    const supabase = createClient()
    const { data, error } = await supabase
      .from('shipments')
      .select('id, created_at, status, submitted_at, notes')
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
  const completed = shipments.filter(s => s.status !== 'active')

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
              Maryland
            </h1>
            <p style={{ color: '#555', fontSize: 13, marginTop: 6 }}>Sender dashboard</p>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button
              onClick={() => router.push('/shipment/new')}
              style={{
                background: '#c8a96e', color: '#0f1117', border: 'none',
                padding: '12px 24px', fontFamily: 'var(--font-syne), sans-serif',
                fontWeight: 700, fontSize: 14, borderRadius: 6, cursor: 'pointer',
              }}
            >
              + New Shipment
            </button>
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
        </div>

        {loading && <div style={{ color: '#555', fontSize: 13 }}>Loading shipments...</div>}

        {!loading && (
          <>
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
                  {active.map(s => (
                    <ShipmentCard key={s.id} s={s}
                      cancelling={cancelling} savingNote={savingNote} savedNote={savedNote}
                      noteValue={noteValues[s.id] ?? ''}
                      onNoteChange={(id, val) => setNoteValues(prev => ({ ...prev, [id]: val }))}
                      onSaveNote={handleSaveNote}
                      onCancel={handleCancel}
                      onOpen={id => router.push(`/shipment/${id}`)}
                    />
                  ))}
                </div>
              )}
            </div>

            {completed.length > 0 && (
              <div>
                <div style={{ fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#555', marginBottom: 14 }}>
                  Past Shipments ({completed.length})
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {completed.map(s => (
                    <ShipmentCard key={s.id} s={s}
                      cancelling={cancelling} savingNote={savingNote} savedNote={savedNote}
                      noteValue={noteValues[s.id] ?? ''}
                      onNoteChange={(id, val) => setNoteValues(prev => ({ ...prev, [id]: val }))}
                      onSaveNote={handleSaveNote}
                      onCancel={handleCancel}
                      onOpen={id => router.push(`/shipment/${id}`)}
                    />
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