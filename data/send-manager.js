import { AsyncLocalStorage } from 'node:async_hooks'
import { settings } from './settings.js'
import { PriorityScheduler } from './priority-scheduler.js'

const context = new AsyncLocalStorage()
const scheduler = new PriorityScheduler({ concurrency: settings.messageConcurrency, vipBurst: settings.vipBurst, maxPending: settings.maxPendingMessages })
const stats = { sent: 0, retries: 0, failed: 0, totalMs: 0, lastErrorAt: 0 }
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))

function statusCode(error) { return Number(error?.output?.statusCode || error?.statusCode || error?.status || error?.response?.status || 0) }
export function isRetryableSendError(error) {
  const status = statusCode(error)
  if ([408, 409, 425, 429, 500, 502, 503, 504, 515].includes(status)) return true
  const code = String(error?.code || error?.cause?.code || '').toUpperCase()
  if (['ECONNRESET', 'ECONNREFUSED', 'EPIPE', 'ETIMEDOUT', 'ENETUNREACH', 'EHOSTUNREACH'].includes(code)) return true
  return /stream errored out|connection closed|connection reset|timed? ?out|rate.?limit|service unavailable|temporar/i.test(String(error?.message || error || ''))
}

export function withSendPriority(priority, fn) { return context.run({ priority }, fn) }
export async function sendMessageFast(sock, jid, content, sendOptions = {}, managerOptions = {}) {
  if (!sock?.sendMessage) throw new TypeError('sendMessageFast precisa de um socket válido.')
  if (!jid) throw new TypeError('sendMessageFast precisa de um JID.')
  const priority = managerOptions.priority || context.getStore()?.priority || 'normal'
  return scheduler.enqueue(async () => {
    const startedAt = Date.now()
    const retries = Math.max(0, Math.min(4, Number(managerOptions.retries ?? settings.sendRetryCount ?? 1)))
    const baseDelayMs = Math.max(40, Math.min(1500, Number(managerOptions.baseDelayMs ?? 120)))
    let lastError
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      try {
        const sent = await sock.sendMessage(jid, content, sendOptions)
        stats.sent += 1; stats.totalMs += Date.now() - startedAt
        return sent
      } catch (error) {
        lastError = error
        if (attempt >= retries || !isRetryableSendError(error)) break
        stats.retries += 1
        await wait(Math.min(2500, baseDelayMs * (2 ** attempt)))
      }
    }
    stats.failed += 1; stats.lastErrorAt = Date.now(); stats.totalMs += Date.now() - startedAt
    throw lastError
  }, { priority, metadata: { jid } })
}
export function sendManagerSnapshot() { return Object.freeze({ ...stats, averageMs: stats.sent ? Math.round(stats.totalMs / stats.sent) : 0, queue: scheduler.snapshot() }) }
export function createMessageSender(sock, defaults = {}) { return (jid, content, sendOptions = {}, managerOptions = {}) => sendMessageFast(sock, jid, content, { ...defaults, ...sendOptions }, managerOptions) }
