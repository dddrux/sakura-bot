import fs from 'node:fs/promises'
import path from 'node:path'
import { openDatabase } from './database.js'
import { settings } from './settings.js'
import { addExactStickerMetadata } from './sticker-metadata.js'
import { prepareLegacyAudio } from './legacy-audio.js'

const CATALOG_VERSION = 6
const store = openDatabase(settings.triggersDb, { version: CATALOG_VERSION, catalogSeedVersion: 0, audio: {}, stickers: {} })

const STICKER_ONLY_AUDIO_IDS = new Set([
  'risada', 'rachei', 'rsrsrs', 'hehe', 'engracado'
])


const COMMAND_ONLY_AUDIO_IDS = new Set([
  'menu', 'audiomenu', 'ban', 'banido', 'apenasadm', 'cmdnaoexiste',
  'infobot', 'promovido', 'sovip', 'vip'
])

const CLASSIC_AUDIO = Object.freeze({
  acorda: ['acorda', 'acorda ai'],
  apenasadm: ['apenas admin', 'so admin', 'só admin'],
  bah: ['bah', 'mas bah'],
  beijo: ['beijo', 'manda beijo', 'beijinho'],
  boanoite: ['boa noite'],
  boatarde: ['boa tarde'],
  bomdia: ['bom dia', 'bum dia'],
  bugada: ['bugou', 'bugado', 'bugada'],
  dog: ['dog', 'cachorro', 'cachorrinho'],
  exaltei: ['eden quer desafiar'],
  marcar: ['marcar', 'marca todo mundo'],
  qsaco: ['sakura'],
  receba: ['receba']
})

const PROFANITY_PHRASES = Object.freeze([
  'porra', 'caralho', 'cacete', 'merda', 'bosta', 'foda', 'foda se',
  'vai se foder', 'se foder', 'vai tomar no cu', 'tomar no cu',
  'vai pra puta que pariu', 'puta que pariu', 'pqp', 'filho da puta', 'fdp',
  'arrombado', 'arrombada', 'desgracado', 'desgraçado', 'desgracada', 'desgraçada',
  'desgraca', 'desgraça', 'cuzao', 'cuzão', 'otario', 'otário', 'otaria', 'otária',
  'imbecil', 'idiota', 'burro', 'burra', 'babaca', 'corno', 'corna',
  'vagabundo', 'vagabunda', 'pau no cu', 'vai pro inferno', 'escroto', 'escrota',
  'lixo', 'nojento', 'nojenta', 'puta', 'puto'
])

const LAUGHTER_PHRASES = Object.freeze([
  'kkkk', 'kkk', 'kakaka', 'kakakka', 'kakak', 'kakakaka',
  'ksksks', 'ksksk', 'ksksksks', 'ksksksksks',
  'hahaha', 'haha', 'hahahaha', 'rsrs', 'rsrsrs', 'rsrsrsrs',
  'rachei', 'morri de rir', 'to morrendo de rir', 'tô morrendo de rir', 'hehe', 'engracado', 'engraçado'
])

const CLASSIC_STICKERS = Object.freeze({
  banho: ['banho', 'vou tomar banho', 'tomar banho', 'indo pro banho'],
  boanoite: ['boa noite'],
  boatarde: ['boa tarde'],
  bomdia: ['bom dia', 'bum dia'],
  calabocasakura: ['cala boca sakura', 'sakura cala boca', 'fica quieta sakura', 'sakura fica quieta'],
  elogiosakura: [
    'sakura linda', 'sakura perfeita', 'sakura maravilhosa', 'sakura bonita',
    'sakura fofa', 'sakura incrível', 'sakura incrivel', 'amo a sakura',
    'eu amo a sakura', 'sakura é linda', 'sakura e linda', 'linda sakura'
  ],
  oie: ['oi', 'oie', 'ola', 'olá', 'oi gente', 'oi pessoal', 'eae', 'e ai', 'e aí'],
  palavrao: PROFANITY_PHRASES,
  presente: ['presente', 'quero presente', 'cade meu presente', 'cadê meu presente', 'natal', 'feliz natal'],
  risada: LAUGHTER_PHRASES,
  sim: ['sim', 'simm', 'ss', 'claro'],
  sono: ['sono', 'to com sono', 'tô com sono', 'estou com sono', 'vou dormir', 'dormir', 'soninho'],
  tedio: ['tedio', 'tédio', 'to no tedio', 'tô no tédio', 'estou entediado', 'estou entediada', 'sem nada pra fazer'],
  treta: ['treta', 'briga', 'barraco', 'confusao', 'confusão', 'vai dar briga', 'comecou a treta', 'começou a treta']
})

const STICKER_OPTIONS = Object.freeze({
  banho: { cooldownMs: 12_000 },
  boanoite: { cooldownMs: 14_000 },
  boatarde: { cooldownMs: 14_000 },
  bomdia: { cooldownMs: 14_000 },
  calabocasakura: { cooldownMs: 18_000 },
  elogiosakura: { cooldownMs: 18_000 },
  oie: { exactOnly: true, cooldownMs: 12_000 },
  palavrao: { cooldownMs: 14_000 },
  presente: { cooldownMs: 20_000 },
  risada: { cooldownMs: 18_000 },
  sim: { exactOnly: true, cooldownMs: 10_000 },
  sono: { cooldownMs: 16_000 },
  tedio: { cooldownMs: 16_000 },
  treta: { groupOnly: true, cooldownMs: 75_000 }
})

const AUDIO_ALIASES = Object.freeze({
  boanoite: ['boa noite'], boatarde: ['boa tarde'], bomdia: ['bom dia', 'bum dia'],
  bugada: ['bugou', 'bugado', 'bugada'], dog: ['dog', 'cachorro'], apenasadm: ['apenas admin', 'so admin'],
  qsaco: ['sakura'], exaltei: ['eden quer desafiar'], marcar: ['marcar', 'marca todo mundo'],
  beijo: ['beijo', 'beijinho'],
  freefire: ['free fire', 'freefire'],
  palmeiras: ['palmeiras', 'verdao', 'verdão'],
  palmeirense: ['palmeirense'],
  corinthiano: ['corinthiano', 'corinthians'],
  flamengo: ['flamengo'],
  flamenguista: ['flamenguista'],
  vascaino: ['vascaino', 'vascaíno', 'vasco'],
  saopaulino: ['saopaulino', 'sao paulino', 'são paulino'],
  santista: ['santista', 'santos']
})

const CONFLICT_WINDOW_MS = 35_000
const CONFLICT_COOLDOWN_MS = 75_000
const conflictState = new Map()

const state = {
  ready: false,
  audio: new Map(),
  stickers: new Map(),
  stickerById: new Map(),
  maxAudioWords: 1,
  maxStickerWords: 1,
  stickerBuffers: new Map(),
  stats: { audioAvailable: 0, audioEnabled: 0, stickerAvailable: 0, stickerEnabled: 0 }
}

function fileStem(file = '') {
  return path.basename(String(file), path.extname(String(file)))
    .replace(/-[a-f0-9]{8,}$/i, '')
    .replace(/[_-]+/g, ' ')
    .trim()
    .toLowerCase()
}

export function normalizeTrigger(value = '') {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR')
    .replace(/([^\p{L}\p{N}])+/gu, ' ')
    .replace(/([\p{L}\p{N}])\1{2,}/gu, (run, char) => char === 'k' ? 'kkk' : char)
    .replace(/\s+/g, ' ')
    .trim()
}

const normalizedConflictTerms = [...new Set([
  ...PROFANITY_PHRASES,
  'cala boca', 'fica quieto', 'fica quieta', 'vai embora', 'ninguem te aguenta',
  'ninguém te aguenta', 'treta', 'briga', 'barraco'
].map(normalizeTrigger).filter(Boolean))]

async function listFilesRecursive(directory, prefix = '') {
  const result = []
  for (const entry of await fs.readdir(directory, { withFileTypes: true }).catch(() => [])) {
    if (entry.name.startsWith('.')) continue
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name
    const full = path.join(directory, entry.name)
    if (entry.isDirectory()) result.push(...await listFilesRecursive(full, relative))
    else result.push(relative)
  }
  return result
}

async function discoverCatalog() {
  const audio = {}
  const audioFiles = (await listFilesRecursive(settings.audioDir))
    .filter(file => /\.(mp3|m4a|ogg|opus|wav)$/i.test(file) && !file.includes('/.ptt-cache/') && fileStem(file).replace(/\s+/g, '') !== 'teste')

  for (const file of audioFiles) {
    const id = fileStem(file).replace(/\s+/g, '')
    if (!id || audio[id]) continue
    const phrases = AUDIO_ALIASES[id] || CLASSIC_AUDIO[id] || [fileStem(file)]
    const lockedDisabled = STICKER_ONLY_AUDIO_IDS.has(id)
    const commandOnly = COMMAND_ONLY_AUDIO_IDS.has(id)
    audio[id] = {
      file,
      phrases: [...new Set(phrases.map(String).map(value => value.trim()).filter(Boolean))],
      enabled: !lockedDisabled && !commandOnly,
      lockedDisabled,
      commandOnly,
      replacedBySticker: lockedDisabled ? 'risada' : undefined,
      ptt: true,
      requiresMention: id === 'qsaco',
      cooldownMs: 12_000,
      preset: lockedDisabled ? 'sticker-only' : commandOnly ? 'command-only' : CLASSIC_AUDIO[id] ? 'classic' : 'meme'
    }
  }

  const stickers = {}
  const stickerFiles = (await listFilesRecursive(settings.stickerDir)).filter(file => /\.webp$/i.test(file))
  for (const file of stickerFiles) {
    const stem = fileStem(file)
    const id = stem.replace(/\s+/g, '')
    if (!id || stickers[id]) continue
    const phrases = CLASSIC_STICKERS[id] || [stem]
    const options = STICKER_OPTIONS[id] || {}
    const commandOnly = id === 'ban'
    stickers[id] = {
      file,
      phrases: [...new Set(phrases.map(String).map(value => value.trim()).filter(Boolean))],
      enabled: commandOnly ? false : Boolean(CLASSIC_STICKERS[id]),
      exactOnly: options.exactOnly === true,
      groupOnly: options.groupOnly === true,
      commandOnly,
      cooldownMs: Math.max(0, Number(options.cooldownMs) || 10_000),
      preset: commandOnly ? 'command-only' : CLASSIC_STICKERS[id] ? 'classic' : 'extra'
    }
  }
  return { audio, stickers }
}

export async function ensureTriggerCatalog() {
  const catalog = await discoverCatalog()
  await store.update(db => {
    db.version = CATALOG_VERSION
    db.audio ||= {}
    db.stickers ||= {}
    if (db.audio.teste?.file === 'teste.mp3' && (db.audio.teste.phrases || []).every(phrase => normalizeTrigger(phrase) === 'teste')) delete db.audio.teste

    const migrateAllMemeAudio = Number(db.catalogSeedVersion || 0) < CATALOG_VERSION
    for (const [id, entry] of Object.entries(catalog.audio)) {
      db.audio[id] = { ...entry, ...(db.audio[id] || {}), file: entry.file, phrases: entry.phrases }
      if (migrateAllMemeAudio) db.audio[id].enabled = !entry.lockedDisabled && !entry.commandOnly
    }
    for (const [id, entry] of Object.entries(catalog.stickers)) {
      if (!db.stickers[id]) db.stickers[id] = entry
    }

    // Áudios de risada ficam permanentemente bloqueados. Mesmo o modo completo
    // não pode reativá-los; as risadas pertencem somente à figurinha.
    for (const id of STICKER_ONLY_AUDIO_IDS) {
      if (!db.audio[id]) continue
      db.audio[id] = {
        ...db.audio[id],
        ...catalog.audio[id],
        enabled: false,
        lockedDisabled: true,
        replacedBySticker: 'risada',
        preset: 'sticker-only'
      }
    }


    for (const id of COMMAND_ONLY_AUDIO_IDS) {
      if (!db.audio[id]) continue
      db.audio[id] = {
        ...db.audio[id],
        ...catalog.audio[id],
        enabled: false,
        commandOnly: true,
        preset: 'command-only'
      }
    }

    // As fotos fornecidas pelo dono são a fonte oficial destes gatilhos.
    // A atualização substitui caminhos/frases antigos sem apagar customizações
    // de outros gatilhos criados no painel.
    for (const id of Object.keys(CLASSIC_STICKERS)) {
      if (!catalog.stickers[id]) continue
      db.stickers[id] = {
        ...db.stickers[id],
        ...catalog.stickers[id],
        enabled: true
      }
    }

    // A figurinha BAN é chamada pelo comando administrativo, nunca por texto comum.
    if (catalog.stickers.ban) {
      db.stickers.ban = {
        ...db.stickers.ban,
        ...catalog.stickers.ban,
        enabled: false,
        commandOnly: true,
        preset: 'command-only'
      }
    }

    db.catalogSeedVersion = CATALOG_VERSION
  })
  return catalog
}

function register(map, phrases, value) {
  for (const phrase of phrases || []) {
    const normalized = normalizeTrigger(phrase)
    if (normalized && !map.has(normalized)) map.set(normalized, value)
  }
}

export async function reloadTriggers() {
  await ensureTriggerCatalog()
  const db = await store.read()
  const audio = new Map()
  const stickers = new Map()
  const stickerById = new Map()
  let audioEnabled = 0
  let stickerEnabled = 0

  for (const [id, entry] of Object.entries(db.audio || {})) {
    if (entry?.enabled === false || !entry?.file || entry?.lockedDisabled === true) continue
    audioEnabled += 1
    register(audio, entry.phrases, {
      id,
      file: path.join(settings.audioDir, entry.file),
      relativeFile: entry.file,
      legacy: String(entry.file).startsWith('legacy/'),
      ptt: entry.ptt !== false,
      requiresMention: entry.requiresMention === true,
      exactOnly: entry.exactOnly === true,
      groupOnly: entry.groupOnly === true,
      cooldownMs: Math.max(0, Number(entry.cooldownMs) || settings.autoTriggerCooldownMs)
    })
  }

  for (const [id, entry] of Object.entries(db.stickers || {})) {
    if (entry?.enabled === false || !entry?.file || entry?.commandOnly === true) continue
    stickerEnabled += 1
    const value = {
      id,
      file: path.join(settings.stickerDir, entry.file),
      relativeFile: entry.file,
      exactOnly: entry.exactOnly === true,
      groupOnly: entry.groupOnly === true,
      cooldownMs: Math.max(0, Number(entry.cooldownMs) || settings.autoTriggerCooldownMs)
    }
    stickerById.set(id, value)
    register(stickers, entry.phrases, value)
  }

  state.audio = audio
  state.stickers = stickers
  state.stickerById = stickerById
  state.maxAudioWords = Math.max(1, ...[...audio.keys()].map(key => key.split(' ').length))
  state.maxStickerWords = Math.max(1, ...[...stickers.keys()].map(key => key.split(' ').length))
  state.stickerBuffers.clear()
  state.ready = true
  state.stats = {
    audioAvailable: Object.keys(db.audio || {}).length,
    audioEnabled,
    stickerAvailable: Object.keys(db.stickers || {}).length,
    stickerEnabled
  }
  return { ...state.stats, audioPhrases: audio.size, stickerPhrases: stickers.size }
}

await reloadTriggers()

function entryAllowed(value, context = {}) {
  if (value?.requiresMention && !context.mentionedBot) return false
  if (value?.groupOnly && !context.isGroup) return false
  return true
}

function matchMap(map, text, maxWords, context = {}) {
  const normalizedText = normalizeTrigger(text)
  if (!normalizedText) return null
  const exact = map.get(normalizedText)
  if (exact && entryAllowed(exact, context)) return { value: exact, matched: normalizedText, exact: true }
  const words = normalizedText.split(/\s+/).filter(Boolean)
  const limit = Math.min(maxWords, words.length)
  for (let size = limit; size >= 1; size -= 1) {
    for (let start = 0; start + size <= words.length; start += 1) {
      const phrase = words.slice(start, start + size).join(' ')
      const value = map.get(phrase)
      if (value?.exactOnly) continue
      if (value && entryAllowed(value, context)) return { value, matched: phrase, exact: false }
    }
  }
  return null
}

function containsPhrase(normalizedText, normalizedPhrase) {
  return ` ${normalizedText} `.includes(` ${normalizedPhrase} `)
}

function matchLaughterText(text, context = {}) {
  const normalizedText = normalizeTrigger(text)
  if (!normalizedText) return null
  const token = normalizedText.split(/\s+/).find(value => {
    if (/^k{3,}$/.test(value)) return true
    if (/^[kas]+$/.test(value) && value.length >= 5 && (value.match(/k/g) || []).length >= 3) return true
    if (/^(?:ha){2,}h?a*$/.test(value)) return true
    if (/^(?:rs){2,}r?s?$/.test(value)) return true
    return false
  })
  if (!token) return null
  const value = state.stickerById.get('risada')
  if (!value || !entryAllowed(value, context)) return null
  return { value, matched: token, exact: normalizedText === token, laughterPattern: true }
}

function matchConflictContext(text, context = {}) {
  if (!context.isGroup || !context.chat || !context.sender) return null
  const normalizedText = normalizeTrigger(text)
  if (!normalizedText || !normalizedConflictTerms.some(term => containsPhrase(normalizedText, term))) return null

  const now = Date.now()
  const key = String(context.chat)
  const sender = String(context.sender)
  const row = conflictState.get(key) || { events: [], lastSent: 0 }
  row.events = row.events.filter(event => now - event.at <= CONFLICT_WINDOW_MS)
  row.events.push({ sender, at: now })

  const uniqueSenders = new Set(row.events.map(event => event.sender))
  if (row.events.length >= 2 && uniqueSenders.size >= 2 && now - row.lastSent >= CONFLICT_COOLDOWN_MS) {
    row.lastSent = now
    row.events = []
    conflictState.set(key, row)
    const value = state.stickerById.get('treta')
    return value ? { value, matched: 'treta-contextual', exact: false, contextual: true } : null
  }

  conflictState.set(key, row)
  if (conflictState.size > 500) conflictState.delete(conflictState.keys().next().value)
  return null
}

export function matchAudioTrigger(text, context = {}) {
  return matchMap(state.audio, text, state.maxAudioWords, context)
}

export function matchStickerTrigger(text, context = {}) {
  const laughter = matchLaughterText(text, context)
  if (laughter) return laughter
  const contextual = matchConflictContext(text, context)
  if (contextual) return contextual
  return matchMap(state.stickers, text, state.maxStickerWords, context)
}

export async function getStickerTriggerBuffer(entry, withMetadata = true, context = {}) {
  const stat = await fs.stat(entry.file)
  const key = `${entry.file}:${stat.size}:${stat.mtimeMs}:auto-sticker-v1:${withMetadata}`
  if (state.stickerBuffers.has(key)) return state.stickerBuffers.get(key)
  const promise = fs.readFile(entry.file)
    .then(raw => withMetadata ? addExactStickerMetadata(raw, {
      packName: 'drux domina',
      publisher: '',
      emojis: []
    }) : raw)
  state.stickerBuffers.set(key, promise)
  if (state.stickerBuffers.size > 100) state.stickerBuffers.delete(state.stickerBuffers.keys().next().value)
  return promise
}

export function getTriggerStats() {
  return { ready: state.ready, ...state.stats, audioPhrases: state.audio.size, stickerPhrases: state.stickers.size }
}

export async function setTriggerMode(mode = 'classic') {
  const normalized = String(mode || '').toLowerCase()
  await store.update(db => {
    const enableAll = normalized === 'all' || normalized === 'completo'
    const disableAll = normalized === 'off' || normalized === 'desligado'
    for (const [id, entry] of Object.entries(db.audio || {})) {
      entry.enabled = entry.lockedDisabled === true || entry.commandOnly === true || STICKER_ONLY_AUDIO_IDS.has(id) || COMMAND_ONLY_AUDIO_IDS.has(id)
        ? false
        : disableAll ? false : enableAll ? true : Boolean(CLASSIC_AUDIO[id])
    }
    for (const [id, entry] of Object.entries(db.stickers || {})) {
      entry.enabled = entry.commandOnly === true
        ? false
        : disableAll ? false : enableAll ? true : Boolean(CLASSIC_STICKERS[id])
    }
  })
  return reloadTriggers()
}

export async function setTriggerEnabled(type, id, enabled) {
  const collection = type === 'sticker' || type === 'stickers' ? 'stickers' : 'audio'
  let changed = false
  await store.update(db => {
    const entry = db?.[collection]?.[id]
    if (!entry) return
    if (collection === 'audio' && (entry.lockedDisabled === true || entry.commandOnly === true || STICKER_ONLY_AUDIO_IDS.has(id) || COMMAND_ONLY_AUDIO_IDS.has(id))) return
    if (collection === 'stickers' && entry.commandOnly === true) return
    entry.enabled = Boolean(enabled)
    changed = true
  })
  await reloadTriggers()
  return changed
}

export async function warmTriggerCaches(logger, limit = 12) {
  const startedAt = Date.now()
  const priority = ['bomdia', 'boatarde', 'boanoite', 'palmeiras', 'palmeirense', 'freefire', 'flamengo', 'flamenguista', 'corinthiano', 'pernambucano', 'carioca', 'dog']
  const allAudio = [...new Map([...state.audio.values()].map(entry => [entry.id, entry])).values()].filter(entry => entry.legacy)
  const byId = new Map(allAudio.map(entry => [entry.id, entry]))
  const uniqueAudio = [
    ...priority.map(id => byId.get(id)).filter(Boolean),
    ...allAudio.filter(entry => !priority.includes(entry.id))
  ].slice(0, Math.max(0, limit))
  let audioReady = 0
  let stickerReady = 0
  const uniqueStickers = [...new Map([...state.stickers.values()].map(item => [item.id, item])).values()].slice(0, 16)
  const tasks = [
    ...uniqueAudio.map(entry => async () => {
      try { await prepareLegacyAudio(entry.file, logger); audioReady += 1 } catch (error) { logger?.debug?.({ error, trigger: entry.id }, 'pré-cache de áudio automático ignorado') }
    }),
    ...uniqueStickers.map(entry => async () => {
      try { await getStickerTriggerBuffer(entry, true); stickerReady += 1 } catch (error) { logger?.debug?.({ error, trigger: entry.id }, 'pré-cache de figurinha automática ignorado') }
    })
  ]
  const workerCount = Math.min(4, Math.max(1, tasks.length))
  await Promise.all(Array.from({ length: workerCount }, async (_, worker) => {
    for (let index = worker; index < tasks.length; index += workerCount) await tasks[index]()
  }))
  logger?.debug?.({ stage: 'trigger-warmup', audio: audioReady, sticker: stickerReady, executionMs: Date.now() - startedAt }, 'cache de respostas automáticas aquecido')
  return { audioReady, stickerReady }
}

export async function getTriggersDatabase() { return store.read() }
export async function updateTriggersDatabase(mutator) {
  const result = await store.update(mutator)
  await reloadTriggers()
  return result
}
