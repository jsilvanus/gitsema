/**
 * Secret-pattern redaction for narrator/explainer payloads.
 *
 * All text submitted to a remote LLM is passed through `redact()` first.
 * Redaction is conservative — it replaces likely secrets with a fixed
 * placeholder rather than removing them, so the structure of the text
 * remains readable but credentials cannot leak.
 *
 * Patterns are intentionally lightweight. For a production system these
 * should be replaced with a library like `@secretlint/secretlint-core`.
 */

// ---------------------------------------------------------------------------
// Pattern definitions
// ---------------------------------------------------------------------------

interface RedactPattern {
  name: string
  pattern: RegExp
  replacement: string
}

const REDACT_PATTERNS: RedactPattern[] = [
  // AWS access keys (AKIA...)
  {
    name: 'aws-access-key',
    pattern: /\b(AKIA|ASIA|AROA)[A-Z0-9]{16}\b/g,
    replacement: '[REDACTED:aws-access-key]',
  },
  // AWS secret keys (40-char base64-like after common assignment patterns)
  {
    name: 'aws-secret-key',
    pattern: /(?:aws_secret|AWS_SECRET)[_A-Za-z]*\s*[=:]\s*["']?([A-Za-z0-9/+]{40})["']?/gi,
    replacement: '[REDACTED:aws-secret-key]',
  },
  // GitHub PATs (classic ghp_ and fine-grained github_pat_)
  {
    name: 'github-pat',
    pattern: /\b(ghp_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{82})\b/g,
    replacement: '[REDACTED:github-pat]',
  },
  // OpenAI / generic sk- API keys
  {
    name: 'openai-key',
    pattern: /\bsk-[A-Za-z0-9_-]{32,}\b/g,
    replacement: '[REDACTED:openai-key]',
  },
  // Google / Firebase API keys (AIza)
  {
    name: 'google-api-key',
    pattern: /\bAIza[A-Za-z0-9_-]{35}\b/g,
    replacement: '[REDACTED:google-api-key]',
  },
  // JWT tokens (three base64url segments separated by dots)
  {
    name: 'jwt',
    pattern: /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
    replacement: '[REDACTED:jwt]',
  },
  // PEM private key blocks
  {
    name: 'pem-private-key',
    pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g,
    replacement: '[REDACTED:pem-private-key]',
  },
  // Generic env-style key=secret assignments (SECRET=, PASSWORD=, TOKEN=, KEY=)
  {
    name: 'env-secret',
    pattern: /\b(?:SECRET|PASSWORD|PASSWD|TOKEN|API_KEY|APIKEY|AUTH_TOKEN)\s*[=:]\s*["']?[^\s"',;\[]{8,}["']?/gi,
    replacement: '[REDACTED:env-secret]',
  },
  // Private RFC-1918 addresses are not secrets but we strip them to avoid
  // leaking internal network topology — useful in error-log contexts.
  {
    name: 'private-ip',
    pattern: /\b(10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3})\b/g,
    replacement: '[REDACTED:private-ip]',
  },
  // Email addresses (can reveal internal employee info)
  {
    name: 'email',
    pattern: /\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/g,
    replacement: '[REDACTED:email]',
  },
]

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface RedactResult {
  text: string
  /** Names of patterns that fired (deduplicated). */
  firedPatterns: string[]
}

/**
 * Apply all redaction patterns to `input`.
 *
 * Returns the cleaned text and the list of pattern names that matched.
 * The function is pure — it does not modify any global state.
 */
export function redact(input: string): RedactResult {
  const firedSet = new Set<string>()
  let text = input
  for (const { name, pattern, replacement } of REDACT_PATTERNS) {
    // Reset lastIndex for global patterns (safety guard)
    pattern.lastIndex = 0
    const replaced = text.replace(pattern, () => {
      firedSet.add(name)
      return replacement
    })
    text = replaced
  }
  return { text, firedPatterns: Array.from(firedSet) }
}

/**
 * Redact an array of text strings and collect all fired patterns.
 * Returns the cleaned strings and combined fired pattern list.
 */
export function redactAll(inputs: string[]): { texts: string[]; firedPatterns: string[] } {
  const allFired = new Set<string>()
  const texts = inputs.map((input) => {
    const { text, firedPatterns } = redact(input)
    for (const p of firedPatterns) allFired.add(p)
    return text
  })
  return { texts, firedPatterns: Array.from(allFired) }
}
