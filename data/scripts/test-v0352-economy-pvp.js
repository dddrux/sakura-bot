import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sakura-v0352-'))
const dbFile = path.join(tempDir, 'economy-test.db')
process.env.SAKURA_ECONOMY_DB = dbFile

const economy = await import('../economy.js')
const { openDatabase } = await import('../database.js')

const alice = '5581999990001'
const bob = '5581999990002'
const chat = '120363000000000000@g.us'

const first = await economy.register(alice)
const second = await economy.register(bob)
if (!first.created || !second.created) throw new Error('contas de teste não foram criadas')
if (first.account.gold !== 0 || first.account.pickaxe !== 'madeira') throw new Error('migração padrão de mineração inválida')
if (first.account.pvp?.battles !== 0) throw new Error('migração padrão PVP inválida')

const mined = await economy.mineGold(alice)
if (!mined.ok || mined.gold < 1 || mined.petals < 1) throw new Error('mineração não entregou ouro e Pétalas')
const cooldown = await economy.mineGold(alice)
if (cooldown.ok || cooldown.reason !== 'cooldown' || cooldown.left <= 0) throw new Error('cooldown de mineração falhou')

const store = openDatabase(dbFile, {})
await store.update(db => {
  const account = db.users[alice]
  account.wallet = 100_000
  account.gold = 10_000
  account.inventory = { ...(account.inventory || {}), madeira: 50, cristal: 50, dourada: 50, rosa: 5 }
  account.mining.lastAt = 0
})

const upgraded = await economy.upgradePickaxe(alice)
if (!upgraded.ok || upgraded.pickaxe.id !== 'pedra') throw new Error('melhoria de picareta falhou')
const exchanged = await economy.convertGold(alice, 10)
if (!exchanged.ok || exchanged.petals !== 10 * economy.getGoldRate()) throw new Error('conversão de ouro falhou')

const box = await economy.claimDailyBox(alice)
if (!box.ok || box.petals <= 0 || box.gold <= 0) throw new Error('caixa diária falhou')
const duplicateBox = await economy.claimDailyBox(alice)
if (duplicateBox.ok || duplicateBox.reason !== 'already') throw new Error('proteção contra caixa duplicada falhou')

const self = await economy.beginPvpChallenge(alice, alice, chat)
if (self.ok || self.reason !== 'self') throw new Error('PVP permitiu autodesafio')
const challenge = await economy.beginPvpChallenge(alice, bob, chat)
if (!challenge.ok || !challenge.id) throw new Error('desafio PVP não foi criado')
const duplicateChallenge = await economy.beginPvpChallenge(alice, bob, chat)
if (duplicateChallenge.ok || duplicateChallenge.reason !== 'busy') throw new Error('PVP permitiu desafios simultâneos')
const wrongAccept = await economy.acceptPvpChallenge(challenge.id, alice, chat)
if (wrongAccept.ok || wrongAccept.reason !== 'target') throw new Error('PVP aceito pela pessoa errada')
const battle = await economy.acceptPvpChallenge(challenge.id, bob, chat)
if (!battle.ok) throw new Error('batalha PVP não foi concluída')
if (battle.fromAccount.pvp.battles !== 1 || battle.toAccount.pvp.battles !== 1) throw new Error('estatísticas PVP não foram persistidas')

const pvpRank = await economy.pvpRanking(10)
const goldRank = await economy.goldRanking(10)
const miningRank = await economy.miningRanking(10)
const pickaxeRank = await economy.pickaxeRanking(10)
if (!pvpRank.some(row => row.number === alice)) throw new Error('ranking PVP não contém conta migrada')
if (goldRank[0]?.number !== alice) throw new Error('ranking de ouro não ordenou corretamente')
if (!miningRank.some(row => row.number === alice)) throw new Error('ranking de mineração vazio')
if (pickaxeRank[0]?.pickaxe?.level < 2) throw new Error('ranking de picareta não refletiu a melhoria')

const raw = await store.read()
if (raw.version < 6 || !raw.pendingBattles || !raw.pvpPairs) throw new Error('migração acumulativa do documento econômico não foi aplicada')
const header = fs.readFileSync(dbFile).subarray(0, 16).toString('utf8')
if (header !== 'SQLite format 3\u0000') throw new Error('banco de teste não é SQLite')
store.close()
fs.rmSync(tempDir, { recursive: true, force: true })

console.log('✅ Parte 2: mineração, ouro, picaretas, caixa diária, PVP, anti-farm e rankings aprovados')
