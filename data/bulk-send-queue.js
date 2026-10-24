import { settings } from './settings.js'

const queue = []
const pendingKeys = new Set()
const sentAt = []
const lastSentByChat = new Map()
let running = false
let paused = false
let currentJob = null

const sleep = ms => new Promise(resolve => setTimeout(resolve, Math.max(0, Number(ms) || 0)))

function jitter() {
  const min = Math.min(settings.bulkSendMinDelayMs, settings.bulkSendMaxDelayMs)
  const max = Math.max(settings.bulkSendMinDelayMs, settings.bulkSendMaxDelayMs)
  return Math.floor(min + Math.random() * Math.max(1, max - min + 1))
}

async function rateLimit(chat = '') {
  let now = Date.now()
  while (sentAt.length && sentAt[0] <= now - 60_000) sentAt.shift()
  if (sentAt.length >= settings.bulkSendPerMinute) {
    await sleep(Math.max(1_000, sentAt[0] + 60_000 - now))
    now = Date.now()
    while (sentAt.length && sentAt[0] <= now - 60_000) sentAt.shift()
  }
  const chatKey = String(chat || '')
  if (chatKey) {
    const last = Number(lastSentByChat.get(chatKey) || 0)
    const wait = last + settings.bulkSendPerChatDelayMs - now
    if (wait > 0) await sleep(wait)
  }
}

async function pump() {
  if (running || paused) return
  running = true
  try {
    while (queue.length && !paused) {
      const job = queue.shift()
      currentJob = job
      await rateLimit(job.chat)
      try {
        const result = await job.task()
        const now = Date.now()
        sentAt.push(now)
        if (job.chat) lastSentByChat.set(job.chat, now)
        job.resolve(result)
      } catch (error) {
        job.reject(error)
      } finally {
        if (job.key) pendingKeys.delete(job.key)
        currentJob = null
      }
      if (queue.length && !paused) await sleep(jitter())
    }
  } finally {
    currentJob = null
    running = false
  }
}

export function enqueueBulkSend(task, { key = '', chat = '', maxPending = 500 } = {}) {
  if (typeof task !== 'function') return Promise.reject(new TypeError('Tarefa de envio inválida.'))
  const normalizedKey = String(key || '').slice(0, 240)
  const normalizedChat = String(chat || '').slice(0, 180)
  if (normalizedKey && pendingKeys.has(normalizedKey)) return Promise.resolve({ skipped: true, reason: 'duplicate' })
  if (queue.length >= Math.max(10, Number(maxPending) || 500)) {
    return Promise.reject(Object.assign(new Error('Fila de envio em massa cheia.'), { code: 'BULK_QUEUE_FULL' }))
  }
  if (normalizedKey) pendingKeys.add(normalizedKey)
  return new Promise((resolve, reject) => {
    queue.push({ task, key: normalizedKey, chat: normalizedChat, resolve, reject, queuedAt: Date.now() })
    void pump()
  })
}

export function bulkSendQueueStatus() {
  const oldest = queue.length ? Math.min(...queue.map(job => job.queuedAt)) : 0
  return {
    running,
    paused,
    pending: queue.length,
    uniquePending: pendingKeys.size,
    currentKey: currentJob?.key || '',
    currentChat: currentJob?.chat || '',
    oldestQueuedAt: oldest,
    sentLastMinute: sentAt.filter(value => value > Date.now() - 60_000).length,
    limitPerMinute: settings.bulkSendPerMinute,
    perChatDelayMs: settings.bulkSendPerChatDelayMs,
    trackedChats: lastSentByChat.size
  }
}

export function setBulkSendQueuePaused(value = true) {
  paused = Boolean(value)
  if (!paused) void pump()
  return bulkSendQueueStatus()
}

export function cancelBulkSendJobs(match = '') {
  const term = String(match || '')
  const error = Object.assign(new Error(`Envio cancelado: ${term || 'solicitação administrativa'}`), { code: 'BULK_QUEUE_CANCELLED' })
  let removed = 0
  for (let index = queue.length - 1; index >= 0; index -= 1) {
    const job = queue[index]
    if (term && !job.key.includes(term) && !job.chat.includes(term)) continue
    queue.splice(index, 1)
    if (job.key) pendingKeys.delete(job.key)
    job.reject(error)
    removed += 1
  }
  return removed
}

export function clearBulkSendQueue(reason = 'cancelled') {
  const error = Object.assign(new Error(`Fila cancelada: ${reason}`), { code: 'BULK_QUEUE_CANCELLED' })
  let removed = 0
  while (queue.length) {
    const job = queue.shift()
    if (job.key) pendingKeys.delete(job.key)
    job.reject(error)
    removed += 1
  }
  return removed
}
