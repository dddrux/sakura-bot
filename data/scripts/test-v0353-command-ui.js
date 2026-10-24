import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'sakura-v0353-ui-'))
process.env.SAKURA_CORE_DB = path.join(temporary, 'core.db')
process.env.SAKURA_ECONOMY_DB = path.join(temporary, 'economy.db')

const { default: economyCommand } = await import('../../commands/economy.js')
const { default: ranksCommand } = await import('../../commands/ranks.js')
const { closeCoreStore } = await import('../core-store.js')
const { openDatabase } = await import('../database.js')

const chat = '120363035300000099@g.us'
const alice = '5581999993901'
const metadata = {
  id: chat,
  participants: [{ id: `${alice}@s.whatsapp.net`, notify: 'Alice Sakura', admin: 'admin' }]
}
const relays = []
const sends = []
const sock = {
  user: { id: '558193775177@s.whatsapp.net' },
  async relayMessage(jid, message, options) {
    relays.push({ jid, message, options })
  },
  async sendMessage(jid, content, options) {
    sends.push({ jid, content, options })
    return { key: { id: `SEND-${sends.length}` } }
  },
  async groupMetadata() { return metadata },
  async profilePictureUrl() { throw new Error('sem foto no teste') }
}
const logger = new Proxy({}, { get: () => () => {} })
const settings = { prefix: '.', botNumber: '558193775177', menuLogoPath: path.join(process.cwd(), 'assets', 'logo.jpg') }

function message(command, id) {
  return {
    key: { remoteJid: chat, participant: `${alice}@s.whatsapp.net`, id },
    message: { conversation: command },
    pushName: 'Alice Sakura'
  }
}

async function execute(command, id, { admin = false } = {}) {
  const msg = message(command, id)
  const raw = command.slice(1).trim()
  const args = raw.split(/\s+/).slice(1)
  return economyCommand.execute({
    sock,
    msg,
    args,
    rawArgs: args.join(' '),
    text: command,
    settings,
    senderNumber: alice,
    chatNumber: chat,
    isGroup: true,
    isAdmin: admin,
    logger,
    metadata
  })
}

for (const [index, command] of ['.investimentos', '.pets', '.casa', '.economiagrupo'].entries()) {
  await execute(command, `UI-${index + 1}`, { admin: true })
}

if (relays.length !== 4) throw new Error(`painéis da Parte 3 esperavam 4 relays, receberam ${relays.length}`)
const serialized = JSON.stringify(relays.map(entry => entry.message))
for (const required of ['.investir conservador 500', '.comprarpet momo', '.comprarcasa cabana', '.limitepetalas 100000']) {
  if (!serialized.includes(required)) throw new Error(`painel não contém a ação ${required}`)
}

const aliases = new Set([economyCommand.name, ...(economyCommand.aliases || [])])
for (const required of ['investimentos', 'ofertar', 'minhaloja', 'pets', 'casa', 'economiagrupo']) {
  if (!aliases.has(required)) throw new Error(`alias econômico ausente: ${required}`)
}
const rankAliases = new Set([ranksCommand.name, ...(ranksCommand.aliases || [])])
for (const required of ['rankinvestidores', 'rankvendedores', 'ranklojas', 'rankpets', 'rankcasas']) {
  if (!rankAliases.has(required)) throw new Error(`alias de ranking ausente: ${required}`)
}

const economyStore = openDatabase(process.env.SAKURA_ECONOMY_DB, {})
economyStore.close()
closeCoreStore()
fs.rmSync(temporary, { recursive: true, force: true })
console.log('✅ Parte 3 UI: painéis Native Flow, ações, aliases econômicos e rankings aprovados')
