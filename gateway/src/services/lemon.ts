import crypto from 'crypto'

const API_BASE = 'https://api.lemonsqueezy.com/v1'
const API_KEY = process.env.LEMON_API_KEY || ''
const WEBHOOK_SECRET = process.env.LEMON_WEBHOOK_SECRET || ''

async function lsRequest(path: string, options: any = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${API_KEY}`,
      ...(options.headers || {}),
    },
  })
  if (!res.ok) {
    throw new Error(`Lemon Squeezy API error: ${res.status}`)
  }
  return res.json()
}

export async function createCheckout(params: {
  variantId: number
  customerEmail: string
  custom: { userId: string; orgId: string }
  successUrl: string
  cancelUrl: string
}) {
  const body = {
    data: {
      type: 'checkout-session',
      attributes: {
        variant_id: params.variantId,
        customer_email: params.customerEmail,
        custom: params.custom,
        success_url: params.successUrl,
        cancel_url: params.cancelUrl,
      },
    },
  }
  const json = await lsRequest('/checkout', { method: 'POST', body: JSON.stringify(body) })
  return { url: json?.data?.attributes?.url }
}

export async function getVariants() {
  const json = await lsRequest('/variants', { method: 'GET' })
  return json?.data ?? []
}

export async function createCustomerPortal(params: { customerId: string }) {
  const body = {
    data: { type: 'customer-portal', attributes: { customer_id: params.customerId } },
  }
  const json = await lsRequest('/customer-portal', { method: 'POST', body: JSON.stringify(body) })
  return { url: json?.data?.attributes?.url }
}

export function verifyWebhookSignature(signature: string | undefined, rawBody: string) {
  if (!signature || !WEBHOOK_SECRET) return false
  const hmac = crypto.createHmac('sha256', WEBHOOK_SECRET).update(rawBody).digest('hex')
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(hmac))
}
