import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { Client as MinioClient } from 'minio'
import { PrismaClient } from '@prisma/client'
import crypto from 'crypto'

export type CreditInput = {
  credit_id: string
  name: string
  amount_estimated: number
  explanation: string
}

const CREDIT_TO_FORMS: Record<string, { forms: string[]; fallback?: string[] }> = {
  // Key by normalized credit ids or keywords
  'R&D': { forms: ['6765'] },
  'RD': { forms: ['6765'] },
  'RESEARCH_CREDIT': { forms: ['6765'] },
  'WORK_OPPORTUNITY_TAX_CREDIT': { forms: ['5884'] },
  'WOTC': { forms: ['5884'] },
  'ENERGY_EFFICIENT_COMMERCIAL_BUILDINGS': { forms: ['7205'] },
}

function normalizeCreditId(id: string): string {
  return id.trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_')
}

export async function mapCreditsToForms(credits: CreditInput[]): Promise<{ forms: string[]; mapping: Array<{ credit_id: string; forms: string[] }> }> {
  const set = new Set<string>()
  const mapping: Array<{ credit_id: string; forms: string[] }> = []
  for (const c of credits) {
    const key = normalizeCreditId(c.credit_id || c.name)
    const entry = CREDIT_TO_FORMS[key]
    const forms = entry?.forms?.length ? entry.forms : []
    forms.forEach((f) => set.add(f))
    mapping.push({ credit_id: c.credit_id || key, forms })
  }
  return { forms: Array.from(set), mapping }
}

export async function generateSummaryPdf(params: {
  profile: Record<string, any>
  credits: CreditInput[]
  forms: string[]
  mapping: Array<{ credit_id: string; forms: string[] }>
}): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const page = doc.addPage([612, 792]) // Letter
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const { width, height } = page.getSize()

  const title = 'Filing Summary'
  page.drawText(title, { x: 50, y: height - 60, size: 20, font, color: rgb(0, 0, 0) })

  let y = height - 100
  const section = (label: string) => {
    page.drawText(label, { x: 50, y, size: 14, font, color: rgb(0.1, 0.1, 0.1) })
    y -= 20
  }
  const line = (text: string) => {
    const wrapped = wrapText(text, 80)
    for (const l of wrapped) {
      page.drawText(l, { x: 60, y, size: 11, font, color: rgb(0, 0, 0) })
      y -= 14
      if (y < 60) {
        y = height - 60
      }
    }
  }

  section('Profil Entreprise')
  line(JSON.stringify(params.profile))

  section('Crédits Identifiés')
  for (const c of params.credits) {
    line(`- ${c.name} (${c.credit_id}) | Estimé: $${c.amount_estimated.toFixed(2)}`)
    line(`  Raison: ${c.explanation}`)
  }

  section('Formulaires IRS recommandés')
  line(params.forms.join(', ') || 'Aucun mappage connu')

  section('Détail mapping')
  for (const m of params.mapping) line(`${m.credit_id} -> [${m.forms.join(', ')}]`)

  const pdfBytes = await doc.save()
  return pdfBytes
}

function wrapText(text: string, width: number): string[] {
  const words = text.split(/\s+/)
  const lines: string[] = []
  let line = ''
  for (const word of words) {
    const test = line ? `${line} ${word}` : word
    if (test.length > width) {
      if (line) lines.push(line)
      line = word
    } else {
      line = test
    }
  }
  if (line) lines.push(line)
  return lines
}

export async function uploadToMinio(minio: MinioClient, bucket: string, bytes: Uint8Array): Promise<{ key: string; url: string }> {
  const key = `filings/${new Date().getUTCFullYear()}/${crypto.randomUUID()}.pdf`
  const buf = Buffer.from(bytes)
  await minio.putObject(bucket, key, buf, buf.length, {
    'Content-Type': 'application/pdf',
  })
  const url = await minio.presignedGetObject(bucket, key)
  return { key, url }
}

export async function createFilingEntry(prisma: PrismaClient, params: {
  organizationId: string
  createdById: string
  reference?: string
  metadata?: Record<string, any>
  fileKey: string
  fileUrl: string
}) {
  const reference = params.reference || `FIL-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`
  // This expects a Filing model compatible with earlier schema
  const filing = await prisma.filing.create({
    data: {
      organizationId: params.organizationId,
      createdById: params.createdById,
      status: 'draft',
      reference,
      metadata: params.metadata || {},
    },
  })
  // Store file as generic File (if your schema uses a File model). If absent, skip.
  try {
    await prisma.file.create({
      data: {
        userId: params.createdById,
        organizationId: params.organizationId,
        name: `${reference}.pdf`,
        type: 'application/pdf',
        key: params.fileKey,
        uploadUrl: params.fileUrl,
      },
    })
  } catch {
    // ignore if File model not present
  }
  return filing
}
