import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const configDir = path.join(rootDir, 'config')
const backupDir = path.join(rootDir, 'storage', 'backups', 'pre-v0.35.1')
const manifest = JSON.parse(fs.readFileSync(path.join(backupDir, 'manifest.json'), 'utf8'))
const failures = []
for (const item of manifest.databases || []) {
  const current = path.join(configDir, item.file)
  if (!fs.existsSync(current)) {
    failures.push(`${item.file}: ausente`)
    continue
  }
  const buffer = fs.readFileSync(current)
  const hash = createHash('sha256').update(buffer).digest('hex')
  if (hash !== item.sha256) failures.push(`${item.file}: hash alterado`)
}
if (failures.length) throw new Error(`Bancos originais não preservados: ${failures.join(', ')}`)
console.log(`✅ Bancos preservados byte a byte: ${manifest.databases.length}`)
