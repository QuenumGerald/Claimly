export type GatewayConfig = { baseUrl: string; token: string; orgId?: string }

async function req(cfg: GatewayConfig, path: string, init: RequestInit = {}) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(cfg.token ? { Authorization: `Bearer ${cfg.token}` } : {}),
  }
  const res = await fetch(`${cfg.baseUrl}${path}`, { ...init, headers: { ...headers, ...(init.headers as any) } })
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  return res
}

export async function listCredits(cfg: GatewayConfig) {
  if (!cfg.orgId) throw new Error('orgId is required')
  const res = await req(cfg, `/api/${cfg.orgId}/credits`)
  return res.json()
}

export async function listFilings(cfg: GatewayConfig) {
  if (!cfg.orgId) throw new Error('orgId is required')
  const res = await req(cfg, `/api/${cfg.orgId}/filings`)
  return res.json()
}

export async function generateFiling(cfg: GatewayConfig, body: { profile: any; credits: any[] }) {
  if (!cfg.orgId) throw new Error('orgId is required')
  const res = await req(cfg, `/api/${cfg.orgId}/filings/generate`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
  return res.json()
}

export async function ragCredits(cfg: GatewayConfig, body: { profile: any; topK?: number }) {
  const res = await req(cfg, `/api/rag/credits`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
  return res.json()
}

export async function uploadFile(cfg: GatewayConfig, file: File) {
  if (!cfg.orgId) throw new Error('orgId is required')
  const form = new FormData()
  form.append('file', file)
  form.append('orgId', cfg.orgId)
  const res = await fetch(`${cfg.baseUrl}/api/files/upload`, {
    method: 'POST',
    headers: cfg.token ? { Authorization: `Bearer ${cfg.token}` } : undefined,
    body: form,
  })
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  return res.json()
}
