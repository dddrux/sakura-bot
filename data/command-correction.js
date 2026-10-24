const CRITICAL_COMMANDS = new Set([
  'ban', 'ban2', 'kick', 'promover', 'promote', 'rebaixar', 'demote',
  'dono', 'subdono', 'iatoken', 'contrato', 'sair', 'reset-session',
  'novolink', 'revogarlink', 'novolik'
])

export function normalizeCommandToken(value = '') {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR')
    .trim()
}

export function cleanCommandToken(value = '') {
  return normalizeCommandToken(String(value || '').trim().replace(/^[.!/#]+/, ''))
}

function damerauLevenshtein(a = '', b = '') {
  const left = normalizeCommandToken(a)
  const right = normalizeCommandToken(b)
  const rows = left.length + 1
  const cols = right.length + 1
  const matrix = Array.from({ length: rows }, () => Array(cols).fill(0))
  for (let i = 0; i < rows; i += 1) matrix[i][0] = i
  for (let j = 0; j < cols; j += 1) matrix[0][j] = j

  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1
      let value = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      )
      if (i > 1 && j > 1 && left[i - 1] === right[j - 2] && left[i - 2] === right[j - 1]) {
        value = Math.min(value, matrix[i - 2][j - 2] + 1)
      }
      matrix[i][j] = value
    }
  }
  return matrix[left.length][right.length]
}

function uniqueCommands(commands) {
  if (!commands?.values) return []
  const seen = new Set()
  const result = []
  for (const command of commands.values()) {
    if (!command || command.hidden || seen.has(command)) continue
    seen.add(command)
    result.push(command)
  }
  return result
}

function thresholdFor(length) {
  if (length <= 2) return 0
  if (length <= 5) return 1
  if (length <= 8) return 2
  return 3
}

function isCritical(command = {}, matchedName = '') {
  const names = [command.name, matchedName, ...(command.aliases || [])].map(normalizeCommandToken)
  return Boolean(
    command.sensitiveArgs || command.ownerOnly || command.subownerAllowed || command.adminOnly || command.botAdminOnly ||
    names.some(name => CRITICAL_COMMANDS.has(name))
  )
}

function candidateFor(command, target) {
  const names = [command.name, ...(command.aliases || [])]
    .map(cleanCommandToken)
    .filter(Boolean)
  let best = null
  for (const name of names) {
    const distance = damerauLevenshtein(target, name)
    const maxLength = Math.max(target.length, name.length, 1)
    const item = {
      command,
      matchedName: name,
      distance,
      ratio: distance / maxLength,
      lengthGap: Math.abs(target.length - name.length),
      prefix: name.startsWith(target) || target.startsWith(name)
    }
    if (!best || item.distance < best.distance || (item.distance === best.distance && item.ratio < best.ratio) || (item.distance === best.distance && item.ratio === best.ratio && item.lengthGap < best.lengthGap)) best = item
  }
  return best
}

export function resolveCommandCorrection(value = '', commands) {
  const target = cleanCommandToken(value)
  if (!target || /\s/.test(target) || target.length > 80) return null
  const exact = commands?.get?.(target)
  if (exact) return { command: exact, matchedName: target, distance: 0, ratio: 0, confidence: 'exact', autoExecute: true, critical: isCritical(exact, target) }

  const candidates = uniqueCommands(commands)
    .map(command => candidateFor(command, target))
    .filter(Boolean)
    .filter(item => {
      const threshold = thresholdFor(target.length)
      if (item.distance > threshold) return false
      if (item.distance === 0) return true
      if (target.length <= 5) return item.distance <= 1
      if (target.length <= 8) return item.ratio <= 0.34
      return item.ratio <= 0.30
    })
    .sort((a, b) => a.distance - b.distance || a.ratio - b.ratio || a.lengthGap - b.lengthGap || String(a.command.name).localeCompare(String(b.command.name), 'pt-BR'))

  const best = candidates[0]
  if (!best) return null
  const second = candidates.find(item => item.command !== best.command)
  const unambiguous = !second || second.distance >= best.distance + 1 || second.ratio >= best.ratio + 0.12
  const strong = best.distance === 1 || (best.distance === 2 && target.length >= 6 && unambiguous) || (best.distance === 3 && target.length >= 10 && unambiguous)
  const critical = isCritical(best.command, best.matchedName)

  return {
    ...best,
    confidence: strong && unambiguous ? 'high' : 'medium',
    critical,
    autoExecute: Boolean(strong && unambiguous && !critical)
  }
}
