import { randomBytes } from 'node:crypto'
import { openDatabase } from './database.js'
import { settings } from './settings.js'
import { SHOP_ITEMS } from './economy.js'

const store = openDatabase(settings.economyDb, {
  version: 7,
  users: {},
  ledger: {},
  marketOffers: {},
  groupEconomy: {},
  serial: 0
})

const MAX_SAFE_BALANCE = 1_000_000_000
const OFFER_TTL_MS = 10 * 60_000
const MAX_PENDING_OFFERS = 5
const MAX_SHOP_LISTINGS = 8
const SHOP_FEE_RATE = 0.03
const nowIso = () => new Date().toISOString()
const clampInt = (value, min = 0, max = MAX_SAFE_BALANCE) => Math.min(max, Math.max(min, Math.floor(Number(value) || 0)))
const digits = value => String(value || '').replace(/\D/g, '')
const dayKey = (date = new Date()) => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Recife', year: 'numeric', month: '2-digit', day: '2-digit'
}).format(date)

export const INVESTMENT_PLANS = Object.freeze({
  conservador: {
    id: 'conservador', name: 'Jardim Conservador', icon: '💮', durationMs: 6 * 60 * 60_000,
    min: 500, max: 50_000, minRate: 0.03, maxRate: 0.05, lossChance: 0, maxLossRate: 0,
    description: 'Retorno pequeno e estável em 6 horas.'
  },
  equilibrado: {
    id: 'equilibrado', name: 'Lago Equilibrado', icon: '💮', durationMs: 12 * 60 * 60_000,
    min: 1_000, max: 80_000, minRate: 0.05, maxRate: 0.10, lossChance: 0.15, maxLossRate: 0.02,
    description: 'Retorno moderado com risco baixo em 12 horas.'
  },
  arrojado: {
    id: 'arrojado', name: 'Trilha Arrojada', icon: '🌸', durationMs: 24 * 60 * 60_000,
    min: 2_500, max: 120_000, minRate: 0.08, maxRate: 0.18, lossChance: 0.25, maxLossRate: 0.08,
    description: 'Maior retorno possível, com risco controlado em 24 horas.'
  }
})

export const PET_CATALOG = Object.freeze({
  momo: { id: 'momo', name: 'Momo', icon: '🐾', price: 4_000, gold: 0, bonus: 'trabalho', bonusPerLevel: 0.03, maxLevel: 5, description: 'Aumenta moderadamente os ganhos de trabalho.' },
  kitsune: { id: 'kitsune', name: 'Kitsune', icon: '🦊', price: 8_000, gold: 100, bonus: 'mineracao', bonusPerLevel: 0.04, maxLevel: 5, description: 'Ajuda a encontrar mais ouro na Mina Sakura.' },
  pinguim: { id: 'pinguim', name: 'Yuki', icon: '🐧', price: 6_000, gold: 40, bonus: 'investimento', bonusPerLevel: 0.02, maxLevel: 5, description: 'Melhora levemente os resultados dos investimentos.' },
  dragao: { id: 'dragao', name: 'Ryuu Sakura', icon: '🐉', price: 20_000, gold: 500, bonus: 'geral', bonusPerLevel: 0.02, maxLevel: 5, description: 'Concede um pequeno bônus em várias atividades.' }
})

export const HOUSE_CATALOG = Object.freeze({
  nenhuma: { id: 'nenhuma', level: 0, name: 'Sem casa', icon: '🚫', price: 0, gold: 0, sleepReductionMs: 0, dailySleeps: 0 },
  cabana: { id: 'cabana', level: 1, name: 'Cabana Sakura', icon: '🛖', price: 5_000, gold: 0, sleepReductionMs: 10 * 60_000, dailySleeps: 1 },
  casa: { id: 'casa', level: 2, name: 'Casa de Cerejeira', icon: '🏠', price: 15_000, gold: 100, sleepReductionMs: 20 * 60_000, dailySleeps: 1 },
  mansao: { id: 'mansao', level: 3, name: 'Mansão Hanami', icon: '🏡', price: 50_000, gold: 500, sleepReductionMs: 35 * 60_000, dailySleeps: 2 },
  palacio: { id: 'palacio', level: 4, name: 'Palácio Sakura', icon: '🏰', price: 120_000, gold: 1_500, sleepReductionMs: 50 * 60_000, dailySleeps: 2 }
})

function ensureRoot(db) {
  db.version = Math.max(7, clampInt(db.version))
  db.users ||= {}
  db.ledger ||= {}
  db.marketOffers ||= {}
  db.groupEconomy ||= {}
  db.serial = clampInt(db.serial)
  return db
}

function freshPart3() {
  return {
    investments: { active: [], history: [] },
    shop: { name: '', createdAt: '', listings: {}, sales: 0, revenue: 0, purchases: 0 },
    pets: { owned: {}, active: '' },
    house: { id: 'nenhuma', sleepDay: '', sleepsToday: 0, totalSleeps: 0, lastSleepAt: 0 },
    market: { offersCreated: 0, sales: 0, purchases: 0, volume: 0 },
    part3Stats: { investedTotal: 0, investmentProfit: 0, investmentClaims: 0 }
  }
}

function user(db, number) {
  ensureRoot(db)
  const key = digits(number)
  if (!key) throw new TypeError('Número de usuário inválido.')
  const a = db.users[key] ||= {
    wallet: 250, bank: 0, gold: 0, inventory: {}, cooldowns: {}, mining: { lastAt: 0 },
    stats: { earned: 250, spent: 0 }, joinedAt: nowIso(), updatedAt: nowIso()
  }
  a.wallet = clampInt(a.wallet)
  a.bank = clampInt(a.bank)
  a.gold = clampInt(a.gold)
  a.inventory ||= {}
  a.cooldowns ||= {}
  a.mining ||= { lastAt: 0 }
  a.stats ||= { earned: 0, spent: 0 }
  const base = freshPart3()
  a.investments = { ...base.investments, ...(a.investments || {}) }
  a.investments.active = Array.isArray(a.investments.active) ? a.investments.active : []
  a.investments.history = Array.isArray(a.investments.history) ? a.investments.history.slice(0, 20) : []
  a.shop = { ...base.shop, ...(a.shop || {}) }
  a.shop.listings ||= {}
  a.shop.sales = clampInt(a.shop.sales)
  a.shop.revenue = clampInt(a.shop.revenue)
  a.shop.purchases = clampInt(a.shop.purchases)
  a.pets = { ...base.pets, ...(a.pets || {}) }
  a.pets.owned ||= {}
  a.pets.active = PET_CATALOG[a.pets.active] && a.pets.owned[a.pets.active] ? a.pets.active : ''
  a.house = { ...base.house, ...(a.house || {}) }
  a.house.id = HOUSE_CATALOG[a.house.id] ? a.house.id : 'nenhuma'
  a.house.sleepsToday = clampInt(a.house.sleepsToday, 0, 10)
  a.house.totalSleeps = clampInt(a.house.totalSleeps)
  a.house.lastSleepAt = clampInt(a.house.lastSleepAt, 0, Number.MAX_SAFE_INTEGER)
  a.market = { ...base.market, ...(a.market || {}) }
  a.part3Stats = { ...base.part3Stats, ...(a.part3Stats || {}) }
  for (const field of Object.keys(base.market)) a.market[field] = clampInt(a.market[field])
  for (const field of Object.keys(base.part3Stats)) a.part3Stats[field] = clampInt(a.part3Stats[field], -MAX_SAFE_BALANCE, MAX_SAFE_BALANCE)
  return a
}

function snapshot(value) { return structuredClone(value) }

function nextId(db, prefix) {
  db.serial = clampInt(db.serial + 1)
  return `${prefix}-${Date.now().toString(36)}-${db.serial.toString(36)}-${randomBytes(2).toString('hex')}`.toUpperCase()
}

function addLedger(db, number, entry) {
  const key = digits(number)
  const list = db.ledger[key] ||= []
  list.unshift({ id: nextId(db, 'TX'), at: nowIso(), ...entry })
  if (list.length > 60) list.length = 60
}

function cleanShopName(value) {
  const text = String(value || '')
    .normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/@/g, '')
    .replace(/https?:\/\/\S+/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 32)
  const blocked = /\b(porra|caralho|nazista|racista|estupro)\b/i
  return text.length >= 3 && !blocked.test(text) ? text : ''
}

function petInvestmentMultiplier(account) {
  const id = account.pets?.active
  const pet = PET_CATALOG[id]
  const owned = account.pets?.owned?.[id]
  if (!pet || !owned || !['investimento', 'geral'].includes(pet.bonus)) return 1
  return 1 + Math.min(0.10, pet.bonusPerLevel * clampInt(owned.level, 1, pet.maxLevel))
}

function groupRow(db, chat) {
  const key = String(chat || '').trim()
  if (!key) return null
  const row = db.groupEconomy[key] ||= { day: dayKey(), limit: 100_000, emitted: 0, moved: 0, operations: 0, updatedAt: nowIso() }
  if (row.day !== dayKey()) {
    row.day = dayKey(); row.emitted = 0; row.moved = 0; row.operations = 0
  }
  row.limit = clampInt(row.limit, 10_000, 10_000_000)
  return row
}

function grantProfit(db, chat, requested) {
  const amount = clampInt(requested)
  const row = groupRow(db, chat)
  if (!row) return { granted: amount, limited: false }
  const remaining = Math.max(0, row.limit - clampInt(row.emitted))
  const granted = Math.min(amount, remaining)
  row.emitted = clampInt(row.emitted + granted)
  row.operations = clampInt(row.operations + 1)
  row.updatedAt = nowIso()
  return { granted, limited: granted < amount }
}

function recordMovement(db, chat, amount) {
  const row = groupRow(db, chat)
  if (!row) return
  row.moved = clampInt(row.moved + clampInt(amount))
  row.operations = clampInt(row.operations + 1)
  row.updatedAt = nowIso()
}

function refundOffer(db, offer) {
  if (!offer || offer.refunded || offer.status === 'accepted') return
  const seller = user(db, offer.from)
  seller.inventory[offer.itemId] = clampInt(Number(seller.inventory[offer.itemId] || 0) + clampInt(offer.quantity))
  offer.refunded = true
}

function cleanupOffers(db) {
  const now = Date.now()
  for (const [id, offer] of Object.entries(db.marketOffers || {})) {
    if (offer.status !== 'pending' && Number(offer.closedAt || offer.expiresAt || 0) < now - 7 * 24 * 60 * 60_000) {
      delete db.marketOffers[id]
      continue
    }
    if (offer.status !== 'pending') continue
    if (Number(offer.expiresAt || 0) > now) continue
    refundOffer(db, offer)
    offer.status = 'expired'
    offer.closedAt = now
  }
}

export async function getPart3Account(number) {
  return store.update(db => snapshot(user(db, number)))
}

export async function startInvestment(number, planId, amount, { chat = '' } = {}) {
  return store.update(db => {
    const a = user(db, number)
    const plan = INVESTMENT_PLANS[String(planId || '').toLowerCase()]
    const value = clampInt(amount, 1, 120_000)
    if (!plan) return { ok: false, reason: 'plan', account: snapshot(a) }
    if (value < plan.min || value > plan.max) return { ok: false, reason: 'range', min: plan.min, max: plan.max, account: snapshot(a) }
    if (a.investments.active.filter(item => item.status === 'active').length >= 3) return { ok: false, reason: 'limit', account: snapshot(a) }
    if (a.wallet < value) return { ok: false, reason: 'money', account: snapshot(a) }

    const lost = Math.random() < plan.lossChance
    const rateBase = lost
      ? -(Math.random() * plan.maxLossRate)
      : plan.minRate + Math.random() * (plan.maxRate - plan.minRate)
    const petMultiplier = petInvestmentMultiplier(a)
    const rate = lost ? rateBase / petMultiplier : rateBase * petMultiplier
    const resultAmount = clampInt(value + Math.round(value * rate), 0, value * 2)
    const id = nextId(db, 'INV')
    const startedAt = Date.now()
    const investment = {
      id, planId: plan.id, amount: value, resultAmount, expectedDelta: resultAmount - value,
      startedAt, endsAt: startedAt + plan.durationMs, status: 'active', chat: String(chat || '')
    }
    a.wallet -= value
    a.stats.spent = clampInt(Number(a.stats.spent || 0) + value)
    a.part3Stats.investedTotal = clampInt(a.part3Stats.investedTotal + value)
    a.investments.active.push(investment)
    addLedger(db, number, { type: 'investment-start', direction: 'out', amount: value, note: plan.name, balance: a.wallet })
    a.updatedAt = nowIso()
    return { ok: true, investment: snapshot(investment), plan: snapshot(plan), account: snapshot(a) }
  })
}

export async function listInvestments(number) {
  return store.update(db => {
    const a = user(db, number)
    return { active: snapshot(a.investments.active), history: snapshot(a.investments.history), account: snapshot(a) }
  })
}

export async function claimInvestment(number, id, { chat = '' } = {}) {
  return store.update(db => {
    const a = user(db, number)
    const investment = a.investments.active.find(item => item.id === String(id || '').toUpperCase() && item.status === 'active')
    if (!investment) return { ok: false, reason: 'unknown', account: snapshot(a) }
    if (Date.now() < investment.endsAt) return { ok: false, reason: 'pending', left: investment.endsAt - Date.now(), investment: snapshot(investment), account: snapshot(a) }

    const rawDelta = clampInt(investment.resultAmount - investment.amount, -MAX_SAFE_BALANCE, MAX_SAFE_BALANCE)
    let profit = rawDelta
    let limited = false
    if (rawDelta > 0) {
      const grant = grantProfit(db, chat || investment.chat, rawDelta)
      profit = grant.granted
      limited = grant.limited
    }
    const payout = clampInt(investment.amount + profit)
    a.wallet = clampInt(a.wallet + payout)
    a.stats.earned = clampInt(Number(a.stats.earned || 0) + payout)
    a.part3Stats.investmentProfit = clampInt(a.part3Stats.investmentProfit + profit, -MAX_SAFE_BALANCE, MAX_SAFE_BALANCE)
    a.part3Stats.investmentClaims = clampInt(a.part3Stats.investmentClaims + 1)
    investment.status = 'claimed'
    investment.claimedAt = Date.now()
    investment.actualProfit = profit
    investment.payout = payout
    investment.limited = limited
    a.investments.active = a.investments.active.filter(item => item.id !== investment.id)
    a.investments.history.unshift(snapshot(investment))
    if (a.investments.history.length > 20) a.investments.history.length = 20
    addLedger(db, number, { type: 'investment-claim', direction: 'in', amount: payout, note: `Resgate ${investment.planId}`, balance: a.wallet })
    a.updatedAt = nowIso()
    return { ok: true, investment: snapshot(investment), payout, profit, limited, account: snapshot(a) }
  })
}

export async function createTradeOffer(from, to, itemId, quantity, price, chat) {
  return store.update(db => {
    ensureRoot(db); cleanupOffers(db)
    const seller = user(db, from)
    user(db, to)
    const item = SHOP_ITEMS[String(itemId || '').toLowerCase()]
    const qty = clampInt(quantity, 1, 20)
    const totalPrice = clampInt(price, 1, 2_000_000)
    if (!item) return { ok: false, reason: 'item', account: snapshot(seller) }
    if (digits(from) === digits(to)) return { ok: false, reason: 'self', account: snapshot(seller) }
    const pendingCount = Object.values(db.marketOffers).filter(row => row.status === 'pending' && row.from === digits(from)).length
    if (pendingCount >= MAX_PENDING_OFFERS) return { ok: false, reason: 'limit', account: snapshot(seller) }
    if (clampInt(seller.inventory[itemId]) < qty) return { ok: false, reason: 'stock', account: snapshot(seller) }
    seller.inventory[itemId] -= qty
    if (seller.inventory[itemId] <= 0) delete seller.inventory[itemId]
    const id = nextId(db, 'OFR')
    const offer = {
      id, from: digits(from), to: digits(to), itemId: String(itemId).toLowerCase(), quantity: qty,
      price: totalPrice, chat: String(chat || ''), status: 'pending', createdAt: Date.now(), expiresAt: Date.now() + OFFER_TTL_MS, refunded: false
    }
    db.marketOffers[id] = offer
    seller.market.offersCreated = clampInt(seller.market.offersCreated + 1)
    seller.updatedAt = nowIso()
    return { ok: true, offer: snapshot(offer), item: { id: offer.itemId, ...item }, account: snapshot(seller) }
  })
}

export async function listTradeOffers(number, chat = '') {
  return store.update(db => {
    ensureRoot(db); cleanupOffers(db)
    const key = digits(number)
    const rows = Object.values(db.marketOffers)
      .filter(row => row.status === 'pending' && (!chat || row.chat === String(chat)) && (row.from === key || row.to === key))
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 20)
    return snapshot(rows)
  })
}

export async function acceptTradeOffer(id, by, chat = '') {
  return store.update(db => {
    ensureRoot(db); cleanupOffers(db)
    const offer = db.marketOffers[String(id || '').toUpperCase()]
    if (!offer || offer.status !== 'pending') return { ok: false, reason: 'expired' }
    if (offer.to !== digits(by)) return { ok: false, reason: 'target' }
    if (chat && offer.chat !== String(chat)) return { ok: false, reason: 'chat' }
    const seller = user(db, offer.from)
    const buyer = user(db, offer.to)
    if (buyer.wallet < offer.price) return { ok: false, reason: 'money', account: snapshot(buyer) }
    buyer.wallet -= offer.price
    seller.wallet = clampInt(seller.wallet + offer.price)
    buyer.inventory[offer.itemId] = clampInt(Number(buyer.inventory[offer.itemId] || 0) + offer.quantity)
    buyer.stats.spent = clampInt(Number(buyer.stats.spent || 0) + offer.price)
    seller.stats.earned = clampInt(Number(seller.stats.earned || 0) + offer.price)
    seller.market.sales = clampInt(seller.market.sales + 1)
    seller.market.volume = clampInt(seller.market.volume + offer.price)
    buyer.market.purchases = clampInt(buyer.market.purchases + 1)
    buyer.market.volume = clampInt(buyer.market.volume + offer.price)
    offer.status = 'accepted'; offer.closedAt = Date.now(); offer.refunded = true
    recordMovement(db, chat || offer.chat, offer.price)
    addLedger(db, offer.from, { type: 'trade-sale', direction: 'in', amount: offer.price, peer: offer.to, note: `${offer.itemId} x${offer.quantity}`, balance: seller.wallet })
    addLedger(db, offer.to, { type: 'trade-buy', direction: 'out', amount: offer.price, peer: offer.from, note: `${offer.itemId} x${offer.quantity}`, balance: buyer.wallet })
    return { ok: true, offer: snapshot(offer), item: { id: offer.itemId, ...SHOP_ITEMS[offer.itemId] }, seller: snapshot(seller), buyer: snapshot(buyer) }
  })
}

export async function closeTradeOffer(id, by, action = 'cancel', chat = '') {
  return store.update(db => {
    ensureRoot(db); cleanupOffers(db)
    const offer = db.marketOffers[String(id || '').toUpperCase()]
    if (!offer || offer.status !== 'pending') return { ok: false, reason: 'expired' }
    const actor = digits(by)
    const allowed = action === 'reject' ? offer.to === actor : offer.from === actor
    if (!allowed) return { ok: false, reason: 'permission' }
    if (chat && offer.chat !== String(chat)) return { ok: false, reason: 'chat' }
    refundOffer(db, offer)
    offer.status = action === 'reject' ? 'rejected' : 'cancelled'
    offer.closedAt = Date.now()
    return { ok: true, offer: snapshot(offer), account: snapshot(user(db, offer.from)) }
  })
}

export async function createUserShop(number, name) {
  return store.update(db => {
    const a = user(db, number)
    const clean = cleanShopName(name)
    if (!clean) return { ok: false, reason: 'name', account: snapshot(a) }
    if (!a.shop.createdAt) a.shop.createdAt = nowIso()
    a.shop.name = clean
    a.updatedAt = nowIso()
    return { ok: true, shop: snapshot(a.shop), account: snapshot(a) }
  })
}

export async function getUserShop(number) {
  return store.update(db => {
    const a = user(db, number)
    return { owner: digits(number), shop: snapshot(a.shop), account: snapshot(a) }
  })
}

export async function addShopListing(number, itemId, quantity, unitPrice) {
  return store.update(db => {
    const a = user(db, number)
    if (!a.shop.name) return { ok: false, reason: 'shop', account: snapshot(a) }
    const idItem = String(itemId || '').toLowerCase()
    const item = SHOP_ITEMS[idItem]
    const qty = clampInt(quantity, 1, 50)
    const price = clampInt(unitPrice, 1, 500_000)
    if (!item) return { ok: false, reason: 'item', account: snapshot(a) }
    if (Object.keys(a.shop.listings).length >= MAX_SHOP_LISTINGS) return { ok: false, reason: 'limit', account: snapshot(a) }
    if (clampInt(a.inventory[idItem]) < qty) return { ok: false, reason: 'stock', account: snapshot(a) }
    a.inventory[idItem] -= qty
    if (a.inventory[idItem] <= 0) delete a.inventory[idItem]
    const listingId = nextId(db, 'ANU')
    const listing = { id: listingId, itemId: idItem, stock: qty, unitPrice: price, createdAt: Date.now() }
    a.shop.listings[listingId] = listing
    a.updatedAt = nowIso()
    return { ok: true, listing: snapshot(listing), item: { id: idItem, ...item }, shop: snapshot(a.shop), account: snapshot(a) }
  })
}

export async function removeShopListing(number, listingId) {
  return store.update(db => {
    const a = user(db, number)
    const id = String(listingId || '').toUpperCase()
    const listing = a.shop.listings[id]
    if (!listing) return { ok: false, reason: 'unknown', account: snapshot(a) }
    a.inventory[listing.itemId] = clampInt(Number(a.inventory[listing.itemId] || 0) + clampInt(listing.stock))
    delete a.shop.listings[id]
    a.updatedAt = nowIso()
    return { ok: true, listing: snapshot(listing), account: snapshot(a) }
  })
}

export async function buyFromUserShop(buyerNumber, ownerNumber, listingId, quantity = 1, chat = '') {
  return store.update(db => {
    const buyer = user(db, buyerNumber)
    const owner = user(db, ownerNumber)
    if (digits(buyerNumber) === digits(ownerNumber)) return { ok: false, reason: 'self', account: snapshot(buyer) }
    const id = String(listingId || '').toUpperCase()
    const listing = owner.shop.listings[id]
    const qty = clampInt(quantity, 1, 20)
    if (!listing || listing.stock < qty) return { ok: false, reason: 'stock', account: snapshot(buyer) }
    const total = clampInt(listing.unitPrice * qty, 1, 5_000_000)
    if (buyer.wallet < total) return { ok: false, reason: 'money', total, account: snapshot(buyer) }
    const fee = Math.max(1, Math.floor(total * SHOP_FEE_RATE))
    const sellerReceives = total - fee
    buyer.wallet -= total
    owner.wallet = clampInt(owner.wallet + sellerReceives)
    listing.stock -= qty
    if (listing.stock <= 0) delete owner.shop.listings[id]
    buyer.inventory[listing.itemId] = clampInt(Number(buyer.inventory[listing.itemId] || 0) + qty)
    buyer.stats.spent = clampInt(Number(buyer.stats.spent || 0) + total)
    owner.stats.earned = clampInt(Number(owner.stats.earned || 0) + sellerReceives)
    owner.shop.sales = clampInt(owner.shop.sales + qty)
    owner.shop.revenue = clampInt(owner.shop.revenue + sellerReceives)
    buyer.shop.purchases = clampInt(buyer.shop.purchases + qty)
    owner.market.sales = clampInt(owner.market.sales + qty)
    buyer.market.purchases = clampInt(buyer.market.purchases + qty)
    recordMovement(db, chat, total)
    addLedger(db, ownerNumber, { type: 'user-shop-sale', direction: 'in', amount: sellerReceives, peer: digits(buyerNumber), note: `${listing.itemId} x${qty} • taxa ${fee}`, balance: owner.wallet })
    addLedger(db, buyerNumber, { type: 'user-shop-buy', direction: 'out', amount: total, peer: digits(ownerNumber), note: `${listing.itemId} x${qty}`, balance: buyer.wallet })
    return {
      ok: true, listing: snapshot(listing), item: { id: listing.itemId, ...SHOP_ITEMS[listing.itemId] }, quantity: qty,
      total, fee, sellerReceives, buyer: snapshot(buyer), owner: snapshot(owner)
    }
  })
}

export async function buyPet(number, petId) {
  return store.update(db => {
    const a = user(db, number)
    const id = String(petId || '').toLowerCase()
    const pet = PET_CATALOG[id]
    if (!pet) return { ok: false, reason: 'unknown', account: snapshot(a) }
    if (a.pets.owned[id]) return { ok: false, reason: 'owned', account: snapshot(a) }
    if (a.wallet < pet.price || a.gold < pet.gold) return { ok: false, reason: 'money', account: snapshot(a) }
    a.wallet -= pet.price; a.gold -= pet.gold
    a.stats.spent = clampInt(Number(a.stats.spent || 0) + pet.price)
    a.pets.owned[id] = { level: 1, xp: 0, obtainedAt: nowIso() }
    if (!a.pets.active) a.pets.active = id
    addLedger(db, number, { type: 'pet-buy', direction: 'out', amount: pet.price, gold: -pet.gold, note: pet.name, balance: a.wallet })
    return { ok: true, pet: snapshot(pet), active: a.pets.active === id, account: snapshot(a) }
  })
}

export async function setActivePet(number, petId) {
  return store.update(db => {
    const a = user(db, number)
    const id = String(petId || '').toLowerCase()
    if (!PET_CATALOG[id] || !a.pets.owned[id]) return { ok: false, reason: 'unknown', account: snapshot(a) }
    a.pets.active = id
    a.updatedAt = nowIso()
    return { ok: true, pet: snapshot(PET_CATALOG[id]), owned: snapshot(a.pets.owned[id]), account: snapshot(a) }
  })
}

export async function evolvePet(number, petId) {
  return store.update(db => {
    const a = user(db, number)
    const id = String(petId || a.pets.active || '').toLowerCase()
    const pet = PET_CATALOG[id]
    const owned = a.pets.owned[id]
    if (!pet || !owned) return { ok: false, reason: 'unknown', account: snapshot(a) }
    if (owned.level >= pet.maxLevel) return { ok: false, reason: 'max', account: snapshot(a) }
    const nextLevel = owned.level + 1
    const petals = 2_500 * nextLevel
    const gold = 40 * nextLevel
    if (a.wallet < petals || a.gold < gold) return { ok: false, reason: 'money', petals, gold, account: snapshot(a) }
    a.wallet -= petals; a.gold -= gold; owned.level = nextLevel
    a.stats.spent = clampInt(Number(a.stats.spent || 0) + petals)
    addLedger(db, number, { type: 'pet-evolve', direction: 'out', amount: petals, gold: -gold, note: `${pet.name} Nv.${nextLevel}`, balance: a.wallet })
    return { ok: true, pet: snapshot(pet), owned: snapshot(owned), petals, gold, account: snapshot(a) }
  })
}

export async function getPets(number) {
  return store.update(db => {
    const a = user(db, number)
    return { catalog: snapshot(PET_CATALOG), pets: snapshot(a.pets), account: snapshot(a) }
  })
}

export async function buyHouse(number, houseId) {
  return store.update(db => {
    const a = user(db, number)
    const id = String(houseId || '').toLowerCase()
    const target = HOUSE_CATALOG[id]
    const current = HOUSE_CATALOG[a.house.id] || HOUSE_CATALOG.nenhuma
    if (!target || target.level !== current.level + 1) return { ok: false, reason: target?.level <= current.level ? 'owned' : 'order', current: snapshot(current), account: snapshot(a) }
    if (a.wallet < target.price || a.gold < target.gold) return { ok: false, reason: 'money', current: snapshot(current), target: snapshot(target), account: snapshot(a) }
    a.wallet -= target.price; a.gold -= target.gold
    a.stats.spent = clampInt(Number(a.stats.spent || 0) + target.price)
    a.house.id = id
    addLedger(db, number, { type: 'house-buy', direction: 'out', amount: target.price, gold: -target.gold, note: target.name, balance: a.wallet })
    return { ok: true, previous: snapshot(current), house: snapshot(target), account: snapshot(a) }
  })
}

export async function getHouse(number) {
  return store.update(db => {
    const a = user(db, number)
    const house = HOUSE_CATALOG[a.house.id] || HOUSE_CATALOG.nenhuma
    if (a.house.sleepDay !== dayKey()) { a.house.sleepDay = dayKey(); a.house.sleepsToday = 0 }
    return { house: snapshot(house), state: snapshot(a.house), account: snapshot(a) }
  })
}

export async function sleepAtHome(number) {
  return store.update(db => {
    const a = user(db, number)
    const house = HOUSE_CATALOG[a.house.id] || HOUSE_CATALOG.nenhuma
    const today = dayKey()
    if (house.level < 1) return { ok: false, reason: 'house', account: snapshot(a) }
    if (a.house.sleepDay !== today) { a.house.sleepDay = today; a.house.sleepsToday = 0 }
    if (a.house.sleepsToday >= house.dailySleeps) return { ok: false, reason: 'limit', house: snapshot(house), account: snapshot(a) }
    const reduction = house.sleepReductionMs
    a.lastWork = Math.max(0, Number(a.lastWork || 0) - reduction)
    a.mining.lastAt = Math.max(0, Number(a.mining.lastAt || 0) - reduction)
    for (const key of ['pescar', 'explorar', 'jardim', 'crime']) {
      if (a.cooldowns[key]) a.cooldowns[key] = Math.max(0, Number(a.cooldowns[key]) - reduction)
    }
    a.house.sleepsToday += 1
    a.house.totalSleeps += 1
    a.house.lastSleepAt = Date.now()
    a.updatedAt = nowIso()
    return { ok: true, reduction, house: snapshot(house), state: snapshot(a.house), account: snapshot(a) }
  })
}

export async function investmentRanking(limit = 10) {
  const db = await store.read(); ensureRoot(db)
  return Object.entries(db.users).map(([number, value]) => {
    const a = user(db, number)
    return { number, invested: a.part3Stats.investedTotal, profit: a.part3Stats.investmentProfit, claims: a.part3Stats.investmentClaims }
  }).filter(row => row.invested > 0 || row.claims > 0).sort((a, b) => b.invested - a.invested || b.profit - a.profit).slice(0, clampInt(limit, 1, 25))
}

export async function sellerRanking(limit = 10) {
  const db = await store.read(); ensureRoot(db)
  return Object.entries(db.users).map(([number]) => {
    const a = user(db, number)
    return { number, sales: a.market.sales, volume: a.market.volume }
  }).filter(row => row.volume > 0 || row.sales > 0).sort((a, b) => b.volume - a.volume || b.sales - a.sales).slice(0, clampInt(limit, 1, 25))
}

export async function shopRanking(limit = 10) {
  const db = await store.read(); ensureRoot(db)
  return Object.entries(db.users).map(([number]) => {
    const a = user(db, number)
    return { number, name: a.shop.name, sales: a.shop.sales, revenue: a.shop.revenue }
  }).filter(row => row.name).sort((a, b) => b.revenue - a.revenue || b.sales - a.sales).slice(0, clampInt(limit, 1, 25))
}

export async function petRanking(limit = 10) {
  const db = await store.read(); ensureRoot(db)
  return Object.entries(db.users).map(([number]) => {
    const a = user(db, number)
    const owned = Object.values(a.pets.owned || {})
    return { number, count: owned.length, levels: owned.reduce((sum, pet) => sum + clampInt(pet.level), 0), active: a.pets.active }
  }).filter(row => row.count > 0).sort((a, b) => b.levels - a.levels || b.count - a.count).slice(0, clampInt(limit, 1, 25))
}

export async function houseRanking(limit = 10) {
  const db = await store.read(); ensureRoot(db)
  return Object.entries(db.users).map(([number]) => {
    const a = user(db, number)
    const house = HOUSE_CATALOG[a.house.id] || HOUSE_CATALOG.nenhuma
    return { number, house: snapshot(house), sleeps: a.house.totalSleeps }
  }).filter(row => row.house.level > 0).sort((a, b) => b.house.level - a.house.level || b.sleeps - a.sleeps).slice(0, clampInt(limit, 1, 25))
}

export function formatPart3Duration(ms) {
  const value = Math.max(0, Number(ms) || 0)
  const hours = Math.floor(value / 3_600_000)
  const minutes = Math.ceil((value % 3_600_000) / 60_000)
  if (hours) return `${hours}h ${minutes}min`
  return `${Math.max(1, minutes)}min`
}
