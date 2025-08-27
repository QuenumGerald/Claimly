import 'dotenv/config'
import Fastify, { FastifyInstance, FastifyRequest } from 'fastify'
import fastifyCors from '@fastify/cors'
import fastifyHelmet from '@fastify/helmet'
import fastifyJwt from '@fastify/jwt'
import { PrismaClient } from '@prisma/client'
import { z } from 'zod'

const PORT = Number(process.env.PORT ?? 8080)
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret'
const CORS_ORIGINS = (process.env.CORS_ORIGINS || '').split(',').filter(Boolean)

const prisma = new PrismaClient({
  datasources: {
    db: { url: process.env.DATABASE_URL },
  },
})

async function buildServer() {
  const app = Fastify({ logger: true })

  // Security & CORS
  await app.register(fastifyHelmet)
  await app.register(fastifyCors, {
    origin: (origin: string | undefined, cb: (err: Error | null, allow: boolean) => void) => {
      if (!origin || CORS_ORIGINS.length === 0) return cb(null, true)
      cb(null, CORS_ORIGINS.includes(origin))
    },
    credentials: true,
  })

  // JWT (placeholder - integrate with OpenSaaS auth in next step)
  await app.register(fastifyJwt, { secret: JWT_SECRET })

  app.decorate('authenticate', async (request: any, reply: any) => {
    try {
      await request.jwtVerify()
    } catch (err) {
      reply.code(401).send({ error: 'Unauthorized' })
    }
  })

  // Health
  app.get('/health', async () => ({ ok: true }))

  // Tenant-aware routes
  app.get<{ Params: { orgId: string } }>(
    '/api/:orgId/credits',
    { preValidation: [app.authenticate] as any },
    async (req: FastifyRequest<{ Params: { orgId: string } }>) => {
      const { orgId } = req.params
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
      const entry = await prisma.credit.create({
        data: { organizationId: orgId, amount: body.amount, reason: body.reason },
      })
      return entry
    }
  )

  app.get<{ Params: { orgId: string } }>(
    '/api/:orgId/filings',
    { preValidation: [app.authenticate] as any },
    async (req: FastifyRequest<{ Params: { orgId: string } }>) => {
      const { orgId } = req.params
      const filings = await prisma.filing.findMany({ where: { organizationId: orgId } })
      return filings
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
      const createdById = req.user?.id || req.user?.sub || '00000000-0000-0000-0000-000000000000'
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
      const files = await prisma.file.findMany({ where: { organizationId: orgId } })
      return files
    }
  )

  return app
}

buildServer()
  .then((app) => app.listen({ port: PORT, host: '0.0.0.0' }))
  .then((address) => {
    console.log(`Gateway listening on ${address}`)
  })
  .catch(async (err) => {
    console.error(err)
    await prisma.$disconnect()
    process.exit(1)
  })

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: any
  }
}
