import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'sakura-v0354-ui-'))
process.env.SAKURA_CORE_DB = path.join(temporary, 'core.db')
process.env.SAKURA_ECONOMY_DB = path.join(temporary, 'economy.db')

const { default: pvp } = await import('../../commands/pvp.js')
const { default: ranks } = await import('../../commands/ranks.js')
const { closeCoreStore } = await import('../core-store.js')
const { openDatabase } = await import('../database.js')

const relays = []
const chat = '120363454545454545@g.us'
const chatNumber = chat.replace(/\D/g, '')
const alice = '5581999994101'
const bob = '5581999994102'
const metadata = {
  id: chat,
  participants: [
    { id: `${alice}@s.whatsapp.net`, notify: 'Alice' },
    { id: `${bob}@s.whatsapp.net`, notify: 'Bruno' }
  ]
}
const sock = {
  user: { id: '558193775177@s.whatsapp.net' },
  async relayMessage(jid, message, options) { relays.push({ jid, message, options }) },
  async groupMetadata() { return metadata }
}
const logger = new Proxy({}, { get: () => () => {} })
const settings = { prefix: '.', botNumber: '558193775177' }
const message = (sender, text, id) => ({
  key: { remoteJid: chat, participant: `${sender}@s.whatsapp.net`, id },
  message: { conversation: text },
  pushName: sender === alice ? 'Alice' : 'Bruno'
})

await pvp.execute({ sock, msg: message(alice, `.pvp ${bob}`, 'PVP4-1'), args: [bob], senderNumber: alice, chatNumber, settings, logger, metadata, invokedAs: 'pvp' })
if (relays.length !== 1) throw new Error('convite PVP v2 não foi enviado')
const invite = JSON.stringify(relays[0].message)
const id = invite.match(/PVP-[A-Z0-9-]+/)?.[0]
if (!id) throw new Error('ID do convite PVP não foi inserido nos botões')
if (!invite.includes('rating') || !invite.includes('vida') || !invite.includes('poder estimado')) throw new Error('prévia do duelo não mostrou novos atributos')
if (!invite.includes(`.pvp cancelar ${id}`)) throw new Error('botão de cancelamento não foi incluído')

await pvp.execute({ sock, msg: message(bob, `.pvp aceitar ${id}`, 'PVP4-2'), args: ['aceitar', id], senderNumber: bob, chatNumber, settings, logger, metadata, invokedAs: 'pvp' })
if (relays.length !== 2) throw new Error('resultado PVP v2 não foi enviado')
const result = JSON.stringify(relays[1].message)
if (!result.includes('RESULTADO DA BATALHA') || !result.includes('R1:') || !result.includes('rating')) throw new Error('resultado não exibiu rodadas e rating')
if (!result.includes('Alice') || !result.includes('Bruno')) throw new Error('resultado perdeu os nomes do grupo')

await pvp.execute({ sock, msg: message(alice, '.pvp atributos', 'PVP4-3'), args: ['atributos'], senderNumber: alice, chatNumber, settings, logger, metadata, invokedAs: 'pvp' })
const attributes = JSON.stringify(relays.at(-1).message)
if (!attributes.includes('ATRIBUTOS PVP') || !attributes.includes('chance de crítico') || !attributes.includes('nível de arena')) throw new Error('painel de atributos PVP incompleto')

await ranks.execute({ sock, msg: message(alice, '.rankarena', 'PVP4-4'), text: '.rankarena', settings, chatNumber, logger })
const ratingRank = JSON.stringify(relays.at(-1).message)
if (!ratingRank.includes('RATING DA ARENA') || !ratingRank.includes('pontos')) throw new Error('ranking de rating não carregou')

await ranks.execute({ sock, msg: message(alice, '.rankdano', 'PVP4-5'), text: '.rankdano', settings, chatNumber, logger })
const damageRank = JSON.stringify(relays.at(-1).message)
if (!damageRank.includes('DANO TOTAL PVP') || !damageRank.includes('maior golpe')) throw new Error('ranking de dano não carregou')

const economyStore = openDatabase(process.env.SAKURA_ECONOMY_DB, {})
economyStore.close()
closeCoreStore()
fs.rmSync(temporary, { recursive: true, force: true })
console.log('✅ Interface Parte 4: prévia, rodadas, atributos e rankings PVP aprovados')
