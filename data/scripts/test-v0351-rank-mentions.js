import ranks from '../../commands/ranks.js'
import { settings } from '../settings.js'

const relays = []
const sock = {
  user: { id: '558193775177@s.whatsapp.net' },
  async groupMetadata() {
    return {
      id: '120363000000000000@g.us',
      participants: [
        { id: '5581111111111@s.whatsapp.net', notify: 'Ana' },
        { id: '5581222222222@s.whatsapp.net', notify: 'Bruno' },
        { id: '5581333333333@s.whatsapp.net' }
      ]
    }
  },
  async relayMessage(jid, message, options) {
    relays.push({ jid, message, options })
  }
}
const msg = { key: { remoteJid: '120363000000000000@g.us', id: 'RANK-TEST' } }
const logger = new Proxy({}, { get: () => () => {} })
await ranks.execute({ sock, msg, text: '.rankgay', settings, chatNumber: '120363000000000000', logger })
if (relays.length !== 1) throw new Error('Ranking não foi enviado por Native Flow')
const inner = relays[0].message?.viewOnceMessage?.message
const mentions = inner?.messageContextInfo?.mentionedJid || []
if (mentions.length !== 3) throw new Error(`Ranking deveria mencionar 3 pessoas, recebeu ${mentions.length}`)
const body = inner?.interactiveMessage?.body?.text || ''
if (!body.includes('Ana (@5581111111111)') || !body.includes('Bruno (@5581222222222)')) throw new Error('Ranking não usou nomes disponíveis')
if (!body.includes('@5581333333333')) throw new Error('Ranking não aplicou fallback de menção')
console.log('✅ Rankings: nomes disponíveis, fallback e JIDs reais de menção aprovados')
