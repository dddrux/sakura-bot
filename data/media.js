import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { downloadMediaMessage } from '@sakura-md/baileys'
import { settings } from './settings.js'
import { getMediaKind, getMediaTarget, unwrapMessage } from './messages.js'
import { renderAnimatedRainbowBratWithFfmpeg, renderBratWithFfmpeg } from './brat-ffmpeg.js'

const MAX_STDERR = 12_000

const WHATSAPP_STYLE_EMOJI_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'node_modules', 'emoji-datasource-apple', 'img', 'apple', '64')
const TWEMOJI_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'node_modules', '@twemoji', 'svg')
const emojiSvgCache = new Map()
const graphemeSegmenter = new Intl.Segmenter('pt-BR', { granularity: 'grapheme' })
const BRAT_FPS = 24
const IS_ARM = process.arch === 'arm' || process.arch === 'arm64' || process.env.SAKURA_FORCE_BRAT_FALLBACK === '1'
let sharpLoader
let imageMagickCommand

async function getSharp({ optional = false } = {}) {
  if (!sharpLoader) sharpLoader = import('sharp').then(module => module.default || module).catch(() => null)
  const sharp = await sharpLoader
  if (sharp || optional) return sharp
  const failure = new Error('O Sharp não está disponível. Em ARMv7, instale ImageMagick para usar o fallback do Brat.')
  failure.code = 'SAKURA_SHARP_UNAVAILABLE'
  throw failure
}

async function resolveImageMagick(logger) {
  if (imageMagickCommand !== undefined) return imageMagickCommand
  for (const command of ['magick', 'convert']) {
    try {
      await runProcess(command, ['-version'], { timeoutMs: 5000, logger })
      imageMagickCommand = command
      return command
    } catch {}
  }
  imageMagickCommand = null
  return null
}

async function renderSvgWithFallback(svg, output, { format = 'webp', logger } = {}) {
  const sharp = await getSharp({ optional: true })
  // Sharp produz texto muito mais consistente que o conversor SVG do
  // ImageMagick no ARM. Quando estiver disponível, ele sempre tem prioridade.
  if (sharp) {
    const image = sharp(Buffer.from(svg), { density: 192 })
      .resize(512, 512, { fit: 'fill', withoutEnlargement: false })
    if (format === 'png') await image.png({ compressionLevel: 7 }).toFile(output)
    else await image.webp({ quality: IS_ARM ? 88 : 92, effort: IS_ARM ? 4 : 5 }).toFile(output)
    return IS_ARM ? 'sharp-arm' : 'sharp'
  }
  const command = await resolveImageMagick(logger)
  if (!command) {
    const error = new Error('Renderizador SVG nativo indisponível; usando fallback FFmpeg.')
    error.code = 'SAKURA_BRAT_USE_FFMPEG'
    throw error
  }
  const input = `${output}.svg`
  await fs.writeFile(input, svg)
  try {
    const args = command === 'magick'
      ? ['-density', '192', input, '-background', 'none', '-alpha', 'on', '-resize', '512x512!', '-strip', '-quality', format === 'png' ? '95' : '90', output]
      : ['-density', '192', input, '-background', 'none', '-alpha', 'on', '-resize', '512x512!', '-strip', '-quality', format === 'png' ? '95' : '90', output]
    await runProcess(command, args, { timeoutMs: 45_000, logger })
    return command
  } finally {
    await fs.rm(input, { force: true }).catch(() => {})
  }
}
const BRAT_THEMES = Object.freeze({
  verde: { key: 'verde', bg: '#8AD900', fg: '#0A0A0A', aliases: ['verde', 'green', 'lime', 'brat'] },
  rosa: { key: 'rosa', bg: '#FF86C8', fg: '#0A0A0A', aliases: ['rosa', 'pink'] },
  azul: { key: 'azul', bg: '#86D7FF', fg: '#0A0A0A', aliases: ['azul', 'blue'] },
  roxo: { key: 'roxo', bg: '#C9A4FF', fg: '#0A0A0A', aliases: ['roxo', 'purple', 'lilas', 'lilás'] },
  vermelho: { key: 'vermelho', bg: '#FF7575', fg: '#0A0A0A', aliases: ['vermelho', 'red'] },
  branco: { key: 'branco', bg: '#FFFFFF', fg: '#101010', aliases: ['branco', 'white'] },
  preto: { key: 'preto', bg: '#111111', fg: '#F4F4F4', aliases: ['preto', 'black'] },
  rainbow: { key: 'rainbow', bg: '#FF4F81', fg: '#FFFFFF', aliases: ['rainbow', 'arcoiris', 'arco-iris'] }
})

async function ensureTmp() {
  await fs.mkdir(settings.tmpDir, { recursive: true })
}

export function runProcess(command, args, { timeoutMs = 60_000, logger } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      child.kill('SIGKILL')
      reject(new Error(`${command} excedeu ${timeoutMs} ms`))
    }, timeoutMs)

    child.stderr.on('data', chunk => {
      stderr += chunk.toString()
      if (stderr.length > MAX_STDERR) stderr = stderr.slice(-MAX_STDERR)
    })
    child.on('error', error => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(error)
    })
    child.on('close', code => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (code === 0) resolve({ code, stderr })
      else {
        logger?.debug?.({ code, stderr: stderr.slice(-3000), command, args }, 'processo de mídia falhou')
        reject(new Error(`${command} terminou com código ${code}: ${stderr.slice(-500)}`))
      }
    })
  })
}

export async function assertFfmpeg() {
  await runProcess(settings.ffmpegPath, ['-version'], { timeoutMs: 5000 })
  return true
}

function normalizeThemeName(value = '') {
  return String(value).normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase()
}

export function resolveBratTheme(value = 'branco') {
  const normalized = normalizeThemeName(value)
  for (const theme of Object.values(BRAT_THEMES)) {
    if (theme.aliases.includes(normalized)) return theme
  }
  return BRAT_THEMES.branco
}

function extensionFor(kind) {
  if (kind === 'image') return '.jpg'
  if (kind === 'video') return '.mp4'
  if (kind === 'sticker') return '.webp'
  return '.bin'
}

async function withTempFiles(names, callback) {
  await ensureTmp()
  const id = randomUUID()
  const files = Object.fromEntries(names.map(name => [name, path.join(settings.tmpDir, `${id}-${name}`)]))
  try {
    return await callback(files)
  } finally {
    await Promise.all(Object.values(files).map(file => fs.rm(file, { force: true }).catch(() => {})))
  }
}

async function withTempDirectory(callback) {
  await ensureTmp()
  const directory = path.join(settings.tmpDir, `brat-${randomUUID()}`)
  await fs.mkdir(directory, { recursive: true })
  try {
    return await callback(directory)
  } finally {
    await fs.rm(directory, { recursive: true, force: true }).catch(() => {})
  }
}

function numericValue(value) {
  if (typeof value === 'number') return value
  if (typeof value === 'bigint') return Number(value)
  if (value && typeof value.toNumber === 'function') return value.toNumber()
  if (value && Number.isFinite(Number(value.low))) return Number(value.low)
  return Number(value) || 0
}

function mediaDetails(target, kind) {
  const { content } = unwrapMessage(target?.message)
  const node = kind === 'image' ? content.imageMessage : kind === 'video' ? content.videoMessage : content.stickerMessage
  return {
    fileLength: numericValue(node?.fileLength),
    seconds: numericValue(node?.seconds),
    animated: kind === 'video' || Boolean(node?.isAnimated)
  }
}

export async function downloadStickerSource(msg, logger) {
  const target = getMediaTarget(msg)
  if (!target) return null
  const kind = getMediaKind(target.message)
  if (!['image', 'video', 'sticker'].includes(kind)) return null
  const details = mediaDetails(target, kind)
  const buffer = await downloadMediaMessage(target, 'buffer', {}, { logger })
  return { buffer, kind, target, ...details }
}

function escapeDrawText(value = '') {
  return String(value || '').replaceAll('\\', '\\\\').replaceAll(':', '\\:').replaceAll("'", "\\'").replaceAll('%', '\\%').replace(/[\r\n]+/g, ' ').slice(0, 120)
}

function baseScaleFilter({ fit = 'fill', border = false } = {}) {
  if (border) return 'scale=464:464:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=white'
  if (fit === 'contain') return 'scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=0x00000000'
  if (fit === 'cover') return 'scale=512:512:force_original_aspect_ratio=increase,crop=512:512'
  return 'scale=512:512:flags=lanczos'
}

function stickerFilters(options = {}, animated = false) {
  const filters = []
  if (animated) filters.push(`fps=${Math.max(8, Math.min(60, Number(options.fps) || 24))}`)
  filters.push(baseScaleFilter(options))
  if (options.round) filters.push("format=rgba,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='if(lte(hypot(X-W/2,Y-H/2),min(W,H)/2),alpha(X,Y),0)'")
  if (options.text) filters.push(`drawtext=text='${escapeDrawText(options.text)}':fontcolor=white:fontsize=38:borderw=3:bordercolor=black:x=(w-text_w)/2:y=h-text_h-28`)
  filters.push('setsar=1')
  return filters.join(',')
}

export async function convertToSticker(buffer, kind, logger, options = {}) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw new TypeError('Mídia vazia')
  const animated = kind === 'video' || kind === 'sticker'
  const duration = Math.max(1, Math.min(animated ? 6 : 1, Number(options.durationSec) || (animated ? 6 : 1)))
  const quality = Math.max(35, Math.min(95, Number(options.quality) || (animated ? 72 : 82)))
  return withTempFiles([`input${extensionFor(kind)}`, 'output.webp'], async files => {
    const input = files[`input${extensionFor(kind)}`]
    const output = files['output.webp']
    await fs.writeFile(input, buffer)
    const args = ['-hide_banner', '-loglevel', 'error', '-y', '-i', input]
    if (animated) args.push('-t', String(duration))
    args.push('-vf', stickerFilters(options, animated), '-an', '-c:v', animated ? 'libwebp_anim' : 'libwebp')
    if (animated) args.push('-loop', '0')
    args.push('-preset', 'picture', '-q:v', String(quality), '-compression_level', String(Math.max(3, Math.min(6, Number(options.compressionLevel) || 4))), output)
    await runProcess(settings.ffmpegPath, args, { timeoutMs: Number(options.timeoutMs) || 75_000, logger })
    const sticker = await fs.readFile(output)
    logger?.debug?.({ bytes: sticker.length, animated, sourceKind: kind, fps: animated ? Number(options.fps) || 24 : 0, fit: options.fit || 'fill' }, 'figurinha convertida')
    return sticker
  })
}

export async function convertVipAnimatedSticker(buffer, kind, logger) {
  if (!['video', 'sticker'].includes(kind)) throw new TypeError('O modo animado VIP precisa de vídeo, GIF ou figurinha animada')
  // Mantém 60 FPS em todas as tentativas. Para caber no limite do WhatsApp,
  // reduz qualidade e duração antes de reduzir a taxa de quadros.
  const tiers = [
    { fps: 60, quality: 66, fit: 'contain', durationSec: 5, compressionLevel: 6 },
    { fps: 60, quality: 54, fit: 'contain', durationSec: 5, compressionLevel: 6 },
    { fps: 60, quality: 42, fit: 'contain', durationSec: 4.5, compressionLevel: 6 }
  ]
  let last
  for (let index = 0; index < tiers.length; index += 1) {
    const tier = tiers[index]
    try {
      const result = await convertToSticker(buffer, kind, logger, { ...tier, timeoutMs: 150_000 })
      last = { buffer: result, fps: 60, reduced: index > 0, qualityReduced: index > 0 }
      if (result.length <= 1_000_000) return last
    } catch (error) { last = { error } }
  }
  if (last?.buffer) return last
  throw last?.error || new Error('Não foi possível criar a figurinha VIP em 60 FPS')
}

export async function normalizeStatusVideo(buffer, logger, { maxSeconds = 60 } = {}) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw new TypeError('Vídeo de status vazio')
  return withTempFiles(['status-input.mp4', 'status-output.mp4'], async files => {
    const input = files['status-input.mp4']
    const output = files['status-output.mp4']
    await fs.writeFile(input, buffer)
    await runProcess(settings.ffmpegPath, [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-i', input, '-t', String(Math.max(1, Math.min(90, Number(maxSeconds) || 60))),
      '-map', '0:v:0', '-map', '0:a?',
      '-vf', "fps=30,scale='min(720,iw)':-2:flags=fast_bilinear,format=yuv420p",
      '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '28',
      '-profile:v', 'baseline', '-level', '3.1',
      '-c:a', 'aac', '-b:a', '96k', '-ar', '44100',
      '-movflags', '+faststart', '-max_muxing_queue_size', '2048',
      output
    ], { timeoutMs: 180_000, logger })
    const result = await fs.readFile(output)
    logger?.debug?.({ inputBytes: buffer.length, outputBytes: result.length }, 'vídeo normalizado para status')
    return result
  })
}

function escapeXml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

function isEmojiLike(character = '') {
  return /\p{Extended_Pictographic}/u.test(character)
}

function splitGraphemes(value = '') {
  return [...graphemeSegmenter.segment(String(value))].map(item => item.segment)
}

function graphemeUnits(segment = '') {
  if (segment === ' ') return 0.34
  if (isEmojiLike(segment)) return 1.02
  if (/[ilI1'`]/u.test(segment)) return 0.31
  if (/[mwMW]/u.test(segment)) return 0.92
  if (/[,.;:!?]/u.test(segment)) return 0.31
  return 0.67
}

function visualLength(value = '') {
  const segments = splitGraphemes(value)
  let total = 0
  for (let index = 0; index < segments.length; index += 1) {
    const current = segments[index]
    const previous = segments[index - 1]
    total += graphemeUnits(current)
    if (isEmojiLike(current) && isEmojiLike(previous)) total += 0.04
    else if (isEmojiLike(current) && previous && previous !== ' ') total += 0.03
    else if (!isEmojiLike(current) && current !== ' ' && isEmojiLike(previous)) total += 0.04
  }
  return total
}

function normalizeBratInput(input) {
  return String(input ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/\t/g, ' ')
    .replace(/[ ]{2,}/g, ' ')
    .trim()
    .slice(0, 260)
}

function tokenizeBratInput(input) {
  const normalized = normalizeBratInput(input)
  if (!normalized) return { tokens: [], explicitLines: [] }

  const explicitLines = normalized
    .split(/\n+/)
    .map(line => line.trim().split(/\s+/).filter(Boolean))
    .filter(line => line.length)

  return {
    tokens: explicitLines.flat().slice(0, 24),
    explicitLines: explicitLines.length > 1 ? explicitLines : []
  }
}


function lineUnits(words) {
  return visualLength(words.join(' '))
}

function candidateLineCounts(wordCount) {
  const target = Math.max(1, Math.ceil(Math.sqrt(wordCount)))
  const minLines = Math.max(1, target - 1)
  const maxLines = Math.min(wordCount, target)
  const counts = []
  for (let lines = minLines; lines <= maxLines; lines += 1) counts.push(lines)
  return counts
}

function distributeWords(words, lineCount) {
  const rows = []
  let cursor = 0
  let remainingWords = words.length
  let remainingLines = lineCount

  while (remainingLines > 0) {
    const target = remainingWords / remainingLines
    let take = Math.max(1, Math.round(target))
    const minRest = remainingLines - 1
    take = Math.min(take, remainingWords - minRest)
    rows.push(words.slice(cursor, cursor + take))
    cursor += take
    remainingWords -= take
    remainingLines -= 1
  }

  return rows.filter(row => row.length)
}

function scorePhraseRows(rows) {
  const innerWidth = 512 - 56
  const innerHeight = 512 - 56
  const rowGap = 8
  const lineHeight = 1.08
  const units = rows.map(lineUnits)
  const maxUnits = Math.max(...units, 1)
  const fontByWidth = innerWidth / (maxUnits * 0.84)
  const fontByHeight = (innerHeight - rowGap * Math.max(0, rows.length - 1)) / (rows.length * lineHeight)
  const fontSize = Math.min(118, fontByWidth, fontByHeight)
  const widthsPx = units.map(value => value * fontSize * 0.84)
  const maxWidth = Math.max(...widthsPx, 1)
  const blockHeight = rows.length * fontSize * lineHeight + rowGap * Math.max(0, rows.length - 1)
  const aspectPenalty = Math.abs(maxWidth / Math.max(blockHeight, 1) - 1)
  const avg = widthsPx.reduce((sum, value) => sum + value, 0) / widthsPx.length
  const variance = Math.sqrt(widthsPx.reduce((sum, value) => sum + Math.pow(value - avg, 2), 0) / widthsPx.length) / Math.max(maxWidth, 1)
  const tinyLast = rows.length > 1 && rows[rows.length - 1].length === 1 ? 0.18 : 0
  const tooManyLines = Math.max(0, rows.length - 4) * 0.12
  return aspectPenalty * 1.3 + variance * 1.4 + tinyLast + tooManyLines - fontSize / 180
}

function autoRowsSquare(words) {
  if (words.length <= 1) return [words]
  let best = [words]
  let bestScore = Number.POSITIVE_INFINITY

  for (const lineCount of candidateLineCounts(words.length)) {
    const base = distributeWords(words, lineCount)
    const variants = [base]

    if (base.length > 1) {
      for (let index = 0; index < base.length - 1; index += 1) {
        if (base[index].length > 1) {
          const moved = base.map(row => [...row])
          moved[index + 1].unshift(moved[index].pop())
          variants.push(moved)
        }
        if (base[index + 1].length > 1) {
          const moved = base.map(row => [...row])
          moved[index].push(moved[index + 1].shift())
          variants.push(moved)
        }
      }
    }

    for (const rows of variants) {
      const score = scorePhraseRows(rows)
      if (score < bestScore) {
        bestScore = score
        best = rows
      }
    }
  }

  return best
}

function buildRows(tokenData, count) {
  const visible = tokenData.tokens.slice(0, Math.max(1, count))
  if (!tokenData.explicitLines.length) return autoRowsSquare(visible)

  const rows = []
  let cursor = 0
  for (const sourceLine of tokenData.explicitLines) {
    if (cursor >= visible.length) break
    const take = Math.min(sourceLine.length, visible.length - cursor)
    rows.push(visible.slice(cursor, cursor + take))
    cursor += take
  }
  return rows.length ? rows : [visible]
}

export function resolveBratAlignment(value = 'esquerda') {
  const raw = String(value || 'esquerda').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase()
  if (['direita', 'right', 'end', 'fim'].includes(raw)) return 'right'
  if (['centro', 'central', 'center', 'centre', 'meio'].includes(raw)) return 'center'
  return 'left'
}

function getLayout(tokenData, count, alignment = 'left') {
  const rows = buildRows(tokenData, count)
  const width = 512
  const height = 512
  const marginX = 48
  const marginY = 42
  const rowGap = 8
  const lineHeight = 1.08
  const rowCount = rows.length
  const units = rows.map(lineUnits)
  const widestUnits = Math.max(...units, 1)
  const availableHeight = height - marginY * 2 - rowGap * Math.max(0, rowCount - 1)
  const fontByHeight = availableHeight / (rowCount * lineHeight)
  const fontByWidth = (width - marginX * 2) / (widestUnits * 0.84)
  const fontSize = Math.max(16, Math.min(118, fontByHeight, fontByWidth))
  const totalHeight = rowCount * fontSize * lineHeight + rowGap * Math.max(0, rowCount - 1)
  const startY = (height - totalHeight) / 2 + fontSize * 0.78
  const positions = []
  let tokenIndex = 0

  rows.forEach((row, rowIndex) => {
    const lineText = row.join(' ')
    const lineWidth = units[rowIndex] * fontSize * 0.84
    const resolvedAlignment = resolveBratAlignment(alignment)
    const preferredX = resolvedAlignment === 'right'
      ? width - marginX - lineWidth
      : resolvedAlignment === 'center'
        ? (width - lineWidth) / 2
        : marginX
    const x = Math.max(marginX, Math.min(width - marginX - lineWidth, preferredX))
    const y = startY + rowIndex * (fontSize * lineHeight + rowGap)
    positions.push({
      index: tokenIndex,
      word: lineText,
      x,
      y,
      fontSize,
      tokenCount: row.length
    })
    tokenIndex += row.length
  })

  return { rows, positions, fontSize }
}

function easeOutCubic(value) {
  const t = Math.max(0, Math.min(1, value))
  return 1 - Math.pow(1 - t, 3)
}

function lerp(a, b, t) {
  return a + (b - a) * t
}

function getAnimationPlan(wordCount) {
  const stepFrames = 12
  const transitionFrames = 8
  const holdFrames = 16
  const totalFrames = Math.max(48, wordCount * stepFrames + holdFrames)
  return { stepFrames, transitionFrames, holdFrames, totalFrames }
}

function getStage(frame, wordCount, plan) {
  const revealIndex = Math.min(wordCount - 1, Math.floor(frame / plan.stepFrames))
  const visibleCount = Math.min(wordCount, revealIndex + 1)
  const localFrame = frame - revealIndex * plan.stepFrames
  const transitionProgress = visibleCount === 1 ? 1 : easeOutCubic(Math.min(1, localFrame / plan.transitionFrames))
  return { visibleCount, transitionProgress }
}

function fontFamilyFor() {
  // DejaVu Sans existe por padrão no Raspberry Pi OS e evita substituições
  // inconsistentes do Arial no fallback do ImageMagick.
  return 'DejaVu Sans, Liberation Sans, Arial, Helvetica, sans-serif'
}


function emojiCodePoint(value = '', { keepVariation = true } = {}) {
  return Array.from(String(value))
    .map(character => character.codePointAt(0))
    .filter(code => keepVariation || code !== 0xfe0f)
    .map(code => code.toString(16).padStart(code <= 0xffff ? 4 : 0, '0'))
    .join('-')
}

function findWhatsAppStyleEmojiFile(value = '') {
  const fullCode = emojiCodePoint(value, { keepVariation: true })
  const simpleCode = emojiCodePoint(value, { keepVariation: false })
  const candidates = [
    path.join(WHATSAPP_STYLE_EMOJI_DIR, `${fullCode}.png`),
    path.join(WHATSAPP_STYLE_EMOJI_DIR, `${simpleCode}.png`)
  ]
  return candidates.find(file => fsSync.existsSync(file)) || null
}

async function prepareEmojiAssets(tokenData) {
  const unique = new Map()
  for (const token of tokenData.tokens || []) {
    for (const segment of splitGraphemes(token)) {
      if (!isEmojiLike(segment)) continue
      const key = emojiCodePoint(segment, { keepVariation: true }) || emojiCodePoint(segment, { keepVariation: false })
      if (key) unique.set(key, segment)
    }
  }

  await Promise.all([...unique.entries()].map(async ([key, value]) => {
    if (emojiSvgCache.has(key)) return
    const whatsappStyleFile = findWhatsAppStyleEmojiFile(value)
    if (whatsappStyleFile) {
      try {
        const png = fsSync.readFileSync(whatsappStyleFile)
        emojiSvgCache.set(key, `data:image/png;base64,${png.toString('base64')}`)
        return
      } catch {}
    }

    const simpleCode = emojiCodePoint(value, { keepVariation: false })
    try {
      const svg = fsSync.readFileSync(path.join(TWEMOJI_DIR, `${simpleCode}.svg`))
      emojiSvgCache.set(key, `data:image/svg+xml;base64,${svg.toString('base64')}`)
    } catch {
      emojiSvgCache.set(key, null)
    }
  }))
}

function emojiDataUri(value = '') {
  const fullCode = emojiCodePoint(value, { keepVariation: true })
  const simpleCode = emojiCodePoint(value, { keepVariation: false })
  return emojiSvgCache.get(fullCode) ?? emojiSvgCache.get(simpleCode) ?? null
}

function renderBratWord(position, theme) {
  const segments = splitGraphemes(position.word)
  const runs = []
  for (const segment of segments) {
    const emoji = isEmojiLike(segment)
    const last = runs[runs.length - 1]
    if (!emoji && last?.type === 'text') last.value += segment
    else runs.push({ type: emoji ? 'emoji' : 'text', value: segment })
  }

  let cursorX = position.x
  const parts = []
  let previousType = ''

  for (const run of runs) {
    if (run.type === 'emoji') {
      const previousRun = runs[runs.indexOf(run) - 1]
      const previousEndsWithSpace = previousRun?.type === 'text' && /\s$/u.test(previousRun.value)
      if (previousType === 'emoji') cursorX += position.fontSize * 0.04
      else if (previousType === 'text' && !previousEndsWithSpace) cursorX += position.fontSize * 0.03

      const uri = emojiDataUri(run.value)
      const box = position.fontSize * 1.05
      const visibleSize = position.fontSize * 1.04
      const inset = (box - visibleSize) / 2
      const x = cursorX + inset
      const y = position.y - visibleSize * 0.88
      if (uri) {
        parts.push(`<image href="${uri}" x="${x.toFixed(3)}" y="${y.toFixed(3)}" width="${visibleSize.toFixed(3)}" height="${visibleSize.toFixed(3)}" preserveAspectRatio="xMidYMid meet"/>`)
      } else {
        parts.push(`<text x="${cursorX.toFixed(3)}" y="${position.y.toFixed(3)}" font-family="Apple Color Emoji, Noto Color Emoji, Segoe UI Emoji, sans-serif" font-size="${(position.fontSize * 0.82).toFixed(2)}" fill="${theme.fg}">${escapeXml(run.value)}</text>`)
      }
      cursorX += box
    } else {
      if (previousType === 'emoji' && !/^\s/u.test(run.value)) cursorX += position.fontSize * 0.04
      parts.push(`<text x="${cursorX.toFixed(3)}" y="${position.y.toFixed(3)}" text-anchor="start" dominant-baseline="alphabetic" font-family="${fontFamilyFor()}" font-size="${position.fontSize.toFixed(2)}" font-weight="400" letter-spacing="-0.25" fill="${theme.fg}">${escapeXml(run.value)}</text>`)
      cursorX += visualLength(run.value) * position.fontSize * 0.84
    }
    previousType = run.type
  }
  return parts.join('')
}

function buildStaticBratSvg(tokenData, options = {}) {
  const layout = getLayout(tokenData, tokenData.tokens.length, options.alignment)
  const theme = resolveBratTheme(options.theme)
  const words = layout.positions.map(position => renderBratWord(position, theme))

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="${theme.bg}"/>
  <g text-rendering="geometricPrecision">${words.join('')}</g>
</svg>`
}

function buildAnimatedBratFrame(tokenData, theme, frame, totalFrames, alignment = 'left') {
  const layout = getLayout(tokenData, tokenData.tokens.length, alignment)
  const position = layout.positions[0]
  const t = frame / Math.max(1, totalFrames - 1)
  const eased = easeOutCubic(Math.min(1, t * 1.6))
  const pulse = 1 + Math.sin(t * Math.PI * 2) * 0.018
  const opacity = Math.max(0.12, eased)
  const scale = (0.9 + eased * 0.1) * pulse
  const rendered = renderBratWord(position, theme)
  const word = `<g opacity="${opacity.toFixed(3)}" transform="translate(${position.x.toFixed(3)} ${position.y.toFixed(3)}) scale(${scale.toFixed(4)} ${scale.toFixed(4)}) translate(${-position.x.toFixed(3)} ${-position.y.toFixed(3)})">${rendered}</g>`
  const hue = Math.round((frame / Math.max(1, totalFrames)) * 360)
  const background = theme.key === 'rainbow' ? `hsl(${hue}, 92%, 60%)` : theme.bg

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="${background}"/>
  <g text-rendering="geometricPrecision">${word}</g>
</svg>`
}


export function wrapBratText(input) {
  const tokenData = tokenizeBratInput(input)
  if (!tokenData.tokens.length) return []
  return buildRows(tokenData, tokenData.tokens.length).map(row => row.join('    '))
}

export async function createStaticBratSticker(text, options = {}, logger) {
  const tokenData = tokenizeBratInput(text)
  if (!tokenData.tokens.length) throw new TypeError('Informe um texto para o brat')
  const theme = resolveBratTheme(options.theme)
  await prepareEmojiAssets(tokenData)

  return withTempFiles(['brat.webp'], async files => {
    let renderer = ''
    try {
      renderer = await renderSvgWithFallback(buildStaticBratSvg(tokenData, { theme: theme.key, alignment: resolveBratAlignment(options.alignment) }), files['brat.webp'], { format: 'webp', logger })
    } catch (error) {
      if (error?.code !== 'SAKURA_BRAT_USE_FFMPEG') throw error
      await renderBratWithFfmpeg({ text, lines: wrapBratText(text), background: theme.bg, foreground: theme.fg, alignment: resolveBratAlignment(options.alignment), output: files['brat.webp'], ffmpegPath: settings.ffmpegPath })
      renderer = 'ffmpeg-drawtext'
    }
    const result = await fs.readFile(files['brat.webp'])
    logger?.success?.({
      bytes: result.length,
      format: 'webp-still',
      theme: theme.key,
      alignment: resolveBratAlignment(options.alignment),
      renderer,
      architecture: process.arch,
      words: tokenData.tokens.length,
      finalLayout: wrapBratText(text)
    }, 'brat estático criado')
    return result
  })
}

export async function createAnimatedBratSticker(text, options = {}, logger) {
  const tokenData = tokenizeBratInput(text)
  if (!tokenData.tokens.length) throw new TypeError('Informe um texto para o brat')
  if (tokenData.tokens.length !== 1) throw new TypeError('A opção animada aceita apenas uma palavra')
  const theme = resolveBratTheme(options.theme)
  await prepareEmojiAssets(tokenData)
  const totalFrames = 30

  return withTempDirectory(async directory => {
    let renderer = ''
    for (let frame = 0; frame < totalFrames; frame += 1) {
      const framePath = path.join(directory, `frame-${String(frame).padStart(3, '0')}.png`)
      try {
        renderer = await renderSvgWithFallback(buildAnimatedBratFrame(tokenData, theme, frame, totalFrames, resolveBratAlignment(options.alignment)), framePath, { format: 'png', logger })
      } catch (error) {
        if (error?.code !== 'SAKURA_BRAT_USE_FFMPEG') throw error
        const fallbackOutput = path.join(directory, 'brat.webp')
        if (theme.key === 'rainbow') {
          await renderAnimatedRainbowBratWithFfmpeg({ text, foreground: theme.fg, alignment: resolveBratAlignment(options.alignment), output: fallbackOutput, ffmpegPath: settings.ffmpegPath })
          logger?.warn?.({ renderer: 'ffmpeg-rainbow-animated' }, 'Brat rainbow animado renderizado diretamente pelo FFmpeg')
        } else {
          await renderBratWithFfmpeg({ text, lines: wrapBratText(text), background: theme.bg, foreground: theme.fg, alignment: resolveBratAlignment(options.alignment), output: fallbackOutput, ffmpegPath: settings.ffmpegPath })
          logger?.warn?.({ renderer: 'ffmpeg-drawtext' }, 'Brat animado caiu para figurinha estática porque Sharp/ImageMagick não estão disponíveis')
        }
        return fs.readFile(fallbackOutput)
      }
    }
    const output = path.join(directory, 'brat.webp')
    await runProcess(settings.ffmpegPath, [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-framerate', String(BRAT_FPS), '-start_number', '0', '-i', path.join(directory, 'frame-%03d.png'),
      '-frames:v', String(totalFrames), '-vf', 'scale=512:512:flags=lanczos,setsar=1',
      '-r', String(BRAT_FPS), '-an',
      '-c:v', 'libwebp_anim', '-loop', '0', '-preset', 'picture',
      '-q:v', '68', '-compression_level', '6', output
    ], { timeoutMs: 120_000, logger })

    const result = await fs.readFile(output)
    logger?.success?.({
      bytes: result.length,
      format: 'webp-anim',
      theme: theme.key,
      alignment: resolveBratAlignment(options.alignment),
      fps: BRAT_FPS,
      frames: totalFrames,
      renderer,
      architecture: process.arch,
      word: tokenData.tokens[0]
    }, 'brat animado criado')
    return result
  })
}
