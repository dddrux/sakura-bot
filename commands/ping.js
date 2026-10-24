import { defineCommand } from '../data/workstation.js'
import { reply } from '../data/reply.js'

export default defineCommand({
  name: 'ping',
  aliases: ['p'],
  category: 'Principal',
  usage: '.ping',
  async execute({ sock, msg, startedAt }) {
    await reply(sock, msg, `💮 pong\n💮 ${Date.now() - startedAt} ms`)
  }
})
