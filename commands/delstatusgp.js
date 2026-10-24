import { defineCommand } from '../data/workstation.js'
import { deleteGroupStatus } from './group-status.js'
import { reply } from '../data/reply.js'

export default defineCommand({
  name: 'delstatusgp',
  aliases: ['apagastatusgp', 'deletarstatusgp', 'delstgp'],
  menuEntries: [{
    name: 'delstatusgp',
    usage: '.delstatusgp [ID|ultimo]',
    description: 'Apaga o último status ou um ID publicado pelo grupo.',
    menuGroup: 'Administração'
  }],
  category: 'Administração',
  usage: '.delstatusgp [ID|ultimo]',
  groupOnly: true,
  adminOnly: true,
  botAdminOnly: true,

  async execute({ sock, msg, args = [], logger }) {
    try {
      const deleted = await deleteGroupStatus({ sock, groupJid: msg.key.remoteJid, args })
      return reply(sock, msg, `💮 Status apagado.\n\n🌸 ID: *${deleted.id}*`, { title: 'STATUS DO GRUPO' })
    } catch (error) {
      logger?.warn?.({ error, stage: 'delstatusgp' }, 'falha ao apagar status do grupo')
      return reply(sock, msg, `Não foi possível apagar o status.\n\nMotivo: ${error.message}`, { title: 'STATUS DO GRUPO', icon: '🌸' })
    }
  }
})
