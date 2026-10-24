import { createHash, randomBytes } from 'node:crypto'
import { openDatabase } from './database.js'
import { settings } from './settings.js'

const store = openDatabase(settings.economyDb, {
  version: 7,
  users: {},
  activity: {},
  ledger: {},
  pendingTransfers: {},
  pendingBattles: {},
  pvpPairs: {},
  marketOffers: {},
  groupEconomy: {},
  serial: 0
})

const TZ = 'America/Recife'
const MAX_LEDGER = 60
const TRANSFER_TTL_MS = 2 * 60_000
const BATTLE_TTL_MS = 2 * 60_000
const BATTLE_COOLDOWN_MS = 10 * 60_000
const PVP_HISTORY_LIMIT = 30
const PVP_MAX_ROUNDS = 5
const PVP_BASE_RATING = 1000
const PVP_DAILY_REWARD_LIMIT = 8
const MINING_COOLDOWN_MS = 15 * 60_000
const GOLD_TO_PETALS = 12
const DEFAULT_GROUP_EMISSION_LIMIT = 100_000
const MAX_SAFE_BALANCE = 1_000_000_000
const nowIso = () => new Date().toISOString()
const dayKey = (date = new Date()) => new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit'
}).format(date)
const clampInt = (value, min = 0, max = MAX_SAFE_BALANCE) => Math.min(max, Math.max(min, Math.floor(Number(value) || 0)))
const randomInt = (min, max) => min + Math.floor(Math.random() * (max - min + 1))

export const JOBS = Object.freeze({
  florista: { name: 'Florista', icon: '💮', wait: 20 * 60_000, min: 110, max: 240, xp: 18 },
  entregador: { name: 'Entregador', icon: '💮', wait: 30 * 60_000, min: 160, max: 330, xp: 24 },
  designer: { name: 'Designer', icon: '🌸', wait: 45 * 60_000, min: 230, max: 470, xp: 32 },
  dev: { name: 'Dev', icon: '🌸', wait: 60 * 60_000, min: 320, max: 650, xp: 42 }
})

export const SHOP_ITEMS = Object.freeze({
  selo: { name: 'Selo de Cerejeira', icon: '🛡️', price: 900, sell: 450, description: 'Protege sua carteira por 6 horas.' },
  energia: { name: 'Chá de Energia', icon: '🍵', price: 520, sell: 260, description: 'Libera o próximo turno de trabalho.' },
  trevo: { name: 'Trevo Rosa', icon: '🍀', price: 700, sell: 350, description: 'Melhora a próxima aventura arriscada.' },
  cupom: { name: 'Cupom Hanami', icon: '🎟️', price: 650, sell: 325, description: 'Aumenta o próximo pagamento de trabalho.' },
  chave: { name: 'Chave Sakura', icon: '🗝️', price: 480, sell: 240, description: 'Abre uma caixa surpresa de Sakura Coins.' },
  rosa: { name: 'Rosa Rara', icon: '🌹', price: 1200, sell: 600, description: 'Colecionável raro do Jardim Sakura.' },
  madeira: { name: 'Galho Sakura', icon: '🪵', price: 140, sell: 70, kind: 'material', description: 'Material usado no Ateliê.' },
  cristal: { name: 'Cristal Lunar', icon: '💎', price: 220, sell: 110, kind: 'material', description: 'Material raro usado no Ateliê.' },
  fita: { name: 'Fita Rosa', icon: '🎀', price: 100, sell: 50, kind: 'material', description: 'Material delicado usado no Ateliê.' },
  dourada: { name: 'Pétala Dourada', icon: '✨', price: 320, sell: 160, kind: 'material', description: 'Material especial para criações raras.' }
})

export const RECIPES = Object.freeze({
  chave: { name: 'Chave Sakura', icon: '🗝️', output: 'chave', quantity: 1, needs: { madeira: 2, fita: 1 } },
  selo: { name: 'Selo de Cerejeira', icon: '🛡️', output: 'selo', quantity: 1, needs: { cristal: 1, fita: 2 } },
  trevo: { name: 'Trevo Rosa', icon: '🍀', output: 'trevo', quantity: 1, needs: { cristal: 1, dourada: 1 } },
  rosa: { name: 'Rosa Rara', icon: '🌹', output: 'rosa', quantity: 1, needs: { cristal: 2, dourada: 2, fita: 1 } }
})

export const PICKAXES = Object.freeze({
  madeira: {
    id: 'madeira', level: 1, name: 'Picareta de Madeira', icon: '🪵', multiplier: 1,
    description: 'Picareta inicial, simples e confiável.', cost: null
  },
  pedra: {
    id: 'pedra', level: 2, name: 'Picareta de Pedra', icon: '🪨', multiplier: 1.3,
    description: 'Aumenta a coleta de ouro em 30%.', cost: { gold: 80, petals: 900, items: { madeira: 3 } }
  },
  ferro: {
    id: 'ferro', level: 3, name: 'Picareta de Ferro', icon: '⚙️', multiplier: 1.65,
    description: 'Aumenta a coleta de ouro em 65%.', cost: { gold: 220, petals: 2400, items: { madeira: 4, cristal: 2 } }
  },
  dourada: {
    id: 'dourada', level: 4, name: 'Picareta Dourada', icon: '🪙', multiplier: 2.05,
    description: 'Dobra a coleta e melhora achados raros.', cost: { gold: 550, petals: 6500, items: { cristal: 4, dourada: 2 } }
  },
  diamante: {
    id: 'diamante', level: 5, name: 'Picareta de Diamante', icon: '💎', multiplier: 2.55,
    description: 'Picareta avançada para grandes minerações.', cost: { gold: 1100, petals: 14000, items: { cristal: 8, dourada: 5 } }
  },
  sakura: {
    id: 'sakura', level: 6, name: 'Picareta Sakura', icon: '💮', multiplier: 3.2,
    description: 'Nível máximo da Parte 2.', cost: { gold: 2500, petals: 32000, items: { cristal: 14, dourada: 10, rosa: 1 } }
  }
})

const PICKAXE_ORDER = Object.freeze(Object.keys(PICKAXES))

const DAILY_BOX_REWARDS = Object.freeze([
  { weight: 34, petals: [180, 420], gold: [2, 7], label: 'Caixa Comum' },
  { weight: 26, petals: [350, 700], gold: [6, 14], item: 'madeira', label: 'Caixa de Materiais' },
  { weight: 20, petals: [500, 950], gold: [10, 22], item: 'fita', label: 'Caixa Brilhante' },
  { weight: 13, petals: [750, 1400], gold: [18, 36], item: 'cristal', label: 'Caixa Rara' },
  { weight: 6, petals: [1200, 2400], gold: [35, 70], item: 'dourada', label: 'Caixa Épica' },
  { weight: 1, petals: [2500, 5000], gold: [80, 150], item: 'rosa', label: 'Caixa Lendária' }
])

const ACTIONS = Object.freeze({
  pescar: { name: 'Lago Lunar', icon: '💮', wait: 15 * 60_000, min: 55, max: 190, xp: 15 },
  explorar: { name: 'Trilha Sakura', icon: '🌸', wait: 25 * 60_000, min: 95, max: 290, xp: 22 },
  jardim: { name: 'Jardim Secreto', icon: '🌸', wait: 18 * 60_000, min: 70, max: 210, xp: 17 },
  crime: { name: 'Rota Sombria', icon: '💮', wait: 35 * 60_000, min: 150, max: 460, xp: 27, risk: 0.32 }
})

const QUEST_TEMPLATES = Object.freeze([
  { id: 'turnos', label: 'Complete 2 turnos', event: 'work', target: 2, reward: 300 },
  { id: 'trilha', label: 'Faça 3 jornadas', event: 'action', target: 3, reward: 360 },
  { id: 'colheita', label: 'Ganhe 700 Sakura Coins', event: 'earn', target: 700, reward: 420 },
  { id: 'presente', label: 'Faça 1 transferência', event: 'transfer', target: 1, reward: 280 },
  { id: 'vitrine', label: 'Compre 1 item', event: 'shop', target: 1, reward: 240 }
])

const ACHIEVEMENTS = Object.freeze([
  { id: 'primeiro_mil', name: 'Primeiro Jardim', icon: '💮', reward: 250, test: a => total(a) >= 1000 },
  { id: 'dez_turnos', name: 'Rotina Brilhante', icon: '💮', reward: 420, test: a => a.stats.work >= 10 },
  { id: 'vinte_jornadas', name: 'Viajante Sakura', icon: '🌸', reward: 620, test: a => a.stats.actions >= 20 },
  { id: 'cofre_5k', name: 'Cofre Florido', icon: '🌸', reward: 780, test: a => a.bank >= 5000 },
  { id: 'dez_pix', name: 'Coração Generoso', icon: '🌸', reward: 650, test: a => a.stats.transfersSent >= 10 },
  { id: 'nivel_15', name: 'Guardião Sakura', icon: '💮', reward: 1000, test: a => a.level >= 15 },
  { id: 'ouro_500', name: 'Veio Dourado', icon: '💮', reward: 900, test: a => a.gold >= 500 },
  { id: 'minerador_25', name: 'Minerador Sakura', icon: '💮', reward: 800, test: a => a.mining.sessions >= 25 },
  { id: 'pvp_10', name: 'Duelista Sakura', icon: '🌸', reward: 1100, test: a => a.pvp.wins >= 10 }
])

function ensureRoot(db) {
  db.version = Math.max(7, clampInt(db.version))
  db.users ||= {}
  db.activity ||= {}
  db.ledger ||= {}
  db.pendingTransfers ||= {}
  db.pendingBattles ||= {}
  db.pvpPairs ||= {}
  db.marketOffers ||= {}
  db.groupEconomy ||= {}
  db.serial = clampInt(db.serial)
  return db
}

function freshUser() {
  return {
    wallet: 250,
    bank: 0,
    gold: 0,
    xp: 0,
    level: 1,
    streak: 0,
    job: 'florista',
    lastDaily: '',
    lastDailyBox: '',
    lastWork: 0,
    lastYield: '',
    joinedAt: nowIso(),
    updatedAt: nowIso(),
    cooldowns: {},
    inventory: {},
    buffs: {},
    pickaxe: 'madeira',
    mining: { sessions: 0, totalGold: 0, rareFinds: 0, bestFind: 0, lastAt: 0 },
    pvp: {
      battles: 0, wins: 0, losses: 0, draws: 0,
      currentStreak: 0, bestStreak: 0, lastBattleAt: 0,
      lastOpponent: '', totalPetals: 0, totalGold: 0,
      rewardDay: '', rewardedBattles: 0, history: [],
      rating: PVP_BASE_RATING, bestRating: PVP_BASE_RATING,
      pvpXp: 0, arenaLevel: 1,
      damageDealt: 0, damageTaken: 0, maxHit: 0,
      criticalHits: 0, dodges: 0, itemsWon: 0,
      lastOpponents: [], forfeits: 0
    },
    investments: { active: [], history: [] },
    shop: { name: '', createdAt: '', listings: {}, sales: 0, revenue: 0, purchases: 0 },
    pets: { owned: {}, active: '' },
    house: { id: 'nenhuma', sleepDay: '', sleepsToday: 0, totalSleeps: 0, lastSleepAt: 0 },
    market: { offersCreated: 0, sales: 0, purchases: 0, volume: 0 },
    part3Stats: { investedTotal: 0, investmentProfit: 0, investmentClaims: 0 },
    stats: {
      earned: 250,
      spent: 0,
      work: 0,
      actions: 0,
      robberies: 0,
      transfersSent: 0,
      transfersReceived: 0,
      shopBuys: 0,
      wins: 0,
      losses: 0,
      dailies: 0
    },
    achievements: [],
    quests: { day: '', items: {} }
  }
}

function user(db, number) {
  ensureRoot(db)
  const key = String(number || '').replace(/\D/g, '')
  if (!key) throw new Error('Número de usuário inválido.')
  const a = db.users[key] ||= freshUser()
  const base = freshUser()
  for (const [field, value] of Object.entries(base)) {
    if (a[field] == null) a[field] = structuredClone(value)
  }
  a.wallet = clampInt(a.wallet)
  a.bank = clampInt(a.bank)
  a.gold = clampInt(a.gold)
  a.xp = clampInt(a.xp)
  a.level = Math.max(1, clampInt(a.level, 1))
  a.streak = clampInt(a.streak)
  a.cooldowns ||= {}
  a.inventory ||= {}
  a.buffs ||= {}
  a.pickaxe = PICKAXES[a.pickaxe] ? a.pickaxe : 'madeira'
  a.mining = { ...base.mining, ...(a.mining || {}) }
  a.mining.sessions = clampInt(a.mining.sessions)
  a.mining.totalGold = clampInt(a.mining.totalGold)
  a.mining.rareFinds = clampInt(a.mining.rareFinds)
  a.mining.bestFind = clampInt(a.mining.bestFind)
  a.mining.lastAt = clampInt(a.mining.lastAt, 0, Number.MAX_SAFE_INTEGER)
  a.pvp = { ...base.pvp, ...(a.pvp || {}) }
  for (const field of ['battles','wins','losses','draws','currentStreak','bestStreak','totalPetals','totalGold','rewardedBattles','pvpXp','damageDealt','damageTaken','maxHit','criticalHits','dodges','itemsWon','forfeits']) a.pvp[field] = clampInt(a.pvp[field])
  a.pvp.rating = clampInt(a.pvp.rating ?? PVP_BASE_RATING, 100, 5000)
  a.pvp.bestRating = clampInt(a.pvp.bestRating ?? a.pvp.rating, 100, 5000)
  a.pvp.bestRating = Math.max(a.pvp.bestRating, a.pvp.rating)
  a.pvp.arenaLevel = Math.max(1, clampInt(a.pvp.arenaLevel || 1, 1, 50))
  a.pvp.lastBattleAt = clampInt(a.pvp.lastBattleAt, 0, Number.MAX_SAFE_INTEGER)
  a.pvp.history = Array.isArray(a.pvp.history) ? a.pvp.history.slice(0, PVP_HISTORY_LIMIT) : []
  a.pvp.lastOpponents = Array.isArray(a.pvp.lastOpponents)
    ? a.pvp.lastOpponents.map(value => String(value || '').replace(/\D/g, '')).filter(Boolean).slice(0, 8)
    : []
  a.investments = { ...base.investments, ...(a.investments || {}) }
  a.investments.active = Array.isArray(a.investments.active) ? a.investments.active : []
  a.investments.history = Array.isArray(a.investments.history) ? a.investments.history.slice(0, 20) : []
  a.shop = { ...base.shop, ...(a.shop || {}) }
  a.shop.listings ||= {}
  a.pets = { ...base.pets, ...(a.pets || {}) }
  a.pets.owned ||= {}
  a.house = { ...base.house, ...(a.house || {}) }
  a.market = { ...base.market, ...(a.market || {}) }
  a.part3Stats = { ...base.part3Stats, ...(a.part3Stats || {}) }
  a.stats = { ...base.stats, ...(a.stats || {}) }
  a.achievements = Array.isArray(a.achievements) ? a.achievements : []
  a.quests ||= { day: '', items: {} }
  a.quests.items ||= {}
  return a
}

function snapshot(a) {
  return structuredClone(a)
}

function nextId(db, prefix = 'TX') {
  ensureRoot(db)
  db.serial += 1
  return `${prefix}-${Date.now().toString(36)}-${db.serial.toString(36)}-${randomBytes(2).toString('hex')}`.toUpperCase()
}

function addLedger(db, number, entry) {
  ensureRoot(db)
  const key = String(number)
  const list = db.ledger[key] ||= []
  list.unshift({ id: nextId(db), at: nowIso(), ...entry })
  if (list.length > MAX_LEDGER) list.length = MAX_LEDGER
}

function addXp(a, xp) {
  a.xp = clampInt(a.xp + clampInt(xp))
  a.level = Math.max(1, Math.floor(Math.sqrt(a.xp / 80)) + 1)
  a.updatedAt = nowIso()
}

function pickDailyQuests(number, date = dayKey()) {
  const digest = createHash('sha256').update(`${number}|${date}|sakura-quests`).digest()
  const pool = [...QUEST_TEMPLATES]
  const selected = []
  for (let index = 0; index < 3 && pool.length; index += 1) {
    const position = digest[index] % pool.length
    selected.push(pool.splice(position, 1)[0])
  }
  return selected
}

function ensureQuests(a, number) {
  const today = dayKey()
  if (a.quests.day === today && Object.keys(a.quests.items || {}).length) return
  const items = {}
  for (const quest of pickDailyQuests(number, today)) {
    items[quest.id] = { ...quest, progress: 0, claimed: false }
  }
  a.quests = { day: today, items }
}

function progress(a, number, event, amount = 1) {
  ensureQuests(a, number)
  for (const quest of Object.values(a.quests.items)) {
    if (quest.event !== event || quest.claimed) continue
    quest.progress = Math.min(quest.target, clampInt(quest.progress + amount))
  }
}

function checkAchievements(db, number, a) {
  const unlocked = []
  for (const achievement of ACHIEVEMENTS) {
    if (a.achievements.includes(achievement.id) || !achievement.test(a)) continue
    a.achievements.push(achievement.id)
    a.wallet += achievement.reward
    a.stats.earned += achievement.reward
    addLedger(db, number, {
      type: 'achievement',
      direction: 'in',
      amount: achievement.reward,
      note: achievement.name,
      balance: a.wallet
    })
    unlocked.push({ ...achievement })
  }
  return unlocked
}

function finishMutation(db, number, a) {
  a.updatedAt = nowIso()
  const unlocked = checkAchievements(db, number, a)
  return { account: snapshot(a), unlocked }
}

function cleanupPending(db) {
  const now = Date.now()
  for (const [id, pending] of Object.entries(db.pendingTransfers || {})) {
    if (Number(pending.expiresAt || 0) <= now || pending.status !== 'pending') delete db.pendingTransfers[id]
  }
  for (const [id, pending] of Object.entries(db.pendingBattles || {})) {
    if (Number(pending.expiresAt || 0) <= now || pending.status !== 'pending') delete db.pendingBattles[id]
  }
  for (const [key, timestamps] of Object.entries(db.pvpPairs || {})) {
    const recent = (Array.isArray(timestamps) ? timestamps : []).filter(value => Number(value) > now - 24 * 60 * 60_000)
    if (recent.length) db.pvpPairs[key] = recent.slice(-12)
    else delete db.pvpPairs[key]
  }
}

function groupEconomyRow(db, chat) {
  const key = String(chat || '').trim()
  if (!key) return null
  ensureRoot(db)
  const today = dayKey()
  const row = db.groupEconomy[key] ||= {
    day: today,
    limit: DEFAULT_GROUP_EMISSION_LIMIT,
    emitted: 0,
    moved: 0,
    operations: 0,
    updatedAt: nowIso()
  }
  if (row.day !== today) {
    row.day = today
    row.emitted = 0
    row.moved = 0
    row.operations = 0
  }
  row.limit = clampInt(row.limit, 10_000, 10_000_000)
  row.emitted = clampInt(row.emitted)
  row.moved = clampInt(row.moved)
  row.operations = clampInt(row.operations)
  return row
}

function previewGroupEmission(db, chat, requested) {
  const amount = clampInt(requested)
  const row = groupEconomyRow(db, chat)
  if (!row) return { requested: amount, granted: amount, limited: false, remaining: Number.MAX_SAFE_INTEGER }
  const remaining = Math.max(0, row.limit - row.emitted)
  const granted = Math.min(amount, remaining)
  return { requested: amount, granted, limited: granted < amount, remaining }
}

function limitGroupEmission(db, chat, requested) {
  const preview = previewGroupEmission(db, chat, requested)
  const row = groupEconomyRow(db, chat)
  if (!row) return preview
  row.emitted = clampInt(row.emitted + preview.granted)
  row.operations = clampInt(row.operations + 1)
  row.updatedAt = nowIso()
  return { ...preview, remaining: Math.max(0, row.limit - row.emitted) }
}

function recordGroupMovement(db, chat, amount) {
  const row = groupEconomyRow(db, chat)
  if (!row) return
  row.moved = clampInt(row.moved + clampInt(amount))
  row.operations = clampInt(row.operations + 1)
  row.updatedAt = nowIso()
}

export async function getGroupEconomyStatus(chat) {
  return store.update(db => {
    const row = groupEconomyRow(db, chat)
    if (!row) return null
    return { ...structuredClone(row), remaining: Math.max(0, row.limit - row.emitted) }
  })
}

export async function setGroupEconomyLimit(chat, value) {
  return store.update(db => {
    const row = groupEconomyRow(db, chat)
    if (!row) return { ok: false, reason: 'chat' }
    const limit = clampInt(value, 10_000, 10_000_000)
    row.limit = limit
    row.updatedAt = nowIso()
    return { ok: true, ...structuredClone(row), remaining: Math.max(0, row.limit - row.emitted) }
  })
}

export function total(account) {
  return clampInt(account?.wallet) + clampInt(account?.bank)
}

export function rankName(level) {
  const ranks = [
    [1, 'Broto'], [3, 'Pétala Nova'], [6, 'Jardineiro'], [10, 'Flor de Cerejeira'], [15, 'Guardião Sakura'],
    [22, 'Espírito Floral'], [30, 'Mestre Sakura'], [40, 'Lenda da Primavera'], [55, 'Imperatriz Sakura'], [75, 'Eterno Hanami']
  ]
  return [...ranks].reverse().find(([need]) => Number(level || 1) >= need)?.[1] || 'Broto'
}

export function getJobs() { return structuredClone(JOBS) }
export function getShop() { return structuredClone(SHOP_ITEMS) }
export function getRecipes() { return structuredClone(RECIPES) }
export function getActions() { return structuredClone(ACTIONS) }
export function getPickaxes() { return structuredClone(PICKAXES) }
export function getGoldRate() { return GOLD_TO_PETALS }

export async function recordActivity(number, chat) {
  if (!number || !chat) return
  return store.update(db => {
    ensureRoot(db)
    const group = db.activity[chat] ||= {}
    const row = group[number] ||= { messages: 0, commands: 0, lastSeenAt: '' }
    row.messages += 1
    row.lastSeenAt = nowIso()
  })
}

export async function recordCommand(number, chat) {
  if (!number || !chat) return
  return store.update(db => {
    ensureRoot(db)
    const group = db.activity[chat] ||= {}
    const row = group[number] ||= { messages: 0, commands: 0, lastSeenAt: '' }
    row.commands += 1
    row.lastSeenAt = nowIso()
  })
}

export async function getAccount(number) {
  return store.update(db => {
    const a = user(db, number)
    ensureQuests(a, number)
    return snapshot(a)
  })
}

export async function rewardCoins(number, amount, { reason = 'Recompensa', chat = '', type = 'reward' } = {}) {
  return store.update(db => {
    const a = user(db, number)
    const requested = clampInt(amount)
    const emission = limitGroupEmission(db, chat, requested)
    const reward = emission.granted
    a.wallet = clampInt(a.wallet + reward)
    a.stats.earned = clampInt(Number(a.stats.earned || 0) + reward)
    progress(a, number, 'earn', reward)
    addLedger(db, number, { type, direction: 'in', amount: reward, note: String(reason || 'Recompensa').slice(0, 90), balance: a.wallet })
    return { ok: true, reward, requestedReward: requested, limited: emission.limited, ...finishMutation(db, number, a) }
  })
}

export async function register(number) {
  return store.update(db => {
    ensureRoot(db)
    const existed = Boolean(db.users[number])
    const a = user(db, number)
    ensureQuests(a, number)
    if (!existed) {
      addLedger(db, number, { type: 'welcome', direction: 'in', amount: 250, note: 'Boas-vindas', balance: a.wallet })
    }
    return { account: snapshot(a), created: !existed }
  })
}

export async function daily(number, { vip = false, dailyMultiplier = settings.vipDailyMultiplier, chat = '' } = {}) {
  return store.update(db => {
    const a = user(db, number)
    ensureQuests(a, number)
    const today = dayKey()
    if (a.lastDaily === today) return { ok: false, reason: 'already', account: snapshot(a) }
    const yesterday = dayKey(new Date(Date.now() - 86400000))
    a.streak = a.lastDaily === yesterday ? a.streak + 1 : 1
    const baseReward = 220 + Math.min(a.streak, 20) * 25 + randomInt(0, 80)
    const rawReward = Math.floor(baseReward * (vip ? Math.max(1, Number(dailyMultiplier) || settings.vipDailyMultiplier) : 1) * activePetMultiplier(a, 'daily'))
    const emission = limitGroupEmission(db, chat, rawReward)
    const reward = emission.granted
    a.wallet += reward
    a.lastDaily = today
    a.stats.earned += reward
    a.stats.dailies += 1
    progress(a, number, 'earn', reward)
    addXp(a, 40)
    let item = null
    if (Math.random() < 0.24) {
      const choices = ['chave', 'energia', 'cupom', 'madeira', 'fita']
      item = choices[randomInt(0, choices.length - 1)]
      a.inventory[item] = clampInt(Number(a.inventory[item] || 0) + 1)
    }
    addLedger(db, number, { type: 'daily', direction: 'in', amount: reward, note: `Sequência ${a.streak}`, balance: a.wallet })
    const result = finishMutation(db, number, a)
    return { ok: true, reward, requestedReward: rawReward, limited: emission.limited, item: item ? { id: item, ...SHOP_ITEMS[item] } : null, ...result }
  })
}

export async function setJob(number, jobId) {
  return store.update(db => {
    const a = user(db, number)
    const job = JOBS[jobId]
    if (!job) return { ok: false, reason: 'unknown', account: snapshot(a) }
    a.job = jobId
    a.updatedAt = nowIso()
    return { ok: true, jobId, job: { ...job }, account: snapshot(a) }
  })
}

export async function work(number, { vip = false, workMultiplier = settings.vipWorkMultiplier, chat = '' } = {}) {
  return store.update(db => {
    const a = user(db, number)
    ensureQuests(a, number)
    const jobId = JOBS[a.job] ? a.job : 'florista'
    const job = JOBS[jobId]
    const left = Number(a.lastWork || 0) + job.wait - Date.now()
    if (left > 0) return { ok: false, reason: 'cooldown', left, jobId, job: { ...job }, account: snapshot(a) }
    let multiplier = 1
    if (Number(a.buffs.workBoostUntil || 0) > Date.now()) {
      multiplier = 1.3
      delete a.buffs.workBoostUntil
    }
    const levelBonus = Math.min(250, a.level * 6)
    if (vip) multiplier *= Math.max(1, Number(workMultiplier) || settings.vipWorkMultiplier)
    multiplier *= activePetMultiplier(a, 'work')
    const rawReward = Math.floor((randomInt(job.min, job.max) + levelBonus) * multiplier)
    const emission = limitGroupEmission(db, chat, rawReward)
    const reward = emission.granted
    a.wallet += reward
    a.lastWork = Date.now()
    a.stats.earned += reward
    a.stats.work += 1
    progress(a, number, 'work', 1)
    progress(a, number, 'earn', reward)
    addXp(a, job.xp)
    addLedger(db, number, { type: 'work', direction: 'in', amount: reward, note: job.name, balance: a.wallet })
    const result = finishMutation(db, number, a)
    return { ok: true, reward, requestedReward: rawReward, limited: emission.limited, multiplier, jobId, job: { ...job }, ...result }
  })
}

export async function claimYield(number, { chat = '' } = {}) {
  return store.update(db => {
    const a = user(db, number)
    const today = dayKey()
    if (a.lastYield === today) return { ok: false, reason: 'already', account: snapshot(a) }
    if (a.bank < 500) return { ok: false, reason: 'minimum', account: snapshot(a) }
    const rawReward = Math.max(10, Math.min(800, Math.floor(a.bank * 0.012) + a.level * 2))
    const emission = limitGroupEmission(db, chat, rawReward)
    const reward = emission.granted
    a.bank += reward
    a.lastYield = today
    a.stats.earned += reward
    progress(a, number, 'earn', reward)
    addLedger(db, number, { type: 'yield', direction: 'in', amount: reward, note: 'Rendimento do cofre', balance: a.bank })
    const result = finishMutation(db, number, a)
    return { ok: true, reward, requestedReward: rawReward, limited: emission.limited, ...result }
  })
}

export async function deposit(number, value) {
  return store.update(db => {
    const a = user(db, number)
    const amount = Math.min(a.wallet, clampInt(value))
    if (!amount) return { ok: false, reason: 'money', account: snapshot(a) }
    a.wallet -= amount
    a.bank += amount
    addLedger(db, number, { type: 'deposit', direction: 'move', amount, note: 'Carteira → Cofre', balance: a.bank })
    const result = finishMutation(db, number, a)
    return { ok: true, amount, ...result }
  })
}

export async function withdraw(number, value) {
  return store.update(db => {
    const a = user(db, number)
    const amount = Math.min(a.bank, clampInt(value))
    if (!amount) return { ok: false, reason: 'money', account: snapshot(a) }
    a.bank -= amount
    a.wallet += amount
    addLedger(db, number, { type: 'withdraw', direction: 'move', amount, note: 'Cofre → Carteira', balance: a.wallet })
    const result = finishMutation(db, number, a)
    return { ok: true, amount, ...result }
  })
}

export async function beginTransfer(from, to, value, { chat = '' } = {}) {
  return store.update(db => {
    ensureRoot(db)
    cleanupPending(db)
    const sender = user(db, from)
    user(db, to)
    const amount = clampInt(value, 1, 10_000_000)
    if (!amount || sender.wallet < amount) return { ok: false, reason: 'money', account: snapshot(sender) }
    if (String(from) === String(to)) return { ok: false, reason: 'self', account: snapshot(sender) }
    const id = nextId(db, 'PIX')
    const expiresAt = Date.now() + TRANSFER_TTL_MS
    db.pendingTransfers[id] = { id, from: String(from), to: String(to), amount, chat: String(chat || ''), createdAt: Date.now(), expiresAt, status: 'pending' }
    return { ok: true, id, from: String(from), to: String(to), amount, expiresAt, account: snapshot(sender) }
  })
}

export async function confirmTransfer(id, by) {
  return store.update(db => {
    ensureRoot(db)
    cleanupPending(db)
    const pending = db.pendingTransfers[id]
    if (!pending || pending.status !== 'pending') return { ok: false, reason: 'expired' }
    if (String(pending.from) !== String(by)) return { ok: false, reason: 'owner' }
    const a = user(db, pending.from)
    const b = user(db, pending.to)
    if (a.wallet < pending.amount) {
      delete db.pendingTransfers[id]
      return { ok: false, reason: 'money', account: snapshot(a) }
    }
    a.wallet -= pending.amount
    b.wallet += pending.amount
    a.stats.spent += pending.amount
    b.stats.earned += pending.amount
    a.stats.transfersSent += 1
    b.stats.transfersReceived += 1
    progress(a, pending.from, 'transfer', 1)
    addXp(a, 8)
    addXp(b, 4)
    addLedger(db, pending.from, { type: 'transfer', direction: 'out', amount: pending.amount, peer: pending.to, note: 'PIX Sakura enviado', balance: a.wallet })
    addLedger(db, pending.to, { type: 'transfer', direction: 'in', amount: pending.amount, peer: pending.from, note: 'PIX Sakura recebido', balance: b.wallet })
    recordGroupMovement(db, pending.chat, pending.amount)
    pending.status = 'done'
    delete db.pendingTransfers[id]
    const senderResult = finishMutation(db, pending.from, a)
    const receiverUnlocked = checkAchievements(db, pending.to, b)
    return {
      ok: true,
      id,
      from: pending.from,
      to: pending.to,
      amount: pending.amount,
      ...senderResult,
      receiverAccount: snapshot(b),
      receiverUnlocked
    }
  })
}

export async function cancelTransfer(id, by) {
  return store.update(db => {
    ensureRoot(db)
    const pending = db.pendingTransfers[id]
    if (!pending || pending.status !== 'pending') return { ok: false, reason: 'expired' }
    if (String(pending.from) !== String(by)) return { ok: false, reason: 'owner' }
    delete db.pendingTransfers[id]
    return { ok: true, id }
  })
}

export async function transfer(from, to, value, options = {}) {
  const pending = await beginTransfer(from, to, value, options)
  if (!pending.ok) return pending
  return confirmTransfer(pending.id, from)
}


function pickWeightedReward(entries) {
  const totalWeight = entries.reduce((sum, entry) => sum + clampInt(entry.weight, 1, 1000), 0)
  let cursor = randomInt(1, totalWeight)
  for (const entry of entries) {
    cursor -= clampInt(entry.weight, 1, 1000)
    if (cursor <= 0) return entry
  }
  return entries[0]
}

function pickaxeFor(account) {
  return PICKAXES[account?.pickaxe] || PICKAXES.madeira
}

function activePetMultiplier(account, type) {
  const id = String(account?.pets?.active || '')
  const owned = account?.pets?.owned?.[id]
  if (!owned) return 1
  const level = clampInt(owned.level, 1, 5)
  const rules = {
    momo: { types: ['work'], perLevel: 0.03, max: 0.15 },
    kitsune: { types: ['mining'], perLevel: 0.04, max: 0.20 },
    pinguim: { types: ['daily'], perLevel: 0.02, max: 0.10 },
    dragao: { types: ['work', 'mining', 'daily'], perLevel: 0.02, max: 0.10 }
  }
  const rule = rules[id]
  if (!rule || !rule.types.includes(type)) return 1
  return 1 + Math.min(rule.max, rule.perLevel * level)
}

export async function getMiningStatus(number) {
  const account = await getAccount(number)
  const pickaxe = pickaxeFor(account)
  const left = Math.max(0, Number(account.mining?.lastAt || 0) + MINING_COOLDOWN_MS - Date.now())
  return { account, pickaxe: structuredClone(pickaxe), left, rate: GOLD_TO_PETALS }
}

export async function mineGold(number, { vip = false, chat = '' } = {}) {
  return store.update(db => {
    const a = user(db, number)
    ensureQuests(a, number)
    const pickaxe = pickaxeFor(a)
    const wait = vip ? Math.floor(MINING_COOLDOWN_MS * 0.8) : MINING_COOLDOWN_MS
    const left = Number(a.mining.lastAt || 0) + wait - Date.now()
    if (left > 0) return { ok: false, reason: 'cooldown', left, account: snapshot(a), pickaxe: structuredClone(pickaxe) }

    const base = randomInt(3, 8)
    const levelBonus = Math.min(10, Math.floor(a.level / 6))
    const gold = Math.max(1, Math.floor((base + levelBonus) * pickaxe.multiplier * (vip ? 1.15 : 1) * activePetMultiplier(a, 'mining')))
    const rawPetals = randomInt(25, 80) + pickaxe.level * 12
    const emission = limitGroupEmission(db, chat, rawPetals)
    const petals = emission.granted
    const rareChance = Math.min(0.28, 0.07 + pickaxe.level * 0.025 + (vip ? 0.03 : 0))
    let itemId = null
    if (Math.random() < rareChance) {
      const pool = pickaxe.level >= 4 ? ['cristal', 'dourada', 'dourada', 'chave'] : ['madeira', 'fita', 'cristal']
      itemId = pool[randomInt(0, pool.length - 1)]
      a.inventory[itemId] = clampInt(Number(a.inventory[itemId] || 0) + 1)
      a.mining.rareFinds += 1
    }

    a.gold = clampInt(a.gold + gold)
    a.wallet = clampInt(a.wallet + petals)
    a.stats.earned = clampInt(a.stats.earned + petals)
    a.stats.actions = clampInt(a.stats.actions + 1)
    a.mining.sessions += 1
    a.mining.totalGold = clampInt(a.mining.totalGold + gold)
    a.mining.bestFind = Math.max(a.mining.bestFind, gold)
    a.mining.lastAt = Date.now()
    progress(a, number, 'action', 1)
    progress(a, number, 'earn', petals)
    addXp(a, 20 + pickaxe.level * 3)
    addLedger(db, number, { type: 'mining', direction: 'in', amount: petals, gold, note: pickaxe.name, balance: a.wallet })
    const result = finishMutation(db, number, a)
    return {
      ok: true, gold, petals, requestedPetals: rawPetals, limited: emission.limited, item: itemId ? { id: itemId, ...SHOP_ITEMS[itemId] } : null,
      pickaxe: structuredClone(pickaxe), wait, ...result
    }
  })
}

export async function convertGold(number, quantity) {
  return store.update(db => {
    const a = user(db, number)
    const amount = clampInt(quantity, 1, 1_000_000)
    if (!amount || a.gold < amount) return { ok: false, reason: 'gold', account: snapshot(a), rate: GOLD_TO_PETALS }
    const petals = clampInt(amount * GOLD_TO_PETALS)
    a.gold -= amount
    a.wallet = clampInt(a.wallet + petals)
    a.stats.earned = clampInt(a.stats.earned + petals)
    progress(a, number, 'earn', petals)
    addLedger(db, number, { type: 'gold-exchange', direction: 'in', amount: petals, gold: -amount, note: `${amount} ouro convertido`, balance: a.wallet })
    const result = finishMutation(db, number, a)
    return { ok: true, gold: amount, petals, rate: GOLD_TO_PETALS, ...result }
  })
}

export async function upgradePickaxe(number) {
  return store.update(db => {
    const a = user(db, number)
    const currentIndex = Math.max(0, PICKAXE_ORDER.indexOf(a.pickaxe))
    const nextId = PICKAXE_ORDER[currentIndex + 1]
    if (!nextId) return { ok: false, reason: 'max', account: snapshot(a), current: structuredClone(pickaxeFor(a)) }
    const next = PICKAXES[nextId]
    const cost = next.cost || { gold: 0, petals: 0, items: {} }
    if (a.gold < cost.gold || a.wallet < cost.petals) {
      return { ok: false, reason: 'money', account: snapshot(a), current: structuredClone(pickaxeFor(a)), next: structuredClone(next) }
    }
    for (const [itemId, quantity] of Object.entries(cost.items || {})) {
      if (clampInt(a.inventory[itemId]) < quantity) {
        return { ok: false, reason: 'materials', missing: itemId, account: snapshot(a), current: structuredClone(pickaxeFor(a)), next: structuredClone(next) }
      }
    }
    a.gold -= cost.gold
    a.wallet -= cost.petals
    a.stats.spent = clampInt(a.stats.spent + cost.petals)
    for (const [itemId, quantity] of Object.entries(cost.items || {})) {
      a.inventory[itemId] -= quantity
      if (a.inventory[itemId] <= 0) delete a.inventory[itemId]
    }
    a.pickaxe = nextId
    addXp(a, 35 * next.level)
    addLedger(db, number, { type: 'pickaxe-upgrade', direction: 'out', amount: cost.petals, gold: -cost.gold, note: next.name, balance: a.wallet })
    const result = finishMutation(db, number, a)
    return { ok: true, previous: structuredClone(PICKAXES[PICKAXE_ORDER[currentIndex]]), pickaxe: structuredClone(next), cost: structuredClone(cost), ...result }
  })
}

export async function claimDailyBox(number, { vip = false, chat = '' } = {}) {
  return store.update(db => {
    const a = user(db, number)
    const today = dayKey()
    if (a.lastDailyBox === today) return { ok: false, reason: 'already', account: snapshot(a) }
    const reward = pickWeightedReward(DAILY_BOX_REWARDS)
    const rawPetals = Math.floor(randomInt(reward.petals[0], reward.petals[1]) * (vip ? 1.2 : 1) * activePetMultiplier(a, 'daily'))
    const emission = limitGroupEmission(db, chat, rawPetals)
    const petals = emission.granted
    const gold = Math.floor(randomInt(reward.gold[0], reward.gold[1]) * (vip ? 1.15 : 1))
    a.wallet = clampInt(a.wallet + petals)
    a.gold = clampInt(a.gold + gold)
    a.stats.earned = clampInt(a.stats.earned + petals)
    a.lastDailyBox = today
    let item = null
    if (reward.item) {
      a.inventory[reward.item] = clampInt(Number(a.inventory[reward.item] || 0) + 1)
      item = { id: reward.item, ...SHOP_ITEMS[reward.item] }
    }
    progress(a, number, 'earn', petals)
    addXp(a, 25)
    addLedger(db, number, { type: 'daily-box', direction: 'in', amount: petals, gold, note: reward.label, balance: a.wallet })
    const result = finishMutation(db, number, a)
    return { ok: true, label: reward.label, petals, requestedPetals: rawPetals, limited: emission.limited, gold, item, ...result }
  })
}

function pairKey(first, second) {
  return [String(first), String(second)].sort().join(':')
}

function activeBattleFor(db, number, chat = '') {
  return Object.values(db.pendingBattles || {}).find(item => item.status === 'pending' && (!chat || item.chat === chat) && (item.from === String(number) || item.to === String(number))) || null
}

function pvpPetLevel(account) {
  const active = String(account?.pets?.active || '')
  return clampInt(account?.pets?.owned?.[active]?.level || 0, 0, 5)
}

function pvpHouseLevel(account) {
  return ({ nenhuma: 0, cabana: 1, casa: 2, mansao: 3, palacio: 4 })[String(account?.house?.id || 'nenhuma')] || 0
}

function pvpArenaLevel(xp) {
  return Math.min(50, Math.max(1, Math.floor(Math.sqrt(clampInt(xp) / 120)) + 1))
}

function syncPvpLevel(account) {
  account.pvp.arenaLevel = pvpArenaLevel(account.pvp.pvpXp)
  return account.pvp.arenaLevel
}

function addPvpXp(account, amount) {
  account.pvp.pvpXp = clampInt(account.pvp.pvpXp + clampInt(amount))
  return syncPvpLevel(account)
}

function pvpCombatStats(account) {
  const pickaxe = pickaxeFor(account)
  const arenaLevel = syncPvpLevel(account)
  const petLevel = pvpPetLevel(account)
  const houseLevel = pvpHouseLevel(account)
  const hp = 110 + account.level * 4 + pickaxe.level * 8 + petLevel * 4 + houseLevel * 3
  const attack = 16 + account.level * 2.2 + pickaxe.level * 5 + petLevel * 2 + arenaLevel * 0.8
  const defense = 7 + account.level * 1.6 + pickaxe.level * 2.5 + houseLevel * 2 + petLevel
  const agility = 6 + arenaLevel * 0.7 + petLevel * 1.5 + houseLevel * 0.5
  const criticalChance = Math.min(0.25, 0.07 + pickaxe.level * 0.012 + arenaLevel * 0.003)
  const dodgeChance = Math.min(0.20, 0.045 + petLevel * 0.012 + arenaLevel * 0.002)
  return {
    hp: Math.round(hp), attack: Math.round(attack), defense: Math.round(defense), agility: Math.round(agility),
    criticalChance, dodgeChance, arenaLevel, rating: account.pvp.rating
  }
}

function pvpPower(account) {
  const stats = pvpCombatStats(account)
  return Math.round(stats.hp * 0.22 + stats.attack * 2.4 + stats.defense * 1.8 + stats.agility + stats.rating / 35)
}

function pvpHistoryEntry({
  id, opponent, result, petals = 0, gold = 0, chat = '', ratingDelta = 0,
  damage = 0, damageTaken = 0, rounds = 0, item = '', rewardMultiplier = 0
}) {
  return {
    id, at: nowIso(), opponent: String(opponent), result,
    petals: clampInt(petals), gold: clampInt(gold), chat: String(chat),
    ratingDelta: Math.trunc(Number(ratingDelta) || 0),
    damage: clampInt(damage), damageTaken: clampInt(damageTaken), rounds: clampInt(rounds, 0, PVP_MAX_ROUNDS),
    item: String(item || ''), rewardMultiplier: Math.max(0, Math.min(1, Number(rewardMultiplier) || 0))
  }
}

function pushPvpHistory(account, entry) {
  account.pvp.history.unshift(entry)
  if (account.pvp.history.length > PVP_HISTORY_LIMIT) account.pvp.history.length = PVP_HISTORY_LIMIT
  const opponent = String(entry.opponent || '').replace(/\D/g, '')
  if (opponent) account.pvp.lastOpponents = [opponent, ...account.pvp.lastOpponents.filter(value => value !== opponent)].slice(0, 8)
}

function ensurePvpRewardDay(account) {
  const today = dayKey()
  if (account.pvp.rewardDay !== today) {
    account.pvp.rewardDay = today
    account.pvp.rewardedBattles = 0
  }
}

function simulatePvpBattle(accountA, accountB) {
  const statsA = pvpCombatStats(accountA)
  const statsB = pvpCombatStats(accountB)
  const fighters = {
    from: { side: 'from', hp: statsA.hp, maxHp: statsA.hp, stats: statsA, damage: 0, taken: 0, criticals: 0, dodges: 0, maxHit: 0 },
    to: { side: 'to', hp: statsB.hp, maxHp: statsB.hp, stats: statsB, damage: 0, taken: 0, criticals: 0, dodges: 0, maxHit: 0 }
  }
  const events = []
  let rounds = 0

  const strike = (attacker, defender, round) => {
    if (attacker.hp <= 0 || defender.hp <= 0) return
    if (Math.random() < defender.stats.dodgeChance) {
      defender.dodges += 1
      events.push({ round, attacker: attacker.side, defender: defender.side, damage: 0, critical: false, dodged: true, defenderHp: defender.hp })
      return
    }
    let damage = Math.max(5, Math.round(attacker.stats.attack + randomInt(-5, 9) - defender.stats.defense * 0.46))
    const critical = Math.random() < attacker.stats.criticalChance
    if (critical) {
      damage = Math.round(damage * 1.6)
      attacker.criticals += 1
    }
    damage = Math.min(defender.hp, damage)
    defender.hp -= damage
    attacker.damage += damage
    defender.taken += damage
    attacker.maxHit = Math.max(attacker.maxHit, damage)
    events.push({ round, attacker: attacker.side, defender: defender.side, damage, critical, dodged: false, defenderHp: defender.hp })
  }

  for (let round = 1; round <= PVP_MAX_ROUNDS; round += 1) {
    rounds = round
    const first = statsA.agility + randomInt(0, 12) >= statsB.agility + randomInt(0, 12) ? fighters.from : fighters.to
    const second = first === fighters.from ? fighters.to : fighters.from
    strike(first, second, round)
    strike(second, first, round)
    if (fighters.from.hp <= 0 || fighters.to.hp <= 0) break
  }

  let result = 'draw'
  if (fighters.from.hp !== fighters.to.hp) result = fighters.from.hp > fighters.to.hp ? 'from' : 'to'
  return { result, rounds, events, from: fighters.from, to: fighters.to, statsFrom: statsA, statsTo: statsB }
}

function ratingChanges(ratingA, ratingB, result, scale = 1) {
  const expectedA = 1 / (1 + 10 ** ((ratingB - ratingA) / 400))
  const scoreA = result === 'from' ? 1 : result === 'to' ? 0 : 0.5
  const rawA = Math.round(32 * (scoreA - expectedA) * Math.max(0, Math.min(1, scale)))
  return { from: rawA, to: -rawA }
}

export async function previewPvpMatch(from, to) {
  return store.update(db => {
    const a = user(db, from)
    const b = user(db, to)
    return {
      from: { account: snapshot(a), stats: pvpCombatStats(a), power: pvpPower(a) },
      to: { account: snapshot(b), stats: pvpCombatStats(b), power: pvpPower(b) }
    }
  })
}

export async function beginPvpChallenge(from, to, chat) {
  return store.update(db => {
    ensureRoot(db)
    cleanupPending(db)
    const source = String(from)
    const target = String(to)
    if (!source || !target || source === target) return { ok: false, reason: 'self' }
    const a = user(db, source)
    const b = user(db, target)
    if (activeBattleFor(db, source, chat) || activeBattleFor(db, target, chat)) return { ok: false, reason: 'busy' }
    const cooldownLeft = Math.max(
      Number(a.pvp.lastBattleAt || 0) + BATTLE_COOLDOWN_MS - Date.now(),
      Number(b.pvp.lastBattleAt || 0) + BATTLE_COOLDOWN_MS - Date.now()
    )
    if (cooldownLeft > 0) return { ok: false, reason: 'cooldown', left: cooldownLeft, account: snapshot(a) }
    const id = nextId(db, 'PVP')
    const challenge = { id, from: source, to: target, chat: String(chat), createdAt: Date.now(), expiresAt: Date.now() + BATTLE_TTL_MS, status: 'pending' }
    db.pendingBattles[id] = challenge
    return {
      ok: true, ...structuredClone(challenge), source: snapshot(a),
      sourceStats: pvpCombatStats(a), targetStats: pvpCombatStats(b),
      sourcePower: pvpPower(a), targetPower: pvpPower(b)
    }
  })
}

export async function cancelPvpChallenge(id, by, chat) {
  return store.update(db => {
    ensureRoot(db)
    cleanupPending(db)
    const challenge = db.pendingBattles[id]
    if (!challenge || challenge.status !== 'pending') return { ok: false, reason: 'expired' }
    if (challenge.from !== String(by) || challenge.chat !== String(chat)) return { ok: false, reason: 'owner' }
    delete db.pendingBattles[id]
    return { ok: true, challenge: structuredClone(challenge) }
  })
}

export async function rejectPvpChallenge(id, by, chat) {
  return store.update(db => {
    ensureRoot(db)
    cleanupPending(db)
    const challenge = db.pendingBattles[id]
    if (!challenge || challenge.status !== 'pending') return { ok: false, reason: 'expired' }
    if (challenge.to !== String(by) || challenge.chat !== String(chat)) return { ok: false, reason: 'target' }
    delete db.pendingBattles[id]
    return { ok: true, challenge: structuredClone(challenge) }
  })
}

export async function acceptPvpChallenge(id, by, chat) {
  return store.update(db => {
    ensureRoot(db)
    cleanupPending(db)
    const challenge = db.pendingBattles[id]
    if (!challenge || challenge.status !== 'pending') return { ok: false, reason: 'expired' }
    if (challenge.to !== String(by) || challenge.chat !== String(chat)) return { ok: false, reason: 'target' }
    const a = user(db, challenge.from)
    const b = user(db, challenge.to)
    const now = Date.now()
    const leftA = Number(a.pvp.lastBattleAt || 0) + BATTLE_COOLDOWN_MS - now
    const leftB = Number(b.pvp.lastBattleAt || 0) + BATTLE_COOLDOWN_MS - now
    if (leftA > 0 || leftB > 0) {
      delete db.pendingBattles[id]
      return { ok: false, reason: 'cooldown', left: Math.max(leftA, leftB) }
    }

    const combat = simulatePvpBattle(a, b)
    const result = combat.result
    let winnerNumber = ''
    let loserNumber = ''
    let winner = null
    let loser = null
    if (result === 'from') { winnerNumber = challenge.from; loserNumber = challenge.to; winner = a; loser = b }
    else if (result === 'to') { winnerNumber = challenge.to; loserNumber = challenge.from; winner = b; loser = a }

    for (const account of [a, b]) {
      account.pvp.battles += 1
      account.pvp.lastBattleAt = now
      account.pvp.lastOpponent = account === a ? challenge.to : challenge.from
      ensurePvpRewardDay(account)
    }

    a.pvp.damageDealt = clampInt(a.pvp.damageDealt + combat.from.damage)
    a.pvp.damageTaken = clampInt(a.pvp.damageTaken + combat.from.taken)
    a.pvp.criticalHits = clampInt(a.pvp.criticalHits + combat.from.criticals)
    a.pvp.dodges = clampInt(a.pvp.dodges + combat.from.dodges)
    a.pvp.maxHit = Math.max(a.pvp.maxHit, combat.from.maxHit)
    b.pvp.damageDealt = clampInt(b.pvp.damageDealt + combat.to.damage)
    b.pvp.damageTaken = clampInt(b.pvp.damageTaken + combat.to.taken)
    b.pvp.criticalHits = clampInt(b.pvp.criticalHits + combat.to.criticals)
    b.pvp.dodges = clampInt(b.pvp.dodges + combat.to.dodges)
    b.pvp.maxHit = Math.max(b.pvp.maxHit, combat.to.maxHit)

    let petals = 0
    let gold = 0
    let rewardMultiplier = 0
    let item = null
    const key = pairKey(challenge.from, challenge.to)
    const recentPair = (db.pvpPairs[key] ||= []).filter(value => Number(value) > now - 6 * 60 * 60_000)
    db.pvpPairs[key] = [...recentPair, now].slice(-12)
    const repeatScale = recentPair.length === 0 ? 1 : recentPair.length === 1 ? 0.35 : 0
    const ratingScale = recentPair.length === 0 ? 1 : recentPair.length === 1 ? 0.5 : 0
    const ratingDelta = ratingChanges(a.pvp.rating, b.pvp.rating, result, ratingScale)
    a.pvp.rating = clampInt(a.pvp.rating + ratingDelta.from, 100, 5000)
    b.pvp.rating = clampInt(b.pvp.rating + ratingDelta.to, 100, 5000)
    a.pvp.bestRating = Math.max(a.pvp.bestRating, a.pvp.rating)
    b.pvp.bestRating = Math.max(b.pvp.bestRating, b.pvp.rating)

    if (result === 'draw') {
      a.pvp.draws += 1
      b.pvp.draws += 1
      a.pvp.currentStreak = 0
      b.pvp.currentStreak = 0
      addXp(a, 10)
      addXp(b, 10)
      addPvpXp(a, Math.max(2, Math.floor(18 * Math.max(0.15, repeatScale))))
      addPvpXp(b, Math.max(2, Math.floor(18 * Math.max(0.15, repeatScale))))
    } else {
      winner.pvp.wins += 1
      loser.pvp.losses += 1
      winner.pvp.currentStreak += 1
      winner.pvp.bestStreak = Math.max(winner.pvp.bestStreak, winner.pvp.currentStreak)
      loser.pvp.currentStreak = 0
      rewardMultiplier = repeatScale
      if (winner.pvp.rewardedBattles >= PVP_DAILY_REWARD_LIMIT) rewardMultiplier = 0
      const rawPetals = Math.floor(randomInt(170, 360) * rewardMultiplier)
      const emission = limitGroupEmission(db, chat, rawPetals)
      petals = emission.granted
      gold = Math.floor(randomInt(4, 11) * rewardMultiplier)
      if (rewardMultiplier > 0) winner.pvp.rewardedBattles += 1
      winner.wallet = clampInt(winner.wallet + petals)
      winner.gold = clampInt(winner.gold + gold)
      winner.stats.earned = clampInt(winner.stats.earned + petals)
      winner.pvp.totalPetals = clampInt(winner.pvp.totalPetals + petals)
      winner.pvp.totalGold = clampInt(winner.pvp.totalGold + gold)
      addXp(winner, 30)
      addXp(loser, 12)
      addPvpXp(winner, Math.max(3, Math.floor(42 * Math.max(0.1, rewardMultiplier))))
      addPvpXp(loser, Math.max(2, Math.floor(14 * Math.max(0.15, repeatScale))))
      if (rewardMultiplier > 0 && Math.random() < 0.12) {
        const itemId = Math.random() < 0.25 ? 'cristal' : 'madeira'
        winner.inventory[itemId] = clampInt(Number(winner.inventory[itemId] || 0) + 1)
        winner.pvp.itemsWon = clampInt(winner.pvp.itemsWon + 1)
        item = { id: itemId, ...SHOP_ITEMS[itemId] }
      }
      if (petals || gold) addLedger(db, winnerNumber, { type: 'pvp', direction: 'in', amount: petals, gold, peer: loserNumber, note: 'Vitória PVP', balance: winner.wallet })
    }

    const historyA = pvpHistoryEntry({
      id, opponent: challenge.to, result: result === 'from' ? 'win' : result === 'to' ? 'loss' : 'draw',
      petals: winnerNumber === challenge.from ? petals : 0, gold: winnerNumber === challenge.from ? gold : 0,
      chat, ratingDelta: ratingDelta.from, damage: combat.from.damage, damageTaken: combat.from.taken,
      rounds: combat.rounds, item: winnerNumber === challenge.from ? item?.id : '', rewardMultiplier
    })
    const historyB = pvpHistoryEntry({
      id, opponent: challenge.from, result: result === 'to' ? 'win' : result === 'from' ? 'loss' : 'draw',
      petals: winnerNumber === challenge.to ? petals : 0, gold: winnerNumber === challenge.to ? gold : 0,
      chat, ratingDelta: ratingDelta.to, damage: combat.to.damage, damageTaken: combat.to.taken,
      rounds: combat.rounds, item: winnerNumber === challenge.to ? item?.id : '', rewardMultiplier
    })
    pushPvpHistory(a, historyA)
    pushPvpHistory(b, historyB)

    delete db.pendingBattles[id]
    const unlockedA = checkAchievements(db, challenge.from, a)
    const unlockedB = checkAchievements(db, challenge.to, b)
    a.updatedAt = nowIso()
    b.updatedAt = nowIso()
    return {
      ok: true, id, challenge: structuredClone(challenge), result, winner: winnerNumber, loser: loserNumber,
      powerFrom: pvpPower(a), powerTo: pvpPower(b), petals, gold, rewardMultiplier, item,
      ratingFrom: a.pvp.rating, ratingTo: b.pvp.rating, ratingDeltaFrom: ratingDelta.from, ratingDeltaTo: ratingDelta.to,
      combat: structuredClone(combat),
      fromAccount: snapshot(a), toAccount: snapshot(b), unlockedFrom: unlockedA, unlockedTo: unlockedB
    }
  })
}

export async function getPvpStatus(number, chat = '') {
  return store.update(db => {
    ensureRoot(db)
    cleanupPending(db)
    const account = user(db, number)
    const pending = activeBattleFor(db, number, chat)
    const left = Math.max(0, Number(account.pvp.lastBattleAt || 0) + BATTLE_COOLDOWN_MS - Date.now())
    return {
      account: snapshot(account), pvp: structuredClone(account.pvp), stats: pvpCombatStats(account), power: pvpPower(account),
      pending: pending ? structuredClone(pending) : null, left
    }
  })
}

export async function economyAction(number, actionName, { chat = '' } = {}) {
  const rule = ACTIONS[actionName]
  if (!rule) return { ok: false, reason: 'unknown' }
  return store.update(db => {
    const a = user(db, number)
    ensureQuests(a, number)
    const left = Number(a.cooldowns[actionName] || 0) + rule.wait - Date.now()
    if (left > 0) return { ok: false, reason: 'cooldown', left, account: snapshot(a) }
    a.cooldowns[actionName] = Date.now()
    const lucky = Number(a.buffs.luckUntil || 0) > Date.now()
    if (lucky) delete a.buffs.luckUntil
    const risk = lucky ? Math.max(0, Number(rule.risk || 0) - 0.2) : Number(rule.risk || 0)
    if (risk && Math.random() < risk) {
      const loss = Math.min(a.wallet, randomInt(35, 150))
      a.wallet -= loss
      a.stats.spent += loss
      a.stats.losses += 1
      a.stats.actions += 1
      progress(a, number, 'action', 1)
      addXp(a, Math.floor(rule.xp / 2))
      addLedger(db, number, { type: 'action', direction: 'out', amount: loss, note: `${rule.name}: imprevisto`, balance: a.wallet })
      const result = finishMutation(db, number, a)
      return { ok: false, reason: 'loss', loss, action: actionName, rule: { ...rule }, lucky, ...result }
    }
    const levelBonus = Math.min(180, a.level * 4)
    const rawReward = randomInt(rule.min, rule.max) + levelBonus
    const emission = limitGroupEmission(db, chat, rawReward)
    const reward = emission.granted
    a.wallet += reward
    a.stats.earned += reward
    a.stats.actions += 1
    progress(a, number, 'action', 1)
    progress(a, number, 'earn', reward)
    addXp(a, rule.xp)
    let item = null
    if (Math.random() < (lucky ? 0.3 : 0.12)) {
      const drops = ['chave', 'trevo', 'energia', 'madeira', 'cristal', 'fita', 'dourada']
      item = drops[randomInt(0, drops.length - 1)]
      a.inventory[item] = clampInt(Number(a.inventory[item] || 0) + 1)
    }
    addLedger(db, number, { type: 'action', direction: 'in', amount: reward, note: rule.name, balance: a.wallet })
    const result = finishMutation(db, number, a)
    return { ok: true, reward, requestedReward: rawReward, limited: emission.limited, item: item ? { id: item, ...SHOP_ITEMS[item] } : null, action: actionName, rule: { ...rule }, lucky, ...result }
  })
}

export async function rob(from, to) {
  return store.update(db => {
    const a = user(db, from)
    const b = user(db, to)
    ensureQuests(a, from)
    const wait = 45 * 60_000
    const left = Number(a.cooldowns.roubar || 0) + wait - Date.now()
    if (left > 0) return { ok: false, reason: 'cooldown', left, account: snapshot(a) }
    if (String(from) === String(to) || total(b) < 100) return { ok: false, reason: 'target', account: snapshot(a) }
    if (Number(b.buffs.protectedUntil || 0) > Date.now()) return { ok: false, reason: 'protected', account: snapshot(a) }
    a.cooldowns.roubar = Date.now()
    const lucky = Number(a.buffs.luckUntil || 0) > Date.now()
    if (lucky) delete a.buffs.luckUntil
    const caughtChance = lucky ? 0.24 : 0.44
    a.stats.robberies += 1
    if (Math.random() < caughtChance) {
      const fine = Math.min(a.wallet, randomInt(60, 220))
      a.wallet -= fine
      a.stats.spent += fine
      a.stats.losses += 1
      addLedger(db, from, { type: 'rob', direction: 'out', amount: fine, peer: to, note: 'Rota interrompida', balance: a.wallet })
      const result = finishMutation(db, from, a)
      return { ok: false, reason: 'caught', loss: fine, lucky, ...result }
    }
    const amount = Math.min(b.wallet, randomInt(80, 360) + Math.min(200, a.level * 5))
    if (!amount) return { ok: false, reason: 'target', account: snapshot(a) }
    b.wallet -= amount
    a.wallet += amount
    a.stats.earned += amount
    b.stats.spent += amount
    a.stats.wins += 1
    progress(a, from, 'earn', amount)
    addXp(a, 28)
    addLedger(db, from, { type: 'rob', direction: 'in', amount, peer: to, note: 'Rota concluída', balance: a.wallet })
    addLedger(db, to, { type: 'rob', direction: 'out', amount, peer: from, note: 'Carteira visitada', balance: b.wallet })
    const result = finishMutation(db, from, a)
    checkAchievements(db, to, b)
    return { ok: true, amount, lucky, ...result }
  })
}

export async function bet(number, value, { chat = '' } = {}) {
  return store.update(db => {
    const a = user(db, number)
    const amount = clampInt(value, 1, 5000)
    if (a.wallet < amount) return { ok: false, reason: 'money', account: snapshot(a) }
    const lucky = Number(a.buffs.luckUntil || 0) > Date.now()
    if (lucky) delete a.buffs.luckUntil
    const won = Math.random() < (lucky ? 0.58 : 0.47)
    if (won) {
      const rawPrize = Math.floor(amount * (lucky ? 1.2 : 1))
      const emission = limitGroupEmission(db, chat, rawPrize)
      const prize = emission.granted
      a.wallet += prize
      a.stats.earned += prize
      a.stats.wins += 1
      progress(a, number, 'earn', prize)
      addXp(a, 10)
      addLedger(db, number, { type: 'luck', direction: 'in', amount: prize, note: 'Estrela da Sorte', balance: a.wallet })
      const result = finishMutation(db, number, a)
      return { ok: true, won: true, amount: prize, requestedAmount: rawPrize, limited: emission.limited, lucky, ...result }
    }
    a.wallet -= amount
    a.stats.spent += amount
    a.stats.losses += 1
    addLedger(db, number, { type: 'luck', direction: 'out', amount, note: 'Estrela apagada', balance: a.wallet })
    const result = finishMutation(db, number, a)
    return { ok: true, won: false, amount, lucky, ...result }
  })
}

export async function buyItem(number, itemId, quantity = 1) {
  return store.update(db => {
    const a = user(db, number)
    ensureQuests(a, number)
    const item = SHOP_ITEMS[itemId]
    const qty = clampInt(quantity, 1, 25)
    if (!item) return { ok: false, reason: 'unknown', account: snapshot(a) }
    const cost = item.price * qty
    if (a.wallet < cost) return { ok: false, reason: 'money', cost, account: snapshot(a) }
    a.wallet -= cost
    a.inventory[itemId] = clampInt(Number(a.inventory[itemId] || 0) + qty)
    a.stats.spent += cost
    a.stats.shopBuys += qty
    progress(a, number, 'shop', qty)
    addLedger(db, number, { type: 'shop', direction: 'out', amount: cost, note: `${item.name} x${qty}`, balance: a.wallet })
    const result = finishMutation(db, number, a)
    return { ok: true, itemId, item: { ...item }, quantity: qty, cost, ...result }
  })
}

export async function sellItem(number, itemId, quantity = 1, { chat = '' } = {}) {
  return store.update(db => {
    const a = user(db, number)
    const item = SHOP_ITEMS[itemId]
    const qty = clampInt(quantity, 1, 25)
    if (!item) return { ok: false, reason: 'unknown', account: snapshot(a) }
    if (clampInt(a.inventory[itemId]) < qty) return { ok: false, reason: 'item', account: snapshot(a) }
    const rawReward = item.sell * qty
    const preview = previewGroupEmission(db, chat, rawReward)
    if (preview.limited) return { ok: false, reason: 'group-limit', requestedReward: rawReward, available: preview.granted, account: snapshot(a) }
    const emission = limitGroupEmission(db, chat, rawReward)
    const reward = emission.granted
    a.inventory[itemId] -= qty
    if (a.inventory[itemId] <= 0) delete a.inventory[itemId]
    a.wallet += reward
    a.stats.earned += reward
    progress(a, number, 'earn', reward)
    addLedger(db, number, { type: 'sale', direction: 'in', amount: reward, note: `${item.name} x${qty}`, balance: a.wallet })
    const result = finishMutation(db, number, a)
    return { ok: true, itemId, item: { ...item }, quantity: qty, reward, requestedReward: rawReward, limited: emission.limited, ...result }
  })
}

export async function useItem(number, itemId, { chat = '' } = {}) {
  return store.update(db => {
    const a = user(db, number)
    const item = SHOP_ITEMS[itemId]
    if (!item) return { ok: false, reason: 'unknown', account: snapshot(a) }
    if (clampInt(a.inventory[itemId]) < 1) return { ok: false, reason: 'item', account: snapshot(a) }
    if (itemId === 'rosa') return { ok: false, reason: 'collectible', account: snapshot(a) }
    if (item.kind === 'material') return { ok: false, reason: 'material', item: { ...item }, account: snapshot(a) }
    let keyReward = 0
    if (itemId === 'chave') {
      keyReward = randomInt(180, 780)
      const preview = previewGroupEmission(db, chat, keyReward)
      if (preview.limited) return { ok: false, reason: 'group-limit', requestedReward: keyReward, available: preview.granted, account: snapshot(a) }
    }
    a.inventory[itemId] -= 1
    if (a.inventory[itemId] <= 0) delete a.inventory[itemId]
    let reward = 0
    if (itemId === 'selo') a.buffs.protectedUntil = Date.now() + 6 * 60 * 60_000
    if (itemId === 'energia') a.lastWork = 0
    if (itemId === 'trevo') a.buffs.luckUntil = Date.now() + 45 * 60_000
    if (itemId === 'cupom') a.buffs.workBoostUntil = Date.now() + 24 * 60 * 60_000
    let requestedReward = 0
    let limited = false
    if (itemId === 'chave') {
      const rawReward = keyReward
      const emission = limitGroupEmission(db, chat, rawReward)
      requestedReward = rawReward
      limited = emission.limited
      reward = emission.granted
      a.wallet += reward
      a.stats.earned += reward
      progress(a, number, 'earn', reward)
      addLedger(db, number, { type: 'box', direction: 'in', amount: reward, note: 'Caixa Sakura', balance: a.wallet })
    }
    addXp(a, 4)
    const result = finishMutation(db, number, a)
    return { ok: true, itemId, item: { ...item }, reward, requestedReward, limited, ...result }
  })
}

export async function craftItem(number, recipeId) {
  return store.update(db => {
    const a = user(db, number)
    const recipe = RECIPES[recipeId]
    if (!recipe) return { ok: false, reason: 'unknown', account: snapshot(a) }
    for (const [itemId, quantity] of Object.entries(recipe.needs)) {
      if (clampInt(a.inventory[itemId]) < quantity) {
        return { ok: false, reason: 'materials', missing: itemId, recipe: structuredClone(recipe), account: snapshot(a) }
      }
    }
    for (const [itemId, quantity] of Object.entries(recipe.needs)) {
      a.inventory[itemId] -= quantity
      if (a.inventory[itemId] <= 0) delete a.inventory[itemId]
    }
    a.inventory[recipe.output] = clampInt(Number(a.inventory[recipe.output] || 0) + recipe.quantity)
    addXp(a, 18)
    addLedger(db, number, { type: 'craft', direction: 'move', amount: 0, note: recipe.name, balance: a.wallet })
    const result = finishMutation(db, number, a)
    return { ok: true, recipeId, recipe: structuredClone(recipe), ...result }
  })
}

export async function getInventory(number) {
  const a = await getAccount(number)
  return Object.entries(a.inventory || {})
    .filter(([, quantity]) => clampInt(quantity) > 0)
    .map(([id, quantity]) => ({ id, quantity: clampInt(quantity), ...(SHOP_ITEMS[id] || { name: id, icon: '🌸', price: 0, sell: 0, description: '' }) }))
}

export async function getStatement(number, limit = 10) {
  const db = await store.read()
  ensureRoot(db)
  return structuredClone((db.ledger[String(number)] || []).slice(0, clampInt(limit, 1, 30)))
}

export async function getMissions(number) {
  const account = await getAccount(number)
  return { day: account.quests.day, items: Object.values(account.quests.items || {}).map(item => ({ ...item })) }
}

export async function claimMission(number, questId, { chat = '' } = {}) {
  return store.update(db => {
    const a = user(db, number)
    ensureQuests(a, number)
    const quest = a.quests.items[questId]
    if (!quest) return { ok: false, reason: 'unknown', account: snapshot(a) }
    if (quest.claimed) return { ok: false, reason: 'claimed', quest: { ...quest }, account: snapshot(a) }
    if (quest.progress < quest.target) return { ok: false, reason: 'progress', quest: { ...quest }, account: snapshot(a) }
    quest.claimed = true
    const emission = limitGroupEmission(db, chat, quest.reward)
    const reward = emission.granted
    a.wallet += reward
    a.stats.earned += reward
    addXp(a, 25)
    addLedger(db, number, { type: 'mission', direction: 'in', amount: reward, note: quest.label, balance: a.wallet })
    const result = finishMutation(db, number, a)
    return { ok: true, reward, requestedReward: quest.reward, limited: emission.limited, quest: { ...quest }, ...result }
  })
}

export async function getAchievements(number) {
  const a = await getAccount(number)
  return ACHIEVEMENTS.map(item => ({ ...item, unlocked: a.achievements.includes(item.id) }))
}

export async function economyRanking(limit = 10, poor = false) {
  const db = await store.read()
  ensureRoot(db)
  return Object.entries(db.users)
    .map(([number, a]) => ({ number, ...a, total: total(a) }))
    .sort((a, b) => poor ? a.total - b.total : b.total - a.total)
    .slice(0, clampInt(limit, 1, 25))
}

export async function activityRanking(chat, inactive = false, limit = 10) {
  const db = await store.read()
  ensureRoot(db)
  return Object.entries(db.activity[chat] || {})
    .map(([number, a]) => ({ number, ...a }))
    .sort((a, b) => inactive ? a.messages - b.messages : b.messages - a.messages)
    .slice(0, clampInt(limit, 1, 25))
}


export async function goldRanking(limit = 10) {
  const db = await store.read()
  ensureRoot(db)
  return Object.entries(db.users)
    .map(([number]) => { const a = user(db, number); return { number, gold: a.gold, totalGold: a.mining.totalGold } })
    .sort((a, b) => b.gold - a.gold || b.totalGold - a.totalGold)
    .slice(0, clampInt(limit, 1, 25))
}

export async function miningRanking(limit = 10) {
  const db = await store.read()
  ensureRoot(db)
  return Object.entries(db.users)
    .map(([number]) => { const a = user(db, number); return { number, sessions: a.mining.sessions, totalGold: a.mining.totalGold, bestFind: a.mining.bestFind } })
    .sort((a, b) => b.totalGold - a.totalGold || b.sessions - a.sessions)
    .slice(0, clampInt(limit, 1, 25))
}

export async function pickaxeRanking(limit = 10) {
  const db = await store.read()
  ensureRoot(db)
  return Object.entries(db.users)
    .map(([number]) => { const a = user(db, number); return { number, pickaxe: structuredClone(pickaxeFor(a)), totalGold: a.mining.totalGold } })
    .sort((a, b) => b.pickaxe.level - a.pickaxe.level || b.totalGold - a.totalGold)
    .slice(0, clampInt(limit, 1, 25))
}

export async function pvpRanking(limit = 10, mode = 'wins') {
  const db = await store.read()
  ensureRoot(db)
  const field = ({ streak: 'bestStreak', rating: 'rating', damage: 'damageDealt', level: 'arenaLevel' })[mode] || 'wins'
  return Object.entries(db.users)
    .map(([number]) => { const a = user(db, number); return { number, ...structuredClone(a.pvp) } })
    .sort((a, b) => b[field] - a[field] || b.rating - a.rating || b.wins - a.wins || a.losses - b.losses)
    .slice(0, clampInt(limit, 1, 25))
}

export function stablePercent(chat, number, trait) {
  return createHash('sha256').update(`${chat}|${number}|${trait}`).digest().readUInt32BE(0) % 101
}

export const rankDefinitions = [
  ['rankgay', 'RANK GAY', 'gay', '🌸'], ['rankgado', 'RANK GADO', 'gado', '🌸'], ['rankcorno', 'RANK DOS CORNOS', 'corno', '🌸'],
  ['rankmaislindos', 'RANK DOS MAIS LINDOS', 'lindo', '🌸'], ['rankfeios', 'RANK DOS FEIOS', 'feio', '🌸'], ['rankinteligente', 'RANK DOS INTELIGENTES', 'inteligente', '🌸']
]
