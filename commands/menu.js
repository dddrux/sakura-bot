import { defineCommand } from '../data/workstation.js'
import path from 'node:path'
import {
  sendAliasCatalog,
  sendCompleteCommandCatalog,
  sendCommandList,
  sendCommandModel,
  sendCommandSearch,
  sendSelectableCommandMenu
} from '../data/interactive.js'
import { prepareLegacyAudio } from '../data/legacy-audio.js'
import { settings } from '../data/settings.js'
import { reply } from '../data/reply.js'
import { menuCategoryFor } from '../data/short-aliases.js'

function normalize(value = '') { return String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim() }
export function shouldPlayMainMenuAudio(invoked = '', action = '') {
  return normalize(invoked) === 'menu' && !normalize(action)
}
function replyGroupOfficial(sock, msg) {
  if (settings.officialGroup) {
    return reply(sock, msg, '🌸 Use o botão *Grupo oficial da sakura* abaixo para entrar.', {
      nativeFlow: [{ text: '🔗 Grupo oficial da sakura', url: settings.officialGroup }]
    })
  }
  return reply(sock, msg, '🌸 O grupo oficial da Sakura ainda não foi configurado.')
}

function decodeToken(value = '') {
  try { return decodeURIComponent(String(value || '')) } catch { return String(value || '') }
}

async function playMenuAudio(sock, msg, logger) {
  try {
    const file = path.join(settings.audioDir, 'legacy', 'menu.mp3')
    const audio = await prepareLegacyAudio(file, logger)
    await sock.sendMessage(msg.key.remoteJid, { audio, ptt: true, mimetype: 'audio/ogg; codecs=opus' }, { quoted: false })
  } catch (error) { logger?.debug?.({ error }, 'áudio do menu não enviado') }
}

export default defineCommand({
  name: 'menu',
  aliases: ['m', 'help', 'ajuda', 'menucomandos', 'menumidia', 'comandos'],
  menuEntries: [
    { name: 'menu', usage: '.menu', description: 'Abre as categorias e os catálogos.', menuGroup: 'Navegação' },
    { name: 'comandos', usage: '.comandos', description: 'Abre o catálogo completo de comandos.', menuGroup: 'Navegação' },
    { name: 'ajuda', usage: '.ajuda', description: 'Abre a central de ajuda da Sakura.', menuGroup: 'Navegação' }
  ],
  category: 'Principal',
  usage: '.menu',
  description: 'Abre categorias, catálogos, atalhos e pesquisa de comandos.',
  officialLinks: true,
  async execute({ sock, msg, args, commands, logger, text, invokedAs, senderNumber }) {
    const originalInvoked = normalize(invokedAs || String(text || '').slice(settings.prefix.length).trim().split(/\s+/, 1)[0])
    const invoked = normalize(String(text || '').slice(settings.prefix.length).trim().split(/\s+/, 1)[0])
    let action = normalize(args?.[0])

    if (invoked === 'comandos' && !action) action = 'catalog'

    const directCategory = menuCategoryFor(action)
    if (directCategory) {
      return sendCommandList({ sock, msg, commands, category: directCategory, logger })
    }

    if (action === 'category' || action === 'categoria') {
      const category = decodeToken(args.slice(1).join(' '))
      return sendCommandList({ sock, msg, commands, category, logger })
    }
    if (action === 'command' || action === 'comando') {
      const selectedName = decodeToken(args.slice(1).join(' '))
      return sendCommandModel({ sock, msg, commands, selectedName, logger })
    }
    if (['catalog', 'catalogo', 'todos', 'c', 'cat'].includes(action)) {
      return sendCompleteCommandCatalog({ sock, msg, commands, logger })
    }
    if (['aliases', 'atalhos', 'apelidos', 'at', 'als'].includes(action)) {
      return sendAliasCatalog({ sock, msg, commands, page: Number(args[1] || 1), logger })
    }
    if (['search', 'buscar', 'pesquisar', 'procura', 'b', 'bus'].includes(action)) {
      return sendCommandSearch({ sock, msg, commands, query: decodeToken(args.slice(1).join(' ')), logger })
    }

    if (['grupooficial', 'grupo-oficial', 'oficial'].includes(action)) {
      return replyGroupOfficial(sock, msg)
    }

    const sent = await sendSelectableCommandMenu({ sock, msg, commands, logger, requesterNumber: senderNumber })
    if (shouldPlayMainMenuAudio(originalInvoked, action)) void playMenuAudio(sock, msg, logger)
    return sent
  }
})
