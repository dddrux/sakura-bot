import { createMessageHandler } from '../handler.js'
import { setRental } from '../rentals.js'

const sent = []
let metadataFetches = 0
const fakeLogger = new Proxy({}, { get: () => () => {} })
const sock = {
  user: { id: '5581999999999@s.whatsapp.net' },
  sakuraResolveNumber: async jid => String(jid).replace(/\D/g, ''),
  groupMetadata: async () => {
    metadataFetches += 1
    return ({
    participants: [
      { id: '5511999999999@s.whatsapp.net', admin: 'admin' },
      { id: '5581999999999@s.whatsapp.net', admin: 'admin' }
    ]
  })
  },
  sakuraPeekGroupMetadata: () => ({
    metadata: {
      participants: [
        { id: '5511999999999@s.whatsapp.net', admin: 'admin' },
        { id: '5581999999999@s.whatsapp.net', admin: 'admin' }
      ]
    },
    cacheHit: true,
    source: 'test-cache',
    ageMs: 5
  }),
  sendMessage: async (jid, content, options) => {
    sent.push({ jid, content, options, mode: 'send' })
    return { key: { id: `TEST-${sent.length}`, remoteJid: jid }, message: content }
  },
  relayMessage: async (jid, message, options) => {
    sent.push({ jid, message, options, mode: 'relay' })
    return options.messageId
  },
  waUploadToServer: async () => ({ mediaUrl: 'https://example.invalid/image.jpg', directPath: '/image.jpg' })
}
await setRental('120363000000000000@g.us', 30, false)
const handler = await createMessageHandler(sock, fakeLogger)
await handler({
  key: { id: 'SELECTION-1', remoteJid: '120363000000000000@g.us', participant: '5511999999999@s.whatsapp.net', fromMe: false },
  message: {
    viewOnceMessage: {
      message: {
        interactiveResponseMessage: {
          nativeFlowResponseMessage: { paramsJson: JSON.stringify({ id: '.brat' }) }
        }
      }
    }
  }
}, 'notify')

if (sent.some(entry => entry.content?.delete?.id === 'SELECTION-1')) throw new Error('seleção foi apagada indevidamente')
const usageReply = sent.find(entry => String(entry.content?.text || '').includes('.brat'))
if (!usageReply) throw new Error('uso do comando selecionado não foi enviado')
if (!sent.some(entry => entry.content?.nativeFlow)) throw new Error('diálogo com rodapé nativo não foi enviado')

await handler({
  key: { id: 'UNKNOWN-1', remoteJid: '5511888888888@s.whatsapp.net', fromMe: false },
  message: { conversation: '.pign' }
}, 'notify')
const unknown = sent.find(entry => String(entry.content?.text || '').includes('comando não encontrado'))
if (!unknown) throw new Error('resposta de comando não encontrado ausente')
if (!String(unknown.content.text).includes('.ping')) throw new Error('sugestão de comando ausente')

await handler({
  key: { id: 'PING-FAST-1', remoteJid: '120363000000000000@g.us', participant: '5511999999999@s.whatsapp.net', fromMe: false },
  message: { conversation: '.ping' }
}, 'notify')
if (metadataFetches !== 0) throw new Error(`comando comum consultou groupMetadata ${metadataFetches} vez(es)`)



await handler({
  key: { id: 'SHORT-BRAT-1', remoteJid: '5511888888888@s.whatsapp.net', fromMe: false },
  message: { conversation: '.br' }
}, 'notify')
if (!sent.some(entry => String(entry.content?.text || '').includes('.brat seu texto'))) throw new Error('atalho .br não foi convertido para .brat')

await handler({
  key: { id: 'SHORT-MENU-ECO-1', remoteJid: '120363000000000000@g.us', participant: '5511999999999@s.whatsapp.net', fromMe: false },
  message: { conversation: '.m eco' }
}, 'notify')
const economyMenu = [...sent].reverse().find(entry => entry.message?.viewOnceMessage?.message?.interactiveMessage)
if (!economyMenu) throw new Error('.m eco não enviou menu interativo')
const singleSelect = economyMenu.message.viewOnceMessage.message.interactiveMessage.nativeFlowMessage?.buttons?.find(button => button.name === 'single_select')
const economySections = JSON.parse(singleSelect?.buttonParamsJson || '{}').sections || []
const economyIds = economySections.flatMap(section => section.rows || []).map(row => row.id)
if (!economyIds.includes('.dp') || !(economyIds.includes('.pf') || economyIds.includes('.menu command perfil'))) throw new Error('.m eco não expôs depósito e modelo de perfil')

const sentBeforeAppend = sent.length
await handler({
  key: { id: 'APPEND-OLD-1', remoteJid: '5511888888888@s.whatsapp.net', fromMe: false },
  messageTimestamp: Math.floor(Date.now() / 1000) - 3600,
  message: { conversation: '.ping' }
}, 'append')
if (sent.length !== sentBeforeAppend) throw new Error('mensagem append antiga executou comando ou resposta automática')

console.log('✅ Handler: seleção preservada, rodapé nativo, contratos, aliases curtos, .m eco, comando inexistente, append e caminho rápido aprovados')
