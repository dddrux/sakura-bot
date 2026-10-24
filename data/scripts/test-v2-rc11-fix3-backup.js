import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'sakura-fix3-backup-'))
try {
  const configFile = path.join(temp, 'config', 'sakura.config.json')
  const backupRoot = path.join(temp, 'backup')
  await fs.mkdir(path.dirname(configFile), { recursive: true })
  await fs.writeFile(configFile, JSON.stringify({ schemaVersion: 2, bot: { prefix: '.', release: '2.0.0-rc.11' }, owners: [] }, null, 2))
  const settingsUrl = new URL('../settings.js', import.meta.url).href
  const configChild = spawnSync(process.execPath, ['--input-type=module', '-e', `import { writeConfigSync } from ${JSON.stringify(settingsUrl)}; writeConfigSync({ owners: [{ name: 'Drux', number: '558199434137', role: 'owner', enabled: true }] });`], {
    env: { ...process.env, SAKURA_CONFIG_FILE: configFile, SAKURA_BACKUP_ROOT: backupRoot }, encoding: 'utf8'
  })
  assert.equal(configChild.status, 0, configChild.stderr || 'writeConfigSync falhou')
  const mirroredConfig = JSON.parse(await fs.readFile(path.join(backupRoot, 'config', 'sakura.config.json'), 'utf8'))
  assert.equal(mirroredConfig.owners?.[0]?.number, '558199434137', 'dono precisa ser espelhado imediatamente no backup')

  const dbFile = path.join(temp, 'storage', 'sakura-db.json')
  const databaseUrl = new URL('../database.js', import.meta.url).href
  const dbChild = spawnSync(process.execPath, ['--input-type=module', '-e', `import { openDatabase, flushDatabase } from ${JSON.stringify(databaseUrl)}; const db=openDatabase('rentals',{groups:{}}); await db.update(d=>{d.groups['123@g.us']={active:true,permanent:true}}); await flushDatabase();`], {
    env: { ...process.env, SAKURA_DB_FILE: dbFile, SAKURA_BACKUP_ROOT: backupRoot }, encoding: 'utf8'
  })
  assert.equal(dbChild.status, 0, dbChild.stderr || 'flushDatabase falhou')
  const mirroredDb = JSON.parse(await fs.readFile(path.join(backupRoot, 'storage', 'sakura-db.json'), 'utf8'))
  assert.equal(mirroredDb.namespaces?.rentals?.groups?.['123@g.us']?.active, true, 'contratos precisam ser espelhados imediatamente no backup')

  await fs.writeFile(configFile, JSON.stringify({ schemaVersion: 2, bot: { prefix: '.', release: '2.0.0-rc.11' }, owners: [] }, null, 2))
  await fs.writeFile(dbFile, JSON.stringify({ schemaVersion: 2, namespaces: {} }, null, 2))
  const { restorePersistentBackup } = await import('../backup-manager.js')
  const restored = await restorePersistentBackup({ rootDir: temp, release: '2.0.0-rc.11-fix3' })
  assert.equal(restored.restored, true, 'primeiro boot precisa detectar backup/ automaticamente')
  const restoredConfig = JSON.parse(await fs.readFile(configFile, 'utf8'))
  const restoredDb = JSON.parse(await fs.readFile(dbFile, 'utf8'))
  assert.equal(restoredConfig.owners?.[0]?.number, '558199434137', 'dono precisa voltar automaticamente no primeiro boot')
  assert.equal(restoredDb.namespaces?.rentals?.groups?.['123@g.us']?.active, true, 'contrato precisa voltar automaticamente no primeiro boot')

  console.log('✅ RC11 fix3 backup: donos/contratos espelhados ao vivo e restaurados no primeiro boot')
} finally {
  await fs.rm(temp, { recursive: true, force: true })
}
