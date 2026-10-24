import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'sakura-v0355-ui-'))

const { default: relationships } = await import('../../commands/relationships.js')
const { default: actions } = await import('../../commands/actions.js')
const { default: actionMedia } = await import('../../commands/action-media.js')
const { default: rentals } = await import('../../commands/rentals.js')
const { default: vip } = await import('../../commands/vip.js')
const { default: ranks } = await import('../../commands/ranks.js')
const { loadCommands } = await import('../handler.js')
const { closeSocialStore } = await import('../social-store.js')
const { closeCoreStore } = await import('../core-store.js')

const chat = '120363055500000099@g.us'
const alice = '5581999995201'
const bob = '5581999995202'
const child = '5581999995203'
const bot = '558193775177'
const metadata = {
  id: chat,
  participants: [
    { id: `${alice}@s.whatsapp.net`, notify: 'Alice', admin: 'admin' },
    { id: `${bob}@s.whatsapp.net`, notify: 'Bruno' },
    { id: `${child}@s.whatsapp.net`, notify: 'Clara' },
    { id: `${bot}@s.whatsapp.net`, notify: 'Sakura', admin: 'admin' }
  ]
}
const relays = []
const sends = []
const sock = {
  user: { id: `${bot}@s.whatsapp.net` },
  async relayMessage(jid, message, options) { relays.push({ jid, message, options }); return { key: { id: `RELAY-${relays.length}` } } },
  async sendMessage(jid, content, options) { sends.push({ jid, content, options }); return { key: { id: `SEND-${sends.length}` } } },
  async groupMetadata() { return metadata }
}
const logger = new Proxy({}, { get: () => () => {} })
const settings = { prefix: '.', botNumber: bot, ownerNumber: alice, botName: 'Sakura-MD' }
const msg = (sender, command, id) => ({
  key: { remoteJid: chat, participant: `${sender}@s.whatsapp.net`, id },
  message: { conversation: command },
  pushName: sender === alice ? 'Alice' : sender === bob ? 'Bruno' : 'Clara'
})

await relationships.execute({ sock, msg: msg(alice, `.namorar ${bob}`, 'SOC-UI-1'), args: [bob], text: `.namorar ${bob}`, invokedAs: 'namorar', settings, senderNumber: alice, metadata, logger })
let serialized = JSON.stringify(relays.at(-1)?.message || {})
const datingId = serialized.match(/SOC-[A-Z0-9]+/)?.[0]
if (!datingId || !serialized.includes(`.aceitarnamoro ${datingId}`) || !serialized.includes('Alice') || !serialized.includes('Bruno')) throw new Error('painel de namoro incompleto')

await relationships.execute({ sock, msg: msg(bob, `.aceitarnamoro ${datingId}`, 'SOC-UI-2'), args: [datingId], text: `.aceitarnamoro ${datingId}`, invokedAs: 'aceitarnamoro', settings, senderNumber: bob, metadata, logger })
if (!JSON.stringify(sends.at(-1)?.content || {}).includes('namoro confirmado')) throw new Error('aceite de namoro não respondeu')

await relationships.execute({ sock, msg: msg(alice, `.casar ${bob}`, 'SOC-UI-3'), args: [bob], text: `.casar ${bob}`, invokedAs: 'casar', settings, senderNumber: alice, metadata, logger })
serialized = JSON.stringify(relays.at(-1)?.message || {})
const marriageId = serialized.match(/SOC-[A-Z0-9]+/)?.[0]
if (!marriageId || !serialized.includes(`.aceitarcasamento ${marriageId}`)) throw new Error('painel de casamento incompleto')
await relationships.execute({ sock, msg: msg(bob, `.aceitarcasamento ${marriageId}`, 'SOC-UI-4'), args: [marriageId], text: `.aceitarcasamento ${marriageId}`, invokedAs: 'aceitarcasamento', settings, senderNumber: bob, metadata, logger })

await relationships.execute({ sock, msg: msg(alice, `.adotar ${child}`, 'SOC-UI-5'), args: [child], text: `.adotar ${child}`, invokedAs: 'adotar', settings, senderNumber: alice, metadata, logger })
serialized = JSON.stringify(relays.at(-1)?.message || {})
const adoptionId = serialized.match(/SOC-[A-Z0-9]+/)?.[0]
if (!adoptionId || !serialized.includes(`.aceitaradocao ${adoptionId}`)) throw new Error('painel de adoção incompleto')
await relationships.execute({ sock, msg: msg(child, `.aceitaradocao ${adoptionId}`, 'SOC-UI-6'), args: [adoptionId], text: `.aceitaradocao ${adoptionId}`, invokedAs: 'aceitaradocao', settings, senderNumber: child, metadata, logger })

await relationships.execute({ sock, msg: msg(alice, '.familia', 'SOC-UI-7'), args: [], text: '.familia', invokedAs: 'familia', settings, senderNumber: alice, metadata, logger })
serialized = JSON.stringify(relays.at(-1)?.message || {})
if (!serialized.includes('Clara') || !serialized.includes('Filhos')) throw new Error('painel familiar não mostrou filho')

await actions.execute({ sock, msg: msg(alice, `.abracar ${bob}`, 'SOC-UI-8'), args: [bob], text: `.abracar ${bob}`, invokedAs: 'abracar', settings, senderNumber: alice, metadata, logger })
serialized = JSON.stringify(sends.at(-1)?.content || {})
if (!serialized.includes('abraçou') || !serialized.includes(alice) || !serialized.includes(bob)) throw new Error('ação social perdeu texto ou menções')

await rentals.execute({ sock, msg: msg(alice, '.c 2h', 'SOC-UI-9'), args: ['2h'], text: '.c 2h', settings, senderNumber: alice, isOwner: true, isSubowner: false, role: 'owner', isGroup: true, logger })
if (!JSON.stringify(sends.at(-1)?.content || {}).includes('2 horas')) throw new Error('contrato personalizado não apareceu')
await rentals.execute({ sock, msg: msg(alice, '.c renovar 45min', 'SOC-UI-10'), args: ['renovar', '45min'], text: '.c renovar 45min', settings, senderNumber: alice, isOwner: true, isSubowner: false, role: 'owner', isGroup: true, logger })
if (!JSON.stringify(sends.at(-1)?.content || {}).includes('renovado')) throw new Error('renovação de contrato não respondeu')

await vip.execute({ sock, msg: msg(alice, `.vip 2h ${bob}`, 'SOC-UI-11'), args: ['2h', bob], text: `.vip 2h ${bob}`, settings, senderNumber: alice, isOwner: true, isSubowner: false, role: 'owner', logger })
if (!JSON.stringify(sends.at(-1)?.content || {}).includes('2 horas')) throw new Error('VIP personalizado não apareceu')

await ranks.execute({ sock, msg: msg(alice, '.rankcasais', 'SOC-UI-12'), text: '.rankcasais', settings, chatNumber: chat.replace(/\D/g, ''), logger })
serialized = JSON.stringify(relays.at(-1)?.message || {})
if (!serialized.includes('CASAIS MAIS ANTIGOS') || !serialized.includes('Alice') || !serialized.includes('Bruno')) throw new Error('ranking de casais incompleto')
await ranks.execute({ sock, msg: msg(alice, '.rankfamilias', 'SOC-UI-13'), text: '.rankfamilias', settings, chatNumber: chat.replace(/\D/g, ''), logger })
if (!JSON.stringify(relays.at(-1)?.message || {}).includes('MAIORES FAMÍLIAS')) throw new Error('ranking de famílias não carregou')
await ranks.execute({ sock, msg: msg(alice, '.rankacoes', 'SOC-UI-14'), text: '.rankacoes', settings, chatNumber: chat.replace(/\D/g, ''), logger })
if (!JSON.stringify(relays.at(-1)?.message || {}).includes('MAIS CARINHOSOS')) throw new Error('ranking de ações não carregou')

await actionMedia.execute({ sock, msg: msg(alice, '.acaomedia', 'SOC-UI-15'), args: [], text: '.acaomedia', invokedAs: 'acaomedia', settings, senderNumber: alice, logger })
if (!JSON.stringify(relays.at(-1)?.message || {}).includes('MÍDIAS DAS AÇÕES')) throw new Error('painel de mídia das ações não carregou')

const commands = await loadCommands(logger)
for (const alias of ['namorar', 'casar', 'adotar', 'beijar', 'acaomedia', 'rankcasais', 'rankfamilias', 'rankacoes']) {
  if (!commands.has(alias)) throw new Error(`alias da Parte 5 ausente: ${alias}`)
}

closeSocialStore()
closeCoreStore()
fs.rmSync(temporary, { recursive: true, force: true })
console.log('✅ Interface Parte 5: pedidos, família, ações, contratos, VIP, rankings e menus aprovados')
