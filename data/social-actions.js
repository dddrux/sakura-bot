import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { downloadMediaMessage } from '@sakura-md/baileys'
import { settings } from './settings.js'
import { getMediaKind, getMediaTarget, unwrapMessage } from './messages.js'
import { getActionMedia, removeActionMedia, setActionMedia, SOCIAL_ACTIONS } from './social-store.js'
import { reply } from './reply.js'
import { suppressCommandOfficialLinks } from './command-ui-state.js'

const ACTION_MEDIA_DIR = path.join(settings.storageDir, 'action-media')
const MAX_IMAGE_BYTES = 8 * 1024 * 1024
const MAX_VIDEO_BYTES = 16 * 1024 * 1024
const MAX_VIDEO_SECONDS = 20

export const ACTION_ALIASES = Object.freeze({
  beijo: 'beijar', beijar: 'beijar', kiss: 'beijar',
  abraco: 'abracar', abraço: 'abracar', abracar: 'abracar', abraçar: 'abracar', hug: 'abracar',
  cafune: 'cafune', cafuné: 'cafune',
  carinho: 'acariciar', acariciar: 'acariciar',
  oi: 'cumprimentar', cumprimentar: 'cumprimentar', saudacao: 'cumprimentar', saudação: 'cumprimentar',
  darmao: 'darmao', maos: 'darmao', mãos: 'darmao',
  presente: 'presentear', presentear: 'presentear', darpresente: 'presentear'
})

export function normalizeSocialAction(value = '') {
  const normalized = String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '')
  return ACTION_ALIASES[normalized] || (SOCIAL_ACTIONS[normalized] ? normalized : '')
}

function extensionFor(kind, mimeType = '') {
  if (kind === 'image') return /png/i.test(mimeType) ? '.png' : '.jpg'
  return '.mp4'
}

function safePath(filename = '') {
  const base = path.basename(String(filename || ''))
  if (!base || base !== String(filename || '')) return ''
  const target = path.join(ACTION_MEDIA_DIR, base)
  const root = `${path.resolve(ACTION_MEDIA_DIR)}${path.sep}`
  return path.resolve(target).startsWith(root) ? target : ''
}

function mediaNode(target, kind) {
  const { content } = unwrapMessage(target?.message || {})
  return kind === 'image' ? content.imageMessage : content.videoMessage
}

export async function saveActionMediaFromMessage({ msg, logger, action: rawAction, actor = '' } = {}) {
  const action = normalizeSocialAction(rawAction)
  if (!action) throw new TypeError('Ação social inválida.')
  const target = getMediaTarget(msg)
  if (!target) throw new TypeError('Responda a uma imagem, GIF ou vídeo curto.')
  const kind = getMediaKind(target.message)
  if (!['image', 'video'].includes(kind)) throw new TypeError('Use apenas imagem, GIF ou vídeo curto.')
  const node = mediaNode(target, kind) || {}
  const mimeType = String(node.mimetype || (kind === 'image' ? 'image/jpeg' : 'video/mp4')).slice(0, 80)
  const seconds = Number(node.seconds || 0)
  if (kind === 'video' && seconds > MAX_VIDEO_SECONDS) throw new TypeError(`O vídeo precisa ter no máximo ${MAX_VIDEO_SECONDS} segundos.`)
  const buffer = await downloadMediaMessage(target, 'buffer', {}, { logger })
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw new TypeError('Não foi possível ler a mídia respondida.')
  const limit = kind === 'image' ? MAX_IMAGE_BYTES : MAX_VIDEO_BYTES
  if (buffer.length > limit) throw new TypeError(`A mídia ultrapassa o limite de ${Math.floor(limit / 1024 / 1024)} MB.`)

  await fsp.mkdir(ACTION_MEDIA_DIR, { recursive: true })
  const filename = `${action}-${randomUUID()}${extensionFor(kind, mimeType)}`
  const finalPath = safePath(filename)
  const tempPath = `${finalPath}.tmp`
  const previous = getActionMedia(action)
  try {
    await fsp.writeFile(tempPath, buffer, { flag: 'wx' })
    await fsp.rename(tempPath, finalPath)
    const row = setActionMedia({ action, kind, filename, mimeType, sizeBytes: buffer.length, actor })
    if (previous?.filename && previous.filename !== filename) {
      const oldPath = safePath(previous.filename)
      if (oldPath) await fsp.rm(oldPath, { force: true }).catch(() => {})
    }
    return row
  } catch (error) {
    await fsp.rm(tempPath, { force: true }).catch(() => {})
    await fsp.rm(finalPath, { force: true }).catch(() => {})
    throw error
  }
}

export async function clearActionMedia(actionValue) {
  const action = normalizeSocialAction(actionValue)
  if (!action) throw new TypeError('Ação social inválida.')
  const old = removeActionMedia(action)
  if (old?.filename) {
    const file = safePath(old.filename)
    if (file) await fsp.rm(file, { force: true }).catch(() => {})
  }
  return old
}

function defaultMedia(action) {
  const directory = path.join(settings.assetsDir, 'actions')
  for (const [kind, extensions] of [['image', ['.jpg', '.jpeg', '.png']], ['video', ['.mp4', '.gif']]]) {
    for (const extension of extensions) {
      const file = path.join(directory, `${action}${extension}`)
      if (fs.existsSync(file)) return { action, kind, filename: file, custom: false }
    }
  }
  return null
}

export function resolveActionMedia(actionValue) {
  const action = normalizeSocialAction(actionValue)
  if (!action) return null
  const custom = getActionMedia(action)
  if (custom?.filename) {
    const file = safePath(custom.filename)
    if (file && fs.existsSync(file)) return { ...custom, filename: file, custom: true }
    removeActionMedia(action)
  }
  return defaultMedia(action)
}

export async function sendSocialAction({ sock, msg, action: rawAction, caption, mentions = [] } = {}) {
  const action = normalizeSocialAction(rawAction)
  if (!action) throw new TypeError('Ação social inválida.')
  const media = resolveActionMedia(action)
  const jid = msg.key.remoteJid
  const uniqueMentions = [...new Set(mentions.map(String).filter(Boolean))]
  if (!media) return reply(sock, msg, caption, { title: 'AÇÃO SOCIAL', mentions: uniqueMentions })
  suppressCommandOfficialLinks(msg)
  if (media.kind === 'image') {
    return sock.sendMessage(jid, { image: { url: media.filename }, caption, mentions: uniqueMentions }, { quoted: msg })
  }
  return sock.sendMessage(jid, { video: { url: media.filename }, caption, gifPlayback: true, mentions: uniqueMentions }, { quoted: msg })
}

export function actionMediaDirectory() {
  return ACTION_MEDIA_DIR
}
