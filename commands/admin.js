import { defineCommand } from '../data/workstation.js'
import path from 'node:path'
import { buildSakuraMentionJids } from '@sakura-md/baileys'
import { reply } from '../data/reply.js'
import { prepareLegacyAudio } from '../data/legacy-audio.js'
import { sendAudioMedia, sendStickerMedia } from '../data/media-delivery.js'
import { getStickerTriggerBuffer } from '../data/triggers.js'
import { settings as botSettings } from '../data/settings.js'
import { sendNativeList } from '../data/interactive.js'
import { formatMessage } from '../data/formatter.js'
import { firstTargetJid } from '../data/targets.js'
import { groupNameMap, displayUser, formatMentionName, groupDisplayName } from '../data/user-display.js'

const digits = value => String(value || '').replace(/\D/g, '')
const toJid = value => {
  const number = digits(value)
  return number ? `${number}@s.whatsapp.net` : ''
}

function targetJid(msg, args = []) { return firstTargetJid(msg, args) || toJid(args[0]) }

async function participantAction(sock, msg, args, action, { replyDone = true } = {}) {
  let target = targetJid(msg, args)
  if (!target) {
    await reply(sock, msg, '💮 marque ou responda alguém')
    return null
  }
  if (String(target).includes('@lid') && typeof sock.sakuraResolveNumber === 'function') {
    const number = await sock.sakuraResolveNumber(target)
    if (number) target = toJid(number)
  }
  await sock.groupParticipantsUpdate(msg.key.remoteJid, [target], action)
  if (replyDone) await reply(sock, msg, '💮 pronto')
  return target
}

async function sendBanBundle(sock, msg, logger) {
  const startedAt = Date.now()
  const audioFile = path.join(botSettings.audioDir, 'legacy', 'ban.mp3')
  const stickerFile = path.join(botSettings.stickerDir, 'legacy', 'ban.webp')
  const groupName = await groupDisplayName(sock, msg.key.remoteJid)
  const prepared = await Promise.allSettled([
    prepareLegacyAudio(audioFile, logger),
    getStickerTriggerBuffer({ id: 'ban', file: stickerFile, relativeFile: 'legacy/ban.webp' }, true, { userName: msg.pushName || 'Usuário', groupName })
  ])

  const results = []
  if (prepared[0].status === 'fulfilled') {
    try {
      await sendAudioMedia(sock, msg, prepared[0].value, {
        ptt: true,
        mimetype: 'audio/ogg; codecs=opus',
        priority: 'high'
      })
      results.push({ status: 'fulfilled', media: 'audio' })
    } catch (error) {
      results.push({ status: 'rejected', media: 'audio', reason: error })
      logger?.warn?.({ error, stage: 'ban-audio-send' }, 'áudio do ban não pôde ser enviado')
    }
  } else {
    results.push({ status: 'rejected', media: 'audio', reason: prepared[0].reason })
    logger?.warn?.({ error: prepared[0].reason, stage: 'ban-audio-prepare' }, 'áudio do ban não pôde ser preparado')
  }

  if (prepared[1].status === 'fulfilled') {
    try {
      await sendStickerMedia(sock, msg, prepared[1].value, { priority: 'high', quoted: false })
      results.push({ status: 'fulfilled', media: 'sticker' })
    } catch (error) {
      results.push({ status: 'rejected', media: 'sticker', reason: error })
      logger?.warn?.({ error, stage: 'ban-sticker-send' }, 'figurinha do ban não pôde ser enviada')
    }
  } else {
    results.push({ status: 'rejected', media: 'sticker', reason: prepared[1].reason })
    logger?.warn?.({ error: prepared[1].reason, stage: 'ban-sticker-prepare' }, 'figurinha do ban não pôde ser preparada')
  }

  logger?.info?.({
    stage: 'ban-media-bundle',
    sent: results.filter(result => result.status === 'fulfilled').length,
    failed: results.filter(result => result.status === 'rejected').length,
    durationMs: Date.now() - startedAt,
    dispatchMode: 'ordered-audio-sticker'
  }, 'áudio e figurinha do ban processados')

  return {
    sent: results.filter(result => result.status === 'fulfilled').length,
    failed: results.filter(result => result.status === 'rejected').length
  }
}

async function sendPromotedAudio(sock, msg, logger) {
  const startedAt = Date.now()
  try {
    const audioFile = path.join(botSettings.audioDir, 'legacy', 'promovido.mp3')
    const audio = await prepareLegacyAudio(audioFile, logger)
    await sendAudioMedia(sock, msg, audio, {
      ptt: true,
      mimetype: 'audio/ogg; codecs=opus',
      priority: 'high'
    })
    logger?.info?.({ stage: 'promote-audio', bytes: audio.length, durationMs: Date.now() - startedAt }, 'áudio de promovido enviado')
    return true
  } catch (error) {
    logger?.warn?.({ error, stage: 'promote-audio', durationMs: Date.now() - startedAt }, 'áudio promovido não pôde ser enviado')
    return false
  }
}


export default defineCommand({
  name: 'ban',
  aliases: [
    'ban2', 'novolink', 'revogarlink', 'novolik', 'hidetag', 'totag',
    'tagall', 'marcar2', 'marcarwa', 'admins'
  ],
  menuEntries: [
    { name: 'ban', usage: '.ban @pessoa', description: 'Remove uma pessoa e envia a mídia do ban.', menuGroup: 'Participantes' },
    { name: 'admins', usage: '.admins', description: 'Lista os administradores do grupo.', menuGroup: 'Participantes' },
    { name: 'novolink', usage: '.novolink', description: 'Revoga e gera um novo link.', menuGroup: 'Convites' },
    { name: 'hidetag', usage: '.hidetag mensagem', description: 'Envia uma mensagem marcando todos.', menuGroup: 'Mensagens' }
  ],
  category: 'Administração',
  usage: '.ban @pessoa',
  groupOnly: true,
  adminOnly: true,

  async execute({ sock, msg, args, rawArgs, text, settings, metadata, logger, commands }) {
    const used = text.slice(settings.prefix.length).trim().split(/\s+/)[0].toLowerCase()
    const openAdminPanel = () => sendNativeList({
      sock,
      jid: msg.key.remoteJid,
      quoted: msg,
      logger,
      kind: 'admin-actions',
      body: formatMessage('Escolha uma ação segura. Para banir, promover ou rebaixar, responda ou marque a pessoa.', { title: 'ADMINISTRAÇÃO', icon: '🌸' }),
      buttonText: '🌸 Abrir ações',
      sections: [
        {
          title: '💮 Grupo',
          rows: [
            { id: `${settings.prefix}gp abrir`, title: '🌸 Abrir grupo', description: 'Todos poderão enviar mensagens' },
            { id: `${settings.prefix}gp fechar`, title: '🌸 Fechar grupo', description: 'Somente administradores poderão enviar' },
            { id: `${settings.prefix}lg`, title: '💮 Link do grupo', description: 'Mostrar convite atual' },
            { id: `${settings.prefix}nl`, title: '💮 Gerar novo link', description: 'Revogar o convite anterior' },
            { id: `${settings.prefix}ads`, title: '🌸 Ver administradores', description: 'Lista de administradores atuais' }
          ]
        },
        {
          title: '💮 Participantes e mensagens',
          rows: [
            { id: `${settings.prefix}menu command ban`, title: '🌸 Como banir', description: 'Modelo curto: .bn @pessoa' },
            { id: `${settings.prefix}menu command promover`, title: '🌸 Como promover', description: 'Modelo curto: .pr @pessoa' },
            { id: `${settings.prefix}menu command rebaixar`, title: '💮 Como rebaixar', description: 'Modelo curto: .rbx @pessoa' },
            { id: `${settings.prefix}menu command hidetag`, title: '🌸 Como marcar todos', description: 'Modelo curto: .ht mensagem' },
            { id: `${settings.prefix}m adm`, title: '💮 Todos os comandos', description: 'Abrir a categoria Administração' }
          ]
        }
      ]
    })

    if (['ban', 'kick', 'ban2', 'promover', 'promote', 'rebaixar', 'demote'].includes(used) && !targetJid(msg, args)) {
      return openAdminPanel()
    }

    if (['ban', 'kick', 'ban2'].includes(used)) {
      const target = await participantAction(sock, msg, args, 'remove', { replyDone: false })
      if (target) await sendBanBundle(sock, msg, logger)
      return
    }
    if (['promover', 'promote'].includes(used)) {
      const target = await participantAction(sock, msg, args, 'promote', { replyDone: false })
      if (target) await sendPromotedAudio(sock, msg, logger)
      return
    }
    if (['rebaixar', 'demote'].includes(used)) {
      await participantAction(sock, msg, args, 'demote')
      return
    }
    if (['grupo', 'fechargp', 'abrirgp'].includes(used)) {
      const arg = String(args[0] || used).toLowerCase()
      const close = ['fechar', 'fechado', 'fechargp'].includes(arg)
      const open = ['abrir', 'aberto', 'abrirgp'].includes(arg)
      if (!close && !open) return reply(sock, msg, `${settings.prefix}grupo abrir\n${settings.prefix}grupo fechar`, { title: 'GRUPO' })
      await sock.groupSettingUpdate(msg.key.remoteJid, close ? 'announcement' : 'not_announcement')
      await reply(sock, msg, close ? '💮 grupo fechado' : '💮 grupo aberto')
      return
    }
    if (['linkgp', 'linkgrupo'].includes(used)) {
      const code = await sock.groupInviteCode(msg.key.remoteJid)
      await reply(sock, msg, `https://chat.whatsapp.com/${code}`, { raw: true })
      return
    }
    if (['novolink', 'revogarlink', 'novolik'].includes(used)) {
      await sock.groupRevokeInvite(msg.key.remoteJid)
      const code = await sock.groupInviteCode(msg.key.remoteJid)
      await reply(sock, msg, `https://chat.whatsapp.com/${code}`, { raw: true })
      return
    }
    if (['hidetag', 'totag', 'tagall', 'marcar2', 'marcarwa'].includes(used)) {
      if (!rawArgs.trim()) return openAdminPanel()
      const participants = typeof sock.sakuraGetMentionJids === 'function'
        ? await sock.sakuraGetMentionJids(msg.key.remoteJid, { metadata, exclude: [sock.user?.id, sock.user?.lid] })
        : buildSakuraMentionJids(metadata, { exclude: [sock.user?.id, sock.user?.lid] })
      await sock.sendMessage(msg.key.remoteJid, {
        text: rawArgs || '💮',
        mentions: participants
      }, { quoted: msg })
      return
    }
    if (used === 'nomegp') {
      if (!rawArgs.trim()) return openAdminPanel()
      await sock.groupUpdateSubject(msg.key.remoteJid, rawArgs.trim())
      await reply(sock, msg, '💮 nome atualizado')
      return
    }
    if (used === 'descgp') {
      if (!rawArgs.trim()) return openAdminPanel()
      await sock.groupUpdateDescription(msg.key.remoteJid, rawArgs.trim())
      await reply(sock, msg, '💮 descrição atualizada')
      return
    }
    if (used === 'admins') {
      const admins = buildSakuraMentionJids({ participants: (metadata?.participants || []).filter(item => item.admin) })
      const names = await groupNameMap(sock, msg.key.remoteJid, metadata)
      const body = admins.map((jid, index) => `${index + 1}. ${formatMentionName(displayUser(digits(jid), names))}`).join('\n')
      await reply(sock, msg, body || 'nenhum administrador', { mentions: admins, title: 'ADMINISTRADORES' })
    }
  }
})
