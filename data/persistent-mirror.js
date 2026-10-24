import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'

function safeRelative(relative = '') {
  const value = String(relative || '').replaceAll('\\', '/').replace(/^\/+/, '')
  if (!value || value.includes('../') || path.isAbsolute(value)) throw new Error(`Caminho de espelho inválido: ${relative}`)
  return value
}

export function resolvePersistentBackupRoot(rootDir = process.cwd()) {
  return path.resolve(process.env.SAKURA_BACKUP_ROOT || path.join(rootDir, 'backup'))
}

export function mirrorFileToBackupSync(source, relative, { rootDir = process.cwd() } = {}) {
  if (!source || !fs.existsSync(source)) return false
  const target = path.join(resolvePersistentBackupRoot(rootDir), safeRelative(relative))
  if (path.resolve(source) === path.resolve(target)) return false
  fs.mkdirSync(path.dirname(target), { recursive: true })
  const temp = `${target}.${process.pid}.${Date.now()}.tmp`
  fs.copyFileSync(source, temp)
  fs.renameSync(temp, target)
  return true
}

export async function mirrorFileToBackup(source, relative, { rootDir = process.cwd() } = {}) {
  try { await fsp.access(source) } catch { return false }
  const target = path.join(resolvePersistentBackupRoot(rootDir), safeRelative(relative))
  if (path.resolve(source) === path.resolve(target)) return false
  await fsp.mkdir(path.dirname(target), { recursive: true })
  const temp = `${target}.${process.pid}.${Date.now()}.tmp`
  await fsp.copyFile(source, temp)
  await fsp.rename(temp, target)
  return true
}
