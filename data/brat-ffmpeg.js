import fs from 'node:fs/promises'
import path from 'node:path'
import { spawn } from 'node:child_process'

function cleanHex(value = '#FFFFFF', fallback = 'FFFFFF') {
  const text = String(value || '').trim().replace(/^#/, '')
  return /^[0-9a-f]{6}$/i.test(text) ? text : fallback
}

function fontSizeFor(lines = []) {
  const maxChars = Math.max(1, ...lines.map(line => [...String(line || '')].length))
  const rows = Math.max(1, lines.length)
  return Math.max(30, Math.min(118, Math.floor(410 / Math.max(2.4, maxChars * 0.54)), Math.floor(400 / Math.max(1.2, rows * 1.15))))
}

function ffmpegRun(command, args, timeoutMs = 45_000) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('FFmpeg Brat excedeu o tempo limite.')) }, timeoutMs)
    child.stderr.on('data', chunk => { stderr += chunk.toString(); if (stderr.length > 6000) stderr = stderr.slice(-6000) })
    child.once('error', error => { clearTimeout(timer); reject(error) })
    child.once('close', code => {
      clearTimeout(timer)
      if (code === 0) resolve()
      else reject(new Error(`FFmpeg Brat falhou (${code}): ${stderr.slice(-800)}`))
    })
  })
}

export async function renderBratWithFfmpeg({ text = '', lines = [], background = '#FFFFFF', foreground = '#111111', alignment = 'left', output, ffmpegPath = 'ffmpeg' } = {}) {
  if (!output) throw new TypeError('Saída do Brat não informada.')
  const safeLines = (Array.isArray(lines) && lines.length ? lines : [String(text || '')]).map(line => String(line || '').trim()).filter(Boolean)
  if (!safeLines.length) throw new TypeError('Texto do Brat vazio.')
  await fs.mkdir(path.dirname(output), { recursive: true })
  const textFile = `${output}.txt`
  await fs.writeFile(textFile, safeLines.join('\n'), 'utf8')
  const size = fontSizeFor(safeLines)
  const x = alignment === 'right' ? 'w-text_w-42' : alignment === 'center' ? '(w-text_w)/2' : '42'
  const y = '(h-text_h)/2'
  const escapedFile = textFile.replaceAll('\\', '\\\\').replaceAll(':', '\\:').replaceAll("'", "\\'")
  const filter = `drawtext=font='Noto Sans':textfile='${escapedFile}':reload=0:fontcolor=0x${cleanHex(foreground,'111111')}:fontsize=${size}:line_spacing=7:x=${x}:y=${y}`
  try {
    await ffmpegRun(ffmpegPath, [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', `color=c=0x${cleanHex(background)}:s=512x512:d=0.1`,
      '-vf', filter,
      '-frames:v', '1', '-an', '-c:v', 'libwebp', '-quality', '90', '-compression_level', '5', output
    ])
    return output
  } finally {
    await fs.rm(textFile, { force: true }).catch(() => {})
  }
}


export async function renderAnimatedRainbowBratWithFfmpeg({ text = '', foreground = '#FFFFFF', alignment = 'left', output, ffmpegPath = 'ffmpeg', duration = 1.35, fps = 24 } = {}) {
  if (!output) throw new TypeError('Saída do Brat rainbow não informada.')
  const safe = String(text || '').trim()
  if (!safe) throw new TypeError('Texto do Brat rainbow vazio.')
  await fs.mkdir(path.dirname(output), { recursive: true })
  const textFile = `${output}.txt`
  await fs.writeFile(textFile, safe, 'utf8')
  const size = fontSizeFor([safe])
  const x = alignment === 'right' ? 'w-text_w-42' : alignment === 'center' ? '(w-text_w)/2' : '42'
  const y = '(h-text_h)/2'
  const escapedFile = textFile.replaceAll('\\', '\\\\').replaceAll(':', '\\:').replaceAll("'", "\\'")
  const filter = `hue=H=360*t:s=1.25,drawtext=font='Noto Sans':textfile='${escapedFile}':reload=0:fontcolor=0x${cleanHex(foreground,'FFFFFF')}:fontsize=${size}:x=${x}:y=${y}`
  try {
    await ffmpegRun(ffmpegPath, [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', `color=c=red:s=512x512:r=${fps}:d=${duration}`,
      '-vf', filter,
      '-an', '-c:v', 'libwebp_anim', '-loop', '0', '-preset', 'picture',
      '-q:v', '70', '-compression_level', '5', output
    ], 120_000)
    return output
  } finally {
    await fs.rm(textFile, { force: true }).catch(() => {})
  }
}
