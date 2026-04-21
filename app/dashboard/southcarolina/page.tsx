'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'

export default function SouthCarolinaDashboard() {
  const router = useRouter()
  const [checking, setChecking] = useState(true)

  useEffect(() => {
    async function checkAuth() {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/'); return }

      const { data: roleData } = await supabase
        .from('user_roles')
        .select('role')
        .eq('email', user.email)
        .single()

      if (!roleData || roleData.role !== 'southcarolina') { router.push('/'); return }
      setChecking(false)
    }
    checkAuth()
  }, [router])

  async function handleSignOut() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/')
  }

  if (checking) return <div style={{ padding: '40px', fontFamily: 'sans-serif' }}>Loading...</div>

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#f5f5f5', fontFamily: 'sans-serif' }}>
      <div style={{ backgroundColor: 'white', padding: '16px 32px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 style={{ fontSize: '18px', margin: 0 }}>item Shipment — South Carolina</h1>
        <button onClick={handleSignOut} style={{ fontSize: '13px', color: '#666', background: 'none', border: 'none', cursor: 'pointer' }}>Sign out</button>
      </div>
      <div style={{ padding: '40px 32px' }}>
        <h2 style={{ margin: '0 0 24px 0', fontSize: '20px' }}>Incoming Shipments</h2>
        <div style={{ backgroundColor: 'white', borderRadius: '8px', padding: '40px', textAlign: 'center', color: '#999', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
          No incoming shipments yet.
        </div>
      </div>
    </div>
  )
}
