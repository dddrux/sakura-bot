import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const packagePath = path.join(root, 'package.json')
const lockPath = path.join(root, 'package-lock.json')
const markerPath = path.join(root, 'node_modules', '.sakura-deps.json')

function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')) }
function packageDir(rootDir, name) { return path.join(rootDir, 'node_modules', ...String(name).split('/')) }
function dependencyReady(rootDir, name) {
  const dir = packageDir(rootDir, name)
  try {
    const stat = fs.lstatSync(dir)
    if (!stat.isDirectory() && !stat.isSymbolicLink()) return false
    return fs.existsSync(path.join(dir, 'package.json'))
  } catch { return false }
}

export function dependencyFingerprint(rootDir = root) {
  const hash = crypto.createHash('sha256')
  for (const file of [path.join(rootDir, 'package.json'), path.join(rootDir, 'package-lock.json')]) {
    if (fs.existsSync(file)) hash.update(fs.readFileSync(file))
  }
  return hash.digest('hex')
}

export function missingRequiredDependencies(rootDir = root) {
  const pkg = readJson(path.join(rootDir, 'package.json'))
  return Object.keys(pkg.dependencies || {}).filter(name => !dependencyReady(rootDir, name))
}

function markerMatches(rootDir, fingerprint) {
  try {
    const marker = readJson(path.join(rootDir, 'node_modules', '.sakura-deps.json'))
    return marker.fingerprint === fingerprint
  } catch { return false }
}

function writeMarker(rootDir, fingerprint) {
  fs.mkdirSync(path.join(rootDir, 'node_modules'), { recursive: true })
  fs.writeFileSync(path.join(rootDir, 'node_modules', '.sakura-deps.json'), JSON.stringify({ fingerprint, checkedAt: Date.now() }) + '\n')
}

function npmCommand() {
  const npmCli = String(process.env.npm_execpath || '').trim()
  if (npmCli && fs.existsSync(npmCli)) return { command: process.execPath, argsPrefix: [npmCli] }
  return { command: process.platform === 'win32' ? 'npm.cmd' : 'npm', argsPrefix: [] }
}

export function ensureDependencies(rootDir = root) {
  const fingerprint = dependencyFingerprint(rootDir)
  const missing = missingRequiredDependencies(rootDir)
  if (!missing.length && markerMatches(rootDir, fingerprint)) {
    console.log('🌸 Dependências prontas.')
    return { installed: false, missing: [] }
  }

  const reason = missing.length ? `faltando: ${missing.join(', ')}` : 'package.json/package-lock alterado'
  console.log(`💮 Preparando dependências automaticamente (${reason})...`)
  const npm = npmCommand()
  const result = spawnSync(npm.command, [
    ...npm.argsPrefix,
    'install',
    '--omit=dev',
    '--omit=optional',
    '--no-audit',
    '--no-fund',
    '--prefer-offline'
  ], {
    cwd: rootDir,
    stdio: 'inherit',
    env: { ...process.env, SAKURA_AUTO_INSTALL: '1' },
    timeout: Math.max(30_000, Number(process.env.SAKURA_NPM_INSTALL_TIMEOUT_MS || 180_000)),
    killSignal: 'SIGTERM'
  })

  const stillMissing = missingRequiredDependencies(rootDir)
  if (result.error?.code === 'ETIMEDOUT' && stillMissing.length) {
    throw new Error(`Instalação automática excedeu o tempo limite; ainda faltam: ${stillMissing.join(', ')}`)
  }
  if (result.status !== 0 && stillMissing.length) {
    throw new Error(`Falha ao instalar dependências obrigatórias: ${stillMissing.join(', ')}`)
  }
  if (stillMissing.length) throw new Error(`Dependências continuam ausentes: ${stillMissing.join(', ')}`)

  writeMarker(rootDir, fingerprint)
  if (result.status !== 0 || result.error) console.warn('🌸 O npm encerrou com aviso, mas as dependências obrigatórias estão disponíveis.')
  else console.log('💮 Dependências instaladas/atualizadas automaticamente.')
  return { installed: true, missing }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { ensureDependencies(root) } catch (error) { console.error(`Falha no bootstrap de dependências: ${error.message}`); process.exitCode = 1 }
}
