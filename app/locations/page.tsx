'use client'

import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import * as XLSX from 'xlsx'
import { createClient } from '@/lib/supabase'

interface LocationRow {
    item_number: string
    location: string
}

export default function LocationsPage() {
    const router = useRouter()
    const fileInputRef = useRef<HTMLInputElement>(null)
    const [parsed, setParsed] = useState<LocationRow[] | null>(null)
    const [fileName, setFileName] = useState('')
    const [error, setError] = useState('')
    const [dragOver, setDragOver] = useState(false)
    const [saving, setSaving] = useState(false)
    const [savedMsg, setSavedMsg] = useState('')
    const [dashboardPath, setDashboardPath] = useState('/dashboard/maryland')

    useEffect(() => {
        async function loadRole() {
            const supabase = createClient()
            const { data: { user } } = await supabase.auth.getUser()
            if (!user) { router.push('/'); return }
            const { data: roleData } = await supabase
                .from('user_roles').select('role').eq('email', user.email).single()
            if (roleData?.role === 'southcarolina') setDashboardPath('/dashboard/southcarolina')
        }
        loadRole()
    }, [router])

    const mono = "var(--font-dm-mono), 'DM Mono', monospace"
    const syne = "var(--font-syne), 'Syne', sans-serif"

    function findColumn(headers: string[], variants: string[]): number {
        return headers.findIndex(h => variants.some(v => h.trim().toLowerCase().includes(v)))
    }

    function processFile(file: File) {
        setError('')
        setParsed(null)
        if (!file.name.toLowerCase().endsWith('.xlsx')) {
            setError('Invalid file type. Please upload a .xlsx Excel file.')
            return
        }
        setFileName(file.name)
        const reader = new FileReader()
        reader.onload = (evt) => {
            try {
                const data = new Uint8Array(evt.target?.result as ArrayBuffer)
                const workbook = XLSX.read(data, { type: 'array' })
                const sheet = workbook.Sheets[workbook.SheetNames[0]]
                const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1 })
                if (rows.length < 2) { setError('The file appears to be empty or has no data rows.'); return }

                const headers = rows[0].map(h => String(h ?? ''))
                const binCol = findColumn(headers, ['bin'])
                const itemCol = findColumn(headers, ['item no', 'item number', 'item_no', 'itemno'])
                if (binCol === -1) { setError('Could not find a "Bin Code" column.'); return }
                if (itemCol === -1) { setError('Could not find an "Item No." column.'); return }

                const map = new Map<string, LocationRow>()
                for (let i = 1; i < rows.length; i++) {
                    const row = rows[i]
                    if (!row || row.every(c => c === undefined || c === null || String(c).trim() === '')) continue
                    const item = String(row[itemCol] ?? '').trim()
                    const bin = String(row[binCol] ?? '').trim()
                    if (!item || !bin) continue
                    map.set(`${item}|${bin}`, { item_number: item, location: bin })
                }

                const result = Array.from(map.values())
                if (result.length === 0) { setError('No valid rows found. Each row needs a Bin Code and an Item No.'); return }
                setParsed(result)
            } catch { setError('Could not read the file. Make sure it is a valid .xlsx Excel file.') }
        }
        reader.readAsArrayBuffer(file)
    }

    function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
        const file = e.target.files?.[0]
        if (file) processFile(file)
    }

    function handleDrop(e: React.DragEvent) {
        e.preventDefault()
        setDragOver(false)
        const file = e.dataTransfer.files?.[0]
        if (file) processFile(file)
    }
    async function handleSave() {
        if (!parsed) return
        setSaving(true)
        setError('')
        const supabase = createClient()

        const { data: { user } } = await supabase.auth.getUser()
        if (!user) { setError('You must be logged in.'); setSaving(false); return }

        const { data: roleData } = await supabase
            .from('user_roles').select('role').eq('email', user.email).single()
        if (!roleData) { setError('No role found for this account.'); setSaving(false); return }
        const site = roleData.role

        // Replace this site's old bins with the new sheet
        const { error: delError } = await supabase.from('part_locations').delete().eq('site', site)
        if (delError) { setError('Could not clear the old locations. Nothing was changed.'); setSaving(false); return }

        const rows = parsed.map(r => ({ site, item_number: r.item_number, location: r.location }))
        for (let i = 0; i < rows.length; i += 500) {
            const { error: insError } = await supabase.from('part_locations').insert(rows.slice(i, i + 500))
            if (insError) {
                setError('Save failed partway. Please upload the file again to fix it.')
                setSaving(false)
                return
            }
        }

        setSavedMsg(`Saved ${rows.length} bin rows for ${site === 'maryland' ? 'Maryland' : 'South Carolina'}.`)
        setParsed(null)
        setFileName('')
        if (fileInputRef.current) fileInputRef.current.value = ''
        setSaving(false)
    }
    const uniqueParts = parsed ? new Set(parsed.map(r => r.item_number)).size : 0
    const multiBinParts = parsed
        ? (() => {
            const counts = new Map<string, number>()
            parsed.forEach(r => counts.set(r.item_number, (counts.get(r.item_number) ?? 0) + 1))
            return Array.from(counts.values()).filter(c => c > 1).length
        })()
        : 0

    return (
        <div style={{ minHeight: '100vh', background: '#F5F5F3', fontFamily: mono }}>

            {/* Nav */}
            <div style={{ background: '#1A1A1A', borderBottom: '1px solid #2A2A2A', padding: '0 32px', height: '56px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'sticky', top: 0, zIndex: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                    <span style={{ fontFamily: syne, fontWeight: 800, fontSize: 16, color: '#fff' }}>Shipment Scanner</span>
                    <span style={{ width: 1, height: 16, background: '#333' }} />
                    <span style={{ fontSize: 11, color: '#555', letterSpacing: '0.1em', textTransform: 'uppercase' }}>Part Locations</span>
                </div>
                <button onClick={() => router.back()} style={{ background: 'transparent', color: '#666', border: '1px solid #333', padding: '6px 16px', borderRadius: 6, fontSize: 12, fontFamily: mono, cursor: 'pointer' }}>← Dashboard</button>
            </div>

            <div style={{ maxWidth: 860, margin: '0 auto', padding: '40px 24px 80px' }}>

                <div style={{ marginBottom: 36 }}>
                    <h1 style={{ fontFamily: syne, fontWeight: 700, fontSize: 28, color: '#1A1A1A', margin: 0 }}>Part Locations</h1>
                    <p style={{ color: '#888', fontSize: 13, marginTop: 6 }}>
                        Upload your bin sheet. Columns: Bin Code and Item No. A part can appear on several rows.
                    </p>
                </div>

                {error && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, fontSize: 13, color: '#B81A1A', marginBottom: 24 }}>
                        <span>⚠</span><span>{error}</span>
                    </div>
                )}
                {savedMsg && (
                    <div style={{ padding: '12px 16px', background: '#F0FDF4', border: '1px solid #BBF7D0', borderRadius: 8, fontSize: 13, color: '#166534', marginBottom: 24 }}>
                        ✓ {savedMsg}
                    </div>
                )}

                {!parsed && (
                    <div
                        onClick={() => fileInputRef.current?.click()}
                        onDragOver={e => { e.preventDefault(); setDragOver(true) }}
                        onDragLeave={() => setDragOver(false)}
                        onDrop={handleDrop}
                        style={{
                            border: `2px dashed ${dragOver ? '#0057B8' : '#D8D8D2'}`,
                            borderRadius: 12, padding: '60px 40px', textAlign: 'center', cursor: 'pointer',
                            background: dragOver ? '#EFF6FF' : '#FFFFFF', transition: 'all 0.15s',
                        }}
                    >
                        <div style={{ fontSize: 40, marginBottom: 16 }}>📂</div>
                        <div style={{ fontFamily: syne, fontWeight: 700, fontSize: 18, color: '#1A1A1A', marginBottom: 8 }}>Click to select Excel file</div>
                        <div style={{ fontSize: 12, color: '#A0A0A0' }}>or drag and drop here · .xlsx files only · header row required</div>
                        <div style={{ marginTop: 20, display: 'inline-block', padding: '10px 24px', background: '#0057B8', color: '#fff', borderRadius: 6, fontSize: 13, fontFamily: syne, fontWeight: 700 }}>Browse files</div>
                        <input ref={fileInputRef} type="file" accept=".xlsx" onChange={handleFile} style={{ display: 'none' }} />
                    </div>
                )}

                {parsed && (
                    <>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, padding: '14px 20px', background: '#fff', border: '1px solid #E2E2DC', borderRadius: 10 }}>
                            <div>
                                <div style={{ fontFamily: syne, fontWeight: 700, fontSize: 15, color: '#1A1A1A' }}>{fileName}</div>
                                <div style={{ fontSize: 12, color: '#0057B8', marginTop: 3 }}>
                                    {parsed.length} bin rows · {uniqueParts} parts · {multiBinParts} parts with multiple bins
                                </div>
                            </div>
                            <button
                                onClick={() => { setParsed(null); setFileName(''); setError(''); if (fileInputRef.current) fileInputRef.current.value = '' }}
                                style={{ padding: '8px 16px', background: '#F5F5F3', color: '#555', border: '1px solid #E2E2DC', borderRadius: 6, fontSize: 12, fontFamily: mono, cursor: 'pointer' }}
                            >
                                Change file
                            </button>
                        </div>

                        <div style={{ background: '#fff', border: '1px solid #E2E2DC', borderRadius: 10, overflow: 'hidden', marginBottom: 24 }}>
                            <div style={{ maxHeight: 440, overflowY: 'auto' }}>
                                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                    <thead>
                                        <tr style={{ background: '#F5F5F3', borderBottom: '1px solid #E2E2DC', position: 'sticky', top: 0 }}>
                                            {['#', 'Item No.', 'Bin Code'].map(h => (
                                                <th key={h} style={{ padding: '10px 16px', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#888', fontWeight: 500, textAlign: 'left' }}>{h}</th>
                                            ))}
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {parsed.map((r, i) => (
                                            <tr key={i} style={{ borderBottom: '1px solid #F0F0EC' }}>
                                                <td style={{ padding: '11px 16px', fontSize: 11, color: '#C0C0BA' }}>{i + 1}</td>
                                                <td style={{ padding: '11px 16px', fontSize: 13, color: '#1A1A1A', fontWeight: 500 }}>{r.item_number}</td>
                                                <td style={{ padding: '11px 16px', fontSize: 13, color: '#0057B8', fontWeight: 600 }}>{r.location}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>

                        <div style={{ display: 'flex', gap: 12 }}>
                            <button
                                onClick={handleSave}
                                disabled={saving}
                                style={{ padding: '13px 28px', background: saving ? '#A0C4F0' : '#0057B8', color: '#fff', border: 'none', borderRadius: 8, fontFamily: syne, fontWeight: 700, fontSize: 14, cursor: saving ? 'not-allowed' : 'pointer' }}
                            >
                                {saving ? 'Saving...' : 'Save Locations →'}
                            </button>
                            <button
                                onClick={() => router.back()}
                                style={{ padding: '13px 24px', background: '#fff', color: '#555', border: '1px solid #E2E2DC', borderRadius: 8, fontFamily: syne, fontWeight: 600, fontSize: 14, cursor: 'pointer' }}
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