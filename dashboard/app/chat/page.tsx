"use client"
import { useState } from 'react'
import { Input } from '@/components/ui/Input'
import { Textarea } from '@/components/ui/Textarea'
import { Button } from '@/components/ui/Button'
import { ragCredits } from '@/lib/api'

export default function ChatPage() {
  const [baseUrl, setBaseUrl] = useState('http://localhost:8080')
  const [token, setToken] = useState('')
  const [orgId, setOrgId] = useState('')
  const [profile, setProfile] = useState('{"industry":"saas","revenue":500000}')
  const [answer, setAnswer] = useState<any[]>([])
  const [loading, setLoading] = useState(false)

  async function ask() {
    setLoading(true)
    try {
      const prof = JSON.parse(profile)
      const res = await ragCredits({ baseUrl, token }, { profile: prof })
      setAnswer(res)
    } catch (e) {
      setAnswer([{ name: 'Erreur', explanation: String(e) } as any])
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <Input placeholder="Gateway URL" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
        <Input placeholder="JWT" value={token} onChange={(e) => setToken(e.target.value)} />
        <Input placeholder="Org ID (optionnel)" value={orgId} onChange={(e) => setOrgId(e.target.value)} />
      </div>
      <div className="space-y-2">
        <label className="text-sm font-medium">Profil (JSON)</label>
        <Textarea value={profile} onChange={(e) => setProfile(e.target.value)} />
        <Button onClick={ask} disabled={loading}>{loading ? '...' : 'Demander'}</Button>
      </div>
      <div className="space-y-2">
        <h2 className="text-lg font-semibold">Réponse</h2>
        <pre className="text-xs bg-neutral-100 p-3 rounded-md whitespace-pre-wrap">{JSON.stringify(answer, null, 2)}</pre>
      </div>
    </div>
  )
}
