// Tema do terminal da Sakura: uma linha por evento, colunas alinhadas.
//   HH:MM:SS │ ESCOPO │ mensagem
const ANSI = Object.freeze({
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  pink: '\x1b[38;5;213m', red: '\x1b[91m', yellow: '\x1b[93m',
  green: '\x1b[92m', cyan: '\x1b[96m', white: '\x1b[97m', gray: '\x1b[90m'
})

const SCOPE_SHORT = Object.freeze({
  SYSTEM: 'SYS', CONNECTION: 'CONN', COMMANDS: 'CMD', MESSAGES: 'MSG', EVENTS: 'EVT',
  BAILEYS: 'WA', 'BAILEYS-DIAG': 'WA!', MEDIA: 'MEDIA', AI: 'AI', PANEL: 'PANEL',
  BACKUP: 'BKP', TERMINAL: 'TERM'
})
const SCOPE_WIDTH = 5
const MARKERS = Object.freeze({ trace: '·', debug: '·', info: ' ', success: '✓', warn: '!', error: '×', fatal: '×' })
const LEVEL_COLOR = Object.freeze({ error: ANSI.red, fatal: ANSI.red, warn: ANSI.yellow, success: ANSI.green, debug: ANSI.cyan, trace: ANSI.gray })

export function colorEnabled(stream = process.stdout) {
  if (process.env.NO_COLOR) return false
  if (process.env.FORCE_COLOR) return true
  return Boolean(stream?.isTTY)
}

function paint(code, text, on) { return on ? `${code}${text}${ANSI.reset}` : String(text) }

export function compactScope(scope = 'APP') {
  const key = String(scope || 'APP').trim().toUpperCase()
  return (SCOPE_SHORT[key] || key).slice(0, SCOPE_WIDTH)
}

const clean = (value, max) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max)

export function formatSakuraTerminalLine({ time, level, scope, message, suffix = '', color = colorEnabled() }) {
  const levelKey = String(level || 'info').toLowerCase()
  const tone = LEVEL_COLOR[levelKey] || ANSI.pink
  const marker = MARKERS[levelKey] ?? ' '
  const bar = paint(ANSI.gray, '│', color)
  const head = `${paint(ANSI.gray, time, color)} ${bar} ${paint(tone, compactScope(scope).padEnd(SCOPE_WIDTH), color)} ${paint(tone, marker, color)}`
  const tail = suffix ? (color ? suffix : suffix.replace(/\x1b\[[0-9;]*m/g, '')) : ''
  return `${head} ${paint(ANSI.white, message, color)}${tail}`
}

export function formatSakuraMessageLine({ time, senderName = 'Sem nome', senderNumber = '', isGroup = false, text = '', color = colorEnabled() }) {
  const number = String(senderNumber || '').replace(/\D/g, '')
  const name = clean(senderName, 48) || 'Sem nome'
  const preview = clean(text, 180) || '[mídia]'
  const identity = number ? `${name} (+${number})` : name
  const bar = paint(ANSI.gray, '│', color)
  const dot = paint(ANSI.gray, '·', color)
  return `${paint(ANSI.gray, time, color)} ${bar} ${paint(ANSI.pink, 'MSG'.padEnd(SCOPE_WIDTH), color)}   ${paint(ANSI.white, identity, color)} ${dot} ${paint(ANSI.pink, isGroup ? 'grupo' : 'privado', color)} ${dot} ${paint(ANSI.white, preview, color)}`
}

// Linhas do console interativo (ajuda, respostas de comandos).
export function formatConsoleLine(kind, text, color = colorEnabled()) {
  const tone = ({ ok: ANSI.green, err: ANSI.red, info: ANSI.pink, dim: ANSI.gray })[kind] || ANSI.white
  const mark = ({ ok: '✓', err: '×', info: '›', dim: ' ' })[kind] || '›'
  return `${paint(tone, mark, color)} ${paint(kind === 'dim' ? ANSI.gray : ANSI.white, text, color)}`
}

export function formatConsoleTable(title, rows = [], color = colorEnabled()) {
  const width = Math.max(0, ...rows.map(([key]) => String(key).length))
  const lines = [paint(ANSI.pink + ANSI.bold, title, color)]
  for (const [key, value] of rows) lines.push(`  ${paint(ANSI.gray, String(key).padEnd(width), color)}  ${value ?? '-'}`)
  return lines.join('\n')
}

export function consolePrompt(color = colorEnabled()) { return paint(ANSI.pink, 'sakura› ', color) }
