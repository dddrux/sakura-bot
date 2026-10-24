import cita from '../../commands/cita.js'
import { buildSakuraMentionJids } from '@sakura-md/baileys'

const group = '120363000000000999@g.us'
const bot = '5581999999999@s.whatsapp.net'
const metadata = {
  id: group,
  participants: [
    { id: '100000000000001@lid', phoneNumber: '5511000000001@s.whatsapp.net', admin: 'admin' },
    { id: '100000000000002@lid', phoneNumber: '5511000000002@s.whatsapp.net' },
    { id: bot, phoneNumber: bot, admin: 'admin' }
  ]
}

const directMentions = buildSakuraMentionJids(metadata, { exclude: [bot] })
if (directMentions.length !== 2) throw new Error(`lista de menções incorreta: ${directMentions.length}`)
if (!directMentions.every(jid => jid.endsWith('@s.whatsapp.net'))) throw new Error('PN real do participante não foi priorizado nas menções')

let relay = null
let detailCalls = 0
const logs = []
const sock = {
  user: { id: bot },
  sakuraGetMentionJids: async (_jid, options) => {
    detailCalls += 1
    return buildSakuraMentionJids(options.metadata, { exclude: options.exclude })
  },
  relayMessage: async (jid, message, options) => {
    relay = { jid, message, options }
  },
  sendMessage: async () => { throw new Error('reply não deveria ser usado no teste válido') }
}

const msg = {
  key: {
    id: 'CITA-CMD-1',
    remoteJid: group,
    participant: '5511000000001@s.whatsapp.net',
    fromMe: false
  },
  message: {
    extendedTextMessage: {
      text: '.cita',
      contextInfo: {
        stanzaId: 'QUOTED-1',
        participant: '5511000000002@s.whatsapp.net',
        quotedMessage: { conversation: 'mensagem original' }
      }
    }
  }
}

await cita.execute({
  sock,
  msg,
  metadata,
  logger: { success: (data, message) => logs.push({ data, message }) }
})

if (!relay) throw new Error('relayMessage não foi chamado')
if (relay.jid !== group) throw new Error('grupo incorreto no relay')
if (!relay.options?.messageId) throw new Error('messageId não foi preservado no relay')
const forwarded = relay.message?.extendedTextMessage || relay.message?.conversation || Object.values(relay.message || {})[0]
const mentioned = forwarded?.contextInfo?.mentionedJid || []
if (mentioned.length !== 2) throw new Error(`cita enviou ${mentioned.length} menções em vez de 2`)
if (mentioned.includes(bot)) throw new Error('a Sakura mencionou o próprio número')
if (detailCalls !== 1) throw new Error('lista de menções não usou o helper rápido')
if (!logs[0]?.data?.relayMs && logs[0]?.data?.relayMs !== 0) throw new Error('tempos detalhados do cita não foram registrados')
console.log('✅ Cita Turbo: encaminhamento, menções por PN real, exclusão do bot e tempos detalhados aprovados')
