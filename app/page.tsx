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

    const { data, error: authError } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    if (authError || !data.user) {
      setError('Invalid email or password.')
      setLoading(false)
      return
    }

    const { data: roleData } = await supabase
      .from('user_roles')
      .select('role')
      .eq('email', data.user.email)
      .single()

    if (!roleData) {
      setError('No role found for this account.')
      setLoading(false)
      return
    }

    if (roleData.role === 'maryland') {
      router.push('/dashboard/maryland')
    } else {
      router.push('/dashboard/southcarolina')
    }
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#f5f5f5', fontFamily: 'sans-serif' }}>
      <div style={{ backgroundColor: 'white', padding: '40px', borderRadius: '8px', boxShadow: '0 2px 8px rgba(0,0,0,0.1)', width: '360px' }}>
        <h1 style={{ marginBottom: '8px', fontSize: '22px' }}>item Shipment</h1>
        <p style={{ marginBottom: '24px', color: '#666', fontSize: '14px' }}>Sign in to your department account</p>

        <label style={{ fontSize: '13px', fontWeight: 600 }}>Email</label>
        <input
          type="email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          style={{ display: 'block', width: '100%', marginTop: '4px', marginBottom: '16px', padding: '10px', border: '1px solid #ddd', borderRadius: '4px', fontSize: '14px', boxSizing: 'border-box' }}
        />

        <label style={{ fontSize: '13px', fontWeight: 600 }}>Password</label>
        <input
          type="password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleLogin()}
          style={{ display: 'block', width: '100%', marginTop: '4px', marginBottom: '24px', padding: '10px', border: '1px solid #ddd', borderRadius: '4px', fontSize: '14px', boxSizing: 'border-box' }}
        />

        {error && <p style={{ color: 'red', fontSize: '13px', marginBottom: '16px' }}>{error}</p>}

        <button
          onClick={handleLogin}
          disabled={loading}
          style={{ width: '100%', padding: '12px', backgroundColor: '#1a1a1a', color: 'white', border: 'none', borderRadius: '4px', fontSize: '15px', cursor: 'pointer' }}
        >
          {loading ? 'Signing in...' : 'Sign In'}
        </button>
      </div>
    </div>
  )
}
