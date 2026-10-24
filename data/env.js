import fs from 'node:fs'
import path from 'node:path'

function parseLine(line = '') {
  const clean = String(line).trim()
  if (!clean || clean.startsWith('#')) return null
  const normalized = clean.startsWith('export ') ? clean.slice(7).trim() : clean
  const index = normalized.indexOf('=')
  if (index <= 0) return null
  const key = normalized.slice(0, index).trim()
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) return null
  let value = normalized.slice(index + 1).trim()
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    const quote = value[0]
    value = value.slice(1, -1)
    if (quote === '"') value = value.replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\\t/g, '\t').replace(/\\"/g, '"').replace(/\\\\/g, '\\')
  } else {
    value = value.replace(/\s+#.*$/, '').trim()
  }
  return { key, value }
}

export function loadEnvFile(file = path.resolve('.env')) {
  if (!fs.existsSync(file)) return { loaded: false, count: 0, file }
  const content = fs.readFileSync(file, 'utf8')
  let count = 0
  for (const line of content.split(/\r?\n/)) {
    const entry = parseLine(line)
    if (!entry || process.env[entry.key] != null) continue
    process.env[entry.key] = entry.value
    count += 1
  }
  return { loaded: true, count, file }
}
