import fs from 'node:fs/promises'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const roots = ['index.js', 'data', 'commands']
const files = []

async function walk(target) {
  const full = path.join(root, target)
  const stat = await fs.stat(full)
  if (stat.isFile()) { if (full.endsWith('.js')) files.push(full); return }
  for (const entry of await fs.readdir(full, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue
    await walk(path.relative(root, path.join(full, entry.name)))
  }
}

for (const target of roots) await walk(target)
files.push(
  path.join(root, 'data/vendor/sakura-baileys/lib/Sakura/index.js'),
  path.join(root, 'data/vendor/sakura-baileys/lib/Socket/messages-recv.js'),
  path.join(root, 'data/vendor/sakura-baileys/lib/Utils/process-message.js'),
  path.join(root, 'data/vendor/sakura-baileys/lib/Utils/messages-media.js'),
  path.join(root, 'data/vendor/sakura-baileys/lib/Utils/chat-utils.js'),
  path.join(root, 'data/vendor/sakura-baileys/lib/Socket/socket.js'),
  path.join(root, 'data/vendor/sakura-baileys/lib/Signal/lid-mapping.js')
)

for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' })
  if (result.status !== 0) {
    console.error(result.stderr || result.stdout)
    throw new Error(`Falha de sintaxe: ${path.relative(root, file)}`)
  }
}
console.log(`✅ Sintaxe validada: ${files.length} arquivos`)
