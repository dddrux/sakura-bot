import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { platformInfo, platformLabel, installHint } from '../platform.js'

const require = createRequire(import.meta.url)
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const packageVersion = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version
const startup = process.argv.includes('--startup')
const quiet = startup

function versionTuple(value = '') {
  return String(value).replace(/^v/, '').split('.').map(part => Number.parseInt(part, 10) || 0)
}

function versionAtLeast(current, minimum) {
  const a = versionTuple(current)
  const b = versionTuple(minimum)
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    if ((a[index] || 0) > (b[index] || 0)) return true
    if ((a[index] || 0) < (b[index] || 0)) return false
  }
  return true
}

function ensureDirectories() {
  for (const relative of [
    'config', 'auth', 'backup', 'storage/logs', 'storage/cache',
    'storage/temp', 'storage/updates', 'storage/backups', 'storage/sticker-library', 'storage/automation-media', 'storage/command-media', 'storage/action-media',
    'assets/audio', 'assets/stickers', 'assets/menu'
  ]) fs.mkdirSync(path.join(root, relative), { recursive: true })
}

function resolvePackage(name) {
  try { return require.resolve(name, { paths: [root] }) } catch { return '' }
}

function ffmpegCandidates() {
  const result = []
  if (process.env.FFMPEG_PATH) result.push(process.env.FFMPEG_PATH)
  try {
    const bundled = require('@ffmpeg-installer/ffmpeg')?.path
    if (bundled) result.push(bundled)
  } catch {}
  result.push(process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg')
  return [...new Set(result.filter(Boolean))]
}

function findFfmpeg() {
  for (const candidate of ffmpegCandidates()) {
    const probe = spawnSync(candidate, ['-version'], { encoding: 'utf8', timeout: 8000, windowsHide: true })
    if (!probe.error && probe.status === 0) return candidate
  }
  return ''
}

function findImageMagick() {
  for (const candidate of ['magick', 'convert']) {
    const probe = spawnSync(candidate, ['-version'], { encoding: 'utf8', timeout: 8000, windowsHide: true })
    if (!probe.error && probe.status === 0) return candidate
  }
  return ''
}

function explainMissing(name) {
  return `Dependência ausente: ${name}. Execute ${installHint()}.`
}

async function main() {
  ensureDirectories()
  const errors = []
  const warnings = []

  if (!versionAtLeast(process.version, '22.5.0')) {
    errors.push(`Node ${process.version} é antigo. Use Node 22.5 ou superior.`)
  }

  const required = ['@sakura-md/baileys', 'qrcode-terminal']
  for (const name of required) {
    if (!resolvePackage(name)) errors.push(explainMissing(name))
  }

  if (!errors.length) {
    try { await import('@sakura-md/baileys') }
    catch (error) {
      errors.push(`O Baileys não carregou: ${error?.message || error}`)
      if (error?.code) errors.push(`Código: ${error.code}`)
    }
  }

  const ffmpeg = findFfmpeg()
  if (!ffmpeg) warnings.push('FFmpeg não encontrado. Downloads e figurinhas de mídia ficarão limitados até instalar ffmpeg.')

  const imageMagick = findImageMagick()

  if (!['127.0.0.1', 'localhost', '::1'].includes(String(process.env.PANEL_HOST || '127.0.0.1').toLowerCase())) {
    warnings.push('O painel está exposto fora do localhost. Use firewall, proxy HTTPS e uma senha forte.')
  }
  const initialPasswordFile = path.join(root, 'config', 'private', 'panel-initial-password.txt')
  if (fs.existsSync(initialPasswordFile) && process.platform !== 'win32') {
    try {
      const mode = fs.statSync(initialPasswordFile).mode & 0o777
      if (mode !== 0o600) warnings.push(`Corrija a permissão do segredo inicial do painel para 0600; atual: ${mode.toString(8)}`)
    } catch {}
  }

  let sharpReady = false
  if (resolvePackage('sharp')) {
    try { await import('sharp'); sharpReady = true }
    catch (error) { warnings.push(`Sharp opcional não carregou nesta arquitetura: ${String(error?.message || error).split('\n')[0]}`) }
  } else {
    if (!imageMagick && !ffmpeg) warnings.push('Sharp, ImageMagick e FFmpeg não foram encontrados. O Brat ficará indisponível.')
  }

  if (!quiet || errors.length || warnings.length) {
    console.log(`\n🧊 Sakura-MD ${packageVersion} — ${platformLabel()}`)
    console.log(`   Node: ${process.version} | RAM: ${platformInfo.totalMemoryMb} MB | mídia: ${platformInfo.mediaMode}`)
    console.log(`   FFmpeg: ${ffmpeg || 'não encontrado'} | Sharp: ${sharpReady ? 'disponível' : 'opcional/indisponível'} | ImageMagick: ${imageMagick || 'não encontrado'} | Brat: ${sharpReady ? 'Sharp' : imageMagick ? 'ImageMagick' : ffmpeg ? 'FFmpeg fallback' : 'indisponível'}`)
    console.log('   Player: yt-dlp dedicado, áudio nativo e fragmentos paralelos')
    console.log('   Downloads sociais: Instagram/Pinterest e TikTok permanecem isolados; .play usa somente yt-dlp')
  }

  for (const warning of warnings) console.warn(`⚠️ ${warning}`)
  for (const error of errors) console.error(`❌ ${error}`)

  if (errors.length) process.exitCode = 1
  else if (!quiet) console.log('✅ Núcleo pronto para iniciar.\n')
}

await main()
