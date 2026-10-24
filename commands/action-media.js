import { defineCommand } from '../data/workstation.js'
import fs from 'node:fs'
import { reply } from '../data/reply.js'
import { sendNativeList } from '../data/interactive.js'
import { formatMessage } from '../data/formatter.js'
import { clearActionMedia, normalizeSocialAction, resolveActionMedia, saveActionMediaFromMessage } from '../data/social-actions.js'
import { getActionMedia, listActionMedia, SOCIAL_ACTIONS } from '../data/social-store.js'
import { suppressCommandOfficialLinks } from '../data/command-ui-state.js'

const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '')

async function panel({ sock, msg, settings, logger }) {
  const configured = new Set(listActionMedia().map(row => row.action))
  return sendNativeList({
    sock, jid: msg.key.remoteJid, quoted: msg, logger, kind: 'action-media-admin',
    body: formatMessage(`Mídias personalizadas: ${configured.size}/${Object.keys(SOCIAL_ACTIONS).length}\nResponda uma imagem, GIF ou vídeo curto ao usar a opção de definir.`, { title: 'MÍDIAS DAS AÇÕES', icon: '🌸' }),
    buttonText: '🌸 Configurar',
    sections: [{
      title: 'Ações',
      rows: Object.entries(SOCIAL_ACTIONS).map(([action, info]) => ({
        id: `${settings.prefix}acaomedia ver ${action}`,
        title: `${configured.has(action) ? '🌸' : '🌸'} ${info.emoji} ${info.label}`,
        description: configured.has(action) ? 'Mídia personalizada ativa' : 'Fallback textual ou mídia padrão'
      }))
    }, {
      title: 'Gerenciamento',
      rows: [
        { id: `${settings.prefix}acaomedia lista`, title: '🌸 Listar configurações', description: 'Estado de todas as ações' },
        { id: `${settings.prefix}acoes`, title: '🌸 Testar ações', description: 'Abrir painel social' }
      ]
    }]
  })
}

export default defineCommand({
  name: 'acaomedia',
  aliases: ['setacaomedia', 'delacaomedia', 'restauraracaomedia', 'veracaomedia', 'listaracoes', 'listaracoesmedia'],
  menuEntries: [{ name: 'acaomedia', usage: '.acaomedia', description: 'Configura imagens e GIFs das ações sociais.', menuGroup: 'Configuração' }],
  category: 'Dono',
  usage: '.acaomedia definir beijar (respondendo mídia)',
  ownerOnly: true,
  async execute({ sock, msg, args, invokedAs, text, settings, senderNumber, logger }) {
    const used = normalize(invokedAs || String(text || '').slice(settings.prefix.length).trim().split(/\s+/, 1)[0])
    let operation = normalize(args[0])
    let actionArg = args[1]
    if (used === 'setacaomedia') { operation = 'definir'; actionArg = args[0] }
    if (used === 'delacaomedia' || used === 'restauraracaomedia') { operation = 'remover'; actionArg = args[0] }
    if (used === 'veracaomedia') { operation = 'ver'; actionArg = args[0] }
    if (used === 'listarações' || used === 'listaracoesmedia') operation = 'lista'
    if (!operation) return panel({ sock, msg, settings, logger })

    if (operation === 'lista' || operation === 'listar') {
      const configured = new Map(listActionMedia().map(row => [row.action, row]))
      const body = Object.entries(SOCIAL_ACTIONS).map(([action, info]) => {
        const row = configured.get(action)
        return `${row ? '🌸' : '🌸'} *${info.label}* — ${row ? `${row.kind}, ${(row.sizeBytes / 1024 / 1024).toFixed(2)} MB` : 'padrão textual'}`
      }).join('\n')
      return reply(sock, msg, body, { title: 'MÍDIAS DAS AÇÕES' })
    }

    const action = normalizeSocialAction(actionArg)
    if (!action) return reply(sock, msg, `Ação inválida. Use *${settings.prefix}acaomedia lista*.`)

    if (['definir', 'set', 'adicionar'].includes(operation)) {
      try {
        const row = await saveActionMediaFromMessage({ msg, logger, action, actor: senderNumber })
        return reply(sock, msg, `Mídia de *${SOCIAL_ACTIONS[action].label}* atualizada.\nTipo: ${row.kind}\nTamanho: ${(row.sizeBytes / 1024 / 1024).toFixed(2)} MB`, { title: 'MÍDIA DA AÇÃO' })
      } catch (error) {
        if (error instanceof TypeError) return reply(sock, msg, error.message, { title: 'MÍDIA DA AÇÃO' })
        throw error
      }
    }

    if (['remover', 'restaurar', 'del', 'delete'].includes(operation)) {
      const old = await clearActionMedia(action)
      return reply(sock, msg, old ? `Mídia personalizada removida de *${SOCIAL_ACTIONS[action].label}*. O fallback padrão voltou a ser usado.` : 'Essa ação já estava usando o padrão.', { title: 'MÍDIA DA AÇÃO' })
    }

    if (['ver', 'status', 'preview'].includes(operation)) {
      const custom = getActionMedia(action)
      const resolved = resolveActionMedia(action)
      if (!resolved) return reply(sock, msg, `*${SOCIAL_ACTIONS[action].label}* usa somente mensagem textual.`, { title: 'MÍDIA DA AÇÃO' })
      const caption = formatMessage(`ação: ${SOCIAL_ACTIONS[action].label}\norigem: ${custom ? 'personalizada' : 'padrão'}\ntipo: ${resolved.kind}`, { title: 'PRÉVIA DA AÇÃO' })
      if (!fs.existsSync(resolved.filename)) return reply(sock, msg, 'O arquivo configurado não existe e será ignorado.')
      suppressCommandOfficialLinks(msg)
      if (resolved.kind === 'image') return sock.sendMessage(msg.key.remoteJid, { image: { url: resolved.filename }, caption }, { quoted: msg })
      return sock.sendMessage(msg.key.remoteJid, { video: { url: resolved.filename }, caption, gifPlayback: true }, { quoted: msg })
    }

    return panel({ sock, msg, settings, logger })
  }
})
