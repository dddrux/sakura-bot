import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const file = path.join(root, 'package-lock.json')
if (!fs.existsSync(file)) process.exit(0)
const lock = JSON.parse(fs.readFileSync(file, 'utf8'))
const internalPattern = /^https?:\/\/[^/]*(?:internal\.api\.openai\.org|applied-caas-gateway[^/]*)\/artifactory\/api\/npm\/npm-public\//i
let changed = 0

function walk(value) {
  if (!value || typeof value !== 'object') return
  if (typeof value.resolved === 'string' && internalPattern.test(value.resolved)) {
    value.resolved = value.resolved.replace(internalPattern, 'https://registry.npmjs.org/')
    changed += 1
  }
  for (const child of Object.values(value)) walk(child)
}

walk(lock)
if (changed) fs.writeFileSync(file, JSON.stringify(lock, null, 2) + '\n')
if (!process.argv.includes('--quiet')) console.log(`🔧 package-lock público: ${changed} endereço(s) corrigido(s).`)
