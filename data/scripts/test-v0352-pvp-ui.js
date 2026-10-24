import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'sakura-v0352-ui-'))
process.env.SAKURA_CORE_DB = path.join(temporary, 'core.db')
process.env.SAKURA_ECONOMY_DB = path.join(temporary, 'economy.db')

const { default: pvp } = await import('../../commands/pvp.js')
const { closeCoreStore } = await import('../core-store.js')
const { openDatabase } = await import('../database.js')

const relays = []
const chat = '120363777777777777@g.us'
const alice = '5581999991001'
const bob = '5581999991002'
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
const msg = { key: { remoteJid: chat, participant: `${alice}@s.whatsapp.net`, id: 'PVP-UI-1' }, message: { conversation: `.pvp ${bob}` }, pushName: 'Alice' }
const settings = { prefix: '.', botNumber: '558193775177' }

await pvp.execute({ sock, msg, args: [bob], senderNumber: alice, chatNumber: chat.replace(/\D/g, ''), settings, logger, metadata })
if (relays.length !== 1) throw new Error('convite PVP não foi enviado')
const serialized = JSON.stringify(relays[0].message)
if (!serialized.includes('.pvp aceitar PVP-') || !serialized.includes('.pvp recusar PVP-')) throw new Error('convite PVP não contém aceite e recusa nativos')
if (!serialized.includes('Alice') || !serialized.includes('Bruno')) throw new Error('convite PVP não usou nomes do grupo')

const economyStore = openDatabase(process.env.SAKURA_ECONOMY_DB, {})
economyStore.close()
closeCoreStore()
fs.rmSync(temporary, { recursive: true, force: true })
console.log('✅ Interface PVP: desafio no grupo, nomes, menções e aceite/recusa Native Flow aprovados')
