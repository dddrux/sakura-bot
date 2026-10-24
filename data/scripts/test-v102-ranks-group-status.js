import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'sakura-v102-'))

const { initializeCoreStore, closeCoreStore, getRememberedUserByIdentity } = await import('../core-store.js')
const { groupNameMap, displayUser, formatMentionName } = await import('../user-display.js')
const { generateWAMessageContent } = await import('@sakura-md/baileys')
const ranks = (await import('../../commands/ranks.js')).default
const statusModule = await import('../../commands/group-status.js')
const statusCommand = statusModule.default
const { settings } = await import('../settings.js')

initializeCoreStore()

const group = '120363000000000000@g.us'
const lid = '123456789012345@lid'
const phone = '558199999999@s.whatsapp.net'
const metadata = {
  id: group,
  subject: 'Grupo de teste',
  participants: [{ id: lid, lid, jid: phone, phoneNumber: phone, notify: 'Maria' }]
}
const relays = []
const sock = {
  user: { id: '558177777777@s.whatsapp.net' },
  groupMetadata: async () => metadata,
  sakuraGetGroupMetadata: async () => ({ metadata, source: 'test' }),
  sakuraResolveNumber: async value => String(value).includes('123456789012345') ? '558199999999' : String(value).replace(/\D/g, ''),
  relayMessage: async (jid, message, options) => { relays.push({ jid, message, options }); return 'R1' }
}

const names = await groupNameMap(sock, group, metadata)
const byLidDigits = displayUser('123456789012345', names)
assert.equal(byLidDigits.number, '558199999999')
assert.equal(byLidDigits.name, 'Maria')
assert.equal(byLidDigits.mentionJid, phone)
assert.equal(formatMentionName(byLidDigits), 'Maria (@558199999999)')
assert.doesNotMatch(formatMentionName(byLidDigits), /123456789012345/)
assert.equal(getRememberedUserByIdentity(lid)?.number, '558199999999')
assert.equal(getRememberedUserByIdentity('123456789012345')?.number, '558199999999')

await ranks.execute({
  sock,
  msg: { key: { remoteJid: group, id: 'RANK-V102' } },
  text: '.rankgay',
  settings,
  chatNumber: '120363000000000000',
  logger: new Proxy({}, { get: () => () => {} })
})
const inner = relays[0]?.message?.viewOnceMessage?.message
const body = inner?.interactiveMessage?.body?.text || ''
const mentions = inner?.interactiveMessage?.contextInfo?.mentionedJid || []
assert.match(body, /Maria \(@558199999999\)/)
assert.doesNotMatch(body, /123456789012345/)
assert.deepEqual(mentions, [phone])
assert.deepEqual(inner?.messageContextInfo?.mentionedJid || [], [phone])

const wrapped = await generateWAMessageContent(
  { text: 'Status do grupo', groupStatus: true },
  { jid: group, logger: { child: () => ({}) } }
)
assert.equal(wrapped?.groupStatusMessageV2?.message?.extendedTextMessage?.text, 'Status do grupo')
assert.equal(wrapped?.groupStatusMessageV2?.message?.extendedTextMessage?.contextInfo?.isGroupStatus, true)
assert.ok(Buffer.isBuffer(wrapped?.messageContextInfo?.messageSecret))
assert.ok(Buffer.isBuffer(wrapped?.groupStatusMessageV2?.message?.messageContextInfo?.messageSecret))
assert.deepEqual(wrapped.messageContextInfo.messageSecret, wrapped.groupStatusMessageV2.message.messageContextInfo.messageSecret)

assert.equal(statusCommand.name, 'statusgp')
assert.equal(statusCommand.groupOnly, true)
assert.equal(statusCommand.adminOnly, true)
assert.ok(statusCommand.aliases.includes('statusgrupo'))
assert.equal(typeof statusModule.sendGroupStatusBroadcast, 'function')

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..')
const packageJson = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'))
assert.equal(packageJson.version, '1.2.3')
const source = await fs.readFile(path.join(root, 'commands', 'group-status.js'), 'utf8')
assert.match(source, /sendGroupStatusBroadcast/)
assert.match(source, /sendZenkGroupStatus/)
assert.match(source, /groupStatusMessageV2/)
assert.match(source, /normalizeStatusVideo/)

closeCoreStore()
await fs.rm(temp, { recursive: true, force: true })
console.log('✅ v1.0.2 acumulativa: aliases LID/PN e compatibilidade do status groupStatusMessageV2 aprovados')
