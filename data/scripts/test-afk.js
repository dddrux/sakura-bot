import { createMessageHandler } from '../handler.js'
import { getAfk, removeAfk } from '../afk.js'
import { setRental, removeRental } from '../rentals.js'

const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`
const chatNumber = `120363${stamp.slice(-12)}`
const chatJid = `${chatNumber}@g.us`
const userA = `55119${stamp.slice(-8)}`
const userB = `55819${stamp.slice(-8)}`
const userC = `55719${stamp.slice(-8)}`
const jidA = `${userA}@s.whatsapp.net`
const jidB = `${userB}@s.whatsapp.net`
const jidC = `${userC}@s.whatsapp.net`
const botJid = '5581999999999@s.whatsapp.net'
const sent = []
const fakeLogger = new Proxy({}, { get: () => () => {} })

const sock = {
  user: { id: botJid },
  sakuraResolveNumber: async jid => String(jid).split('@')[0].split(':')[0].replace(/\D/g, ''),
  groupMetadata: async () => ({
    id: chatJid,
    subject: 'Teste AFK Sakura',
    participants: [
      { id: jidA },
      { id: jidB, admin: 'admin' },
      { id: jidC },
      { id: botJid, admin: 'admin' }
    ]
  }),
  sendMessage: async (jid, content, options) => {
    sent.push({ jid, content, options })
    return { key: { id: `AFK-SENT-${sent.length}`, remoteJid: jid }, message: content }
  }
}

let sequence = 0
function incoming(senderJid, text, contextInfo) {
  sequence += 1
  const key = { id: `AFK-IN-${stamp}-${sequence}`, remoteJid: chatJid, participant: senderJid, fromMe: false }
  if (contextInfo) return { key, pushName: `Pessoa ${sequence}`, message: { extendedTextMessage: { text, contextInfo } } }
  return { key, pushName: `Pessoa ${sequence}`, message: { conversation: text } }
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

const handler = await createMessageHandler(sock, fakeLogger)
await setRental(chatJid, 1, false)

try {
  await handler(incoming(jidA, '.afk almoço'), 'notify')
  assert(sent.some(item => /MODO AFK/.test(item.content?.text || '') && /almoço/.test(item.content?.text || '')), 'ativação AFK não foi enviada')
  assert(await getAfk(chatNumber, userA), 'AFK não foi persistido')

  sent.length = 0
  await handler(incoming(jidB, 'ei, volta aí', { mentionedJid: [jidA] }), 'notify')
  assert(sent.some(item => /USUÁRIO AFK/.test(item.content?.text || '') && /almoço/.test(item.content?.text || '')), 'menção não avisou que o usuário está AFK')

  sent.length = 0
  await handler(incoming(jidC, '.afk estudando'), 'notify')
  assert(await getAfk(chatNumber, userC), 'segundo AFK não foi persistido')
  sent.length = 0
  await handler(incoming(jidB, 'responde aqui', {
    stanzaId: 'QUOTED-C',
    participant: jidC,
    quotedMessage: { conversation: 'mensagem antiga' }
  }), 'notify')
  assert(sent.some(item => /USUÁRIO AFK/.test(item.content?.text || '') && /estudando/.test(item.content?.text || '')), 'resposta citada não avisou que o usuário está AFK')
  assert(await getAfk(chatNumber, userC), 'AFK desapareceu ao responder uma mensagem do usuário')
  await handler(incoming(jidC, 'voltei também'), 'notify')
  assert(!(await getAfk(chatNumber, userC)), 'segundo AFK não saiu automaticamente')

  sent.length = 0
  await handler(incoming(jidA, 'voltei sem usar comando'), 'notify')
  assert(sent.some(item => /BEM-VINDO\(A\) DE VOLTA/.test(item.content?.text || '')), 'mensagem comum não removeu AFK automaticamente')
  assert(!(await getAfk(chatNumber, userA)), 'AFK continuou ativo após nova mensagem')

  sent.length = 0
  await handler(incoming(jidA, '.afk @pessoa', { mentionedJid: [jidC] }), 'notify')
  assert(sent.some(item => /AFK é individual/.test(item.content?.text || '')), 'AFK com menção não foi recusado')
  assert(!(await getAfk(chatNumber, userA)), 'AFK recusado foi salvo indevidamente')

  sent.length = 0
  await handler(incoming(jidA, '.ausente estudando'), 'notify')
  assert(await getAfk(chatNumber, userA), 'alias .ausente não ativou AFK')
  await handler(incoming(jidA, '.afk off'), 'notify')
  assert(!(await getAfk(chatNumber, userA)), '.afk off não desativou o estado')

  console.log('✅ AFK Sakura: ativação, persistência, menção, resposta, saída automática, alias e off validados')
} finally {
  await removeRental(chatJid)
  await Promise.all([
    removeAfk(chatNumber, userA),
    removeAfk(chatNumber, userB),
    removeAfk(chatNumber, userC)
  ])
}
