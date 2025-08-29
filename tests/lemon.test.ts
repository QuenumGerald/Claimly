import { describe, it } from 'node:test'
import assert from 'node:assert'
import { createHmac } from 'crypto'
process.env.LEMON_WEBHOOK_SECRET = 'test-secret'
import { verifyWebhookSignature } from '../gateway/src/services/lemon'

describe('verifyWebhookSignature', () => {
  const payload = JSON.stringify({ hello: 'world' })
  const valid = createHmac('sha256', 'test-secret').update(payload).digest('hex')
  it('returns true for valid signature', () => {
    assert.equal(verifyWebhookSignature(valid, payload), true)
  })
  it('returns false for invalid signature', () => {
    assert.equal(verifyWebhookSignature('bad', payload), false)
  })
})
