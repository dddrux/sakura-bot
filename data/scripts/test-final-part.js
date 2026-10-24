import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sakura-final-test-'))
process.env.SAKURA_CONFIG_DB = path.join(root, 'bot.db')
process.env.SAKURA_AUTOMATION_DB = path.join(root, 'automation.db')
process.env.SAKURA_PROTECTION_DB = path.join(root, 'protection.db')
process.env.SAKURA_COMMAND_MEDIA_DB = path.join(root, 'command-media.db')
process.env.SAKURA_COMMAND_MEDIA_DIR = path.join(root, 'command-media')

const funModule = await import('../../commands/fun.js')
const { TRAITS } = funModule
assert(!funModule.default.aliases.includes('beijo'), 'alias .beijo deve continuar compatível com a ação social')
const requiredTraits = [
  'gay', 'corno', 'lesbica', 'rico', 'pobre', 'gostoso', 'feio', 'casavel', 'otaku', 'fedido',
  'inteligente', 'sortudo', 'azarado', 'beijo', 'flerte', 'talarico', 'mentiroso', 'fofo', 'carente',
  'lindo', 'chato', 'burro', 'viciado', 'fitness', 'nerd', 'emo', 'gamer', 'safado', 'romantico',
  'feliz', 'estressado', 'bebado', 'engracado', 'dorminhoco', 'preguicoso', 'rei', 'rainha',
  'bonito', 'simpatico', 'ciumento', 'briguento', 'calmo', 'doido', 'famoso', 'poderoso'
]
for (const name of requiredTraits) assert(TRAITS[name], `comando de brincadeira ausente: ${name}`)
assert(Object.keys(TRAITS).length >= 100, 'catálogo final precisa ter pelo menos 100 testes percentuais')
const actionsSource = await fs.readFile(new URL('../../commands/actions.js', import.meta.url), 'utf8')
assert(/aliases:\s*\[[^\]]*['"]beijo['"]/.test(actionsSource), 'ação social .beijo precisa permanecer registrada')

const media = await import('../fun-media-store.js')
assert.throws(() => media.parseRemoteMediaUrl('file:///etc/passwd'), /HTTP ou HTTPS/)
assert.throws(() => media.parseRemoteMediaUrl('http://127.0.0.1/media.gif'), /privado|reservado/)
assert.throws(() => media.parseRemoteMediaUrl('http://localhost/media.gif'), /local/)
assert(media.isBlockedAddress('10.0.0.1'))
assert(media.isBlockedAddress('::1'))
assert(!media.isBlockedAddress('1.1.1.1'))
assert.equal(media.parseRemoteMediaUrl('https://example.com/media.gif').protocol, 'https:')
let permission = media.setGroupMediaAdminPermission('120363000000@g.us', true, '558199999999')
assert(permission.enabled)
permission = media.setGroupMediaAdminPermission('120363000000@g.us', false, '558199999999')
assert(!permission.enabled)

const automation = await import('../automation-store.js')
const chat = '120363111111@g.us'
let config = automation.updateAutomationConfig(chat, {
  quietHoursEnabled: true,
  quietHoursStart: '22:00',
  quietHoursEnd: '07:00',
  quietHoursTimezone: 'America/Recife'
})
assert(automation.isQuietHoursActive(config, new Date('2026-07-24T02:00:00-03:00')))
assert(!automation.isQuietHoursActive(config, new Date('2026-07-24T12:00:00-03:00')))

const protection = await import('../private-protection.js')
const jid = '558198888888@s.whatsapp.net'
let attempt = protection.registerPrivateAttempt(jid, 'message')
assert.equal(attempt.attempts, 1)
protection.registerPrivateAttempt(jid, 'message')
attempt = protection.registerPrivateAttempt(jid, 'message')
assert(attempt.shouldBlock)
protection.addPrivateProtectionAllow(jid, '558199999999')
assert(protection.isPrivateProtectionAllowed(jid))
assert.equal(protection.removePrivateProtectionAllow(jid), 1)

const queue = await import('../bulk-send-queue.js')
queue.setBulkSendQueuePaused(true)
const queued = queue.enqueueBulkSend(async () => true, { key: 'final:test', chat }).catch(error => error.code)
assert.equal(queue.bulkSendQueueStatus().pending, 1)
assert.equal(queue.cancelBulkSendJobs('final:test'), 1)
assert.equal(await queued, 'BULK_QUEUE_CANCELLED')
queue.setBulkSendQueuePaused(false)

media.closeCommandMediaStore()
automation.closeAutomationStore()
protection.closePrivateProtectionStore()
await fs.rm(root, { recursive: true, force: true })
console.log(`✅ Parte final validada: ${Object.keys(TRAITS).length} brincadeiras, SSRF, permissões, silêncio, proteções e fila.`)
