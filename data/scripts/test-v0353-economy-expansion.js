import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sakura-v0353-'))
const dbFile = path.join(tempDir, 'economy-test.db')
process.env.SAKURA_ECONOMY_DB = dbFile

const economy = await import('../economy.js')
const part3 = await import('../economy-part3.js')
const { openDatabase } = await import('../database.js')

const alice = '5581999993001'
const bob = '5581999993002'
const chat = '120363035300000001'

await economy.register(alice)
await economy.register(bob)
const store = openDatabase(dbFile, {})
await store.update(db => {
  db.users[alice].wallet = 500_000
  db.users[alice].gold = 10_000
  db.users[alice].inventory = { madeira: 30, cristal: 20, fita: 20 }
  db.users[bob].wallet = 500_000
  db.users[bob].gold = 10_000
  db.users[bob].inventory = { madeira: 10 }
})

const investment = await part3.startInvestment(alice, 'conservador', 5_000, { chat })
if (!investment.ok || !investment.investment.id) throw new Error('investimento não foi criado')
await store.update(db => {
  db.users[alice].investments.active[0].endsAt = Date.now() - 1
})
const claimed = await part3.claimInvestment(alice, investment.investment.id, { chat })
if (!claimed.ok || claimed.payout <= 0) throw new Error('investimento não foi resgatado')
const duplicateClaim = await part3.claimInvestment(alice, investment.investment.id, { chat })
if (duplicateClaim.ok) throw new Error('investimento permitiu resgate duplicado')

const offer = await part3.createTradeOffer(alice, bob, 'madeira', 2, 1_000, chat)
if (!offer.ok) throw new Error('oferta entre membros não foi criada')
const accepted = await part3.acceptTradeOffer(offer.offer.id, bob, chat)
if (!accepted.ok || accepted.buyer.inventory.madeira < 2) throw new Error('oferta não foi aceita atomicamente')
const duplicateOffer = await part3.acceptTradeOffer(offer.offer.id, bob, chat)
if (duplicateOffer.ok) throw new Error('oferta permitiu aceite duplicado')

const shop = await part3.createUserShop(alice, 'Jardim da Alice')
if (!shop.ok || shop.shop.name !== 'Jardim da Alice') throw new Error('loja própria não foi criada')
const listing = await part3.addShopListing(alice, 'cristal', 3, 700)
if (!listing.ok) throw new Error('anúncio não foi criado')
const purchase = await part3.buyFromUserShop(bob, alice, listing.listing.id, 2, chat)
if (!purchase.ok || purchase.quantity !== 2 || purchase.fee < 1) throw new Error('compra em loja própria falhou')

const pet = await part3.buyPet(alice, 'momo')
if (!pet.ok || !pet.active) throw new Error('pet não foi comprado e ativado')
const evolved = await part3.evolvePet(alice, 'momo')
if (!evolved.ok || evolved.owned.level !== 2) throw new Error('evolução de pet falhou')

const house = await part3.buyHouse(alice, 'cabana')
if (!house.ok || house.house.level !== 1) throw new Error('casa inicial não foi comprada')
await store.update(db => {
  db.users[alice].lastWork = Date.now()
  db.users[alice].mining.lastAt = Date.now()
})
const rested = await part3.sleepAtHome(alice)
if (!rested.ok || rested.reduction !== 10 * 60_000) throw new Error('descanso da casa falhou')
const restAgain = await part3.sleepAtHome(alice)
if (restAgain.ok || restAgain.reason !== 'limit') throw new Error('limite diário de descanso falhou')

const limit = await economy.setGroupEconomyLimit(chat, 25_000)
if (!limit.ok || limit.limit !== 25_000) throw new Error('limite econômico do grupo não foi salvo')
const status = await economy.getGroupEconomyStatus(chat)
if (!status || status.moved < 2_400) throw new Error('circulação do grupo não foi registrada')

await store.update(db => {
  db.users[alice].inventory.chave = 1
  db.groupEconomy[chat].emitted = db.groupEconomy[chat].limit
})
const beforeBlocked = await economy.getAccount(alice)
const blockedSale = await economy.sellItem(alice, 'madeira', 1, { chat })
const blockedKey = await economy.useItem(alice, 'chave', { chat })
const afterBlocked = await economy.getAccount(alice)
if (blockedSale.ok || blockedSale.reason !== 'group-limit') throw new Error('venda ao sistema ignorou o limite do grupo')
if (blockedKey.ok || blockedKey.reason !== 'group-limit') throw new Error('caixa ignorou o limite do grupo')
if (afterBlocked.inventory.madeira !== beforeBlocked.inventory.madeira || afterBlocked.inventory.chave !== beforeBlocked.inventory.chave) {
  throw new Error('item foi consumido em operação bloqueada pelo limite do grupo')
}

const investorRank = await part3.investmentRanking(10)
const sellerRank = await part3.sellerRanking(10)
const shopRank = await part3.shopRanking(10)
const petRank = await part3.petRanking(10)
const houseRank = await part3.houseRanking(10)
if (investorRank[0]?.number !== alice) throw new Error('ranking de investidores inválido')
if (!sellerRank.some(row => row.number === alice)) throw new Error('ranking de vendedores inválido')
if (shopRank[0]?.number !== alice) throw new Error('ranking de lojas inválido')
if (petRank[0]?.number !== alice) throw new Error('ranking de pets inválido')
if (houseRank[0]?.number !== alice) throw new Error('ranking de casas inválido')

const raw = await store.read()
if (raw.version < 6 || !raw.marketOffers || !raw.groupEconomy) throw new Error('migração econômica acumulativa incompleta')
const aliceRaw = raw.users[alice]
if (!aliceRaw.investments || !aliceRaw.shop || !aliceRaw.pets || !aliceRaw.house) throw new Error('campos da Parte 3 não foram persistidos')

store.close()
fs.rmSync(tempDir, { recursive: true, force: true })
console.log('✅ Parte 3: investimentos, comércio, lojas, pets, casas, circulação e rankings aprovados')
