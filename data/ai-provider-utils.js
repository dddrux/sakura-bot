export const GROQ_CANONICAL_BASE_URL = 'https://api.groq.com/openai/v1'

export function normalizeGroqBaseUrl(value = '', { allowCustom = false } = {}) {
  let raw = String(value || '').trim().replace(/\/+$/, '')
  if (!raw) return GROQ_CANONICAL_BASE_URL
  raw = raw.replace(/\/(?:chat\/completions|models)$/i, '')
  if (/^https:\/\/api\.groq\.com\/openai\/v1$/i.test(raw)) return GROQ_CANONICAL_BASE_URL
  if (allowCustom && /^https?:\/\//i.test(raw)) return raw
  return GROQ_CANONICAL_BASE_URL
}
