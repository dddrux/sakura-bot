import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sakura-v0354-pvp-'))
const dbFile = path.join(tempDir, 'economy.db')
process.env.SAKURA_ECONOMY_DB = dbFile

const economy = await import('../economy.js')
const { openDatabase } = await import('../database.js')

const alice = '5581999994001'
const bob = '5581999994002'
const chat = '120363444444444444@g.us'

await economy.register(alice)
await economy.register(bob)
const store = openDatabase(dbFile, {})
await store.update(db => {
  db.users[alice].xp = 210_000
  db.users[alice].level = 52
  db.users[alice].pickaxe = 'sakura'
  db.users[alice].pets = { active: 'dragao', owned: { dragao: { level: 5 } } }
  db.users[alice].house = { id: 'palacio' }
  db.users[bob].xp = 0
  db.users[bob].level = 1
  db.users[bob].pickaxe = 'madeira'
})

const preview = await economy.previewPvpMatch(alice, bob)
if (preview.from.stats.hp <= preview.to.stats.hp) throw new Error('atributos avançados não influenciaram a prévia PVP')
if (preview.from.power <= preview.to.power) throw new Error('poder estimado não refletiu os atributos')

const cancellable = await economy.beginPvpChallenge(alice, bob, chat)
if (!cancellable.ok) throw new Error('convite cancelável não foi criado')
const wrongCancel = await economy.cancelPvpChallenge(cancellable.id, bob, chat)
if (wrongCancel.ok || wrongCancel.reason !== 'owner') throw new Error('alvo conseguiu cancelar convite de outra pessoa')
const cancelled = await economy.cancelPvpChallenge(cancellable.id, alice, chat)
if (!cancelled.ok) throw new Error('desafiante não conseguiu cancelar o próprio convite')

async function battle() {
  const challenge = await economy.beginPvpChallenge(alice, bob, chat)
  if (!challenge.ok) throw new Error(`desafio não criado: ${challenge.reason}`)
  const result = await economy.acceptPvpChallenge(challenge.id, bob, chat)
  if (!result.ok) throw new Error(`batalha não concluída: ${result.reason}`)
  return result
}

const first = await battle()
if (!first.combat || !Array.isArray(first.combat.events) || !first.combat.events.length) throw new Error('combate não gerou eventos em rodadas')
if (first.combat.rounds < 1 || first.combat.rounds > 5) throw new Error('quantidade de rodadas inválida')
if (first.fromAccount.pvp.damageDealt + first.toAccount.pvp.damageDealt <= 0) throw new Error('dano PVP não foi persistido')
if (first.fromAccount.pvp.damageDealt !== first.combat.from.damage || first.toAccount.pvp.damageDealt !== first.combat.to.damage) throw new Error('dano persistido divergiu do combate')
if (first.fromAccount.pvp.pvpXp <= 0 || first.toAccount.pvp.pvpXp <= 0) throw new Error('XP PVP não foi concedida')
if (!first.fromAccount.pvp.lastOpponents.includes(bob) || !first.toAccount.pvp.lastOpponents.includes(alice)) throw new Error('últimos adversários não foram registrados')
if (!Number.isInteger(first.ratingDeltaFrom) || !Number.isInteger(first.ratingDeltaTo)) throw new Error('variação de rating inválida')
if (first.ratingDeltaFrom !== -first.ratingDeltaTo) throw new Error('rating deixou de ser soma zero')
const history = first.fromAccount.pvp.history[0]
if (!history || history.rounds < 1 || history.damage <= 0 || !Number.isInteger(history.ratingDelta)) throw new Error('histórico detalhado incompleto')

await store.update(db => {
  db.users[alice].pvp.lastBattleAt = 0
  db.users[bob].pvp.lastBattleAt = 0
})
await battle()
await store.update(db => {
  db.users[alice].pvp.lastBattleAt = 0
  db.users[bob].pvp.lastBattleAt = 0
})
const third = await battle()
if (third.ratingDeltaFrom !== 0 || third.ratingDeltaTo !== 0) throw new Error('anti-farm não bloqueou rating após repetição excessiva')
if (third.result !== 'draw' && third.rewardMultiplier !== 0) throw new Error('anti-farm não bloqueou recompensa financeira')

const ratingRank = await economy.pvpRanking(10, 'rating')
const damageRank = await economy.pvpRanking(10, 'damage')
if (!ratingRank.some(row => row.number === alice && row.rating >= 100)) throw new Error('ranking de rating não retornou a conta')
if (damageRank[0]?.damageDealt <= 0) throw new Error('ranking de dano não foi ordenado')

const raw = await store.read()
if (raw.version !== 7) throw new Error('migração econômica v7 não foi aplicada')
if (raw.users[alice].pvp.history.length !== 3) throw new Error('histórico das três batalhas não persistiu')

store.close()
fs.rmSync(tempDir, { recursive: true, force: true })
console.log('✅ Parte 4: rodadas, atributos, rating, XP PVP, dano, cancelamento, anti-farm e rankings aprovados')
