import fs from 'node:fs/promises'
import path from 'node:path'

export const PANEL_LOGIN_POLICY = Object.freeze({
  maxFailures: 5,
  windowMs: 10 * 60_000,
  blockMs: 15 * 60_000,
  maxTrackedClients: 500
})

export class LoginRateLimiter {
  constructor(policy = PANEL_LOGIN_POLICY) {
    this.policy = { ...PANEL_LOGIN_POLICY, ...policy }
    this.clients = new Map()
  }

  prune(now = Date.now()) {
    for (const [key, row] of this.clients) {
      const lastRelevant = Math.max(Number(row.windowStartedAt || 0), Number(row.blockedUntil || 0))
      if (now - lastRelevant > Math.max(this.policy.windowMs, this.policy.blockMs) * 2) this.clients.delete(key)
    }
    while (this.clients.size > this.policy.maxTrackedClients) this.clients.delete(this.clients.keys().next().value)
  }

  status(key, now = Date.now()) {
    this.prune(now)
    const id = String(key || 'unknown').slice(0, 200)
    const row = this.clients.get(id)
    if (!row) return { allowed: true, remainingMs: 0, failures: 0 }
    if (row.blockedUntil > now) return { allowed: false, remainingMs: row.blockedUntil - now, failures: row.failures }
    if (now - row.windowStartedAt >= this.policy.windowMs) {
      this.clients.delete(id)
      return { allowed: true, remainingMs: 0, failures: 0 }
    }
    return { allowed: true, remainingMs: 0, failures: row.failures }
  }

  failure(key, now = Date.now()) {
    const id = String(key || 'unknown').slice(0, 200)
    const current = this.clients.get(id)
    const expired = !current || now - Number(current.windowStartedAt || 0) >= this.policy.windowMs
    const row = expired ? { failures: 0, windowStartedAt: now, blockedUntil: 0 } : current
    row.failures += 1
    if (row.failures >= this.policy.maxFailures) row.blockedUntil = now + this.policy.blockMs
    this.clients.set(id, row)
    this.prune(now)
    return this.status(id, now)
  }

  success(key) {
    this.clients.delete(String(key || 'unknown').slice(0, 200))
  }
}

export function panelSecurityHeaders(contentType = 'application/json; charset=utf-8') {
  return {
    'content-type': contentType,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'referrer-policy': 'no-referrer',
    'permissions-policy': 'camera=(), microphone=(), geolocation=()',
    'content-security-policy': "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
  }
}

export async function writeInitialPanelPassword(file, password) {
  const target = path.resolve(file)
  await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 })
  await fs.writeFile(target, `Senha inicial do painel Sakura-MD:\n${String(password)}\n\nAltere a senha no painel; este arquivo será removido automaticamente.\n`, { mode: 0o600 })
  try { await fs.chmod(target, 0o600) } catch {}
  return target
}

export async function removeInitialPanelPassword(file) {
  await fs.rm(path.resolve(file), { force: true }).catch(() => {})
}
