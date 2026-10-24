import assert from 'node:assert/strict'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..')
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8')
const exists = relative => fs.existsSync(path.join(root, relative))

const admin = read('commands/admin.js')
assert.doesNotMatch(admin, /foi removido do grupo/i, '.ban não deve enviar confirmação textual de remoção')

// .promover é registrado pela central de grupo; o áudio precisa existir no fluxo que realmente recebe o alias.
const groupCustomization = read('commands/group-customization.js')
assert.match(groupCustomization, /promovido\.mp3/, '.promover precisa enviar o áudio promovido.mp3 no handler real do alias')
assert.match(groupCustomization, /sendAudioMedia/, '.promover precisa usar o helper de mídia seguro')
assert.doesNotMatch(groupCustomization, /Pessoa promovida\./, '.promover não deve adicionar confirmação textual desnecessária')

const interactive = read('data/interactive.js')
assert.equal((interactive.match(/includeUpdateCta:\s*true/g) || []).length, 1, 'CTAs oficiais devem existir somente no menu principal')
assert.match(interactive, /includeVipCta:\s*true/, 'menu principal precisa habilitar CTA de VIP')

const officialLinks = read('data/official-links.js')
assert.match(officialLinks, /Adquira seu VIP/, 'CTA VIP precisa estar no catálogo de links do menu')
assert.match(officialLinks, /vipContactNumber/, 'CTA VIP precisa usar número configurável')

const settings = read('data/settings.js')
const config = JSON.parse(read('config/sakura.config.json'))
assert.match(settings, /vipContactNumber/, 'settings precisa expor vipContactNumber')
assert.equal(String(config.vip?.contactNumber || ''), '558199434137', 'número de compra do VIP incorreto')

const aiGuide = read('data/ai-command-guide.js')
assert.match(aiGuide, /if \(!asksHow\) return false/, 'reply/citação isolada não pode disparar pesquisa de comandos')
assert.match(aiGuide, /sendCommandSearch/, 'pesquisa local da IA precisa usar catálogo nativo')
assert.match(aiGuide, /sendCommandModel/, 'ajuda explícita de comando precisa usar modelo nativo')
assert.doesNotMatch(aiGuide, /nativeFlow:\s*found/, 'pesquisa da IA não deve criar vários quick replies soltos')

const aiEngine = read('data/ai-engine.js')
assert.doesNotMatch(aiEngine, /buildAiQuickReplies/, 'resposta normal da IA não deve carregar botões extras')
assert.doesNotMatch(aiEngine, /nativeFlow:\s*buildAiQuickReplies/, 'resposta normal da IA precisa ser texto limpo')

assert.ok(exists('data/command-correction.js'), 'módulo de tolerância de comandos ausente')
if (exists('data/command-correction.js')) {
  const correction = await import(`${pathToFileURL(path.join(root, 'data/command-correction.js')).href}?t=${Date.now()}`)
  const menu = { name: 'menu', aliases: ['m'], hidden: false }
  const autoia = { name: 'autoia', aliases: [], hidden: false }
  const ban = { name: 'ban', aliases: ['kick'], hidden: false, adminOnly: true }
  const commands = new Map([['menu', menu], ['m', menu], ['autoia', autoia], ['ban', ban], ['kick', ban]])
  const safe = correction.resolveCommandCorrection('meniu', commands)
  assert.equal(safe?.command?.name, 'menu', 'typo claro de menu não foi reconhecido')
  assert.equal(safe?.autoExecute, true, 'typo claro de comando seguro deveria ser executável')
  const typoAutoIa = correction.resolveCommandCorrection('autoria', commands)
  assert.equal(typoAutoIa?.command?.name, 'autoia', 'autoria deveria sugerir/corrigir autoia')
  assert.equal(typoAutoIa?.autoExecute, true, 'autoia é comando seguro para autocorreção clara')
  const critical = correction.resolveCommandCorrection('bam', commands)
  assert.equal(critical?.command?.name, 'ban', 'typo claro de ban deveria ser reconhecido')
  assert.equal(critical?.autoExecute, false, 'ban fuzzy nunca deve ser autoexecutado')
  assert.equal(correction.cleanCommandToken('..MENU'), 'menu', 'prefixos repetidos simples devem ser tolerados')
}

assert.ok(exists('data/backup-manager.js'), 'backup manager B ausente')
assert.ok(exists('backup/.gitkeep'), 'pasta backup precisa existir na raiz')
if (exists('data/backup-manager.js')) {
  const backupApi = await import(`${pathToFileURL(path.join(root, 'data/backup-manager.js')).href}?t=${Date.now()}`)
  const temp = await fsp.mkdtemp(path.join(os.tmpdir(), 'sakura-backup-test-'))
  try {
    await fsp.mkdir(path.join(temp, 'config/private'), { recursive: true })
    await fsp.mkdir(path.join(temp, 'auth'), { recursive: true })
    await fsp.mkdir(path.join(temp, 'storage/sticker-library'), { recursive: true })
    await fsp.mkdir(path.join(temp, 'storage/command-media'), { recursive: true })
    await fsp.mkdir(path.join(temp, 'storage/automation-media'), { recursive: true })
    await fsp.mkdir(path.join(temp, 'storage/action-media'), { recursive: true })
    await fsp.writeFile(path.join(temp, 'config/sakura.config.json'), JSON.stringify({ schemaVersion: 2, bot: { prefix: '!' }, owners: [{ number: '5511999999999', role: 'owner' }], ai: { tokens: [{ token: 'token-de-teste-comprido-123456' }] }, vip: { contactNumber: '558199434137' } }, null, 2))
    await fsp.writeFile(path.join(temp, 'config/ai-personality.txt'), 'personalidade personalizada')
    await fsp.writeFile(path.join(temp, 'config/private/secret.txt'), 'segredo')
    await fsp.writeFile(path.join(temp, 'storage/sakura-db.json'), JSON.stringify({ schemaVersion: 2, namespaces: { test: { ok: true } } }))
    await fsp.writeFile(path.join(temp, 'auth/creds.json'), '{"me":"ok"}')
    await fsp.writeFile(path.join(temp, 'auth/.process.lock'), 'nao-copiar')
    await fsp.writeFile(path.join(temp, 'storage/sticker-library/a.webp'), 'sticker')

    await backupApi.snapshotPersistentBackup({ rootDir: temp })
    assert.ok(fs.existsSync(path.join(temp, 'backup/manifest.json')), 'snapshot não criou manifest')
    assert.ok(!fs.existsSync(path.join(temp, 'backup/auth/.process.lock')), 'lock de processo não pode ir para backup')

    await fsp.writeFile(path.join(temp, 'config/sakura.config.json'), JSON.stringify({ schemaVersion: 3, bot: { prefix: '.' }, newFeature: { enabled: true }, vip: { plans: [{ key: 'novo' }] } }, null, 2))
    await fsp.rm(path.join(temp, 'auth/creds.json'), { force: true })
    await fsp.rm(path.join(temp, 'storage/sakura-db.json'), { force: true })
    await fsp.rm(path.join(temp, 'storage/sticker-library/a.webp'), { force: true })

    const restored = await backupApi.restorePersistentBackup({ rootDir: temp })
    assert.equal(restored.restored, true, 'restore deveria detectar backup existente')
    const merged = JSON.parse(await fsp.readFile(path.join(temp, 'config/sakura.config.json'), 'utf8'))
    assert.equal(merged.schemaVersion, 3, 'schemaVersion da build nova deve prevalecer no merge')
    assert.equal(merged.bot.prefix, '!', 'prefixo do backup não foi restaurado')
    assert.equal(merged.newFeature.enabled, true, 'nova chave da build deveria ser preservada no merge')
    assert.equal(merged.vip.contactNumber, '558199434137', 'contato VIP do backup não foi preservado')
    assert.ok(fs.existsSync(path.join(temp, 'auth/creds.json')), 'auth não foi restaurado')
    assert.ok(fs.existsSync(path.join(temp, 'storage/sakura-db.json')), 'database não foi restaurado')
    assert.ok(fs.existsSync(path.join(temp, 'storage/sticker-library/a.webp')), 'biblioteca de sticker não foi restaurada')
    assert.ok(!fs.existsSync(path.join(temp, 'auth/.process.lock')), 'restore recriou lock de processo indevido')
  } finally {
    await fsp.rm(temp, { recursive: true, force: true })
  }
}

const indexSource = read('index.js')
assert.match(indexSource, /restorePersistentBackup[\s\S]*initializeCoreStore/, 'backup precisa ser restaurado antes de carregar core/settings')
const clientSource = read('data/client.js')
assert.match(clientSource, /snapshotPersistentBackup/, 'shutdown precisa persistir backup')
assert.match(clientSource, /startPersistentBackupScheduler/, 'runtime precisa manter snapshot periódico')
assert.match(read('data/scripts/preflight.js'), /['"]backup['"]/, 'preflight precisa criar backup na raiz')
assert.match(read('data/update-manager.js'), /backup\//, 'updater precisa proteger backup/')

console.log('✅ Hotfix3: admin, CTAs, IA, corretor tolerante e backup B aprovados')
