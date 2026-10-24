import { getMediaKind } from './messages.js'

const TTL_MS = 10 * 60_000
const MAX_PER_USER = 24
const buckets = new Map()

function key(chat = '', sender = '') {
  return `${String(chat)}:${String(sender)}`
}

function pruneBucket(items = [], now = Date.now()) {
  return items.filter(item => now - item.createdAt <= TTL_MS).slice(-MAX_PER_USER)
}

function pruneAll(now = Date.now()) {
  if (buckets.size < 250) return
  for (const [bucketKey, items] of buckets) {
    const kept = pruneBucket(items, now)
    if (kept.length) buckets.set(bucketKey, kept)
    else buckets.delete(bucketKey)
  }
}

export function rememberRecentStickerMedia(msg, chat, sender, now = Date.now()) {
  const kind = getMediaKind(msg?.message)
  if (!['image', 'video'].includes(kind) || !chat || !sender || !msg?.key?.id) return false
  const bucketKey = key(chat, sender)
  const current = pruneBucket(buckets.get(bucketKey) || [], now)
  if (current.some(item => item.id === msg.key.id)) return false
  current.push({ id: msg.key.id, kind, createdAt: now, msg })
  buckets.set(bucketKey, current.slice(-MAX_PER_USER))
  pruneAll(now)
  return true
}

export function listRecentStickerMedia(chat, sender, limit = 20, now = Date.now()) {
  const bucketKey = key(chat, sender)
  const current = pruneBucket(buckets.get(bucketKey) || [], now)
  if (current.length) buckets.set(bucketKey, current)
  else buckets.delete(bucketKey)
  return current.slice(-Math.max(1, Math.min(20, Number(limit) || 20)))
}

export function consumeRecentStickerMedia(chat, sender, limit = 20, now = Date.now()) {
  const bucketKey = key(chat, sender)
  const current = pruneBucket(buckets.get(bucketKey) || [], now)
  const selected = current.slice(-Math.max(1, Math.min(20, Number(limit) || 20)))
  const selectedIds = new Set(selected.map(item => item.id))
  const remaining = current.filter(item => !selectedIds.has(item.id))
  if (remaining.length) buckets.set(bucketKey, remaining)
  else buckets.delete(bucketKey)
  return selected
}

export function clearRecentStickerMedia(chat, sender) {
  return buckets.delete(key(chat, sender))
}

export function recentStickerMediaStats(chat, sender, now = Date.now()) {
  return {
    count: listRecentStickerMedia(chat, sender, 20, now).length,
    ttlMs: TTL_MS,
    max: 20
  }
}

export const STICKER_BATCH_TTL_MS = TTL_MS
