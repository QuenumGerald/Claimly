import 'dotenv/config'
import Fastify, { FastifyInstance, FastifyRequest } from 'fastify'
import fastifyCors from '@fastify/cors'
import fastifyJwt from '@fastify/jwt'
import multipart from '@fastify/multipart'
import { Client as MinioClient } from 'minio'
import { PrismaClient } from '@prisma/client'
import { z } from 'zod'
import crypto from 'crypto'
import { mapCreditsToForms, generateSummaryPdf, uploadToMinio, createFilingEntry, CreditInput } from './services/filingService.js'
import { createCheckout, getVariants, createCustomerPortal, verifyWebhookSignature } from './services/lemon'

const PORT = Number(process.env.PORT ?? 8080)
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret'
const CORS_ORIGINS = (process.env.CORS_ORIGINS || '').split(',').filter(Boolean)
const MINIO_ENDPOINT = process.env.MINIO_ENDPOINT
const MINIO_PORT = process.env.MINIO_PORT ? Number(process.env.MINIO_PORT) : undefined
const MINIO_USE_SSL = (process.env.MINIO_USE_SSL || 'false') === 'true'
const MINIO_ACCESS_KEY = process.env.MINIO_ACCESS_KEY
const MINIO_SECRET_KEY = process.env.MINIO_SECRET_KEY
const MINIO_BUCKET = process.env.MINIO_BUCKET || 'uploads'
const APP_SHARED_SECRET = process.env.APP_SHARED_SECRET || ''
const QDRANT_URL = process.env.QDRANT_URL || 'http://localhost:6333'
const QDRANT_API_KEY = process.env.QDRANT_API_KEY
const QDRANT_COLLECTION = process.env.QDRANT_COLLECTION || 'tax_programs'
const QDRANT_VECTOR_SIZE = Number(process.env.QDRANT_VECTOR_SIZE || 384)
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || ''
const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-chat'

export async function buildServer(prisma = new PrismaClient({
  datasources: {
    db: { url: process.env.DATABASE_URL },
  },
})) {
  const app = Fastify({
    logger: {
      level: 'info',
      redact: ['req.headers.authorization'],
      serializers: {
        req: (req) => {
          const serialized: any = {
            method: req.method,
            url: req.url,
            headers: { ...req.headers },
            hostname: req.hostname,
            remoteAddress: req.ip,
            remotePort: req.socket?.remotePort
          }
          // Mask LEMON_API_KEY in request body if present
          if (req.body && typeof req.body === 'object') {
            const bodyStr = JSON.stringify(req.body)
            if (bodyStr.includes('LEMON_API_KEY')) {
              serialized.body = '[REDACTED - Contains API Key]'
            } else {
              serialized.body = req.body
            }
          }
          return serialized
        },
        res: (res) => ({
          statusCode: res.statusCode,
          headers: res.headers
        })
      }
    }
  })

  // Security & CORS
  await app.register(fastifyCors, {
    origin: (origin: string | undefined, cb: (err: Error | null, allow: boolean) => void) => {
      if (!origin || CORS_ORIGINS.length === 0) return cb(null, true)
      cb(null, CORS_ORIGINS.includes(origin))
    },
    credentials: true,
  })

  // JWT (placeholder - integrate with OpenSaaS auth in next step)
  await app.register(fastifyJwt, { secret: JWT_SECRET })
  await app.register(multipart)

  // MinIO client
  const minio = new MinioClient({
    endPoint: MINIO_ENDPOINT as string,
    port: MINIO_PORT,
    useSSL: MINIO_USE_SSL,
    accessKey: MINIO_ACCESS_KEY as string,
    secretKey: MINIO_SECRET_KEY as string,
  })
  // Ensure bucket exists
  try {
    const exists = await minio.bucketExists(MINIO_BUCKET)
    if (!exists) await minio.makeBucket(MINIO_BUCKET, '')
  } catch (e) {
    app.log.warn({ err: e }, 'MinIO bucket check failed (continuing)')
  }

  app.decorate('authenticate', async (request: any, reply: any) => {
    try {
      await request.jwtVerify()
    } catch (err) {
      reply.code(401).send({ error: 'Unauthorized' })
    }
  })

  // Health
  app.get('/health', async () => ({ ok: true }))

  // Auth (basic placeholder) ----------------------------
  // Token exchange: app signs a payload and gateway issues JWT
  app.post<{ Body: { userId: string; email?: string; orgId?: string; timestamp: number; signature: string } }>(
    '/api/auth/exchange',
    async (req, reply) => {
      if (!APP_SHARED_SECRET) return reply.code(500).send({ error: 'APP_SHARED_SECRET not configured' })
      const schema = z.object({ userId: z.string(), email: z.string().optional(), orgId: z.string().optional(), timestamp: z.number(), signature: z.string() })
      const body = schema.parse(req.body)
      // prevent replay (5 minutes)
      if (Math.abs(Date.now() - body.timestamp) > 5 * 60 * 1000) return reply.code(400).send({ error: 'Stale request' })
      const payload = `${body.userId}.${body.email ?? ''}.${body.orgId ?? ''}.${body.timestamp}`
      const expected = crypto.createHmac('sha256', APP_SHARED_SECRET).update(payload).digest('hex')
      if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(body.signature))) {
        return reply.code(401).send({ error: 'Invalid signature' })
      }
      const token = (app as any).jwt.sign({ sub: body.userId, email: body.email, orgId: body.orgId })
      return { token }
    }
  )

  // Generate Filing PDF from credits and profile, upload to MinIO, create filing record
  app.post<{ Params: { orgId: string }; Body: { profile: Record<string, any>; credits: CreditInput[] } }>(
    '/api/:orgId/filings/generate',
    { preValidation: [app.authenticate] as any },
    async (req, reply) => {
      const { orgId } = req.params
      const schema = z.object({
        profile: z.record(z.any()),
        credits: z.array(z.object({
          credit_id: z.string(),
          name: z.string(),
          amount_estimated: z.number(),
          explanation: z.string(),
        })),
      })
      const body = schema.parse(req.body)
      const userId = resolveUserId(req as any)
      if (!(await verifyOrgAccess(orgId, userId))) return reply.code(403).send({ error: 'Forbidden' })

      // Map credits -> forms
      const { forms, mapping } = await mapCreditsToForms(body.credits)

      // Generate PDF
      const pdfBytes = await generateSummaryPdf({ profile: body.profile, credits: body.credits, forms, mapping })

      // Upload
      const { key, url } = await uploadToMinio(minio, MINIO_BUCKET, pdfBytes)

      // Create filing entry (graceful if model missing)
      let filing: any = null
      try {
        filing = await createFilingEntry(prisma as any, {
          organizationId: orgId,
          createdById: userId as string,
          metadata: { forms, mapping },
          fileKey: key,
          fileUrl: url,
        })
      } catch (e) {
        req.log.warn({ err: e }, 'Failed to create filing entry, returning file info only')
      }

      return { orgId, forms, mapping, file: { key, url }, filing }
    }
  )
  app.post<{ Body: { email: string; orgId?: string } }>(
    '/api/auth/signup',
    async (req) => {
      const schema = z.object({ email: z.string().email(), orgId: z.string().optional() })
      const body = schema.parse(req.body)
      // Upsert user and optionally org membership
      const user = await prisma.user.upsert({
        where: { email: body.email },
        update: {},
        create: { email: body.email },
      })
      const token = (app as any).jwt.sign({ sub: user.id, email: user.email, orgId: body.orgId })
      return { token, userId: user.id }
    }
  )

  app.post<{ Body: { email: string; orgId?: string } }>(
    '/api/auth/login',
    async (req, reply) => {
      const schema = z.object({ email: z.string().email(), orgId: z.string().optional() })
      const body = schema.parse(req.body)
      const user = await prisma.user.findUnique({ where: { email: body.email } })
      if (!user) return reply.code(401).send({ error: 'Invalid credentials' })
      const token = (app as any).jwt.sign({ sub: user.id, email: user.email, orgId: body.orgId })
      return { token, userId: user.id }
    }
  )

  // Helper to read orgId from JWT or query/body
  function resolveOrgId(req: any): string | undefined {
    return req.user?.orgId || (req.query as any)?.orgId || (req.body as any)?.orgId
  }

  // Helper to read userId from JWT
  function resolveUserId(req: any): string | undefined {
    return req.user?.sub || req.user?.id
  }

  async function verifyOrgAccess(orgId: string, userId?: string) {
    if (!orgId) return false
    if (!userId) return false
    const member = await prisma.organizationMember.findFirst({ where: { organizationId: orgId, userId } })
    return !!member
  }

  function requireSubscription(plan?: string) {
    return async (req: any, reply: any) => {
      const orgId = resolveOrgId(req)
      if (!orgId) return reply.code(403).send({ error: 'No organization' })
      const org = await prisma.organization.findUnique({ where: { id: orgId } })
      if (!org) return reply.code(403).send({ error: 'Org not found' })
      if (!['active', 'trialing'].includes(org.status))
        return reply.code(402).send({ error: 'Subscription inactive' })
      if (org.current_period_end && org.current_period_end < new Date())
        return reply.code(402).send({ error: 'Subscription expired' })
      if (plan && org.plan !== plan)
        return reply.code(403).send({ error: 'Plan required' })
      ;(req as any).org = org
    }
  }

  const USAGE_LIMITS: Record<string, number> = { Basic: 3, Pro: 25 }

  async function incrementUsage(orgId: string, key: string, plan: string) {
    const limit = USAGE_LIMITS[plan]
    if (!limit) return
    const now = new Date()
    const start = new Date(now.getFullYear(), now.getMonth(), 1)
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 1)
    let counter = await prisma.usageCounter.findFirst({
      where: { org_id: orgId, key, period_start: start, period_end: end },
    })
    if (!counter) {
      await prisma.usageCounter.create({
        data: { org_id: orgId, key, period_start: start, period_end: end, value: 1 },
      })
    } else {
      if (counter.value >= limit) throw new Error('limit')
      await prisma.usageCounter.update({
        where: { id: counter.id },
        data: { value: { increment: 1 } },
      })
    }
  }

  // Tenant-aware routes
  app.get<{ Params: { orgId: string } }>(
    '/api/:orgId/credits',
    { preValidation: [app.authenticate] as any },
    async (req: FastifyRequest<{ Params: { orgId: string } }>) => {
      const { orgId } = req.params
      const userId = resolveUserId(req as any)
      if (!(await verifyOrgAccess(orgId, userId))) return { error: 'Forbidden' }
      const credits = await prisma.credit.findMany({ where: { organizationId: orgId } })
      const balance = credits.reduce((sum: number, c: { amount: number }) => sum + c.amount, 0)
      return { orgId, balance, entries: credits }
    }
  )

  app.post<{ Params: { orgId: string }; Body: { amount: number; reason?: string } }>(
    '/api/:orgId/credits',
    { preValidation: [app.authenticate] as any },
    async (req: FastifyRequest<{ Params: { orgId: string }; Body: { amount: number; reason?: string } }>) => {
      const schema = z.object({ amount: z.number().int(), reason: z.string().optional() })
      const body = schema.parse(req.body)
      const { orgId } = req.params
      const userId = resolveUserId(req as any)
      if (!(await verifyOrgAccess(orgId, userId))) return { error: 'Forbidden' }
      const entry = await prisma.credit.create({
        data: { organizationId: orgId, amount: body.amount, reason: body.reason },
      })
      return entry
    }
  )

  app.get<{ Params: { orgId: string } }>(
    '/api/:orgId/filings',
    { preValidation: [app.authenticate] as any },
    async (req: any) => {
      const orgId = resolveOrgId(req)
      const userId = resolveUserId(req as any)
      if (!orgId) return { error: 'Missing orgId' }
      if (!(await verifyOrgAccess(orgId, userId))) return { error: 'Forbidden' }
      const [credits, filings, files] = await Promise.all([
        prisma.credit.findMany({ where: { organizationId: orgId } }),
        prisma.filing.findMany({ where: { organizationId: orgId } }),
        prisma.file.findMany({ where: { organizationId: orgId }, take: 10, orderBy: { createdAt: 'desc' as any } as any }).catch(() => prisma.file.findMany({ where: { organizationId: orgId } })),
      ])
      return { credits, filings, files }
    }
  )

  app.post<{ Params: { orgId: string }; Body: { reference: string; metadata?: any } }>(
    '/api/:orgId/filings',
    { preValidation: [app.authenticate] },
    async (req: FastifyRequest<{ Params: { orgId: string }; Body: { reference: string; metadata?: any } }> & { user?: any }) => {
      const schema = z.object({ reference: z.string(), metadata: z.any().optional() })
      const body = schema.parse(req.body)
      const { orgId } = req.params
      // In a later step, map JWT user to createdById
      const createdById = resolveUserId(req) || '00000000-0000-0000-0000-000000000000'
      if (!(await verifyOrgAccess(orgId, createdById))) return { error: 'Forbidden' }
      const filing = await prisma.filing.create({
        data: {
          organizationId: orgId,
          createdById,
          reference: body.reference,
          status: 'draft',
          metadata: body.metadata,
        },
      })
      return filing
    }
  )

  app.get<{ Params: { orgId: string } }>(
    '/api/:orgId/files',
    { preValidation: [app.authenticate] as any },
    async (req: FastifyRequest<{ Params: { orgId: string } }>) => {
      const { orgId } = req.params
      const userId = resolveUserId(req as any)
      if (!(await verifyOrgAccess(orgId, userId))) return { error: 'Forbidden' }
      const files = await prisma.file.findMany({ where: { organizationId: orgId } })
      return files
    }
  )

  // Upload file -> MinIO and record in DB
  app.post(
    '/api/files/upload',
    { preValidation: [app.authenticate] as any },
    async (req: any, reply) => {
      const part = await req.file()
      if (!part) return reply.code(400).send({ error: 'No file' })

      const orgId = (req.body?.orgId as string) || resolveOrgId(req)
      const userId = resolveUserId(req)
      if (!orgId) return reply.code(400).send({ error: 'Missing orgId' })
      if (!(await verifyOrgAccess(orgId, userId))) return reply.code(403).send({ error: 'Forbidden' })

      const filename = part.filename || 'upload.bin'
      const contentType = part.mimetype || 'application/octet-stream'

      // Stream to buffer to get size (MinIO putObject requires size for streams)
      const chunks: Buffer[] = []
      for await (const chunk of part.file) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
      const buf = Buffer.concat(chunks)

      const key = `uploads/${orgId}/${Date.now()}-${filename}`
      await minio.putObject(MINIO_BUCKET, key, buf, buf.length, { 'Content-Type': contentType })
      const url = await minio.presignedGetObject(MINIO_BUCKET, key)

      let record: any = null
      try {
        record = await prisma.file.create({
          data: {
            userId: userId as string,
            organizationId: orgId,
            name: filename,
            type: contentType,
            key,
            uploadUrl: url,
          },
        })
      } catch (e) {
        req.log.warn({ err: e }, 'Failed to persist File, returning object info only')
      }

      return { id: record?.id, key, url, name: filename, type: contentType }
    }
  )

  // --------- RAG: Query credits via DeepSeek + Qdrant ---------
  type RagResponseItem = { credit_id: string; name: string; amount_estimated: number; explanation: string }
  const qdrant =
    process.env.TEST_MODE === 'true'
      ? { search: async () => [] }
      : new (await import('qdrant-client')).QdrantClient({ url: QDRANT_URL, apiKey: QDRANT_API_KEY })
  let embedder: any
  async function getEmbedder() {
    if (!embedder) {
      const { pipeline } = await import('@xenova/transformers')
      embedder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2')
    }
    return embedder
  }
  function l2Normalize(vec: number[]): number[] {
    const norm = Math.sqrt(vec.reduce((s, x) => s + x * x, 0)) || 1
    return vec.map((x) => x / norm)
  }
  function meanPool(vectors: number[][]): number[] {
    const length = vectors[0].length
    const sum = new Array(length).fill(0)
    for (const v of vectors) for (let i = 0; i < length; i++) sum[i] += v[i]
    return sum.map((x) => x / vectors.length)
  }

  app.post<{ Body: { orgId?: string; profile: Record<string, any>; topK?: number } }>(
    '/api/rag/credits',
    { preValidation: [app.authenticate, requireSubscription()] as any },
    async (req, reply) => {
      if (!DEEPSEEK_API_KEY) return reply.code(500).send({ error: 'DeepSeek not configured' })
      const schema = z.object({ orgId: z.string().optional(), profile: z.record(z.any()), topK: z.number().int().min(1).max(50).optional() })
      const body = schema.parse(req.body)
      const orgId = body.orgId || resolveOrgId(req)
      const userId = resolveUserId(req as any)
      if (orgId && !(await verifyOrgAccess(orgId, userId))) return reply.code(403).send({ error: 'Forbidden' })
      const org = (req as any).org
      try {
        await incrementUsage(orgId as string, 'credits.detect', org.plan)
      } catch {
        return reply.code(402).send({ error: 'Usage limit exceeded' })
      }
      if (process.env.TEST_MODE === 'true') return []

      // 1) Embed query (company profile rendered to text)
      const profileText = JSON.stringify(body.profile)
      const embed = await getEmbedder()
      const result: any = await embed(profileText, { pooling: 'none', normalize: false })
      const vectors = Array.from(result.data as any) as unknown as number[][]
      const queryVec = l2Normalize(meanPool(vectors))

      // 2) Qdrant search
      const topK = body.topK ?? 8
      const search = await qdrant.search(QDRANT_COLLECTION, {
        vector: queryVec,
        limit: topK,
        with_payload: true,
      } as any)
      const contextItems = (search as any[]).map((p: any) => p.payload)
      const contextText = contextItems
        .map((p: any, i: number) => `#${i + 1} ${p.title}\nSource: ${p.source}\nURL: ${p.url}`)
        .join('\n\n')

      // 3) DeepSeek prompt
      const system = `Tu es un assistant fiscal. Réponds en JSON strict, tableau d'objets {credit_id, name, amount_estimated, explanation}. N'inclus AUCUN texte hors JSON.`
      const userPrompt = `Voici profil entreprise:\n${profileText}\n\nLois / context:\n${contextText}\n\nQuestion: Quels crédits sont applicables ? Donne montant estimé (nombre) + raison. Réponds uniquement en JSON.`
      const dsRes = await fetch('https://api.deepseek.com/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: DEEPSEEK_MODEL,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: userPrompt },
          ],
          temperature: 0.2,
        }),
      })
      if (!dsRes.ok) return reply.code(502).send({ error: 'DeepSeek error', status: dsRes.status })
      const dsJson: any = await dsRes.json()
      const content: string | undefined = dsJson?.choices?.[0]?.message?.content
      if (!content) return reply.code(502).send({ error: 'Invalid DeepSeek response' })

      // 4) Parse JSON strictly
      let parsed: RagResponseItem[] = []
      try {
        parsed = JSON.parse(content)
      } catch {
        // Try to extract JSON block if model leaked text
        const match = content.match(/\[.*\]/s)
        if (match) parsed = JSON.parse(match[0])
      }
      if (!Array.isArray(parsed)) return reply.code(502).send({ error: 'Model did not return JSON array' })

      // 5) Sanitize
      const clean = parsed.map((x) => ({
        credit_id: String((x as any).credit_id || ''),
        name: String((x as any).name || ''),
        amount_estimated: Number((x as any).amount_estimated || 0),
        explanation: String((x as any).explanation || ''),
      }))
      return clean
    }
  )
  // Billing ---------------------------------------------------
  app.post(
    '/api/billing/checkout',
    { preValidation: [app.authenticate] as any },
    async (req, reply) => {
      const schema = z.object({
        variantId: z.number().int(),
        customerEmail: z.string().email().optional(),
        successUrl: z.string(),
        cancelUrl: z.string(),
      })
      const body = schema.parse(req.body as any)
      const userId = resolveUserId(req as any) || ''
      const orgId = resolveOrgId(req) || ''
      const res = await createCheckout({
        variantId: body.variantId,
        customerEmail: body.customerEmail || '',
        successUrl: body.successUrl,
        cancelUrl: body.cancelUrl,
        custom: { userId, orgId },
      })
      return res
    }
  )

  app.post('/api/billing/webhook', async (req, reply) => {
    const signature = (req.headers['x-signature'] as string) || ''
    const raw = typeof req.body === 'string' ? req.body : JSON.stringify(req.body)
    if (!verifyWebhookSignature(signature, raw))
      return reply.code(400).send({ error: 'Invalid signature' })
    const body: any = req.body
    const eventId = body?.meta?.event_id || body?.id
    const type = body?.meta?.event_name || body?.type
    const exists = await prisma.webhookEvent.findUnique({ where: { id: eventId } })
    if (exists) return { ok: true }
    await prisma.webhookEvent.create({ data: { id: eventId, type: type || '', payload: body } })
    const orgId = body?.data?.attributes?.custom_data?.orgId
    if (orgId) {
      switch (type) {
        case 'subscription_created':
          await prisma.organization.update({
            where: { id: orgId },
            data: {
              status: body?.data?.attributes?.status || 'active',
              plan: body?.data?.attributes?.variant_name || 'unknown',
              lemon_customer_id: String(body?.data?.attributes?.customer_id || ''),
              lemon_subscription_id: String(body?.data?.id || ''),
              current_period_end: body?.data?.attributes?.renews_at
                ? new Date(body.data.attributes.renews_at)
                : null,
            },
          })
          break
        case 'payment_failed':
          await prisma.organization.update({ where: { id: orgId }, data: { status: 'past_due' } })
          break
        case 'subscription_cancelled':
          await prisma.organization.update({ where: { id: orgId }, data: { status: 'cancelled' } })
          break
      }
    }
    return { ok: true }
  })

  app.get(
    '/api/billing/portal',
    { preValidation: [app.authenticate] as any },
    async (req, reply) => {
      const orgId = resolveOrgId(req)
      if (!orgId) return reply.code(400).send({ error: 'Missing org' })
      const org = await prisma.organization.findUnique({ where: { id: orgId } })
      if (!org?.lemon_customer_id) return reply.code(400).send({ error: 'No customer' })
      const { url } = await createCustomerPortal({ customerId: org.lemon_customer_id })
      return { url }
    }
  )

  app.get('/api/billing/plans', async () => {
    const variants = await getVariants()
    return variants
  })

  return app
}

import { fileURLToPath } from 'url'
import { dirname } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

if (import.meta.url === `file://${process.argv[1]}`) {
  buildServer()
    .then((app) => app.listen({ port: PORT, host: '0.0.0.0' }))
    .then((address) => {
      console.log(`Gateway listening on ${address}`)
    })
    .catch((err) => {
      console.error(err)
      process.exit(1)
    })
}

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: any
  }
}
