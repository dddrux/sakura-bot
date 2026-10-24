import fs from 'node:fs'
import path from 'node:path'
import util from 'node:util'
import { formatConsoleTable, formatSakuraMessageLine, formatSakuraTerminalLine } from './terminal-theme.js'

const LEVELS = Object.freeze({ trace: 10, debug: 20, info: 30, success: 35, warn: 40, error: 50, fatal: 60 })
const COLORS = Object.freeze({
  reset: '\x1b[0m', dim: '\x1b[2m', bold: '\x1b[1m',
  trace: '\x1b[90m', debug: '\x1b[36m', info: '\x1b[34m', success: '\x1b[32m',
  warn: '\x1b[33m', error: '\x1b[31m', fatal: '\x1b[41m\x1b[97m'
})

const SECRET_KEYS = /(?:qr|secret|private|privKey|rootKey|chainKey|baseKey|identityKey|remoteIdentityKey|ephemeralKey|advSecretKey|noiseKey|signedIdentityKey|pairingEphemeralKeyPair|signedPreKey|accountSyncCounter|registrationId|signalIdentities|myAppStateKeyId|routingInfo|mediaKey|encKey|macKey|devicePairingData|eRegid|eIdent|eSkeyId|eSkeyVal|eSkeySig|buildHash|preKey|sessionKey|authState)/i
const JID_PATTERN = /(\d+)(?::\d+)?@(s\.whatsapp\.net|lid|g\.us|broadcast)/gi
const LOW_POWER_ARM = process.arch === 'arm' || process.arch === 'arm64'
const LOG_FLUSH_MS = Math.max(25, Number(process.env.LOG_FLUSH_MS) || (LOW_POWER_ARM ? 900 : 250))
const LOG_BUFFERS = new Map()
let flushTimer = null

function flushLogBuffersSync() {
  if (flushTimer) clearTimeout(flushTimer)
  flushTimer = null
  for (const [file, chunks] of LOG_BUFFERS) {
    if (!chunks.length) continue
    LOG_BUFFERS.set(file, [])
    try { fs.appendFileSync(file, chunks.join('')) } catch {}
  }
}

function scheduleLogFlush() {
  if (flushTimer) return
  flushTimer = setTimeout(flushLogBuffersSync, LOG_FLUSH_MS)
  flushTimer.unref?.()
}

function queueLogLine(file, line, immediate = false) {
  const chunks = LOG_BUFFERS.get(file) || []
  chunks.push(line)
  LOG_BUFFERS.set(file, chunks)
  if (immediate || chunks.length >= (LOW_POWER_ARM ? 250 : 120) || chunks.reduce((size, item) => size + item.length, 0) >= 128 * 1024) flushLogBuffersSync()
  else scheduleLogFlush()
}

// Ganchos do console interativo: limpam/redesenham o prompt ao redor de cada linha de log.
const consoleHooks = { before: null, after: null }
let consoleLevelOverride = null
export function setConsoleHooks({ before = null, after = null } = {}) { consoleHooks.before = before; consoleHooks.after = after }
export function setConsoleLevel(level) {
  if (level == null) { consoleLevelOverride = null; return null }
  if (!LEVELS[level]) throw new Error(`nível inválido: ${level}`)
  consoleLevelOverride = level
  return level
}
export function getConsoleLevel(fallback = 'warn') { return consoleLevelOverride || fallback }
export const LOG_LEVELS = Object.freeze(Object.keys(LEVELS))

process.once('beforeExit', flushLogBuffersSync)
process.once('exit', flushLogBuffersSync)

function normalizeJidsInString(value) {
  return String(value).replace(JID_PATTERN, (_, digits) => digits)
}

function localDateParts(date = new Date()) {
  const pad = value => String(value).padStart(2, '0')
  return {
    date: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    time: `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  }
}

function sanitize(value, key = '', seen = new WeakSet(), depth = 0) {
  if (SECRET_KEYS.test(key)) return '[REDACTED]'
  if (typeof value === 'string') {
    const clean = String(value).replace(/[\u0000-\u001f\u007f]/g, ' ').trim()
    if (/jid/i.test(key)) return clean.slice(0, 220)
    return normalizeJidsInString(clean)
  }
  if (value == null || typeof value === 'number' || typeof value === 'boolean') return value
  if (typeof value === 'bigint') return String(value)
  if (typeof value === 'function') return `[Function ${value.name || 'anonymous'}]`
  if (Buffer.isBuffer(value)) return `<Buffer ${value.length} bytes>`
  if (value instanceof Error) {
    return {
      name: value.name,
      message: normalizeJidsInString(value.message),
      code: value.code,
      statusCode: value.output?.statusCode || value.statusCode,
      data: sanitize(value.data, 'data', seen, depth + 1),
      stack: normalizeJidsInString(value.stack || '')
    }
  }
  if (depth > 6) return '[MaxDepth]'
  if (typeof value === 'object') {
    if (seen.has(value)) return '[Circular]'
    seen.add(value)
    if (Array.isArray(value)) return value.slice(0, 50).map((item, index) => sanitize(item, String(index), seen, depth + 1))
    const output = {}
    for (const [childKey, childValue] of Object.entries(value)) output[childKey] = sanitize(childValue, childKey, seen, depth + 1)
    return output
  }
  return normalizeJidsInString(String(value))
}

function parseArgs(first, second) {
  if (typeof first === 'string') return { message: first, data: second }
  if (typeof second === 'string') return { message: second, data: first }
  return { message: typeof first === 'undefined' ? '' : util.format(first), data: undefined }
}

function compactData(data, { verbose = false } = {}) {
  if (!data || typeof data !== 'object') return data == null ? '' : String(data)
  const common = ['statusCode', 'reason', 'reasonName', 'connection', 'attempt', 'retryCount', 'delayMs', 'command', 'alias', 'count', 'aliases', 'groupName', 'durationMs', 'queueDepth', 'queuedMessages', 'event', 'action', 'state', 'hasCreds', 'sessionFiles', 'chats', 'contacts', 'messages', 'bytes', 'platform', 'release', 'arch', 'pid']
  const diagnostics = ['source', 'subsystem', 'stage', 'retryScheduled', 'retryDelayMs', 'selection', 'selectionSource', 'identityMs', 'parseMs', 'commandParseMs', 'permissionMs', 'metadataMs', 'mentionsMs', 'forwardMs', 'generationMs', 'relayMs', 'executionMs', 'queueWaitMs', 'activeChats', 'activeMessages', 'batchIndex', 'requestId', 'messageId', 'messageType', 'quotedType', 'e2eType', 'type', 'upsertType', 'participants', 'mentions', 'argsCount', 'rawArgLength', 'isGroup', 'isAdmin', 'botIsAdmin', 'metadataSource', 'metadataCacheHit', 'cacheHit', 'cacheAgeMs', 'stale', 'cachedOnly', 'referenced', 'audio', 'sticker', 'trigger', 'reasonLength', 'reasonPreview', 'textPreview', 'progress', 'file', 'category', 'format', 'fps', 'estimatedBytes', 'cpus', 'totalMemoryMb', 'freeMemoryMb', 'heartbeatMs', 'maintenanceMs', 'staleSocketMs', 'idleMs', 'lastMessageAgoMs', 'wsOpen', 'rssMb', 'heapMb', 'externalMb', 'uptimeSec', 'reconnectAttempts']
  const preferred = verbose ? [...common, ...diagnostics] : common
  const pairs = []
  if (data.error && typeof data.error === 'object') {
    const errorLabel = [data.error.name, data.error.code, data.error.message].filter(Boolean).join(': ')
    if (errorLabel) pairs.push(`error=${util.format(errorLabel.slice(0, 180))}`)
  }
  if (data.warning && typeof data.warning === 'object') {
    const warningLabel = [data.warning.name, data.warning.code, data.warning.message].filter(Boolean).join(': ')
    if (warningLabel) pairs.push(`warning=${util.format(warningLabel.slice(0, 180))}`)
  }
  for (const key of preferred) {
    if (data[key] !== undefined && data[key] !== null && data[key] !== '') pairs.push(`${key}=${util.format(data[key])}`)
  }
  return pairs.join(' ')
}

export class TerminalLogger {
  constructor({ scope = 'APP', level = 'warn', fileLevel = 'debug', logsDir, bindings = {} } = {}) {
    this.scope = scope
    this.level = LEVELS[level] ? level : 'warn'
    this.fileLevel = LEVELS[fileLevel] ? fileLevel : 'debug'
    this.logsDir = logsDir
    this.bindings = bindings
    if (logsDir) fs.mkdirSync(logsDir, { recursive: true })
  }

  child(bindings = {}) {
    const scope = bindings.scope || bindings.class || bindings.module || this.scope
    return new TerminalLogger({ scope: String(scope).toUpperCase(), level: this.level, fileLevel: this.fileLevel, logsDir: this.logsDir, bindings: { ...this.bindings, ...bindings } })
  }

  isLevelEnabled(level, threshold = this.level) { return LEVELS[level] >= LEVELS[threshold] }

  write(level, first, second) {
    const parsed = parseArgs(first, second)
    const rawMessage = String(parsed.message || '')
    const statusCode = Number(parsed.data?.statusCode || parsed.data?.error?.output?.statusCode || 0)

    const diagnosticText = `${rawMessage} ${String(parsed.data?.reason || '')} ${String(parsed.data?.message || '')} ${String(parsed.data?.error?.message || '')}`
    if ((statusCode === 515 || /restartrequired|restart required/i.test(diagnosticText)) && /stream errored out|restart required/i.test(diagnosticText)) level = 'info'
    if (/no name present, ignoring presence/i.test(rawMessage)) level = 'debug'
    if (/Decrypted message with closed session|Closing session:/i.test(rawMessage)) level = 'debug'
    if (/blocked on missing key.*parking/i.test(rawMessage)) level = 'debug'
    if (/failed to obtain extra info/i.test(rawMessage)) level = 'debug'
    if (/failed to decrypt secretEncryptedMessage MESSAGE_EDIT/i.test(rawMessage)) level = 'debug'
    const nestedErrorMessage = String(parsed.data?.error?.message || parsed.data?.err?.message || parsed.data?.message || '')
    if (/transaction failed, rolling back/i.test(rawMessage) && /decrypt|session|cipher|sender key|bad mac|no matching/i.test(nestedErrorMessage)) level = 'debug'
    if (/failed to decrypt message/i.test(rawMessage)) level = 'warn'

    const consoleEnabled = this.isLevelEnabled(level, consoleLevelOverride || this.level)
    const fileEnabled = Boolean(this.logsDir) && this.isLevelEnabled(level, this.fileLevel)
    if (!consoleEnabled && !fileEnabled) return
    const now = new Date()
    const { date, time } = localDateParts(now)
    const cleanData = sanitize(parsed.data)
    const cleanBindings = sanitize(this.bindings)
    const message = normalizeJidsInString(parsed.message || '')
    const scope = String(this.scope).slice(0, 18).padEnd(18)
    const summary = compactData(cleanData, { verbose: level === 'debug' || level === 'trace' })
    const suffix = summary ? `  ${COLORS.dim}· ${summary}${COLORS.reset}` : ''
    const line = this.scope === 'MESSAGES' && cleanData && typeof cleanData === 'object'
      ? formatSakuraMessageLine({
          time,
          senderName: cleanData.senderName,
          senderNumber: cleanData.senderNumber,
          isGroup: Boolean(cleanData.isGroup),
          text: cleanData.textPreview || (cleanData.command ? `.${cleanData.command}` : message)
        })
      : formatSakuraTerminalLine({
          time,
          level,
          scope: scope.trim(),
          message,
          suffix
        })
    if (consoleEnabled) {
      const stream = level === 'error' || level === 'fatal' ? process.stderr : process.stdout
      try { consoleHooks.before?.() } catch {}
      stream.write(`${line}\n`)
      try { consoleHooks.after?.() } catch {}
    }

    if (fileEnabled) {
      const entry = JSON.stringify({ timestamp: now.toISOString(), level, scope: this.scope, message, bindings: cleanBindings, data: cleanData })
      const line = `${entry}\n`
      const immediate = level === 'error' || level === 'fatal'
      queueLogLine(path.join(this.logsDir, `${date}.jsonl`), line, immediate)
      queueLogLine(path.join(this.logsDir, 'latest.jsonl'), line, immediate)
    }
  }

  trace(first, second) { this.write('trace', first, second) }
  debug(first, second) { this.write('debug', first, second) }
  info(first, second) { this.write('info', first, second) }
  success(first, second) { this.write('success', first, second) }
  warn(first, second) { this.write('warn', first, second) }
  error(first, second) { this.write('error', first, second) }
  fatal(first, second) { this.write('fatal', first, second) }


  flush() { flushLogBuffersSync() }

  diagnosis(title, rows = []) {
    process.stderr.write(`\n${formatConsoleTable(title, rows)}\n\n`)
  }
}

export function createLogger(options) { return new TerminalLogger(options) }
