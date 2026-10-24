import { defineCommand } from '../data/workstation.js'
import { clearStickerLibrary, pruneMissingStickers, setStickerLibraryEnabled, stickerLibraryStatus } from '../data/sticker-library.js'
import { reply } from '../data/reply.js'
import { sendQuickButtons } from '../data/interactive.js'

function normalize(value = '') {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase()
}

export default defineCommand({
  name: 'bibliotecafig',
  aliases: ['figbiblioteca', 'bibfig'],
  category: 'Dono',
  usage: '.bibliotecafig on|off|status|limpar|revisar',
  description: 'Controla a biblioteca de figurinhas geradas pela Sakura.',
  ownerOnly: true,
  subownerAllowed: false,

  async execute({ sock, msg, args, senderNumber }) {
    const noAction = !String(args[0] || '').trim()
    const action = normalize(args[0] || 'status')
    if (noAction) return sendQuickButtons({ sock, jid: msg.key.remoteJid, quoted: msg, logger, kind: 'sticker-library-toggle', includeUpdateCta: false,
      body: 'Biblioteca de figurinhas automáticas.', buttons: [
        { id: `${settings.prefix}bibliotecafig on`, text: '🌸 Ativar' },
        { id: `${settings.prefix}bibliotecafig off`, text: '💮 Desativar' },
        { id: `${settings.prefix}bibliotecafig status`, text: '🪷 Ver estado' }
      ] })

    if (['on', 'ativar', 'ligar'].includes(action)) await setStickerLibraryEnabled(true, senderNumber)
    else if (['off', 'desativar', 'desligar'].includes(action)) await setStickerLibraryEnabled(false, senderNumber)
    else if (['limpar', 'clear'].includes(action)) {
      const removed = await clearStickerLibrary()
      return reply(sock, msg, `💮 biblioteca limpa. ${removed} arquivo(s) removido(s).`)
    } else if (['revisar', 'corrigir', 'prune'].includes(action)) {
      const removed = await pruneMissingStickers()
      return reply(sock, msg, `💮 revisão concluída. ${removed} registro(s) ausente(s) removido(s).`)
    }
    const stats = await stickerLibraryStatus()
    return reply(sock, msg, [
      `💮 *biblioteca:* ${stats.enabled ? 'ativa' : 'desativada'}`,
      `💮 *figurinhas:* ${stats.count}/${stats.max}`,
      `🌸 *salvas:* ${stats.saved}`,
      `🌸 *duplicadas evitadas:* ${stats.duplicates}`,
      `🌸 *arquivos ausentes corrigidos:* ${stats.missing}`,
      '',
      'Somente figurinhas geradas pela Sakura são armazenadas, e apenas enquanto o recurso estiver ativo.'
    ].join('\n'))
  }
})
