import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { spawn } from 'node:child_process'
import { settings } from './settings.js'

const FORMAT = 'sakura-update-v1'
const BLOCKED_PREFIXES = ['config/', 'auth/', 'backup/', 'storage/logs/', 'storage/backups/', 'storage/updates/', 'node_modules/', '.git/']
const ALLOWED_PREFIXES = ['commands/', 'assets/', 'data/', 'index.js', 'install.sh', 'package.json', 'README.md', '.npmrc']

function run(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] })
    let stderr = ''
    child.stderr.on('data', chunk => { stderr += chunk.toString() })
    child.on('error', reject)
    child.on('close', code => code === 0 ? resolve() : reject(new Error(`${command} falhou (${code}): ${stderr.slice(-1000)}`)))
  })
}

function safeRelative(value) {
  const normalized = String(value || '').replaceAll('\\', '/').replace(/^\/+/, '')
  if (!normalized || normalized.includes('../') || path.isAbsolute(normalized)) throw new Error(`Caminho inválido: ${value}`)
  if (BLOCKED_PREFIXES.some(prefix => normalized === prefix.replace(/\/$/, '') || normalized.startsWith(prefix))) throw new Error(`Caminho protegido: ${normalized}`)
  if (!ALLOWED_PREFIXES.some(prefix => normalized === prefix || normalized.startsWith(prefix.endsWith('/') ? prefix : `${prefix}/`))) throw new Error(`Caminho não permitido: ${normalized}`)
  return normalized
}

async function sha256(file) {
  const hash = createHash('sha256')
  hash.update(await fs.readFile(file))
  return hash.digest('hex')
}

function canonicalManifest(manifest) {
  const clean = { ...manifest }
  delete clean.signature
  return JSON.stringify(clean)
}

export function signManifest(manifest, secret) {
  return createHmac('sha256', secret).update(canonicalManifest(manifest)).digest('hex')
}

function verifySignature(manifest, secret) {
  if (!manifest.signature || !secret) return false
  const expected = Buffer.from(signManifest(manifest, secret), 'hex')
  const actual = Buffer.from(String(manifest.signature), 'hex')
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}

export async function inspectUpdatePackage(packagePath, secret) {
  const stage = path.join(settings.updatesDir, `inspect-${Date.now()}-${process.pid}`)
  await fs.mkdir(stage, { recursive: true })
  try {
    await run('unzip', ['-qq', packagePath, '-d', stage], settings.rootDir)
    const manifest = JSON.parse(await fs.readFile(path.join(stage, 'manifest.json'), 'utf8'))
    if (manifest.format !== FORMAT) throw new Error('Formato de atualização incompatível')
    if (!verifySignature(manifest, secret)) throw new Error('Assinatura da atualização inválida')
    if (!Array.isArray(manifest.files) || !manifest.files.length) throw new Error('Atualização sem arquivos')
    for (const item of manifest.files) {
      const relative = safeRelative(item.path)
      const file = path.join(stage, 'payload', relative)
      if (await sha256(file) !== item.sha256) throw new Error(`Hash inválido: ${relative}`)
    }
    return { manifest, stage }
  } catch (error) {
    await fs.rm(stage, { recursive: true, force: true })
    throw error
  }
}

export async function applyUpdatePackage(packagePath, secret, logger) {
  const { manifest, stage } = await inspectUpdatePackage(packagePath, secret)
  const backup = path.join(settings.backupsDir, `update-${Date.now()}-${manifest.version}`)
  await fs.mkdir(backup, { recursive: true })
  try {
    for (const item of manifest.files) {
      const relative = safeRelative(item.path)
      const target = path.join(settings.rootDir, relative)
      const source = path.join(stage, 'payload', relative)
      try {
        const stat = await fs.stat(target)
        if (stat.isFile()) {
          const backupFile = path.join(backup, relative)
          await fs.mkdir(path.dirname(backupFile), { recursive: true })
          await fs.copyFile(target, backupFile)
        }
      } catch {}
      await fs.mkdir(path.dirname(target), { recursive: true })
      await fs.copyFile(source, target)
    }
    await fs.writeFile(path.join(backup, 'manifest.json'), JSON.stringify(manifest, null, 2))
    logger?.success?.({ version: manifest.version, files: manifest.files.length, backup }, 'atualização aplicada')
    return { version: manifest.version, files: manifest.files.length, backup, restartRequired: manifest.restartRequired !== false }
  } finally {
    await fs.rm(stage, { recursive: true, force: true })
  }
}

export async function createUpdatePackage(sourceDir, version, outputPath, secret) {
  const source = path.resolve(sourceDir)
  const work = path.join(settings.updatesDir, `build-${Date.now()}-${process.pid}`)
  const payload = path.join(work, 'payload')
  await fs.mkdir(payload, { recursive: true })
  const files = []

  async function walk(directory) {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name)
      const relative = path.relative(source, absolute).replaceAll('\\', '/')
      if (entry.isDirectory()) await walk(absolute)
      else {
        const safe = safeRelative(relative)
        const destination = path.join(payload, safe)
        await fs.mkdir(path.dirname(destination), { recursive: true })
        await fs.copyFile(absolute, destination)
        files.push({ path: safe, sha256: await sha256(absolute) })
      }
    }
  }

  try {
    await walk(source)
    const manifest = { format: FORMAT, version: String(version), createdAt: new Date().toISOString(), restartRequired: true, files }
    manifest.signature = signManifest(manifest, secret)
    await fs.writeFile(path.join(work, 'manifest.json'), JSON.stringify(manifest, null, 2))
    await fs.mkdir(path.dirname(outputPath), { recursive: true })
    await fs.rm(outputPath, { force: true })
    await run('zip', ['-qr', outputPath, 'manifest.json', 'payload'], work)
    return { outputPath, files: files.length, manifest }
  } finally {
    await fs.rm(work, { recursive: true, force: true })
  }
}
