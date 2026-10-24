import fs from 'node:fs/promises'
import path from 'node:path'

async function exists(filePath) {
  try { await fs.access(filePath); return true } catch { return false }
}

export async function inspectSession(sessionDir) {
  const credsPath = path.join(sessionDir, 'creds.json')
  const hasCreds = await exists(credsPath)
  let files = []
  try { files = await fs.readdir(sessionDir) } catch {}
  return { hasCreds, fileCount: files.filter(name => name !== '.gitkeep').length, credsPath }
}

export async function backupAndResetSession(sessionDir, reason = 'invalid') {
  const parent = path.dirname(sessionDir)
  const base = path.basename(sessionDir)
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').replace('Z', '')
  const backupDir = path.join(parent, `${base}-backup-${reason}-${stamp}`)
  const session = await inspectSession(sessionDir)
  if (session.fileCount > 0) await fs.rename(sessionDir, backupDir)
  else await fs.rm(sessionDir, { recursive: true, force: true })
  // O backup persistente restauraria a sessão inválida na próxima inicialização.
  await fs.rm(path.join(parent, 'backup', base), { recursive: true, force: true }).catch(() => {})
  await fs.mkdir(sessionDir, { recursive: true })
  await fs.writeFile(path.join(sessionDir, '.gitkeep'), '')
  return { backupDir: session.fileCount > 0 ? backupDir : null }
}

export async function acquireSessionProcessLock(sessionDir) {
  await fs.mkdir(sessionDir, { recursive: true })
  const lockPath = path.join(sessionDir, '.process.lock')
  try {
    const handle = await fs.open(lockPath, 'wx')
    await handle.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }))
    await handle.close()
    return async () => { await fs.rm(lockPath, { force: true }).catch(() => {}) }
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error
    let owner = null
    try { owner = JSON.parse(await fs.readFile(lockPath, 'utf8')) } catch {}
    if (owner?.pid) {
      try {
        process.kill(owner.pid, 0)
        const lockError = new Error(`Outra instância da Sakura já está usando esta sessão (PID ${owner.pid}).`)
        lockError.code = 'SESSION_IN_USE'
        throw lockError
      } catch (checkError) {
        if (checkError?.code === 'SESSION_IN_USE') throw checkError
      }
    }
    await fs.rm(lockPath, { force: true })
    return acquireSessionProcessLock(sessionDir)
  }
}
