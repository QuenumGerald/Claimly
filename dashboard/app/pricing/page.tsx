"use client"
import { useEffect, useState } from 'react'
import { Card, CardTitle } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'

type Variant = {
  id: number
  attributes?: { name?: string; price?: number }
}

export default function PricingPage() {
  const [baseUrl, setBaseUrl] = useState('http://localhost:8080')
  const [token, setToken] = useState('')
  const [orgId, setOrgId] = useState('')
  const [plans, setPlans] = useState<Variant[]>([])
  const [active, setActive] = useState(false)

  useEffect(() => {
    fetch(`${baseUrl}/api/billing/plans`)
      .then((r) => r.json())
      .then((d) => setPlans(d))
      .catch(console.error)
  }, [baseUrl])

  useEffect(() => {
    if (!token || !orgId) {
      setActive(false)
      return
    }
    fetch(`${baseUrl}/api/billing/portal?orgId=${orgId}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => setActive(r.ok))
      .catch(() => setActive(false))
  }, [baseUrl, token, orgId])

  async function checkout(variantId: number) {
    const res = await fetch(`${baseUrl}/api/billing/checkout`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        variantId,
        orgId,
        customerEmail: '',
        successUrl: window.location.href,
        cancelUrl: window.location.href,
      }),
    })
    const data = await res.json()
    if (data.url) window.location.href = data.url
  }

  async function portal() {
    const res = await fetch(`${baseUrl}/api/billing/portal?orgId=${orgId}`, {
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    })
    const data = await res.json()
    if (data.url) window.location.href = data.url
  }

  const ORDER = ['Basic', 'Pro', 'Enterprise']
  const displayPlans = ORDER.map((name) =>
    plans.find((p) => p.attributes?.name === name)
  ).filter(Boolean) as Variant[]

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <Input
          placeholder="Gateway URL"
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
        />
        <Input
          placeholder="JWT"
          value={token}
          onChange={(e) => setToken(e.target.value)}
        />
        <Input
          placeholder="Org ID"
          value={orgId}
          onChange={(e) => setOrgId(e.target.value)}
        />
      </div>
      <div className="grid grid-cols-3 gap-3">
        {displayPlans.map((plan) => {
          const price = plan.attributes?.price
            ? `$${(plan.attributes.price / 100).toFixed(0)}/mo`
            : ''
          return (
            <Card key={plan.id} className="space-y-2">
              <CardTitle>{plan.attributes?.name}</CardTitle>
              <div className="text-2xl font-bold">{price}</div>
              {active ? (
                <Button onClick={portal}>Manage billing</Button>
              ) : (
                <Button onClick={() => checkout(plan.id)}>Get started</Button>
              )}
            </Card>
          )
        })}
      </div>
    </div>
  )
}

