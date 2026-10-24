import assert from 'node:assert/strict'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8')

const pkg = JSON.parse(read('package.json'))
const config = JSON.parse(read('config/sakura.config.json'))
assert.equal(pkg.version, '2.0.0-rc.11', 'RC11 precisa atualizar package.json')
assert.equal(config.bot.release, '2.0.0-rc.11', 'RC11 precisa atualizar config.bot.release')

const workstation = await import(`${pathToFileURL(path.join(root, 'data/workstation.js')).href}?rc11=${Date.now()}`)
const strict = workstation.normalizeCommandDefinition({ name: 'x', strictAdminOnly: true, execute() {} })
assert.equal(strict.strictAdminOnly, true, 'workstation precisa preservar strictAdminOnly')

const groupSource = read('commands/group-customization.js')
assert.match(groupSource, /strictAdminOnly:\s*true/, '.promover precisa exigir admin real do grupo, sem bypass por dono/subdono')
assert.match(groupSource, /promoteGroupParticipant/, '.promover precisa usar o resolvedor robusto de participante')

const handlerSource = read('data/handler.js')
assert.match(handlerSource, /strictAdminOnly[\s\S]{0,800}permissions\.senderIsAdmin/, 'handler precisa validar admin real para comandos strictAdminOnly')

const groupAdminPath = path.join(root, 'data/group-admin.js')
assert.ok(fs.existsSync(groupAdminPath), 'resolvedor de administração de grupo ausente')
const groupAdmin = await import(`${pathToFileURL(groupAdminPath).href}?rc11=${Date.now()}`)
const calls = []
const invalidations = []
const metadata = {
  participants: [
    { id: '123456789012345@lid', phoneNumber: '5581999999999@s.whatsapp.net', admin: null },
    { id: '999999999999999@lid', phoneNumber: '5581888888888@s.whatsapp.net', admin: 'admin' }
  ]
}
const sock = {
  groupParticipantsUpdate: async (jid, targets, action) => {
    calls.push({ jid, targets, action })
    assert.equal(jid, '120363000000@g.us')
    assert.equal(action, 'promote')
    assert.deepEqual(targets, ['123456789012345@lid'], 'ação precisa usar o JID nativo do participante LID')
    metadata.participants[0].admin = 'admin'
    return [{ status: '200', jid: targets[0] }]
  },
  sakuraInvalidateGroupMetadata: jid => invalidations.push(jid),
  sakuraGetGroupMetadata: async () => ({ metadata, source: 'network', cacheHit: false })
}
const promoted = await groupAdmin.promoteGroupParticipant(sock, '120363000000@g.us', ['5581999999999@s.whatsapp.net'], { metadata })
assert.equal(promoted.ok, true, 'promoção precisa ser confirmada como sucesso')
assert.equal(promoted.jid, '123456789012345@lid', 'retorno precisa preservar identidade nativa do grupo')
assert.equal(calls.length, 1, 'promoção válida não deve fazer chamadas duplicadas')
assert.deepEqual(invalidations, ['120363000000@g.us'], 'cache de metadata precisa ser invalidado após promover')

const backupApi = await import(`${pathToFileURL(path.join(root, 'data/backup-manager.js')).href}?rc11=${Date.now()}`)
const temp = await fsp.mkdtemp(path.join(os.tmpdir(), 'sakura-rc11-backup-'))
try {
  await fsp.mkdir(path.join(temp, 'backup/config/private'), { recursive: true })
  await fsp.mkdir(path.join(temp, 'backup/auth'), { recursive: true })
  await fsp.mkdir(path.join(temp, 'config'), { recursive: true })
  await fsp.writeFile(path.join(temp, 'backup/config/sakura.config.json'), JSON.stringify({
    schemaVersion: 2,
    bot: { release: '2.0.0-rc.10', prefix: '!' },
    owners: [{ number: '5511999999999', role: 'owner' }]
  }, null, 2))
  await fsp.writeFile(path.join(temp, 'backup/auth/creds.json'), '{"restored":true}')
  await fsp.writeFile(path.join(temp, 'config/sakura.config.json'), JSON.stringify({
    schemaVersion: 3,
    bot: { release: '2.0.0-rc.11', prefix: '.' },
    rc11Only: { enabled: true }
  }, null, 2))

  // Sem manifest: RC11 deve detectar os arquivos existentes na pasta backup no primeiro boot.
  const restored = await backupApi.restorePersistentBackup({ rootDir: temp, release: '2.0.0-rc.11' })
  assert.equal(restored.restored, true, 'backup com arquivos deve restaurar automaticamente mesmo sem manifest')
  assert.equal(restored.discovered, true, 'restore sem manifest deve ser identificado como backup descoberto')
  const merged = JSON.parse(await fsp.readFile(path.join(temp, 'config/sakura.config.json'), 'utf8'))
  assert.equal(merged.bot.release, '2.0.0-rc.11', 'release da build nova deve prevalecer')
  assert.equal(merged.bot.prefix, '!', 'configuração do usuário deve vir do backup')
  assert.equal(merged.rc11Only.enabled, true, 'campos novos da RC11 devem permanecer')
  assert.ok(fs.existsSync(path.join(temp, 'auth/creds.json')), 'sessão auth precisa ser restaurada automaticamente')
} finally {
  await fsp.rm(temp, { recursive: true, force: true })
}

console.log('✅ RC11: restore automático e promoção LID/admin estrito aprovados')
