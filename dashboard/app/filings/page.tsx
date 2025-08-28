"use client"
import { useEffect, useState } from 'react'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { listFilings, generateFiling, ragCredits } from '@/lib/api'

export default function FilingsPage() {
  const [baseUrl, setBaseUrl] = useState('http://localhost:8080')
  const [token, setToken] = useState('')
  const [orgId, setOrgId] = useState('')
  const [profile, setProfile] = useState('{"industry":"manufacturing","employees":42}')
  const [items, setItems] = useState<any[]>([])
  const [logs, setLogs] = useState('')

  async function refresh() {
    if (!token || !orgId) return
    try {
      const r = await listFilings({ baseUrl, token, orgId })
      setItems(r.filings || [])
    } catch (e: any) {
      setLogs((l) => l + `\nList error: ${e.message}`)
    }
  }

  useEffect(() => { refresh() }, [baseUrl, token, orgId])

  async function onGenerate() {
    try {
      const prof = JSON.parse(profile)
      // Ask RAG for credits suggestions
      const credits = await ragCredits({ baseUrl, token }, { profile: prof })
      const res = await generateFiling({ baseUrl, token, orgId }, { profile: prof, credits })
      setLogs((l) => l + `\nFiling: ${JSON.stringify(res)}`)
      await refresh()
    } catch (e: any) {
      setLogs((l) => l + `\nGenerate error: ${e.message}`)
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <Input placeholder="Gateway URL" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
        <Input placeholder="JWT" value={token} onChange={(e) => setToken(e.target.value)} />
        <Input placeholder="Org ID" value={orgId} onChange={(e) => setOrgId(e.target.value)} />
      </div>
      <div className="space-y-2">
        <label className="text-sm font-medium">Profil (JSON)</label>
        <textarea className="w-full border rounded-md p-2 text-sm" rows={6} value={profile} onChange={(e) => setProfile(e.target.value)} />
        <Button onClick={onGenerate}>Générer un PDF + Filing</Button>
      </div>
      <div className="space-y-3">
        <h2 className="text-lg font-semibold">Filings</h2>
        <ul className="text-sm space-y-2">
          {items.map((f: any) => (
            <li key={f.id} className="border rounded-md p-3 flex items-center justify-between">
              <div>
                <div className="font-medium">{f.reference}</div>
                <div className="text-xs text-neutral-500">{f.status}</div>
              </div>
              {/* Download via File list if you store URLs there; placeholder button */}
              <a className="text-sm underline" href="#" onClick={(e) => e.preventDefault()}>Download</a>
            </li>
          ))}
        </ul>
      </div>
      <pre className="text-xs bg-neutral-100 p-3 rounded-md whitespace-pre-wrap">{logs}</pre>
    </div>
  )
}
