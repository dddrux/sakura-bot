import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { downloadMediaMessage } from '@sakura-md/baileys'
import { settings } from './settings.js'
import { getQuotedMessage, unwrapMessage } from './messages.js'

const MEDIA_DIR = path.join(settings.storageDir, 'automation-media')
const MAX_AUDIO_BYTES = 12 * 1024 * 1024
const MAX_AUDIO_SECONDS = 120

function audioNode(message = {}) {
  const { content } = unwrapMessage(message)
  return content.audioMessage || null
}

function audioTarget(msg) {
  const quoted = getQuotedMessage(msg)
  if (quoted && audioNode(quoted.message)) return quoted
  return audioNode(msg?.message) ? msg : null
}

function extensionFor(mime = '') {
  if (/ogg|opus/i.test(mime)) return '.ogg'
  if (/m4a|mp4/i.test(mime)) return '.m4a'
  if (/wav/i.test(mime)) return '.wav'
  return '.mp3'
}

function safeCustomPath(relative = '') {
  const value = String(relative || '')
  if (!value.startsWith('custom/')) return ''
  const base = path.basename(value.slice('custom/'.length))
  const target = path.resolve(MEDIA_DIR, base)
  const root = `${path.resolve(MEDIA_DIR)}${path.sep}`
  return target.startsWith(root) ? target : ''
}

export async function saveDailyAudioFromMessage({ msg, logger } = {}) {
  const target = audioTarget(msg)
  if (!target) throw new TypeError('Responda a um áudio ou nota de voz para definir o áudio diário.')
  const node = audioNode(target.message) || {}
  const seconds = Number(node.seconds || 0)
  if (seconds > MAX_AUDIO_SECONDS) throw new TypeError(`O áudio precisa ter no máximo ${MAX_AUDIO_SECONDS} segundos.`)
  const mimeType = String(node.mimetype || 'audio/mpeg').slice(0, 80)
  const buffer = await downloadMediaMessage(target, 'buffer', {}, { logger })
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw new TypeError('Não foi possível ler o áudio respondido.')
  if (buffer.length > MAX_AUDIO_BYTES) throw new TypeError('O áudio ultrapassa o limite de 12 MB.')
  await fsp.mkdir(MEDIA_DIR, { recursive: true })
  const filename = `daily-${randomUUID()}${extensionFor(mimeType)}`
  const finalPath = path.join(MEDIA_DIR, filename)
  const tmpPath = `${finalPath}.tmp`
  try {
    await fsp.writeFile(tmpPath, buffer, { flag: 'wx' })
    await fsp.rename(tmpPath, finalPath)
    return { relative: `custom/${filename}`, file: finalPath, mimeType, sizeBytes: buffer.length }
  } catch (error) {
    await fsp.rm(tmpPath, { force: true }).catch(() => {})
    await fsp.rm(finalPath, { force: true }).catch(() => {})
    throw error
  }
}

export async function removeCustomDailyAudio(relative = '') {
  const file = safeCustomPath(relative)
  if (file) await fsp.rm(file, { force: true }).catch(() => {})
}

export function resolveDailyAudio(relative = '') {
  const value = String(relative || '').trim()
  if (!value || value === 'off') return null
  const custom = safeCustomPath(value)
  if (custom && fs.existsSync(custom)) return custom
  const base = path.resolve(settings.audioDir)
  const candidate = path.resolve(settings.audioDir, value)
  if (candidate.startsWith(`${base}${path.sep}`) && fs.existsSync(candidate)) return candidate
  return null
}

export function automationMediaDirectory() {
  return MEDIA_DIR
}
