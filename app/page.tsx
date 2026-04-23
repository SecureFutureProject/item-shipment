'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleLogin() {
    setLoading(true)
    setError('')
    const supabase = createClient()
    const { data, error: authError } = await supabase.auth.signInWithPassword({ email, password })
    if (authError || !data.user) { setError('Invalid email or password.'); setLoading(false); return }
    const { data: roleData } = await supabase.from('user_roles').select('role').eq('email', data.user.email).single()
    if (!roleData) { setError('No role found for this account.'); setLoading(false); return }
    if (roleData.role === 'maryland') { router.push('/dashboard/maryland') } else { router.push('/dashboard/southcarolina') }
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', background: '#F5F5F3', fontFamily: "var(--font-dm-mono), 'DM Mono', monospace" }}>
      <div style={{ width: '420px', flexShrink: 0, background: '#1A1A1A', padding: '52px 48px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', position: 'relative', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', inset: 0, opacity: 0.055, backgroundImage: 'linear-gradient(#ffffff 1px, transparent 1px), linear-gradient(90deg, #ffffff 1px, transparent 1px)', backgroundSize: '32px 32px', pointerEvents: 'none' }} />
        <div style={{ position: 'relative', zIndex: 1 }}>
          <div style={{ fontFamily: "var(--font-syne), 'Syne', sans-serif", fontWeight: 800, fontSize: '26px', color: '#FFFFFF', letterSpacing: '-0.02em', lineHeight: 1.15 }}>Shipment<br />Scanner</div>
          <div style={{ fontSize: '10px', color: '#555', letterSpacing: '0.13em', textTransform: 'uppercase', marginTop: '8px' }}>Created by item for item</div>
        </div>
        <div style={{ position: 'relative', zIndex: 1 }}>
          <div style={{ width: '32px', height: '3px', background: '#0057B8', borderRadius: '2px', marginBottom: '18px' }} />
          <div style={{ fontSize: '10px', color: '#555', letterSpacing: '0.13em', textTransform: 'uppercase', marginBottom: '10px' }}>Internal Tool</div>
          <div style={{ fontFamily: "var(--font-syne), 'Syne', sans-serif", fontWeight: 700, fontSize: '20px', color: '#E8E8E8', lineHeight: 1.35 }}>Shipment<br />Verification<br />System</div>
          <div style={{ fontSize: '11px', color: '#444', lineHeight: 1.8, marginTop: '14px' }}>Maryland ↔ South Carolina<br />Biweekly shipment tracking<br />Barcode scan · Manifest match</div>
        </div>
      </div>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '52px 72px', background: '#FAFAFA' }}>
        <div style={{ marginBottom: '36px' }}>
          <div style={{ fontFamily: "var(--font-syne), 'Syne', sans-serif", fontWeight: 700, fontSize: '24px', color: '#1A1A1A', marginBottom: '6px' }}>Sign in</div>
          <div style={{ fontSize: '12px', color: '#888', letterSpacing: '0.04em' }}>Use your department credentials</div>
        </div>
        <div style={{ marginBottom: '22px' }}>
          <label style={{ display: 'block', fontSize: '10px', fontWeight: 500, letterSpacing: '0.13em', textTransform: 'uppercase', color: '#6B6B6B', marginBottom: '8px' }}>Email address</label>
          <input type="email" placeholder="maryland@item24.us" value={email} onChange={e => setEmail(e.target.value)} autoComplete="email"
            style={{ display: 'block', width: '100%', maxWidth: '400px', padding: '12px 14px', fontFamily: "var(--font-dm-mono), 'DM Mono', monospace", fontSize: '13px', color: '#1A1A1A', background: '#FFFFFF', border: '1px solid #D8D8D2', borderRadius: '6px', outline: 'none', boxSizing: 'border-box' }}
            onFocus={e => { e.target.style.borderColor = '#0057B8'; e.target.style.boxShadow = '0 0 0 3px rgba(0,87,184,0.08)' }}
            onBlur={e => { e.target.style.borderColor = '#D8D8D2'; e.target.style.boxShadow = 'none' }} />
        </div>
        <div style={{ marginBottom: '8px' }}>
          <label style={{ display: 'block', fontSize: '10px', fontWeight: 500, letterSpacing: '0.13em', textTransform: 'uppercase', color: '#6B6B6B', marginBottom: '8px' }}>Password</label>
          <input type="password" placeholder="••••••••••" value={password} onChange={e => setPassword(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleLogin()} autoComplete="current-password"
            style={{ display: 'block', width: '100%', maxWidth: '400px', padding: '12px 14px', fontFamily: "var(--font-dm-mono), 'DM Mono', monospace", fontSize: '13px', color: '#1A1A1A', background: '#FFFFFF', border: '1px solid #D8D8D2', borderRadius: '6px', outline: 'none', boxSizing: 'border-box' }}
            onFocus={e => { e.target.style.borderColor = '#0057B8'; e.target.style.boxShadow = '0 0 0 3px rgba(0,87,184,0.08)' }}
            onBlur={e => { e.target.style.borderColor = '#D8D8D2'; e.target.style.boxShadow = 'none' }} />
        </div>
        {error && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 14px', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: '6px', fontSize: '12px', color: '#B81A1A', marginTop: '16px', maxWidth: '400px' }}>
            <span>⚠</span><span>{error}</span>
          </div>
        )}
        <button onClick={handleLogin} disabled={loading}
          style={{ display: 'block', width: '100%', maxWidth: '400px', padding: '13px 20px', background: loading ? '#5B8FD4' : '#0057B8', color: '#FFFFFF', fontFamily: "var(--font-syne), 'Syne', sans-serif", fontWeight: 700, fontSize: '14px', letterSpacing: '0.02em', border: 'none', borderRadius: '6px', cursor: loading ? 'not-allowed' : 'pointer', marginTop: '20px', opacity: loading ? 0.75 : 1 }}>
          {loading ? 'Signing in...' : 'Sign in →'}
        </button>
        <div style={{ marginTop: '36px', paddingTop: '24px', borderTop: '1px solid #E8E8E2', display: 'flex', alignItems: 'center', gap: '8px', maxWidth: '400px' }}>
          <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#4CAF82', flexShrink: 0 }} />
          <div style={{ fontSize: '10px', color: '#A8A8A0', letterSpacing: '0.06em' }}>Secure · Internal use only · item Industrial Applications</div>
        </div>
      </div>
    </div>
  )
}
