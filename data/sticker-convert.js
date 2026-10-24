import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { settings } from './settings.js'
import { stripStickerMetadata } from './sticker-metadata.js'

function shortError(error) {
  const text = String(error?.message || error || '').replace(/\s+/g, ' ').trim()
  return text.length > 180 ? `${text.slice(0, 177)}…` : text
}

async function runProcess(command, args = [], { timeoutMs = 120_000, logger } = {}) {
  return new Promise((resolve, reject) => {
    let settled = false
    let stderr = ''
    const child = spawn(command, args, { stdio: ['ignore', 'ignore', 'pipe'] })
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      child.kill('SIGKILL')
      reject(new Error(`${command} excedeu o tempo limite`))
    }, Math.max(1_000, Number(timeoutMs) || 120_000))
    timer.unref?.()
    child.stderr?.on('data', chunk => {
      stderr += chunk.toString()
      if (stderr.length > 12_000) stderr = stderr.slice(-12_000)
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
      if (code === 0) return resolve({ code, stderr })
      logger?.debug?.({ code, command, args, stderr: stderr.slice(-1600) }, 'conversor de figurinha: processo falhou')
      reject(new Error(`${command} falhou (código ${code})`))
    })
  })
}

async function tempFiles(names = [], callback) {
  await fs.mkdir(settings.tmpDir, { recursive: true })
  const id = randomUUID()
  const files = Object.fromEntries(names.map(name => [name, path.join(settings.tmpDir, `${id}-${name}`)]))
  try { return await callback(files) }
  finally { await Promise.all(Object.values(files).map(file => fs.rm(file, { force: true }).catch(() => {}))) }
}

async function tempDirectory(callback) {
  await fs.mkdir(settings.tmpDir, { recursive: true })
  const dir = path.join(settings.tmpDir, `sticker-convert-${randomUUID()}`)
  await fs.mkdir(dir, { recursive: true })
  try { return await callback(dir) }
  finally { await fs.rm(dir, { recursive: true, force: true }).catch(() => {}) }
}

export function detectMediaFormat(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 4) return 'bin'
  if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return 'webp'
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]))) return 'png'
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpg'
  if (buffer.toString('ascii', 0, 3) === 'GIF') return 'gif'
  if (buffer.length >= 12 && buffer.toString('ascii', 4, 8) === 'ftyp') return 'mp4'
  return 'bin'
}

function safeStickerBuffer(buffer) {
  if (detectMediaFormat(buffer) !== 'webp') return buffer
  try { return stripStickerMetadata(buffer) } catch { return buffer }
}

export function stickerDecodeCandidates(buffer) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) return []
  const candidates = [{ kind: 'original', buffer }]
  if (detectMediaFormat(buffer) === 'webp') {
    try {
      const normalized = stripStickerMetadata(buffer)
      if (Buffer.isBuffer(normalized) && normalized.length && !normalized.equals(buffer)) candidates.push({ kind: 'normalized', buffer: normalized })
    } catch {}
  }
  return candidates
}

async function getJimp() {
  const module = await import('jimp')
  const Jimp = module.Jimp || module.default?.Jimp || module.default
  if (!Jimp?.read) throw new Error('Jimp indisponível')
  return Jimp
}

async function jimpPng(buffer) {
  const Jimp = await getJimp()
  const image = await Jimp.read(buffer)
  const png = await image.getBuffer('image/png')
  if (!Buffer.isBuffer(png) || !png.length) throw new Error('Jimp retornou PNG vazio')
  return png
}

function readUInt24LE(buffer, offset) {
  return buffer[offset] | (buffer[offset + 1] << 8) | (buffer[offset + 2] << 16)
}

function writeUInt24LE(buffer, value, offset) {
  buffer[offset] = value & 0xff
  buffer[offset + 1] = (value >> 8) & 0xff
  buffer[offset + 2] = (value >> 16) & 0xff
}

function webpChunks(buffer) {
  if (detectMediaFormat(buffer) !== 'webp') return []
  const chunks = []
  let offset = 12
  while (offset + 8 <= buffer.length) {
    const fourCC = buffer.toString('ascii', offset, offset + 4)
    const size = buffer.readUInt32LE(offset + 4)
    const start = offset + 8
    const end = start + size
    if (end > buffer.length) break
    chunks.push({ fourCC, data: Buffer.from(buffer.subarray(start, end)) })
    offset = end + (size % 2)
  }
  return chunks
}

function chunkBuffer(fourCC, data) {
  const head = Buffer.alloc(8)
  head.write(fourCC, 0, 4, 'ascii')
  head.writeUInt32LE(data.length, 4)
  return Buffer.concat([head, data, data.length % 2 ? Buffer.from([0]) : Buffer.alloc(0)])
}

function buildStaticWebp(width, height, nestedChunks) {
  const vp8x = Buffer.alloc(10)
  const hasAlpha = nestedChunks.some(chunk => chunk.fourCC === 'ALPH' || chunk.fourCC === 'VP8L')
  if (hasAlpha) vp8x[0] |= 0x10
  writeUInt24LE(vp8x, Math.max(0, width - 1), 4)
  writeUInt24LE(vp8x, Math.max(0, height - 1), 7)
  const body = Buffer.concat([chunkBuffer('VP8X', vp8x), ...nestedChunks.map(chunk => chunkBuffer(chunk.fourCC, chunk.data))])
  const header = Buffer.alloc(12)
  header.write('RIFF', 0); header.writeUInt32LE(body.length + 4, 4); header.write('WEBP', 8)
  return Buffer.concat([header, body])
}

function parseAnimatedWebp(buffer) {
  const chunks = webpChunks(buffer)
  const vp8x = chunks.find(chunk => chunk.fourCC === 'VP8X')
  const width = vp8x?.data?.length >= 10 ? readUInt24LE(vp8x.data, 4) + 1 : 512
  const height = vp8x?.data?.length >= 10 ? readUInt24LE(vp8x.data, 7) + 1 : 512
  const frames = []
  for (const chunk of chunks.filter(item => item.fourCC === 'ANMF')) {
    if (chunk.data.length < 16) continue
    const x = readUInt24LE(chunk.data, 0) * 2
    const y = readUInt24LE(chunk.data, 3) * 2
    const frameWidth = readUInt24LE(chunk.data, 6) + 1
    const frameHeight = readUInt24LE(chunk.data, 9) + 1
    const durationMs = Math.max(20, readUInt24LE(chunk.data, 12))
    const flags = chunk.data[15]
    const nested = []
    let offset = 16
    while (offset + 8 <= chunk.data.length) {
      const fourCC = chunk.data.toString('ascii', offset, offset + 4)
      const size = chunk.data.readUInt32LE(offset + 4)
      const start = offset + 8
      const end = start + size
      if (end > chunk.data.length) break
      if (['ALPH', 'VP8 ', 'VP8L'].includes(fourCC)) nested.push({ fourCC, data: Buffer.from(chunk.data.subarray(start, end)) })
      offset = end + (size % 2)
    }
    if (nested.some(item => item.fourCC === 'VP8 ' || item.fourCC === 'VP8L')) {
      frames.push({ x, y, width: frameWidth, height: frameHeight, durationMs, dispose: Boolean(flags & 1), noBlend: Boolean(flags & 2), webp: buildStaticWebp(frameWidth, frameHeight, nested) })
    }
  }
  return { width, height, frames }
}

async function clearRegion(image, x, y, width, height) {
  image.scan(x, y, width, height, function (_x, _y, idx) {
    this.bitmap.data[idx] = 0
    this.bitmap.data[idx + 1] = 0
    this.bitmap.data[idx + 2] = 0
    this.bitmap.data[idx + 3] = 0
  })
}

async function animatedWebpToPngSequence(buffer, directory, logger) {
  const parsed = parseAnimatedWebp(buffer)
  if (!parsed.frames.length) throw new Error('WebP sem quadros animados')
  const entries = []
  const maxFrames = Math.min(parsed.frames.length, 180)
  for (let index = 0; index < maxFrames; index += 1) {
    const frame = parsed.frames[index]
    const input = path.join(directory, `source-${String(index).padStart(4, '0')}.webp`)
    const file = path.join(directory, `frame-${String(index).padStart(4, '0')}.png`)
    await fs.writeFile(input, frame.webp)
    const pad = `format=rgba,pad=${parsed.width}:${parsed.height}:${frame.x}:${frame.y}:color=black@0`
    await runProcess(settings.ffmpegPath, [
      '-hide_banner', '-loglevel', 'error', '-y', '-i', input, '-frames:v', '1', '-vf', pad, '-c:v', 'png', file
    ], { timeoutMs: 30_000, logger })
    entries.push({ file, duration: Math.max(0.02, Math.min(2, frame.durationMs / 1000)) })
  }
  logger?.debug?.({ frames: entries.length, canvas: `${parsed.width}x${parsed.height}` }, 'WebP animado demuxado por quadros estáticos')
  return entries
}

async function runImageSequenceEncoder(entries, output, encoder, logger) {
  const list = `${output}.txt`
  const rows = []
  for (const entry of entries) {
    rows.push(`file '${entry.file.replaceAll("'", "'\\''")}'`)
    rows.push(`duration ${entry.duration.toFixed(4)}`)
  }
  if (entries.length) rows.push(`file '${entries.at(-1).file.replaceAll("'", "'\\''")}'`)
  await fs.writeFile(list, `${rows.join('\n')}\n`)
  try {
    const codec = encoder === 'libx264'
      ? ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '24']
      : ['-c:v', 'mpeg4', '-q:v', '5']
    await runProcess(settings.ffmpegPath, [
      '-hide_banner', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', list,
      '-an', '-vf', 'fps=30,scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=black,format=yuv420p',
      ...codec, '-movflags', '+faststart', output
    ], { timeoutMs: 180_000, logger })
  } finally { await fs.rm(list, { force: true }).catch(() => {}) }
}

async function resolveImageMagick(logger) {
  for (const command of ['magick', 'convert']) {
    try {
      await runProcess(command, ['-version'], { timeoutMs: 5_000, logger })
      return command
    } catch {}
  }
  return ''
}

async function animatedWebpViaImageMagick(buffer, logger) {
  const command = await resolveImageMagick(logger)
  if (!command) throw new Error('ImageMagick indisponível')
  return tempDirectory(async dir => {
    const input = path.join(dir, 'input.webp')
    const gif = path.join(dir, 'frames.gif')
    const output = path.join(dir, 'output.mp4')
    await fs.writeFile(input, buffer)
    await runProcess(command, [input, '-coalesce', gif], { timeoutMs: 120_000, logger })
    await runVideoEncoder(gif, output, 'libx264', logger).catch(() => runVideoEncoder(gif, output, 'mpeg4', logger))
    return { buffer: await fs.readFile(output), encoder: `${command}+ffmpeg` }
  })
}

async function animatedWebpViaSharp(buffer, logger) {
  const module = await import('sharp').catch(() => null)
  const sharp = module?.default || module
  if (!sharp) throw new Error('Sharp indisponível')
  return tempDirectory(async dir => {
    const gif = path.join(dir, 'frames.gif')
    const output = path.join(dir, 'output.mp4')
    await sharp(buffer, { animated: true }).gif({ effort: 3 }).toFile(gif)
    await runVideoEncoder(gif, output, 'libx264', logger).catch(() => runVideoEncoder(gif, output, 'mpeg4', logger))
    return { buffer: await fs.readFile(output), encoder: 'sharp+ffmpeg' }
  })
}

export async function convertStickerToImage(buffer, logger) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw new TypeError('Figurinha vazia.')
  const candidates = stickerDecodeCandidates(buffer)

  for (const candidate of candidates) {
    const format = detectMediaFormat(candidate.buffer)
    try {
      const png = await jimpPng(candidate.buffer)
      logger?.debug?.({ renderer: 'jimp', bytes: png.length, format, candidate: candidate.kind }, '.toimg convertido sem FFmpeg')
      return { buffer: png, mimetype: 'image/png', fileName: 'sakura.png', renderer: `jimp-${candidate.kind}` }
    } catch (jimpError) {
      logger?.debug?.({ error: shortError(jimpError), renderer: 'jimp', format, candidate: candidate.kind }, 'Jimp não converteu a mídia; tentando FFmpeg')
    }

    const extension = format === 'jpg' ? 'jpg' : format === 'png' ? 'png' : format === 'gif' ? 'gif' : format === 'mp4' ? 'mp4' : 'webp'
    try {
      return await tempFiles([`input.${extension}`, 'output.png'], async files => {
        await fs.writeFile(files[`input.${extension}`], candidate.buffer)
        await runProcess(settings.ffmpegPath, [
          '-hide_banner', '-loglevel', 'error', '-y', '-i', files[`input.${extension}`], '-frames:v', '1',
          '-vf', 'scale=512:512:force_original_aspect_ratio=decrease:flags=lanczos', '-c:v', 'png', '-threads', '1', files['output.png']
        ], { timeoutMs: 60_000, logger })
        return { buffer: await fs.readFile(files['output.png']), mimetype: 'image/png', fileName: 'sakura.png', renderer: `ffmpeg-png-${candidate.kind}` }
      })
    } catch (ffmpegError) {
      logger?.warn?.({ error: shortError(ffmpegError), format, candidate: candidate.kind }, '.toimg tentou candidato sem sucesso')
    }
  }

  const fallback = candidates.at(-1)?.buffer || buffer
  const format = detectMediaFormat(fallback)
  logger?.warn?.({ format }, '.toimg caiu para mídia original')
  const mimetype = format === 'png' ? 'image/png' : format === 'jpg' ? 'image/jpeg' : 'image/webp'
  return { buffer: fallback, mimetype, fileName: `sakura.${format === 'jpg' ? 'jpg' : format === 'png' ? 'png' : 'webp'}`, renderer: 'original' }
}

async function runVideoEncoder(input, output, encoder, logger, { loopImage = false } = {}) {
  const common = ['-hide_banner', '-loglevel', 'error', '-y']
  if (loopImage) common.push('-loop', '1', '-framerate', '30')
  common.push('-i', input, '-t', loopImage ? '3' : '12', '-map', '0:v:0', '-an', '-vf', 'fps=30,scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=black,format=yuv420p')
  const codec = encoder === 'libx264' ? ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '24'] : ['-c:v', 'mpeg4', '-q:v', '5']
  await runProcess(settings.ffmpegPath, [...common, ...codec, '-movflags', '+faststart', output], { timeoutMs: 150_000, logger })
}

async function encodeDirect(cleaned, format, logger) {
  const extension = ['mp4','gif','png','jpg','webp'].includes(format) ? format : 'bin'
  return tempFiles([`input.${extension}`, 'output.mp4'], async files => {
    const input = files[`input.${extension}`]
    const output = files['output.mp4']
    await fs.writeFile(input, cleaned)
    let firstError
    try {
      await runVideoEncoder(input, output, 'libx264', logger)
      return { buffer: await fs.readFile(output), encoder: 'libx264' }
    } catch (error) { firstError = error }
    await fs.rm(output, { force: true }).catch(() => {})
    try {
      await runVideoEncoder(input, output, 'mpeg4', logger)
      return { buffer: await fs.readFile(output), encoder: 'mpeg4' }
    } catch (fallbackError) {
      throw new Error(`FFmpeg não decodificou ${format}: ${shortError(firstError)} / ${shortError(fallbackError)}`)
    }
  })
}

async function encodeStillFallback(buffer, logger) {
  const image = await convertStickerToImage(buffer, logger)
  return tempFiles(['input.png', 'output.mp4'], async files => {
    const png = image.mimetype === 'image/png' ? image.buffer : await jimpPng(image.buffer)
    await fs.writeFile(files['input.png'], png)
    try { await runVideoEncoder(files['input.png'], files['output.mp4'], 'libx264', logger, { loopImage: true }) }
    catch { await runVideoEncoder(files['input.png'], files['output.mp4'], 'mpeg4', logger, { loopImage: true }) }
    return { buffer: await fs.readFile(files['output.mp4']), encoder: `quadro-estatico+${image.renderer}` }
  })
}

export async function convertStickerToVideo(buffer, logger) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw new TypeError('Figurinha vazia.')
  const candidates = stickerDecodeCandidates(buffer)
  let lastFormat = detectMediaFormat(buffer)

  for (const candidate of candidates) {
    const format = detectMediaFormat(candidate.buffer)
    lastFormat = format
    const animatedWebp = format === 'webp' && (candidate.buffer.includes(Buffer.from('ANIM')) || candidate.buffer.includes(Buffer.from('ANMF')))

    try {
      const direct = await encodeDirect(candidate.buffer, format, logger)
      return { ...direct, mimetype: 'video/mp4', fileName: 'sakura.mp4', source: candidate.kind }
    } catch (directError) {
      logger?.warn?.({ error: shortError(directError), format, animatedWebp, candidate: candidate.kind }, '.tomp4 tentando decodificadores alternativos')
    }

    if (animatedWebp) {
      for (const attempt of [
        async () => animatedWebpViaSharp(candidate.buffer, logger),
        async () => animatedWebpViaImageMagick(candidate.buffer, logger),
        async () => tempDirectory(async dir => {
          const entries = await animatedWebpToPngSequence(candidate.buffer, dir, logger)
          const output = path.join(dir, 'output.mp4')
          try { await runImageSequenceEncoder(entries, output, 'libx264', logger) }
          catch { await runImageSequenceEncoder(entries, output, 'mpeg4', logger) }
          return { buffer: await fs.readFile(output), encoder: 'webp-demux+ffmpeg' }
        })
      ]) {
        try {
          const result = await attempt()
          return { ...result, mimetype: 'video/mp4', fileName: 'sakura.mp4', source: candidate.kind }
        } catch (error) { logger?.debug?.({ error: shortError(error), candidate: candidate.kind }, '.tomp4 fallback animado indisponível') }
      }
    }

    try {
      const result = await encodeStillFallback(candidate.buffer, logger)
      return { ...result, mimetype: 'video/mp4', fileName: 'sakura.mp4', source: candidate.kind }
    } catch (error) {
      logger?.debug?.({ error: shortError(error), format, candidate: candidate.kind }, '.tomp4 fallback estático indisponível')
    }
  }

  logger?.warn?.({ format: lastFormat, candidates: candidates.map(item => item.kind) }, '.tomp4 falhou em todos os caminhos')
  throw new Error('Não consegui converter essa figurinha para MP4. Tente outra figurinha; a Sakura já testou a mídia original e a versão normalizada.')
}
