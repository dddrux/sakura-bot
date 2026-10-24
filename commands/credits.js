import { defineCommand } from '../data/workstation.js'
import { reply } from '../data/reply.js'

export default defineCommand({
  name: 'creditos',
  aliases: ['credits', 'creditosmidia', 'creditosaudio'],
  category: 'Principal',
  usage: '.creditos',
  description: 'Mostra os créditos dos áudios e figurinhas da base.',
  async execute({ sock, msg, settings }) {
    await reply(sock, msg, [
      `💮 *${settings.botName}*`,
      '',
      '💮 *Áudios e figurinhas:* Scheyot',
      '💮 *Base:* Sakura',
      '🌸 *Organização e manutenção:* Drux'
    ].join('\n'))
  }
})
