#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const failures = []
const warnings = []
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const config = JSON.parse(fs.readFileSync(path.join(root, 'config', 'sakura.config.json'), 'utf8'))
const dbFile = path.resolve(root, config.paths?.database || 'storage/sakura-db.json')

if (!String(pkg.version || '').startsWith('2.')) failures.push(`package.json não está na linha V2: ${pkg.version}`)
if (!String(pkg.engines?.node || '').includes('22')) warnings.push(`engine Node esperado na linha 22+: ${pkg.engines?.node || 'ausente'}`)
if (config.economy?.currencyName !== 'Sakura Coins' || config.economy?.currencyEmoji !== '🪙') failures.push('economia não está padronizada como Sakura Coins 🪙')
if (JSON.stringify(config.ui?.contentEmojis || []) !== JSON.stringify(['💮', '🌸']) || config.ui?.dividerEmoji !== '🪷' || (config.ui?.emojis || []).includes('🪷')) failures.push('tema Sakura inválido: 🪷 deve ficar apenas nas divisórias e conteúdo deve usar 💮/🌸')
if (!/^https:\/\/whatsapp\.com\/channel\//.test(config.ui?.updateChannel || '')) failures.push('canal de atualização não configurado')
if (config.paths?.session !== 'auth') failures.push(`sessão V2 precisa ficar em /auth na raiz: ${config.paths?.session || 'ausente'}`)
if (!fs.existsSync(path.join(root, 'auth', '.gitkeep'))) failures.push('auth/.gitkeep ausente da raiz')
if (fs.existsSync(path.join(root, 'data', 'statusgp.json'))) failures.push('data/statusgp.json é banco paralelo; status de grupo deve usar sakura-db.json')
if (fs.existsSync(path.join(root, 'data', 'ai-crypto.js'))) failures.push('criptografia legada de tokens ainda presente')

for (const dirName of ['config', 'storage']) {
  const dir = path.join(root, dirName)
  if (!fs.existsSync(dir)) continue
  const legacy = fs.readdirSync(dir).filter(name => /\.(?:db|sqlite)(?:-(?:wal|shm))?$/i.test(name))
  if (legacy.length) failures.push(`${dirName} contém bancos legados: ${legacy.join(', ')}`)
}

if (fs.existsSync(dbFile)) {
  try {
    const parsed = JSON.parse(fs.readFileSync(dbFile, 'utf8'))
    if (parsed.schemaVersion !== 2 || !parsed.namespaces || typeof parsed.namespaces !== 'object') failures.push('sakura-db.json possui estrutura inválida')
  } catch (error) { failures.push(`sakura-db.json inválido: ${error.message}`) }
}

const runtimeFiles = ['database.js','automation-store.js','ai-store.js','core-store.js','social-store.js','fun-media-store.js','protection-store.js','private-protection.js','group-schedule-store.js','global-morning-store.js']
for (const name of runtimeFiles) {
  const source = fs.readFileSync(path.join(root, 'data', name), 'utf8')
  if (/from\s+['"]node:sqlite['"]|new\s+DatabaseSync\s*\(/.test(source)) failures.push(`${name} ainda usa SQLite`)
}

const required = [
  'config/sakura.config.json', 'data/workstation.js', 'data/database.js',
  'docs/superpowers/specs/2026-08-26-sakura-v2-foundation-design.md',
  'docs/superpowers/plans/2026-08-26-sakura-v2-foundation.md'
]
for (const relative of required) if (!fs.existsSync(path.join(root, relative))) failures.push(`arquivo obrigatório ausente: ${relative}`)

if (failures.length) {
  failures.forEach(item => console.error(`❌ ${item}`))
  warnings.forEach(item => console.warn(`⚠️ ${item}`))
  process.exitCode = 1
} else {
  warnings.forEach(item => console.warn(`⚠️ ${item}`))
  console.log(`✅ Auditoria Sakura V2: v${pkg.version}, JSON central íntegro, sem SQLite no runtime.`)
}
