import { openDatabase } from './database.js'

const store = openDatabase('brat-usage', { version: 1, users: {} })
const digits = value => String(value || '').replace(/\D/g, '')
const dayKey = now => new Date(Number(now) || Date.now()).toISOString().slice(0, 10)

export async function consumeBratQuota(number, { vip = false, limit = 10, now = Date.now() } = {}) {
  const key = digits(number)
  const max = Math.max(1, Number(limit) || 10)
  if (vip) return { allowed: true, unlimited: true, used: 0, remaining: Infinity, limit: max }
  if (!key) return { allowed: false, unlimited: false, used: max, remaining: 0, limit: max }
  const day = dayKey(now)
  return store.update(db => {
    db.version = 1
    if (!db.users || typeof db.users !== 'object') db.users = {}
    let row = db.users[key]
    if (!row || row.day !== day) row = { day, used: 0 }
    const used = Math.max(0, Number(row.used) || 0)
    if (used >= max) {
      db.users[key] = { day, used }
      return { allowed: false, unlimited: false, used, remaining: 0, limit: max }
    }
    row.used = used + 1
    db.users[key] = row
    return { allowed: true, unlimited: false, used: row.used, remaining: Math.max(0, max - row.used), limit: max }
  })
}
