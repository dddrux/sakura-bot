import assert from 'node:assert/strict'

let formatter
try {
  formatter = await import('../ranking-format.js')
} catch (error) {
  assert.fail(`formatador de ranking ainda não existe: ${error?.code || error?.message}`)
}

const rows = [
  { name: 'Ana', label: '98% 🌸' },
  { name: 'Bruno', label: '91% 🌸' },
  { name: 'Carla', label: '84% 🌸' },
  { name: 'Davi', label: '77% 🌸' },
  { name: 'Eli', label: '70% 🌸' }
]

const body = formatter.formatRankingBody(rows, { title: 'RANK GAY' })
assert.match(body, /🥇\s+Ana/u)
assert.match(body, /🥈\s+Bruno/u)
assert.match(body, /🥉\s+Carla/u)
assert.match(body, /🌸\s*4º\s+Davi/u)
assert.match(body, /🌸\s*5º\s+Eli/u)
assert.doesNotMatch(body, /\d+\.\s+[^\n]+\s+—\s+/u)
assert.match(body, /🥇\s+Ana\n\s+98%/u)
assert.match(body, /╭━━⪩\s+🪷\s+\*RANK GAY\*/u)

console.log('✅ RC11 rankings: top 3 com medalhas, posições restantes com 🌸 e layout em duas linhas aprovados')
