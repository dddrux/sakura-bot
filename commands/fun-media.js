import { defineCommand } from '../data/workstation.js'
import { reply } from '../data/reply.js'
import { writeAudit } from '../data/core-store.js'
import {
  clearCommandMedia,
  deleteCommandMedia,
  getGroupMediaAdminPermission,
  listCommandMedia,
  normalizeMediaBucket,
  normalizeMediaCommand,
  saveCommandMedia,
  sendCommandResult,
  setCommandMediaEnabled,
  setGroupMediaAdminPermission
} from '../data/fun-media-store.js'

const normalize = value => String(value || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/[^a-z0-9]/g, '')

const onWords = new Set(['on', 'ativar', 'ligar', 'sim'])
const offWords = new Set(['off', 'desativar', 'desligar', 'nao'])
const isUrl = value => /^https?:\/\//i.test(String(value || '').trim())

function parseScope(args, { isGroup, isOwner, chat }) {
  const requestedGroup = args.some(value => ['--grupo', '--group'].includes(String(value).toLowerCase()))
  const requestedGlobal = args.some(value => ['--global', '--todos'].includes(String(value).toLowerCase()))
  if (!isOwner) return chat
  if (requestedGroup) {
    if (!isGroup) throw new TypeError('O escopo de grupo só pode ser usado dentro de um grupo.')
    return chat
  }
  if (requestedGlobal || !isGroup) return '*'
  return '*'
}

function parseTarget(args = []) {
  const values = args.filter(value => !String(value).startsWith('--'))
  const command = normalizeMediaCommand(values[0])
  const url = values.find((value, index) => index > 0 && isUrl(value)) || ''
  const bucketValue = values.find((value, index) => index > 0 && !isUrl(value)) || 'default'
  return { command, url, bucket: normalizeMediaBucket(bucketValue), values }
}

function permissionText(enabled) {
  return enabled
    ? 'Administradores podem configurar somente as mídias deste grupo.'
    : 'Somente o dono pode alterar mídias; administradores do grupo estão bloqueados.'
}

export default defineCommand({
  name: 'setmidia',
  aliases: [
    'addmidia', 'delmidia', 'listarmidias', 'limparmidias', 'testarmidia', 'midiaon', 'midiaoff',
    'permitirmidiagp', 'midiapermissao', 'midiaadmin'
  ],
  category: 'Configuração',
  adminOnly: true,
  needsMetadata: true,
  sensitiveArgs: true,
  menuEntries: [
    { name: 'setmidia', usage: '.setmidia on|off <comando>', description: 'Define mídia e também ativa/desativa mídias do comando.', menuGroup: 'Mídias de comandos' },
    { name: 'addmidia', usage: '.addmidia ship --grupo', description: 'Adiciona variações para um comando.', menuGroup: 'Mídias de comandos' },
    { name: 'listarmidias', usage: '.listarmidias ship --grupo', description: 'Lista mídias cadastradas.', menuGroup: 'Mídias de comandos' },
    { name: 'permitirmidiagp', usage: '.permitirmidiagp on', description: 'Autoriza admins a editar mídia do grupo.', menuGroup: 'Dono' }
  ],

  async execute({ sock, msg, args, invokedAs, senderNumber, isGroup, isOwner, isAdmin, logger }) {
    const operation = normalize(invokedAs)
    const chat = String(msg.key.remoteJid || '')

    if (['permitirmidiagp', 'midiapermissao', 'midiaadmin'].includes(operation)) {
      if (!isOwner) return reply(sock, msg, 'Somente o dono principal pode liberar essa permissão.')
      if (!isGroup) return reply(sock, msg, 'Use este comando dentro do grupo que receberá a permissão.')
      const action = normalize(args[0] || 'status')
      if (action === 'status' || !action) {
        const current = getGroupMediaAdminPermission(chat)
        return reply(sock, msg, `${permissionText(current.enabled)}\nEstado: *${current.enabled ? 'ATIVADO' : 'DESATIVADO'}*.`, { title: 'PERMISSÃO DE MÍDIA' })
      }
      const enabled = onWords.has(action) ? true : offWords.has(action) ? false : null
      if (enabled == null) return reply(sock, msg, 'Use *.permitirmidiagp on*, *.permitirmidiagp off* ou *.permitirmidiagp status*.')
      const current = setGroupMediaAdminPermission(chat, enabled, senderNumber)
      writeAudit({ actor: senderNumber, action: 'command-media.group-admin-permission', chat, details: { enabled } })
      return reply(sock, msg, `${permissionText(current.enabled)}\nEstado: *${current.enabled ? 'ATIVADO' : 'DESATIVADO'}*.`, { title: 'PERMISSÃO DE MÍDIA' })
    }

    if (!isOwner) {
      if (!isGroup || !isAdmin) return reply(sock, msg, 'Somente o dono ou um administrador autorizado pode configurar mídias.')
      const permission = getGroupMediaAdminPermission(chat)
      if (!permission.enabled) return reply(sock, msg, 'O dono ainda não permitiu que administradores alterem as mídias deste grupo.')
    }

    const legacyToggle = operation === 'midiaon' ? true : operation === 'midiaoff' ? false : null
    const requestedToggle = operation === 'setmidia'
      ? (onWords.has(normalize(args[0])) ? true : offWords.has(normalize(args[0])) ? false : null)
      : legacyToggle
    if (requestedToggle != null) {
      const toggleArgs = operation === 'setmidia' ? args.slice(1) : args
      let toggleScope
      try { toggleScope = parseScope(toggleArgs, { isGroup, isOwner, chat }) } catch (error) { return reply(sock, msg, error.message) }
      if (!isOwner) toggleScope = chat
      const { command: toggleCommand } = parseTarget(toggleArgs)
      if (!toggleCommand) return reply(sock, msg, `Use *.setmidia on <comando>* ou *.setmidia off <comando>*.`)
      const count = setCommandMediaEnabled(toggleCommand, toggleScope, requestedToggle)
      return reply(sock, msg, `${count} mídia(s) ${requestedToggle ? 'ativada(s)' : 'desativada(s)'} em *${toggleCommand}*.`)
    }

    let scope
    try { scope = parseScope(args, { isGroup, isOwner, chat }) } catch (error) { return reply(sock, msg, error.message) }
    if (!isOwner) scope = chat

    const { command, url, bucket, values } = parseTarget(args)
    if (!command) {
      return reply(sock, msg, [
        'Informe o comando desejado.',
        'Exemplos:',
        '• *.setmidia ship 80-100* respondendo uma mídia',
        '• *.setmidia ship https://site.com/ship.gif*',
        '• *.addmidia pescar raro --grupo*'
      ].join('\n'))
    }

    try {
      if (operation === 'setmidia' || operation === 'addmidia') {
        const row = await saveCommandMedia({
          msg,
          logger,
          command,
          bucket,
          scope,
          actor: senderNumber,
          replace: operation === 'setmidia',
          url
        })
        writeAudit({
          actor: senderNumber,
          action: `command-media.${operation === 'setmidia' ? 'set' : 'add'}`,
          chat: scope === '*' ? '' : scope,
          target: command,
          details: { bucket, scope, kind: row.kind, remote: Boolean(url), sizeBytes: row.sizeBytes }
        })
        return reply(sock, msg, [
          `Mídia ${operation === 'setmidia' ? 'definida' : 'adicionada'} para *${command}*.`,
          `Faixa/categoria: *${bucket}*`,
          `Tipo: *${row.kind}*`,
          `Tamanho: *${(row.sizeBytes / 1048576).toFixed(2)} MB*`,
          `Origem: *${url ? 'URL validada' : 'mensagem respondida'}*`,
          `Escopo: *${scope === '*' ? 'global' : 'somente este grupo'}*`
        ].join('\n'), { title: 'MÍDIA CONFIGURADA' })
      }

      if (operation === 'delmidia') {
        const index = values.slice(1).find(value => /^\d+$/.test(value))
        const row = await deleteCommandMedia(command, scope, index)
        return reply(sock, msg, row ? `Mídia ${index} removida de *${command}*.` : 'Número de mídia não encontrado.')
      }

      if (operation === 'listarmidias') {
        const rows = listCommandMedia(command, scope)
        if (!rows.length) return reply(sock, msg, 'Nenhuma mídia cadastrada nesse escopo.')
        return reply(sock, msg, rows.map(row => [
          `${row.index}. ${row.kind} • ${row.bucket}`,
          `${(Number(row.size_bytes) / 1048576).toFixed(2)} MB • ${row.enabled ? 'ativa' : 'desativada'} • ${row.source_url ? 'URL' : 'upload'}`
        ].join('\n')).join('\n\n'), { title: `MÍDIAS DE ${command.toUpperCase()}` })
      }

      if (operation === 'limparmidias') {
        const count = await clearCommandMedia(command, scope)
        return reply(sock, msg, `${count} mídia(s) removida(s) de *${command}*.`)
      }

      if (operation === 'testarmidia') {
        return sendCommandResult({
          sock,
          msg,
          command,
          caption: `🌸 Prévia da mídia de *${command}*\nFaixa/categoria simulada: *${bucket}*`,
          percent: 95,
          category: bucket
        })
      }

      return reply(sock, msg, 'Ação de mídia não reconhecida.')
    } catch (error) {
      logger?.warn?.({ error, command, scope, operation }, 'falha recuperável ao configurar mídia de comando')
      return reply(sock, msg, error.message || 'Falha ao configurar mídia.')
    }
  }
})
