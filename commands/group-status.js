import { defineCommand } from '../data/workstation.js'
import { downloadMediaMessage } from '@sakura-md/baileys'
import { getMediaKind, getMediaTarget, unwrapMessage } from '../data/messages.js'
import { normalizeStatusVideo } from '../data/media.js'
import { reply } from '../data/reply.js'
import { deleteZenkGroupStatus, sendZenkGroupStatus } from '../data/zenk-group-status.js'
import { openDatabase } from '../data/database.js'

const statusStore = openDatabase('group-status', { version: 1, statuses: [] })
const IMAGE_LIMIT = 16 * 1024 * 1024
const VIDEO_LIMIT = 48 * 1024 * 1024
const DOWNLOAD_TIMEOUT_MS = 90_000

function readDb() {
  const db = statusStore.readSync()
  return { ...db, statuses: Array.isArray(db?.statuses) ? db.statuses : [] }
}

function saveDb(db) {
  statusStore.replaceSync({ version: 1, statuses: Array.isArray(db?.statuses) ? db.statuses : [] })
}

function numeric(value) {
  if (typeof value === 'number') return value
  if (typeof value === 'bigint') return Number(value)
  if (value && typeof value.toNumber === 'function') return value.toNumber()
  if (value && Number.isFinite(Number(value.low))) return Number(value.low)
  return Number(value) || 0
}

function digits(value = '') {
  return String(value || '').split('@')[0].split(':')[0].replace(/\D/g, '')
}


function mediaNode(target, kind) {
  const { content } = unwrapMessage(target?.message)
  return kind === 'image' ? content.imageMessage : content.videoMessage
}

async function downloadWithTimeout(target, sock, logger) {
  let timer
  try {
    return await Promise.race([
      downloadMediaMessage(target, 'buffer', {}, {
        logger,
        reuploadRequest: typeof sock?.updateMediaMessage === 'function'
          ? sock.updateMediaMessage.bind(sock)
          : undefined
      }),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('O download da mídia excedeu 90 segundos.')), DOWNLOAD_TIMEOUT_MS)
      })
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/**
 * Publica diretamente no JID do grupo com o mesmo gerador usado pela ZENK.
 * O fork principal da Sakura continua conectado; o núcleo secundário apenas
 * monta o envelope groupStatusMessageV2 compatível com mídia.
 */
export async function sendGroupStatus(sock, groupJid, payload, _audience = null, logger = null) {
  const result = await sendZenkGroupStatus(sock, groupJid, payload, { logger })
  return {
    sent: result.sent,
    groupMention: null,
    recipients: [],
    transport: result.transport
  }
}

// Mantido para compatibilidade com testes e módulos antigos.
export const sendGroupStatusBroadcast = sendGroupStatus

export async function deleteGroupStatus({ sock, groupJid, args = [] }) {
  const db = readDb()
  const groupStatuses = db.statuses.filter(status => status.groupJid === groupJid)
  if (!groupStatuses.length) throw new Error('Não há status registrados para este grupo.')

  const targetArg = String(args[0] || '').trim().toLowerCase()
  const target = !targetArg || ['ultimo', 'último'].includes(targetArg)
    ? groupStatuses[groupStatuses.length - 1]
    : groupStatuses.find(status => status.id === args[0])

  if (!target) throw new Error('Status não encontrado no histórico deste grupo.')

  await deleteZenkGroupStatus(sock, groupJid, {
    remoteJid: groupJid,
    fromMe: true,
    id: target.id,
    participant: target.participant || undefined
  })

  db.statuses = db.statuses.filter(status => status.id !== target.id)
  saveDb(db)
  return target
}

export default defineCommand({
  name: 'statusgp',
  aliases: ['status', 'statusgrupo', 'gpstatus', 'postarstatusgp', 'postarstatusgrupo', 'postarstatusgrupp', 'statusdogrupo', 'sgp', 'swgc', 'gstatus'],
  menuEntries: [{
    name: 'statusgp',
    usage: '.statusgp [legenda]',
    description: 'Publica texto, imagem ou vídeo no status real deste grupo.',
    menuGroup: 'Administração',
    menuModelOnly: true
  }],
  category: 'Administração',
  officialLinks: false,
  usage: '.statusgp texto ou responda uma imagem/vídeo com .statusgp [legenda]',
  description: 'Publica no status do grupo usando o fluxo funcional portado da ZENK.',
  groupOnly: true,
  adminOnly: true,
  botAdminOnly: true,
  needsMetadata: true,

  async execute({ sock, msg, rawArgs = '', logger, senderNumber }) {
    try {
      const target = getMediaTarget(msg)
      const caption = String(rawArgs || '').trim().slice(0, 700)
      let payload
      let type = 'text'
      let bytes = 0

      if (!target) {
        if (!caption) {
          return reply(sock, msg, 'Escreva um texto depois de *.statusgp* ou responda a uma imagem/vídeo.\n\nExemplos:\n*.statusgp Bom dia!*\n*.statusgp Nossa foto* respondendo a uma mídia.', { title: 'STATUS DO GRUPO' })
        }
        payload = { text: caption }
      } else {
        const kind = getMediaKind(target.message)
        if (!['image', 'video'].includes(kind)) {
          return reply(sock, msg, 'O status aceita texto, imagem ou vídeo.', { title: 'STATUS DO GRUPO' })
        }

        const source = mediaNode(target, kind) || {}
        const limit = kind === 'image' ? IMAGE_LIMIT : VIDEO_LIMIT
        const announced = numeric(source.fileLength)
        if (announced > limit) {
          return reply(sock, msg, `A mídia excede o limite de ${Math.round(limit / 1024 / 1024)} MB.`, { title: 'STATUS DO GRUPO' })
        }

        let buffer = await downloadWithTimeout(target, sock, logger)
        if (!Buffer.isBuffer(buffer) || !buffer.length) throw new Error('A mídia baixada veio vazia.')
        if (buffer.length > limit) {
          return reply(sock, msg, `A mídia excede o limite de ${Math.round(limit / 1024 / 1024)} MB.`, { title: 'STATUS DO GRUPO' })
        }

        type = kind
        if (kind === 'video') {
          buffer = await normalizeStatusVideo(buffer, logger, { maxSeconds: 60 })
          if (buffer.length > VIDEO_LIMIT) throw new Error('O vídeo ficou maior que 48 MB após a preparação.')
          payload = {
            video: buffer,
            mimetype: 'video/mp4',
            gifPlayback: Boolean(source.gifPlayback),
            ...(caption ? { caption } : {})
          }
        } else {
          payload = {
            image: buffer,
            mimetype: String(source.mimetype || '').startsWith('image/') ? source.mimetype : 'image/jpeg',
            ...(caption ? { caption } : {})
          }
        }
        bytes = buffer.length
      }

      const result = await sendGroupStatus(sock, msg.key.remoteJid, payload, null, logger)
      const sent = result.sent
      const db = readDb()
      db.statuses.push({
        id: sent?.key?.id,
        remoteJid: sent?.key?.remoteJid || msg.key.remoteJid,
        participant: sent?.key?.participant || null,
        fromMe: true,
        groupJid: msg.key.remoteJid,
        createdBy: digits(senderNumber),
        createdAt: Date.now(),
        type,
        transport: result.transport
      })
      db.statuses = db.statuses.filter(status => status.id).slice(-100)
      saveDb(db)

      logger?.info?.({
        action: 'group-status-published',
        transport: result.transport,
        chatJid: msg.key.remoteJid,
        senderNumber,
        type,
        bytes,
        statusId: sent?.key?.id
      }, 'status de grupo enviado pelo transporte funcional da ZENK')

      return reply(sock, msg, `💮 ${type === 'video' ? 'Vídeo' : type === 'image' ? 'Imagem' : 'Texto'} publicado no *status deste grupo*.\n\n🌸 Status: *${sent?.key?.id || 'sem ID'}*\n🌸 Transporte: *ZENK groupStatusMessageV2*`, { title: 'STATUS DO GRUPO' })
    } catch (error) {
      logger?.warn?.({ error, stage: 'statusgp' }, 'falha ao publicar status do grupo')
      return reply(sock, msg, `Não foi possível publicar o status.\n\nMotivo: ${error.message}`, { title: 'STATUS DO GRUPO', icon: '🌸' })
    }
  }
})
