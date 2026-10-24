import fs from 'node:fs/promises'
import path from 'node:path'

const SIGNAL_PREFIXES = [
  'session-',
  'sender-key-',
  'sender-key-memory-',
  'device-list-',
  'lid-mapping-'
]

function isSignalStateFile(name = '') {
  return SIGNAL_PREFIXES.some(prefix => name.startsWith(prefix)) && name.endsWith('.json')
}

export async function repairCopiedSignalState({ sessionDir, backupsDir, logger }) {
  const marker = path.join(sessionDir, '.signal-repair-v3')
  try {
    await fs.access(marker)
    return { repaired: false, reason: 'already-repaired', moved: 0 }
  } catch {}

  let names = []
  try { names = await fs.readdir(sessionDir) } catch { return { repaired: false, reason: 'no-session', moved: 0 } }
  const candidates = names.filter(isSignalStateFile)
  if (!candidates.length) {
    await fs.writeFile(marker, JSON.stringify({ at: new Date().toISOString(), moved: 0 }, null, 2))
    return { repaired: false, reason: 'no-signal-files', moved: 0 }
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const backupDir = path.join(backupsDir, `signal-state-${stamp}`)
  await fs.mkdir(backupDir, { recursive: true })

  let moved = 0
  for (const name of candidates) {
    try {
      await fs.rename(path.join(sessionDir, name), path.join(backupDir, name))
      moved += 1
    } catch (error) {
      logger?.debug?.({ error, file: name }, 'não foi possível mover chave Signal antiga')
    }
  }

  await fs.writeFile(marker, JSON.stringify({ at: new Date().toISOString(), moved, backupDir }, null, 2))
  logger?.warn?.({ moved, backupDir, stage: 'signal-repair-v3' }, 'chaves Signal incompatíveis foram isoladas; login e credenciais foram preservados')
  return { repaired: moved > 0, reason: 'copied-session-signal-reset', moved, backupDir }
}
