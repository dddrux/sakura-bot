import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'sakura-v0358-'))
process.env.SAKURA_AUTOMATION_DB = path.join(temp, 'automation.db')
process.env.SAKURA_RENTAL_DB = path.join(temp, 'rentals.db')
process.env.SAKURA_CORE_DB = path.join(temp, 'core.db')
process.env.WELCOME_BATCH_MS = '1500'

const {
  getAutomationConfig,
  updateAutomationConfig,
  reserveTikTokUrl,
  checkCommandFlood,
  claimDailyRun,
  clearFloodState,
  getAutomationStatus,
  closeAutomationStore
} = await import('../automation-store.js')
const { setRentalDuration } = await import('../rentals.js')
const { handleGroupParticipantsUpdate, stopGroupAutomationScheduler, testDailyAutomationNow } = await import('../group-automations.js')

const assert = (condition, message) => { if (!condition) throw new Error(message) }
const chat = '120363000000000000@g.us'
const user = '5581999999999'

const defaults = getAutomationConfig(chat)
assert(defaults.welcomeEnabled === false, 'boas-vindas devem iniciar desligadas')
assert(defaults.antifloodEnabled === true, 'antiflood deve iniciar ligado')

const configured = updateAutomationConfig(chat, {
  welcomeEnabled: true,
  welcomeMessage: 'Leia as regras.',
  tiktokAutoEnabled: true,
  dailyEnabled: true,
  dailyTime: '08:15',
  dailyTimezone: 'America/Recife',
  dailyAudioPath: 'off',
  antifloodWindowMs: 10_000,
  antifloodUserLimit: 3,
  antifloodGroupLimit: 50,
  antifloodBaseBlockMs: 5_000
})
assert(configured.dailyTime === '08:15' && configured.tiktokAutoEnabled, 'configuração não persistiu')
assert(reserveTikTokUrl(chat, 'https://www.tiktok.com/@x/video/1') === true, 'primeiro TikTok deveria ser reservado')
assert(reserveTikTokUrl(chat, 'https://www.tiktok.com/@x/video/1') === false, 'TikTok repetido deveria ser bloqueado')
assert(claimDailyRun(chat, '2026-07-19') === true, 'primeira rotina deveria ser reivindicada')
assert(claimDailyRun(chat, '2026-07-19') === false, 'rotina duplicada deveria ser bloqueada')

assert(checkCommandFlood({ chat, user, role: 'member', cost: 1 }).allowed, 'comando 1 deveria passar')
assert(checkCommandFlood({ chat, user, role: 'member', cost: 1 }).allowed, 'comando 2 deveria passar')
assert(checkCommandFlood({ chat, user, role: 'member', cost: 1 }).allowed, 'comando 3 deveria passar')
const warning = checkCommandFlood({ chat, user, role: 'member', cost: 1 })
assert(!warning.allowed && warning.warning && !warning.blocked, 'primeiro excesso deveria apenas avisar')
assert(checkCommandFlood({ chat, user, role: 'member', cost: 1 }).allowed, 'comando após aviso deveria ter pequena margem')
const blocked = checkCommandFlood({ chat, user, role: 'member', cost: 1 })
assert(!blocked.allowed && blocked.blocked && blocked.remainingMs > 0, 'reincidência deveria bloquear')
assert(checkCommandFlood({ chat, user: '5581888888888', role: 'owner', cost: 10 }).allowed, 'dono precisa ser imune')
clearFloodState(chat)

await setRentalDuration(chat, { permanent: true, ms: 0 }, '558199434137')
const sent = []
const sock = {
  user: { id: '558193775177@s.whatsapp.net' },
  async profilePictureUrl() { throw new Error('privada') },
  async groupMetadata() {
    return { participants: [
      { id: '558193775177@s.whatsapp.net' },
      { id: '5581111111111@s.whatsapp.net' },
      { id: '5581222222222@s.whatsapp.net' }
    ] }
  },
  async sendMessage(jid, content) { sent.push({ jid, content }); return { key: { id: `sent-${sent.length}` } } }
}
handleGroupParticipantsUpdate(sock, { id: chat, action: 'add', participants: ['5581111111111@s.whatsapp.net'] })
handleGroupParticipantsUpdate(sock, { id: chat, action: 'add', participants: ['5581222222222@s.whatsapp.net'] })
await new Promise(resolve => setTimeout(resolve, 1700))
assert(sent.length === 1, `boas-vindas deveriam ser agrupadas em uma mensagem, recebidas: ${sent.length}`)
assert(sent[0].content.mentions.length === 2, 'boas-vindas deveriam mencionar os dois membros')

sent.length = 0
const test = await testDailyAutomationNow(sock, chat)
assert(test.participants === 2, 'rotina deve excluir o próprio bot das marcações')
assert(sent.length === 1 && sent[0].content.mentions.length === 2, 'teste diário deveria enviar marcações em lote')

const status = getAutomationStatus()
assert(status.groups === 1 && status.welcomes === 1 && status.daily === 1, 'status das automações incorreto')
stopGroupAutomationScheduler()
closeAutomationStore()
await fs.rm(temp, { recursive: true, force: true })
console.log('✅ Parte 8: boas-vindas agrupadas, deduplicação TikTok, rotina persistente e antiflood progressivo aprovados')
