import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'sakura-brat-quota-'))
process.env.SAKURA_DB_FILE = path.join(tmp, 'db.json')
const { consumeBratQuota } = await import(`../brat-quota.js?test=${Date.now()}`)
const number = '5511999991234'
const now = Date.parse('2026-08-27T12:00:00Z')
for (let index = 1; index <= 10; index += 1) {
  const row = await consumeBratQuota(number, { vip: false, now })
  assert.equal(row.allowed, true, `uso ${index} deveria ser permitido`)
  assert.equal(row.used, index)
}
const blocked = await consumeBratQuota(number, { vip: false, now })
assert.equal(blocked.allowed, false)
assert.equal(blocked.limit, 10)
const unlimited = await consumeBratQuota(number, { vip: true, now })
assert.equal(unlimited.allowed, true)
assert.equal(unlimited.unlimited, true)

const brat = await fs.readFile(new URL('../../commands/brat.js', import.meta.url), 'utf8')
assert.match(brat, /isVip:\s*vipAccess/)
assert.match(brat, /const vip = Boolean\(vipAccess\)/)
assert.match(brat, /consumeBratQuota/)
assert.match(brat, /rainbow/i)
assert.match(brat, /parsed\.theme\s*===\s*['\"]rainbow['\"]/)
const media = await fs.readFile(new URL('../media.js', import.meta.url), 'utf8')
assert.match(media, /rainbow:\s*\{\s*key:\s*['\"]rainbow['\"]/)
assert.match(media, /hsl\(/i, 'background animado rainbow deve variar hue por frame')
console.log('✅ brat: limite grátis 10 + VIP ilimitado + rainbow animado')
