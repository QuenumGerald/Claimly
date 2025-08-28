"use client"
import { useEffect, useState } from 'react'
import { Card, CardTitle } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { listCredits } from '@/lib/api'

export default function CreditsPage() {
  const [items, setItems] = useState<any[]>([])
  const [baseUrl, setBaseUrl] = useState('http://localhost:8080')
  const [token, setToken] = useState('')
  const [orgId, setOrgId] = useState('')

  useEffect(() => {
    if (!token || !orgId) return
    listCredits({ baseUrl, token, orgId }).then((r) => {
      const entries = r.entries || []
      setItems(entries)
    }).catch(console.error)
  }, [baseUrl, token, orgId])

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <Input placeholder="Gateway URL" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
        <Input placeholder="JWT" value={token} onChange={(e) => setToken(e.target.value)} />
        <Input placeholder="Org ID" value={orgId} onChange={(e) => setOrgId(e.target.value)} />
      </div>
      <div className="grid gap-3">
        {items.map((c, i) => (
          <Card key={i}>
            <CardTitle>Crédit</CardTitle>
            <div className="text-sm">Montant: {c.amount}</div>
            <div className="text-sm">Raison: {c.reason || '-'}</div>
            <div className="text-xs text-neutral-500">ID: {c.id}</div>
          </Card>
        ))}
      </div>
    </div>
  )
}
