import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const read = file => fs.readFile(path.join(root, file), 'utf8')
const databaseSource = await read('data/database.js')
assert.match(databaseSource, /readSync\(/)
assert.match(databaseSource, /updateSync\(/)

for (const file of ['data/protection-store.js', 'data/private-protection.js', 'data/group-schedule-store.js', 'data/global-morning-store.js', 'data/automation-store.js', 'data/core-store.js', 'data/ai-store.js', 'data/social-store.js', 'data/fun-media-store.js']) {
  const source = await read(file)
  assert.doesNotMatch(source, /node:sqlite|DatabaseSync|PRAGMA|CREATE TABLE/i, `${file} ainda usa SQLite`)
  assert.match(source, /openDatabase/)
}

const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'sakura-v2-sync-store-'))
process.env.SAKURA_DB_FILE = path.join(temp, 'db.json')
const dbModule = await import(`${pathToFileURL(path.join(root, 'data/database.js')).href}?t=${Date.now()}`)
const store = dbModule.openDatabase('sync-test', { count: 0, rows: {} })
assert.equal(store.readSync().count, 0)
const result = store.updateSync(draft => { draft.count += 1; draft.rows.a = { ok: true }; return draft.count })
assert.equal(result, 1)
assert.equal(store.readSync().rows.a.ok, true)
await dbModule.flushDatabase()
const persisted = JSON.parse(await fs.readFile(process.env.SAKURA_DB_FILE, 'utf8'))
assert.equal(persisted.namespaces['sync-test'].count, 1)
console.log('V2 JSON sync stores tests: OK')

const settingsSource = await read('data/settings.js')
assert.doesNotMatch(settingsSource, /legacyDb(?:Dir)?|\.db[`'"]/i, 'settings ainda aponta para bancos legados')

async function collectJs(dir) {
  const result = []
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    if (entry.name === 'vendor') continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) result.push(...await collectJs(full))
    else if (entry.isFile() && entry.name.endsWith('.js')) result.push(full)
  }
  return result
}
for (const file of await collectJs(path.join(root, 'data'))) {
  const source = await fs.readFile(file, 'utf8')
  assert.doesNotMatch(source, /from\s+['"]node:sqlite['"]|new\s+DatabaseSync\s*\(/, `${path.relative(root, file)} ainda importa SQLite`)
}
const legacyDbFiles = (await fs.readdir(path.join(root, 'config'))).filter(name => /\.(?:db|sqlite)(?:-(?:wal|shm))?$/i.test(name))
assert.deepEqual(legacyDbFiles, [], `arquivos de banco legados ainda presentes: ${legacyDbFiles.join(', ')}`)
