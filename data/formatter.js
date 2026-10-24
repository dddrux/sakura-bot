import { settings } from './settings.js'
import { visibleCommandForRole } from './permissions.js'

const OLD_DECORATION_RE = /^(?:▢\s*•\s*)?(?:[\p{Extended_Pictographic}\uFE0F\u200D]+\s*)+/u
const BORDER_RE = /^(?:╭|╰|├|└|┌|┐|┘|┏|┓|┗|┛|━|─|═|╔|╚|║|┃|┠|┨|┯|┷).*/u

function uniqueCommands(commands) {
  return [...new Map([...commands.values()].map(command => [command.name, command])).values()]
}

function normalizeCommand(value = '') {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
}

function levenshtein(a = '', b = '') {
  const left = normalizeCommand(a)
  const right = normalizeCommand(b)
  const matrix = Array.from({ length: left.length + 1 }, () => Array(right.length + 1).fill(0))

  for (let i = 0; i <= left.length; i += 1) matrix[i][0] = i
  for (let j = 0; j <= right.length; j += 1) matrix[0][j] = j

  for (let i = 1; i <= left.length; i += 1) {
    for (let j = 1; j <= right.length; j += 1) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      )
    }
  }

  return matrix[left.length][right.length]
}

function boldImportant(line = '') {
  const value = String(line)
  if (!value.trim()) return ''
  if (/^\*.*\*$/.test(value.trim())) return value

  // "Label: conteúdo" vira "*Label:* conteúdo"
  return value.replace(
    /^([\p{L}\p{N} _-]{1,32}):\s*(.+)$/u,
    (_, label, content) => `*${label}:* ${content}`
  )
}

function cleanDecoratedLine(value = '') {
  return String(value || '')
    .replace(/\u00a0/g, ' ')
    .replace(OLD_DECORATION_RE, '')
    .trim()
}

function normalizeSourceLines(text = '') {
  const source = String(text ?? '').replace(/\r\n?/g, '\n').replace(/[ \t]+$/gm, '')
  const raw = source.split('\n')
  const lines = []
  let blankPending = false

  for (const original of raw) {
    const trimmed = original.trim()
    if (!trimmed) {
      blankPending = lines.length > 0
      continue
    }
    // Descarta molduras antigas, mantendo só o conteúdo.
    if (BORDER_RE.test(trimmed)) continue
    if (blankPending && lines.length && lines[lines.length - 1] !== '') lines.push('')
    blankPending = false
    lines.push(cleanDecoratedLine(trimmed))
  }

  while (lines[0] === '') lines.shift()
  while (lines.at(-1) === '') lines.pop()
  return lines
}

export function wrapSakuraLine(line = '', maxWords = 7, maxChars = 72) {
  const value = String(line || '').trim()
  if (!value) return []

  const words = value.split(/\s+/).filter(Boolean)
  const wordLimit = Math.max(1, Math.min(12, Number(maxWords) || 7))
  const charLimit = Math.max(24, Math.min(96, Number(maxChars) || 72))
  const chunks = []
  let current = []

  for (const word of words) {
    const candidate = [...current, word]
    const candidateText = candidate.join(' ')
    if (current.length && (candidate.length > wordLimit || candidateText.length > charLimit)) {
      chunks.push(current.join(' '))
      current = [word]
    } else {
      current = candidate
    }
  }
  if (current.length) chunks.push(current.join(' '))

  // Evita uma última linha com 1–2 palavras órfãs: puxa um pouco da anterior.
  if (chunks.length > 1) {
    const last = chunks.at(-1).split(/\s+/).filter(Boolean)
    const previous = chunks.at(-2).split(/\s+/).filter(Boolean)
    if (last.length < 3 && previous.length > 3) {
      const wanted = 3 - last.length
      const movable = Math.min(wanted, previous.length - 3)
      if (movable > 0) {
        const moved = previous.splice(previous.length - movable, movable)
        const balancedLast = [...moved, ...last]
        if (balancedLast.join(' ').length <= charLimit) {
          chunks[chunks.length - 2] = previous.join(' ')
          chunks[chunks.length - 1] = balancedLast.join(' ')
        }
      }
    }
  }

  return chunks
}

export function formatMessage(text, options = {}) {
  const divider = String(options.dividerEmoji || settings.dividerEmoji || '🪷')
  const contentEmojis = Array.isArray(settings.contentEmojis) && settings.contentEmojis.length
    ? settings.contentEmojis.filter(icon => icon && icon !== divider)
    : ['💮', '🌸']
  const title = String(options.title || settings.botName || 'SAKURA-MD').trim().toUpperCase()
  const lines = normalizeSourceLines(text)
  const body = []
  let visibleIndex = 0

  for (const line of lines) {
    if (!line) {
      body.push('│')
      continue
    }

    const chunks = wrapSakuraLine(
      boldImportant(line),
      options.maxWords ?? 7,
      options.maxChars ?? 72
    )
    const icon = contentEmojis[visibleIndex % contentEmojis.length] || '💮'
    visibleIndex += 1

    chunks.forEach((chunk, index) => {
      // Primeira linha: marcador + emoji. Continuação: só indentação, sem seta.
      body.push(index === 0 ? `│ ▢ ${icon} ${chunk}` : `│    ${chunk}`)
    })
  }

  if (!body.length) body.push('│ ▢ 💮 …')

  return [
    `╭━━⪩ ${divider} *${title}* ⪨━━`,
    ...body,
    `╰━━─「${divider}」─━━`
  ].join('\n')
}

export function findCommandSuggestions(commandName, commands, limit = 3, role = 'member') {
  const target = normalizeCommand(commandName)
  if (!target || target.length > 80 || /\s/.test(target)) return []

  const candidates = uniqueCommands(commands)
    .filter(command => !command.hidden && visibleCommandForRole(command, role))
    .map(command => {
      const names = [command.name, ...(command.aliases || [])].map(normalizeCommand).filter(Boolean)
      let best = { distance: Number.POSITIVE_INFINITY, prefix: false, contains: false, lengthGap: 999 }

      for (const name of names) {
        const distance = levenshtein(target, name)
        const candidate = {
          distance,
          prefix: name.startsWith(target) || target.startsWith(name),
          contains: name.includes(target) || target.includes(name),
          lengthGap: Math.abs(name.length - target.length)
        }
        if (
          candidate.distance < best.distance ||
          (candidate.distance === best.distance && candidate.lengthGap < best.lengthGap)
        ) best = candidate
      }

      const normalizedDistance = best.distance / Math.max(target.length, normalizeCommand(command.name).length, 1)
      const score = best.distance * 10 + best.lengthGap - (best.prefix ? 8 : 0) - (best.contains ? 3 : 0)
      return { name: command.name, ...best, normalizedDistance, score }
    })
    .filter(item => {
      if (target.length <= 2) return item.prefix && item.distance <= 1
      if (item.prefix && item.distance <= Math.max(2, Math.floor(target.length * 0.45))) return true
      if (item.contains && item.distance <= Math.max(2, Math.floor(target.length * 0.4))) return true
      if (target.length >= 3 && item.distance <= 2) return true
      return item.distance <= 3 && item.normalizedDistance <= 0.46
    })
    .sort((a, b) => a.score - b.score || a.distance - b.distance || a.name.localeCompare(b.name, 'pt-BR'))

  return [...new Set(candidates.map(item => item.name))].slice(0, Math.max(1, Math.min(5, Number(limit) || 3)))
}

export function buildCommandNotFound(commandName, commands, { role = 'member' } = {}) {
  const cleanName = String(commandName || '').trim()
  const suggestions = findCommandSuggestions(cleanName, commands, 3, role)
  const flower = settings.contentEmojis?.[0] || '💮'

  return [
    `Comando não encontrado: ${settings.prefix}${cleanName}`,
    suggestions.length
      ? `${flower} Talvez: *${suggestions.map(name => `${settings.prefix}${name}`).join(', ')}*`
      : `${flower} Use *${settings.prefix}menu*`
  ].join('\n')
}
