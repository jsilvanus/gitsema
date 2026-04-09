/**
 * Tests for src/core/narrator/redact.ts
 *
 * Verifies that the redaction layer catches common secret patterns
 * before content is sent to a remote LLM provider.
 */
import { describe, it, expect } from 'vitest'
import { redact, redactAll } from '../src/core/narrator/redact.js'

// ---------------------------------------------------------------------------
// redact()
// ---------------------------------------------------------------------------

describe('redact()', () => {
  it('passes through clean text unchanged', () => {
    const { text, firedPatterns } = redact('Hello, world! This is a normal commit message.')
    expect(text).toBe('Hello, world! This is a normal commit message.')
    expect(firedPatterns).toHaveLength(0)
  })

  it('redacts AWS access keys', () => {
    const { text, firedPatterns } = redact('AWS key: AKIAIOSFODNN7EXAMPLE is used here')
    expect(text).toContain('[REDACTED:aws-access-key]')
    expect(text).not.toContain('AKIAIOSFODNN7EXAMPLE')
    expect(firedPatterns).toContain('aws-access-key')
  })

  it('redacts GitHub PATs (ghp_ prefix)', () => {
    const token = 'ghp_' + 'A'.repeat(36)
    const { text, firedPatterns } = redact(`Using token: ${token}`)
    expect(text).not.toContain(token)
    expect(text).toContain('[REDACTED:github-pat]')
    expect(firedPatterns).toContain('github-pat')
  })

  it('redacts OpenAI sk- keys', () => {
    const key = 'sk-' + 'x'.repeat(48)
    const { text, firedPatterns } = redact(`API_KEY=${key}`)
    expect(text).not.toContain(key)
    expect(text).toContain('[REDACTED:openai-key]')
    expect(firedPatterns).toContain('openai-key')
  })

  it('redacts Google API keys (AIza prefix)', () => {
    const key = 'AIza' + 'B'.repeat(35)
    const { text, firedPatterns } = redact(`Setting key=${key}`)
    expect(text).not.toContain(key)
    expect(text).toContain('[REDACTED:google-api-key]')
    expect(firedPatterns).toContain('google-api-key')
  })

  it('redacts JWT tokens', () => {
    // Valid-shape JWT (three base64url segments)
    const jwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c'
    const { text, firedPatterns } = redact(`Authorization: Bearer ${jwt}`)
    expect(text).not.toContain(jwt)
    expect(text).toContain('[REDACTED:jwt]')
    expect(firedPatterns).toContain('jwt')
  })

  it('redacts PEM private key blocks', () => {
    const pem = '-----BEGIN RSA PRIVATE KEY-----\nMIIE...\n-----END RSA PRIVATE KEY-----'
    const { text, firedPatterns } = redact(pem)
    expect(text).not.toContain('MIIE')
    expect(text).toContain('[REDACTED:pem-private-key]')
    expect(firedPatterns).toContain('pem-private-key')
  })

  it('redacts generic SECRET= assignments', () => {
    const { text, firedPatterns } = redact('SECRET=supersecretpassword123')
    expect(text).not.toContain('supersecretpassword123')
    expect(firedPatterns).toContain('env-secret')
  })

  it('redacts TOKEN= assignments', () => {
    const { text, firedPatterns } = redact('TOKEN=mytoken123456')
    expect(text).not.toContain('mytoken123456')
    expect(firedPatterns).toContain('env-secret')
  })

  it('redacts private IP addresses', () => {
    const { text, firedPatterns } = redact('Server at 192.168.1.100 is down')
    expect(text).not.toContain('192.168.1.100')
    expect(text).toContain('[REDACTED:private-ip]')
    expect(firedPatterns).toContain('private-ip')
  })

  it('redacts 10.x.x.x private IP range', () => {
    const { text, firedPatterns } = redact('Database host: 10.0.0.1')
    expect(text).not.toContain('10.0.0.1')
    expect(firedPatterns).toContain('private-ip')
  })

  it('redacts email addresses', () => {
    const { text, firedPatterns } = redact('Contact: alice@example.com for access')
    expect(text).not.toContain('alice@example.com')
    expect(text).toContain('[REDACTED:email]')
    expect(firedPatterns).toContain('email')
  })

  it('reports multiple fired patterns when multiple secrets present', () => {
    const key = 'sk-' + 'z'.repeat(48)
    const { firedPatterns } = redact(`Token: ${key} and email: bob@corp.io`)
    expect(firedPatterns).toContain('openai-key')
    expect(firedPatterns).toContain('email')
  })

  it('deduplicates fired patterns when the same secret appears twice', () => {
    const key = 'sk-' + 'y'.repeat(48)
    const { firedPatterns } = redact(`Key1=${key} Key2=${key}`)
    const openAiPatterns = firedPatterns.filter((p) => p === 'openai-key')
    expect(openAiPatterns).toHaveLength(1)
  })

  it('does not flag public IP addresses', () => {
    const { firedPatterns } = redact('Public IP: 8.8.8.8 is Google DNS')
    expect(firedPatterns).not.toContain('private-ip')
  })
})

// ---------------------------------------------------------------------------
// redactAll()
// ---------------------------------------------------------------------------

describe('redactAll()', () => {
  it('processes an array of strings', () => {
    const key = 'sk-' + 'a'.repeat(48)
    const { texts, firedPatterns } = redactAll([
      'First commit message',
      `API_KEY=${key}`,
      'Another clean message',
    ])
    expect(texts).toHaveLength(3)
    expect(texts[0]).toBe('First commit message')
    expect(texts[1]).not.toContain(key)
    expect(texts[2]).toBe('Another clean message')
    expect(firedPatterns).toContain('openai-key')
  })

  it('returns empty firedPatterns for all-clean inputs', () => {
    const { texts, firedPatterns } = redactAll(['Clean text', 'Also clean'])
    expect(firedPatterns).toHaveLength(0)
    expect(texts[0]).toBe('Clean text')
  })

  it('handles an empty array', () => {
    const { texts, firedPatterns } = redactAll([])
    expect(texts).toHaveLength(0)
    expect(firedPatterns).toHaveLength(0)
  })

  it('deduplicates patterns across multiple strings', () => {
    const key = 'sk-' + 'b'.repeat(48)
    const { firedPatterns } = redactAll([`key1=${key}`, `key2=${key}`])
    const matches = firedPatterns.filter((p) => p === 'openai-key')
    expect(matches).toHaveLength(1)
  })
})
