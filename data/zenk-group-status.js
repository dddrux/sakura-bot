/**
 * Transporte de Status do Grupo portado da ZENK-MD v3.4.4.
 *
 * O socket conectado continua sendo o fork principal da Sakura. O pacote
 * @whiskeysockets/baileys vendorizado é usado somente para gerar a estrutura
 * groupStatusMessageV2 que o WhatsApp espera para foto, vídeo e texto.
 */
import {
  generateMessageIDV2,
  generateWAMessageContent,
  generateWAMessageFromContent
} from '@whiskeysockets/baileys'

function isGroupJid(jid = '') {
  return String(jid || '').endsWith('@g.us')
}

function addGroupStatusContext(message = {}) {
  const type = Object.keys(message || {}).find(key => key !== 'messageContextInfo')
  const body = type ? message[type] : null
  if (body && typeof body === 'object') {
    body.contextInfo = {
      ...(body.contextInfo || {}),
      isGroupStatus: true
    }
  }
  return message
}

function generatorOptions(sock, groupJid, extra = {}) {
  const userJid = sock?.user?.id || sock?.authState?.creds?.me?.id
  if (!userJid) throw new Error('A sessão ainda não informou o JID do bot.')
  if (typeof sock?.waUploadToServer !== 'function') {
    throw new Error('O upload de mídia do socket não está disponível.')
  }
  return {
    userJid,
    jid: groupJid,
    logger: extra.logger || sock?.logger,
    upload: sock.waUploadToServer,
    mediaUploadTimeoutMs: extra.mediaUploadTimeoutMs || 180_000,
    getUrlInfo: sock?.getUrlInfo,
    getProfilePicUrl: typeof sock?.profilePictureUrl === 'function'
      ? sock.profilePictureUrl.bind(sock)
      : undefined
  }
}

export async function sendZenkGroupStatus(sock, groupJid, content, options = {}) {
  if (!isGroupJid(groupJid)) throw new Error('STATUSGP só pode ser usado dentro de um grupo.')
  if (typeof sock?.relayMessage !== 'function') throw new Error('relayMessage não está disponível nesta conexão.')
  if (!content || typeof content !== 'object') throw new Error('Conteúdo do status inválido.')

  const buildOptions = generatorOptions(sock, groupJid, options)
  const inner = addGroupStatusContext(await generateWAMessageContent(content, buildOptions))
  const messageId = typeof generateMessageIDV2 === 'function'
    ? generateMessageIDV2(buildOptions.userJid)
    : undefined

  const full = generateWAMessageFromContent(groupJid, {
    groupStatusMessageV2: { message: inner }
  }, {
    userJid: buildOptions.userJid,
    messageId,
    timestamp: new Date()
  })

  if (!full?.message?.groupStatusMessageV2?.message) {
    throw new Error('O gerador não criou groupStatusMessageV2.')
  }

  await sock.relayMessage(groupJid, full.message, {
    messageId: full.key.id,
    useCachedGroupMetadata: true
  })

  return {
    sent: full,
    transport: 'zenk/groupStatusMessageV2'
  }
}

export async function deleteZenkGroupStatus(sock, groupJid, originalKey, options = {}) {
  if (!originalKey?.id) throw new Error('O ID original do status não foi encontrado.')
  return sendZenkGroupStatus(sock, groupJid, {
    delete: {
      ...originalKey,
      id: originalKey.id,
      remoteJid: groupJid,
      fromMe: true
    }
  }, options)
}
