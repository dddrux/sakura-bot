import { sendMessageFast } from './send-manager.js'
import { suppressCommandOfficialLinks } from './command-ui-state.js'

function deliverySendOptions(msg, quoted = true) {
  if (quoted === false) return {}
  if (quoted && typeof quoted === 'object') return { quoted }
  return { quoted: msg }
}

function requireBuffer(value, label) {
  if (!Buffer.isBuffer(value) || !value.length) throw new TypeError(`${label} precisa ser um Buffer válido.`)
  return value
}

export async function sendStickerMedia(sock, msg, sticker, options = {}) {
  const buffer = requireBuffer(sticker, 'Sticker')
  suppressCommandOfficialLinks(msg)
  return sendMessageFast(sock, msg.key.remoteJid, { sticker: buffer }, deliverySendOptions(msg, options.quoted), {
    priority: options.priority || 'high',
    retries: options.retries ?? 2
  })
}

export async function sendAudioMedia(sock, msg, audio, options = {}) {
  const buffer = requireBuffer(audio, 'Áudio')
  suppressCommandOfficialLinks(msg)
  const content = {
    audio: buffer,
    mimetype: options.mimetype || 'audio/mp4',
    ptt: Boolean(options.ptt),
    ...(options.fileName ? { fileName: options.fileName } : {})
  }
  return sendMessageFast(sock, msg.key.remoteJid, content, deliverySendOptions(msg, options.quoted), {
    priority: options.priority || 'high',
    retries: options.retries ?? 2
  })
}

export async function sendAudioFileMedia(sock, msg, filePath, options = {}) {
  const value = String(filePath || '').trim()
  if (!value) throw new TypeError('Áudio precisa de um caminho local válido.')
  const content = {
    audio: { url: value },
    mimetype: options.mimetype || 'audio/mp4',
    ptt: Boolean(options.ptt),
    ...(options.fileName ? { fileName: options.fileName } : {})
  }
  return sendMessageFast(sock, msg.key.remoteJid, content, deliverySendOptions(msg, options.quoted), {
    priority: options.priority || 'high',
    retries: options.retries ?? 2
  })
}
