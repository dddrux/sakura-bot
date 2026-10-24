import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'sakura-v103-'))

const { initializeCoreStore, closeCoreStore, rememberUser, getRememberedUserByIdentity } = await import('../core-store.js')
const { resolveMentionIdentities } = await import('../mentions.js')
const { groupNameMap, displayUser } = await import('../user-display.js')
const ranks = (await import('../../commands/ranks.js')).default
const { sendGroupStatusBroadcast } = await import('../../commands/group-status.js')
const { settings } = await import('../settings.js')

initializeCoreStore()

const group = '120363999999999999@g.us'
const lid = '111222333444555@lid'
const phone = '558198765432@s.whatsapp.net'
const metadata = {
  id: group,
  subject: 'Teste real de menção',
  participants: [{ id: lid, lid, jid: phone, participantPn: phone, notify: 'João' }]
}
const relays = []
const sends = []
const sock = {
  user: { id: '558177777777@s.whatsapp.net' },
  waUploadToServer: async () => { throw new Error('upload não deveria ser usado no status textual') },
  groupMetadata: async () => metadata,
  sakuraGetGroupMetadata: async () => ({ metadata, source: 'test-v103' }),
  sakuraResolveNumber: async value => String(value).includes('111222333444555') ? '558198765432' : String(value).replace(/\D/g, ''),
  relayMessage: async (jid, message, options) => { relays.push({ jid, message, options }); return options?.messageId || 'relay-v103' },
  sendMessage: async (jid, content, options) => { sends.push({ jid, content, options }); return { key: { id: 'STATUS-V103', remoteJid: jid }, message: { groupStatusMessageV2: { message: { extendedTextMessage: { text: content.text, contextInfo: { isGroupStatus: true } } } } } } }
}

// Simula um diretório antigo que guardava LID como mentionedJid; a resolução nova precisa corrigi-lo.
rememberUser({
  number: '558198765432',
  jid: lid,
  mentionJid: lid,
  phoneJid: phone,
  lidJid: lid,
  name: 'João',
  source: 'legacy-test'
})
const remembered = getRememberedUserByIdentity(lid)
assert.equal(remembered.phoneJid, phone)

const identities = await resolveMentionIdentities(sock, group, [lid], { metadata })
assert.equal(identities[0].number, '558198765432')
assert.equal(identities[0].phoneJid, phone)
assert.equal(identities[0].mentionJid, phone)

const names = await groupNameMap(sock, group, metadata)
assert.equal(displayUser(lid, names).mentionJid, phone)
assert.equal(displayUser('111222333444555', names).mentionJid, phone)

await ranks.execute({
  sock,
  msg: { key: { remoteJid: group, id: 'RANK-V103' } },
  text: '.rankgay',
  settings,
  chatNumber: '120363999999999999',
  logger: new Proxy({}, { get: () => () => {} })
})
const rankRelay = relays.shift()
const viewOnce = rankRelay?.message?.viewOnceMessage?.message
assert.match(viewOnce?.interactiveMessage?.body?.text || '', /João \(@558198765432\)/)
assert.deepEqual(viewOnce?.interactiveMessage?.contextInfo?.mentionedJid || [], [phone])
assert.deepEqual(viewOnce?.messageContextInfo?.mentionedJid || [], [phone])
assert.ok(!(viewOnce?.interactiveMessage?.contextInfo?.mentionedJid || []).includes(lid))

const status = await sendGroupStatusBroadcast(sock, group, { text: 'Status real do grupo' }, [phone])
const statusSend = sends.shift()
assert.equal(status.sent.key.id, 'STATUS-V103')
assert.equal(statusSend.jid, group)
assert.equal(statusSend.content.text, 'Status real do grupo')
assert.equal(statusSend.content.groupStatus, true)

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..')
const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'))
assert.equal(pkg.version, '1.2.3')
const interactiveSource = await fs.readFile(path.join(root, 'data', 'interactive.js'), 'utf8')
assert.match(interactiveSource, /contextInfo: \{ mentionedJid: mentionJids \}/)
const statusSource = await fs.readFile(path.join(root, 'commands', 'group-status.js'), 'utf8')
assert.match(statusSource, /sendZenkGroupStatus/)
assert.match(statusSource, /groupStatusMessageV2/)
assert.match(statusSource, /normalizeStatusVideo/)

closeCoreStore()
await fs.rm(temp, { recursive: true, force: true })
console.log('✅ v1.0.3: ranking usa PN e status direto usa groupStatusMessageV2')
