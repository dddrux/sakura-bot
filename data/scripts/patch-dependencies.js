import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const vendorFork = path.join(root, 'data', 'vendor', 'sakura-baileys')
const installedFork = path.join(root, 'node_modules', '@sakura-md', 'baileys')
const quiet = process.argv.includes('--quiet')

async function replace(relative, from, to) {
  const file = path.join(root, relative)
  try {
    const source = await fs.readFile(file, 'utf8')
    if (source.includes(to) || !source.includes(from)) return false
    await fs.writeFile(file, source.replace(from, to))
    return true
  } catch { return false }
}

let synced = false
try {
  await fs.mkdir(path.dirname(installedFork), { recursive: true })
  await fs.rm(installedFork, { recursive: true, force: true })
  await fs.cp(vendorFork, installedFork, { recursive: true, force: true })
  synced = true
} catch (error) {
  console.warn(`⚠️ Não foi possível sincronizar o fork local: ${error.message}`)
}

const changes = []
changes.push(await replace('node_modules/libsignal/src/session_record.js', 'console.info("Closing session:", session);', '// Sakura: material criptográfico removido do terminal.'))
changes.push(await replace('node_modules/libsignal/src/session_cipher.js', 'console.warn("Decrypted message with closed session.");', '// Sakura: sessão fechada tratada silenciosamente.'))

if (!quiet) console.log(`✅ Fork sincronizado: ${synced ? 'sim' : 'não'} | patches extras: ${changes.filter(Boolean).length}`)
