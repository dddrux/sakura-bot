import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'sakura-v101-'))
process.env.SAKURA_CONFIG_DB = path.join(temp, 'bot.db')
process.env.SAKURA_CORE_DB = path.join(temp, 'core.db')
process.env.LOG_LEVEL = 'info'

const { initializeCoreStore, closeCoreStore, getRememberedUser } = await import('../core-store.js')
const { installMentionResolver, resolveMentionIdentities } = await import('../mentions.js')
const { groupNameMap, formatMentionName } = await import('../user-display.js')
initializeCoreStore()

const group = '120363000000000000@g.us'
const metadata = {
  subject: 'Grupo de teste',
  participants: [
    {
      id: '123456789012345@lid',
      lid: '123456789012345@lid',
      phoneNumber: '558199999999@s.whatsapp.net',
      notify: 'Maria'
    },
    {
      id: '558188888888@s.whatsapp.net',
      phoneNumber: '558188888888@s.whatsapp.net',
      notify: 'João'
    }
  ]
}

const sends = []
const relays = []
const sock = {
  user: { id: '558177777777@s.whatsapp.net' },
  groupMetadata: async () => metadata,
  sakuraGetGroupMetadata: async () => ({ metadata, source: 'test', cacheHit: true }),
  sakuraResolveNumber: async jid => jid.includes('123456789012345') ? '558199999999' : String(jid).replace(/\D/g, ''),
  sendMessage: async (jid, content, options) => { sends.push({ jid, content, options }); return { key: { id: 'S1' } } },
  relayMessage: async (jid, message, options) => { relays.push({ jid, message, options }); return 'R1' }
}
installMentionResolver(sock)

await sock.sendMessage(group, {
  text: 'Olá @558199999999',
  mentions: ['558199999999@s.whatsapp.net']
})
assert.deepEqual(sends[0].content.mentions, ['558199999999@s.whatsapp.net'])
assert.match(sends[0].content.text, /@558199999999/)
assert.doesNotMatch(sends[0].content.text, /@123456789012345/)

await sock.sendMessage(group, {
  text: 'Olá @123456789012345',
  mentions: ['123456789012345@lid']
})
assert.deepEqual(sends[1].content.mentions, ['558199999999@s.whatsapp.net'])
assert.equal(sends[1].content.text, 'Olá @558199999999')

const relayPayload = {
  viewOnceMessage: {
    message: {
      messageContextInfo: { mentionedJid: ['558199999999@s.whatsapp.net'] },
      interactiveMessage: { body: { text: 'Ranking: @558199999999' } }
    }
  }
}
await sock.relayMessage(group, relayPayload, { messageId: 'TEST' })
assert.deepEqual(relays[0].message.viewOnceMessage.message.messageContextInfo.mentionedJid, ['558199999999@s.whatsapp.net'])

const identities = await resolveMentionIdentities(sock, group, ['558199999999@s.whatsapp.net'])
assert.equal(identities[0].number, '558199999999')
assert.equal(identities[0].mentionJid, '558199999999@s.whatsapp.net')

const names = await groupNameMap(sock, group, metadata)
assert.equal(names.get('558199999999').jid, '123456789012345@lid')
assert.equal(names.get('558199999999').mentionJid, '558199999999@s.whatsapp.net')
assert.equal(formatMentionName(names.get('558199999999')), 'Maria (@558199999999)')
const remembered = getRememberedUser('558199999999')
assert.equal(remembered.lidJid, '123456789012345@lid')
assert.equal(remembered.phoneJid, '558199999999@s.whatsapp.net')

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..')
const lockText = await fs.readFile(path.join(root, 'package-lock.json'), 'utf8')
assert.doesNotMatch(lockText, /internal\.api\.openai\.org|applied-caas-gateway/i)
const packageJson = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'))
assert.equal(packageJson.version, '1.2.3')
assert.equal(packageJson.dependencies['link-preview-js'], undefined)
const settingsSource = await fs.readFile(path.join(root, 'data', 'settings.js'), 'utf8')
assert.match(settingsSource, /process\.env\.LOG_LEVEL \|\| 'info'/)
const clientSource = await fs.readFile(path.join(root, 'data', 'client.js'), 'utf8')
assert.match(clientSource, /installMentionResolver\(socket/)
const interactiveSource = await fs.readFile(path.join(root, 'data', 'interactive.js'), 'utf8')
assert.match(interactiveSource, /🧮 Calculadora/)
assert.doesNotMatch(interactiveSource, /Calculadora segura/)
const installSource = await fs.readFile(path.join(root, 'install.sh'), 'utf8')
assert.match(installSource, /npm ci --omit=dev --include=optional/)
assert.match(installSource, /npm run doctor/)
assert.doesNotMatch(installSource, /yt-dlp|pip install/)
const signalSource = await fs.readFile(path.join(root, 'data', 'signal-repair.js'), 'utf8')
assert.match(signalSource, /signal-repair-v3/)
const handlerSource = await fs.readFile(path.join(root, 'data', 'handler.js'), 'utf8')
assert.match(handlerSource, /scope: 'MESSAGES'/)
assert.match(handlerSource, /senderName/)
assert.match(handlerSource, /senderJid/)

closeCoreStore()
await fs.rm(temp, { recursive: true, force: true })
console.log('✅ v1.0.1: PN real no campo de menção, LID apenas como alias/rota, números normais e terminal aprovados')
