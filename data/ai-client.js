import { settings } from './settings.js'

let fetchImplementation = (...args) => fetch(...args)

const modelCache = new Map()
const MODEL_CACHE_TTL_MS = 5 * 60_000
const PREFERRED_CHAT_MODELS = [
  'llama-3.1-8b-instant',
  'llama-3.3-70b-versatile',
  'openai/gpt-oss-20b',
  'openai/gpt-oss-120b',
  'groq/compound-mini',
  'groq/compound'
]

function modelCacheKey(token = '') {
  return String(token || '').trim()
}

function looksLikeChatModel(id = '') {
  const value = String(id || '').toLowerCase()
  return Boolean(value && !/(?:whisper|tts|guard|safeguard|embedding|moderation)/.test(value))
}

export class GroqApiError extends Error {
  constructor(message, { statusCode = 0, retryAfterMs = 0, code = 'GROQ_ERROR' } = {}) {
    super(message)
    this.name = 'GroqApiError'
    this.statusCode = Number(statusCode) || 0
    this.retryAfterMs = Number(retryAfterMs) || 0
    this.code = code
  }
}

function retryAfterMs(headers) {
  const raw = headers?.get?.('retry-after')
  const seconds = Number(raw)
  return Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds * 1000) : 0
}

async function safeJson(response) {
  try { return await response.json() } catch { return {} }
}

async function request(url, options = {}, timeoutMs = 10000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), Math.max(1000, Number(timeoutMs) || 10000))
  timer.unref?.()
  try {
    return await fetchImplementation(url, { ...options, signal: controller.signal })
  } catch (error) {
    if (error?.name === 'AbortError') throw new GroqApiError('A Groq não respondeu dentro do limite.', { code: 'GROQ_TIMEOUT' })
    throw new GroqApiError('Não foi possível alcançar a Groq.', { code: 'GROQ_NETWORK' })
  } finally {
    clearTimeout(timer)
  }
}

function headers(token) {
  return {
    authorization: `Bearer ${String(token || '').trim()}`,
    'content-type': 'application/json',
    accept: 'application/json'
  }
}

export async function listGroqModels(token, { timeoutMs = 8000, forceRefresh = false } = {}) {
  const key = modelCacheKey(token)
  if (!key) throw new GroqApiError('Token Groq ausente.', { code: 'GROQ_TOKEN_MISSING' })
  const cached = modelCache.get(key)
  if (!forceRefresh && cached && cached.expiresAt > Date.now()) return [...cached.models]
  const response = await request(`${settings.aiBaseUrl}/models`, { method: 'GET', headers: headers(token) }, timeoutMs)
  const body = await safeJson(response)
  if (!response.ok) {
    throw new GroqApiError(String(body?.error?.message || 'A Groq não conseguiu listar os modelos disponíveis.'), {
      statusCode: response.status,
      retryAfterMs: retryAfterMs(response.headers),
      code: body?.error?.code || body?.error?.type || `GROQ_HTTP_${response.status}`
    })
  }
  const models = (Array.isArray(body?.data) ? body.data : [])
    .map(row => String(row?.id || '').trim())
    .filter(Boolean)
  modelCache.set(key, { models, expiresAt: Date.now() + MODEL_CACHE_TTL_MS })
  return [...models]
}

export async function resolveGroqModel(token, requestedModel = '', { preferred = [], exclude = [], timeoutMs = 8000, forceRefresh = false } = {}) {
  const models = await listGroqModels(token, { timeoutMs, forceRefresh })
  const blocked = new Set(exclude.map(value => String(value || '').trim()).filter(Boolean))
  const available = new Set(models.filter(model => !blocked.has(model)))
  const requested = String(requestedModel || '').trim()
  if (requested && available.has(requested)) return { model: requested, changed: false, available: models }
  const candidates = [
    ...preferred,
    ...PREFERRED_CHAT_MODELS,
    ...models.filter(looksLikeChatModel)
  ].map(value => String(value || '').trim()).filter(value => value && !blocked.has(value))
  const model = candidates.find(candidate => available.has(candidate)) || ''
  return { model, changed: Boolean(model && model !== requested), available: models }
}

export async function validateGroqToken(token, { timeoutMs = 8000 } = {}) {
  const response = await request(`${settings.aiBaseUrl}/models`, { method: 'GET', headers: headers(token) }, timeoutMs)
  const body = await safeJson(response)
  if (!response.ok) {
    throw new GroqApiError(String(body?.error?.message || 'A Groq recusou o token informado.'), {
      statusCode: response.status,
      retryAfterMs: retryAfterMs(response.headers),
      code: body?.error?.code || body?.error?.type || `GROQ_HTTP_${response.status}`
    })
  }
  return { valid: true, models: Array.isArray(body?.data) ? body.data.length : 0 }
}

export async function groqChat({ token, model, messages, timeoutMs = 12000, maxOutputTokens = 320, temperature = 0.8 } = {}) {
  const response = await request(`${settings.aiBaseUrl}/chat/completions`, {
    method: 'POST',
    headers: headers(token),
    body: JSON.stringify({
      model,
      messages,
      temperature: Math.max(0.1, Math.min(2, Number(temperature) || 0.8)),
      max_tokens: Math.max(64, Math.min(1000, Math.floor(Number(maxOutputTokens) || 320))),
      n: 1,
      stream: false
    })
  }, timeoutMs)
  const body = await safeJson(response)
  if (!response.ok) {
    throw new GroqApiError(String(body?.error?.message || 'A Groq não conseguiu gerar a resposta.'), {
      statusCode: response.status,
      retryAfterMs: retryAfterMs(response.headers),
      code: body?.error?.code || body?.error?.type || `GROQ_HTTP_${response.status}`
    })
  }
  const content = body?.choices?.[0]?.message?.content
  if (typeof content !== 'string' || !content.trim()) throw new GroqApiError('A Groq retornou uma resposta vazia.', { code: 'GROQ_EMPTY_RESPONSE' })
  return {
    text: content.trim(),
    usage: body?.usage || {},
    model: body?.model || model
  }
}

export function setAiFetchImplementationForTests(fn) {
  fetchImplementation = typeof fn === 'function' ? fn : (...args) => fetch(...args)
  modelCache.clear()
}
