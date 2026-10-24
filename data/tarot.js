import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { randomBytes, randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { readConfig, rootDir, settings } from './settings.js'
import { isPlausibleAiToken } from './ai-token-utils.js'
import { openDatabase } from './database.js'

const deckPath = path.join(rootDir, 'assets', 'tarot', 'tarot.json')
const tarotDir = path.join(rootDir, 'assets', 'tarot')
const cardsDir = path.join(tarotDir, 'cards')
const labelsDir = path.join(tarotDir, 'labels')
const templatePath = path.join(tarotDir, 'template.png')
const stateStore = openDatabase('tarot-state', { version: 1, readings: {}, quota: {} })
const READING_TTL_MS = 45 * 60 * 1000
let deckCache = null

function digits(value = '') { return String(value || '').replace(/\D/g, '') }
function dayKey(now = Date.now()) { return new Date(Number(now) || Date.now()).toISOString().slice(0, 10) }
function normalize(value = '') { return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim() }

function runProcess(command, args, { timeoutMs = 60_000, logger } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      child.kill('SIGKILL')
      reject(new Error(`${command} excedeu ${timeoutMs} ms`))
    }, timeoutMs)
    child.stderr.on('data', chunk => { stderr += chunk.toString(); if (stderr.length > 12000) stderr = stderr.slice(-12000) })
    child.on('error', error => { if (settled) return; settled = true; clearTimeout(timer); reject(error) })
    child.on('close', code => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (code === 0) resolve({ code, stderr })
      else {
        logger?.debug?.({ code, stderr: stderr.slice(-2000), command }, 'renderização FFmpeg do tarô falhou')
        reject(new Error(`${command} terminou com código ${code}: ${stderr.slice(-500)}`))
      }
    })
  })
}

export const TAROT_POSITIONS = Object.freeze(['Passado', 'Presente', 'Caminho'])
export const TAROT_MODES = Object.freeze({
  geral: Object.freeze({ label: 'Leitura geral', positions: TAROT_POSITIONS }),
  simnao: Object.freeze({ label: 'Sim ou não', positions: Object.freeze(['Sinal', 'Influência', 'Resposta']) }),
  amor: Object.freeze({ label: 'Amor', positions: Object.freeze(['Você', 'Vínculo', 'Caminho']) }),
  trabalho: Object.freeze({ label: 'Trabalho', positions: Object.freeze(['Situação', 'Desafio', 'Caminho']) }),
  conselho: Object.freeze({ label: 'Conselho', positions: Object.freeze(['Agora', 'Atenção', 'Conselho']) })
})

export function parseTarotRequest(input = '') {
  const raw = String(input || '').replace(/\s+/g, ' ').trim()
  if (!raw) return { mode: 'geral', question: '' }
  const normalized = normalize(raw)
  const patterns = [
    ['simnao', /^(?:sim\s+ou\s+nao|sim\s*\/\s*nao|sim-?nao)\b\s*/i],
    ['amor', /^amor\b\s*/i],
    ['trabalho', /^(?:trabalho|carreira)\b\s*/i],
    ['conselho', /^conselho\b\s*/i],
    ['geral', /^geral\b\s*/i]
  ]
  for (const [mode, pattern] of patterns) {
    const match = normalized.match(pattern)
    if (!match) continue
    const wordsRemoved = normalized.slice(0, match[0].length).trim().split(/\s+/).filter(Boolean).length
    const question = raw.split(/\s+/).slice(wordsRemoved).join(' ').trim()
    return { mode, question }
  }
  return { mode: 'geral', question: raw }
}

export function getTarotDeck() {
  if (!deckCache) deckCache = JSON.parse(fs.readFileSync(deckPath, 'utf8'))
  return deckCache.map(card => ({ ...card }))
}

function cardById(id = '') {
  return getTarotDeck().find(card => card.id === id) || null
}

export function drawTarotCards(random = Math.random) {
  const pool = getTarotDeck()
  const picked = []
  while (picked.length < 3 && pool.length) {
    const index = Math.max(0, Math.min(pool.length - 1, Math.floor(Number(random()) * pool.length)))
    picked.push(pool.splice(index, 1)[0])
  }
  return picked
}

function cardYesNoScore(card = {}) {
  const id = String(card.id || '')
  if (/^major-/.test(id)) {
    const n = Number(id.slice(-2))
    if ([1, 3, 6, 7, 8, 10, 14, 17, 19, 20, 21].includes(n)) return 1
    if ([12, 13, 15, 16, 18].includes(n)) return -1
    return 0
  }
  const rank = Number(id.split('-').at(-1))
  if (id.startsWith('swords-')) return [1, 6, 11, 12, 13, 14].includes(rank) ? 0 : -1
  if (id.startsWith('cups-')) return [5, 7, 8].includes(rank) ? -1 : 1
  if (id.startsWith('pents-')) return rank === 5 ? -1 : ([4, 7].includes(rank) ? 0 : 1)
  if (id.startsWith('wands-')) return [5, 9, 10].includes(rank) ? -1 : 1
  return 0
}

export function evaluateTarotYesNo(cards = []) {
  const score = cards.slice(0, 3).reduce((total, card) => total + cardYesNoScore(card), 0)
  if (score >= 2) return 'Sim'
  if (score <= -2) return 'Não'
  return 'Talvez'
}

export function buildTarotBaseText(question, cards, { mode = 'geral' } = {}) {
  const selectedMode = TAROT_MODES[mode] ? mode : 'geral'
  const cfg = TAROT_MODES[selectedMode]
  const q = String(question || '').trim()
  const rows = cards.slice(0, 3).map((card, index) => `${cfg.positions[index]}: ${card.name}\n${card.meaning}.`)
  const extra = selectedMode === 'simnao'
    ? [`Tendência simbólica: ${evaluateTarotYesNo(cards)}`, 'Use como reflexão, não como certeza.']
    : []
  return [
    q ? `Pergunta: ${q}` : '',
    `Modo: ${cfg.label}`,
    '',
    ...rows,
    ...(extra.length ? ['', ...extra] : [])
  ].filter((item, index, list) => item !== '' || (index > 0 && list[index - 1] !== '')).join('\n')
}

export function buildTarotAiPrompt(question, cards, { mode = 'geral' } = {}) {
  const selectedMode = TAROT_MODES[mode] ? mode : 'geral'
  const cfg = TAROT_MODES[selectedMode]
  const list = cards.slice(0, 3).map((card, index) => `${cfg.positions[index]}: ${card.name} — ${card.meaning}`).join('\n')
  const modeInstruction = selectedMode === 'simnao'
    ? `A leitura é de sim ou não. Comece a resposta com "Sim", "Não" ou "Talvez" e explique brevemente. A tendência simbólica calculada pelas cartas foi "${evaluateTarotYesNo(cards)}"; trate isso como reflexão, nunca como certeza.`
    : selectedMode === 'amor'
      ? 'A leitura é sobre amor ou vínculos. Foque em sentimentos, dinâmica e caminho possível, sem afirmar o que outra pessoa pensa como fato.'
      : selectedMode === 'trabalho'
        ? 'A leitura é sobre trabalho/carreira. Foque em cenário, desafio e próximos passos simbólicos.'
        : selectedMode === 'conselho'
          ? 'A leitura é um conselho simbólico. Foque em reflexão prática e leve.'
          : 'A leitura é geral. Conecte as três posições de modo coerente.'
  return `Faça uma interpretação curta e cuidadosa de tarô em português brasileiro para a pergunta abaixo. Use somente as cartas e significados fornecidos. Não trate como certeza, previsão garantida, diagnóstico ou conselho profissional. Seja leve, humano e objetivo, em no máximo 2 parágrafos.\n${modeInstruction}\n\nPergunta: ${String(question || '').trim()}\n${list}`
}

export function hasConfiguredTarotAiToken() {
  const tokens = readConfig().ai?.tokens
  return Array.isArray(tokens) && tokens.some(entry => isPlausibleAiToken(typeof entry === 'object' ? (entry.token || entry.value || '') : entry))
}

export async function consumeTarotQuota(number, { vip = false, limit = 10, now = Date.now() } = {}) {
  const key = digits(number)
  const max = Math.max(1, Number(limit) || 10)
  if (vip) return { allowed: true, unlimited: true, used: 0, remaining: Infinity, limit: max }
  if (!key) return { allowed: false, unlimited: false, used: max, remaining: 0, limit: max }
  const day = dayKey(now)
  return stateStore.update(db => {
    db.version = 1
    if (!db.quota || typeof db.quota !== 'object') db.quota = {}
    let row = db.quota[key]
    if (!row || row.day !== day) row = { day, used: 0 }
    const used = Math.max(0, Number(row.used) || 0)
    if (used >= max) {
      db.quota[key] = { day, used }
      return { allowed: false, unlimited: false, used, remaining: 0, limit: max }
    }
    row.used = used + 1
    db.quota[key] = row
    return { allowed: true, unlimited: false, used: row.used, remaining: Math.max(0, max - row.used), limit: max }
  })
}

export async function createPendingTarotReading({ chatJid, senderNumber, question, mode = 'geral', cards, now = Date.now() } = {}) {
  const id = randomBytes(6).toString('hex')
  const createdAt = Number(now) || Date.now()
  const row = {
    id,
    chatJid: String(chatJid || ''),
    senderNumber: digits(senderNumber),
    question: String(question || '').trim().slice(0, 500),
    mode: TAROT_MODES[mode] ? mode : 'geral',
    cardIds: (cards || []).slice(0, 3).map(card => String(card?.id || '')).filter(Boolean),
    createdAt,
    expiresAt: createdAt + READING_TTL_MS
  }
  await stateStore.update(db => {
    db.version = 1
    if (!db.readings || typeof db.readings !== 'object') db.readings = {}
    for (const [key, value] of Object.entries(db.readings)) {
      if (!value || Number(value.expiresAt || 0) < createdAt) delete db.readings[key]
    }
    db.readings[id] = row
  })
  return { ...row, cards: row.cardIds.map(cardById).filter(Boolean) }
}

export async function getPendingTarotReading(id, { senderNumber, chatJid, now = Date.now() } = {}) {
  const key = String(id || '').trim()
  if (!key) return null
  const db = await stateStore.read()
  const row = db.readings?.[key]
  const current = Number(now) || Date.now()
  if (!row || Number(row.expiresAt || 0) < current) return null
  if (digits(row.senderNumber) !== digits(senderNumber)) return null
  if (String(row.chatJid || '') !== String(chatJid || '')) return null
  const cards = (row.cardIds || []).map(cardById).filter(Boolean)
  if (cards.length !== 3) return null
  return { ...row, cards }
}

async function renderWithJimp(cards) {
  const { Jimp } = await import('jimp')
  const canvas = await Jimp.read(templatePath)
  const cardW = 300, cardH = 518, gap = 55, startX = 95, top = 70, labelY = 610
  for (let i = 0; i < 3; i++) {
    const card = cards[i], x = startX + i * (cardW + gap)
    const art = await Jimp.read(path.join(cardsDir, card.image))
    art.resize({ w: cardW, h: cardH })
    canvas.composite(art, x, top)
    const label = await Jimp.read(path.join(labelsDir, card.label))
    canvas.composite(label, x - 15, labelY)
  }
  return canvas.getBuffer('image/png')
}

async function renderWithFfmpeg(cards, logger) {
  await fsp.mkdir(settings.tmpDir, { recursive: true })
  const output = path.join(settings.tmpDir, `tarot-${randomUUID()}.png`)
  const args = ['-hide_banner', '-loglevel', 'error', '-y', '-i', templatePath]
  for (const card of cards) args.push('-i', path.join(cardsDir, card.image), '-i', path.join(labelsDir, card.label))
  const xs = [95, 450, 805]
  const filters = []
  let base = '[0:v]'
  for (let i = 0; i < 3; i++) {
    const cardInput = 1 + i * 2
    const labelInput = cardInput + 1
    filters.push(`[${cardInput}:v]scale=300:518[c${i}]`)
    filters.push(`${base}[c${i}]overlay=${xs[i]}:70[b${i}]`)
    filters.push(`[${labelInput}:v]scale=330:62[l${i}]`)
    filters.push(`[b${i}][l${i}]overlay=${xs[i]-15}:610[o${i}]`)
    base = `[o${i}]`
  }
  args.push('-filter_complex', filters.join(';'), '-map', base, '-frames:v', '1', output)
  try {
    await runProcess(settings.ffmpegPath, args, { timeoutMs: 60_000, logger })
    return await fsp.readFile(output)
  } finally {
    await fsp.rm(output, { force: true }).catch(() => {})
  }
}

export async function renderTarotImage(cards, { logger } = {}) {
  if (!Array.isArray(cards) || cards.length !== 3) throw new Error('A imagem de tarô precisa de exatamente 3 cartas.')
  try {
    return await renderWithJimp(cards)
  } catch (error) {
    logger?.debug?.({ error, stage: 'tarot-jimp-fallback' }, 'Jimp indisponível; usando FFmpeg para o tarô')
    return renderWithFfmpeg(cards, logger)
  }
}
