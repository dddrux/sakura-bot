import makeRawWASocket from '../Socket/index.js'
import { Browsers, fetchLatestWaWebVersion } from '../Utils/index.js'
import { DisconnectReason } from '../Types/index.js'
import { DEFAULT_CONNECTION_CONFIG } from '../Defaults/index.js'
import { proto } from '../../WAProto/index.js'
import { getNativeFlowBizBinaryNode } from '../WABinary/index.js'

export const SAKURA_FORK_INFO = Object.freeze({
  name: '@sakura-md/baileys',
  version: '1.8.5-group-status.1',
  base: '@whiskeysockets/baileys 7.0.0-rc13 + camada Sakura',
  channel: 'stable-rc13'
})

const REASON_NAMES = new Map([
  [DisconnectReason.connectionClosed, 'connectionClosed'],
  [DisconnectReason.connectionLost, 'connectionLost/timedOut'],
  [DisconnectReason.connectionReplaced, 'connectionReplaced'],
  [DisconnectReason.loggedOut, 'loggedOut'],
  [DisconnectReason.badSession, 'badSession'],
  [DisconnectReason.restartRequired, 'restartRequired'],
  [DisconnectReason.multideviceMismatch, 'multideviceMismatch'],
  [DisconnectReason.forbidden, 'forbidden'],
  [DisconnectReason.unavailableService, 'unavailableService']
])

function getStatusCode(error) {
  return Number(
    error?.output?.statusCode ??
    error?.statusCode ??
    error?.data?.statusCode ??
    0
  ) || 0
}

function getDiagnostics(error) {
  const data = error?.data
  if (!data || typeof data !== 'object') return {}

  const reasonNode = data.reasonNode || (data.tag ? data : undefined)
  const fullErrorNode = data.fullErrorNode
  const conflictType =
    data.conflictType ||
    reasonNode?.attrs?.type ||
    fullErrorNode?.content?.[0]?.attrs?.type

  return {
    source: data.source,
    reason: data.reason,
    conflictType,
    reasonNode,
    fullErrorNode
  }
}

export function analyzeDisconnect(error) {
  const statusCode = getStatusCode(error)
  const diagnostics = getDiagnostics(error)
  const reasonName = diagnostics.reason || REASON_NAMES.get(statusCode) || 'unknown'
  const conflictType = diagnostics.conflictType || null

  let retryable = false
  let resetSession = false
  let stop = false
  let severity = 'error'
  let action = 'Verifique os dados do erro antes de reiniciar.'

  switch (statusCode) {
    case DisconnectReason.restartRequired:
      retryable = true
      severity = 'info'
      action = 'Reiniciar o socket imediatamente; a sessão continua válida.'
      break
    case DisconnectReason.connectionClosed:
    case DisconnectReason.connectionLost:
    case DisconnectReason.unavailableService:
      retryable = true
      severity = 'warn'
      action = 'Reconectar com atraso progressivo.'
      break
    case DisconnectReason.connectionReplaced:
      stop = true
      action = 'Feche outra instância do bot que esteja usando a mesma sessão.'
      break
    case DisconnectReason.loggedOut:
      resetSession = true
      stop = true
      action = conflictType === 'device_removed'
        ? 'O WhatsApp removeu este dispositivo vinculado. Gere uma sessão nova.'
        : 'A sessão foi desconectada. Gere uma sessão nova.'
      break
    case DisconnectReason.badSession:
    case DisconnectReason.multideviceMismatch:
      resetSession = true
      stop = true
      action = 'A sessão é incompatível ou está corrompida. Gere uma sessão nova.'
      break
    case DisconnectReason.forbidden:
      stop = true
      action = 'A conexão foi recusada pelo servidor. Não faça reconexão automática.'
      break
    default:
      retryable = statusCode === 0 || statusCode >= 500
      stop = !retryable
      action = retryable
        ? 'Erro desconhecido possivelmente temporário; tentar reconectar com limite.'
        : 'Erro desconhecido não classificado; interromper para evitar loop.'
  }

  return {
    statusCode,
    reasonName,
    conflictType,
    message: error?.message || 'Conexão encerrada sem mensagem',
    retryable,
    resetSession,
    stop,
    severity,
    action,
    diagnostics
  }
}

export async function resolveSakuraWaVersion({ timeoutMs = 8000, logger } = {}) {
  const fallback = [...DEFAULT_CONNECTION_CONFIG.version]
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const result = await fetchLatestWaWebVersion({ signal: controller.signal })
    if (result?.isLatest && Array.isArray(result.version) && result.version.length === 3) {
      return { version: result.version, source: 'web.whatsapp.com', isLatest: true }
    }

    logger?.debug?.({ error: result?.error }, 'versão online indisponível; usando fallback do fork')
    return { version: fallback, source: 'fork-fallback', isLatest: false, error: result?.error }
  } catch (error) {
    logger?.debug?.({ error }, 'consulta de versão falhou; usando fallback do fork')
    return { version: fallback, source: 'fork-fallback', isLatest: false, error }
  } finally {
    clearTimeout(timer)
  }
}


function digitsFromJid(value = '') {
  return String(value || '').split('@')[0].split(':')[0].replace(/\D/g, '')
}

function unwrapSakuraMessage(message = {}) {
  let current = message || {}
  for (let depth = 0; depth < 12; depth += 1) {
    const next =
      current?.ephemeralMessage?.message ||
      current?.viewOnceMessage?.message ||
      current?.viewOnceMessageV2?.message ||
      current?.viewOnceMessageV2Extension?.message ||
      current?.documentWithCaptionMessage?.message ||
      current?.deviceSentMessage?.message ||
      current?.editedMessage?.message ||
      current?.protocolMessage?.editedMessage
    if (!next) break
    current = next
  }
  return current || {}
}

export function extractSakuraSelection(message = {}) {
  const content = unwrapSakuraMessage(message)
  const direct =
    content?.buttonsResponseMessage?.selectedButtonId ||
    content?.listResponseMessage?.singleSelectReply?.selectedRowId ||
    content?.templateButtonReplyMessage?.selectedId
  if (direct) return String(direct).trim()
  return parseSakuraNativeFlowResponse(
    content?.interactiveResponseMessage?.nativeFlowResponseMessage?.paramsJson ||
    content?.interactiveResponseMessage ||
    ''
  )
}

function summarizeSakuraMessage(message = {}) {
  const content = unwrapSakuraMessage(message)
  const keys = Object.keys(content)
  return {
    type: keys.find(key => !['messageContextInfo', 'senderKeyDistributionMessage'].includes(key)) || keys[0] || 'unknown',
    selection: extractSakuraSelection(content) || undefined,
    wrapped: message !== content
  }
}


function normalizeMentionJid(value = '') {
  const jid = String(value || '').trim()
  if (!jid) return ''
  if (jid.includes('@')) return jid
  const digits = digitsFromJid(jid)
  return digits ? `${digits}@s.whatsapp.net` : ''
}

export function buildSakuraMentionJids(metadata = {}, { exclude = [] } = {}) {
  const excluded = new Set((Array.isArray(exclude) ? exclude : [exclude]).map(digitsFromJid).filter(Boolean))
  const seen = new Set()
  const mentions = []
  for (const participant of metadata?.participants || []) {
    const phoneCandidate = [participant?.phoneNumber, participant?.participantPn, participant?.pn, participant?.jid]
      .map(normalizeMentionJid)
      .find(value => /@(s\.whatsapp\.net|hosted)$/i.test(value))
    const candidate = phoneCandidate || normalizeMentionJid(participant?.id || participant?.lid || participant?.jid)
    const digits = digitsFromJid(candidate)
    if (!candidate || !digits || excluded.has(digits) || seen.has(candidate)) continue
    seen.add(candidate)
    mentions.push(candidate)
  }
  return mentions
}

function estimateSakuraPayload(value, depth = 0, seen = new WeakSet()) {
  if (value == null) return 0
  if (typeof value === 'string') return Buffer.byteLength(value)
  if (typeof value === 'number' || typeof value === 'boolean') return 8
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) return value.byteLength
  if (typeof value !== 'object' || depth > 4) return 0
  if (seen.has(value)) return 0
  seen.add(value)
  if (Array.isArray(value)) return value.slice(0, 100).reduce((sum, item) => sum + estimateSakuraPayload(item, depth + 1, seen), 0)
  return Object.entries(value).slice(0, 100).reduce((sum, [key, child]) => sum + Buffer.byteLength(key) + estimateSakuraPayload(child, depth + 1, seen), 0)
}

function isTransientSakuraSendError(error) {
  const status = getStatusCode(error)
  const code = String(error?.code || error?.cause?.code || '')
  const message = String(error?.message || '')
  return status === 408 || status === 503 || status === 504 || status >= 500 ||
    /ECONNRESET|ETIMEDOUT|EPIPE|ENETUNREACH|socket.*closed|connection.*closed|websocket/i.test(`${code} ${message}`)
}

export function makeSakuraSocket(config = {}) {
  const {
    sakuraGroupMetadataTtlMs = 120_000,
    sakuraGroupMetadataStaleMs = 5 * 60_000,
    sakuraMessageCacheMax = 1_000,
    sakuraMessageCacheTtlMs = 6 * 60 * 60_000,
    sakuraLidCacheTtlMs = 6 * 60 * 60_000,
    sakuraSendRetryCount = 0,
    ...rawConfig
  } = config || {}

  const recentMessages = new Map()
  const groupMetadataCache = new Map()
  const groupMetadataInflight = new Map()
  const groupMentionCache = new Map()
  const lidNumberCache = new Map()
  const sentDiagnostics = new Map()
  const userGetMessage = typeof rawConfig.getMessage === 'function' ? rawConfig.getMessage : null
  const metrics = {
    startedAt: Date.now(),
    incomingMessages: 0,
    messageCacheHits: 0,
    messageCacheMisses: 0,
    messageCacheStores: 0,
    sendCalls: 0,
    sendSuccess: 0,
    sendErrors: 0,
    sendRetries: 0,
    relayCalls: 0,
    relaySuccess: 0,
    relayErrors: 0,
    groupMetadataHits: 0,
    groupMetadataMisses: 0,
    groupMetadataStaleHits: 0,
    groupMetadataInflightJoins: 0,
    groupMetadataInvalidations: 0,
    lidCacheHits: 0,
    lidCacheMisses: 0,
    selectionEvents: 0
  }

  const rememberMessage = message => {
    const id = message?.key?.id
    if (!id || !message?.message) return
    recentMessages.delete(id)
    recentMessages.set(id, { message: message.message, storedAt: Date.now(), remoteJid: message?.key?.remoteJid })
    metrics.messageCacheStores += 1
    while (recentMessages.size > Math.max(100, Number(sakuraMessageCacheMax) || 1_000)) {
      const oldest = recentMessages.keys().next().value
      if (!oldest) break
      recentMessages.delete(oldest)
    }
  }

  const getMessage = async key => {
    const cached = recentMessages.get(key?.id)
    if (cached?.message && Date.now() - cached.storedAt <= sakuraMessageCacheTtlMs) {
      metrics.messageCacheHits += 1
      return cached.message
    }
    if (cached) recentMessages.delete(key?.id)
    metrics.messageCacheMisses += 1
    return userGetMessage ? userGetMessage(key) : undefined
  }

  const socket = makeRawWASocket({
    browser: Browsers.ubuntu('Chrome'),
    markOnlineOnConnect: false,
    syncFullHistory: false,
    shouldSyncHistoryMessage: ({ syncType }) => [
      proto.HistorySync.HistorySyncType.INITIAL_BOOTSTRAP,
      proto.HistorySync.HistorySyncType.PUSH_NAME,
      proto.HistorySync.HistorySyncType.NON_BLOCKING_DATA
    ].includes(syncType),
    generateHighQualityLinkPreview: false,
    connectTimeoutMs: 60_000,
    defaultQueryTimeoutMs: 60_000,
    keepAliveIntervalMs: 20_000,
    retryRequestDelayMs: 350,
    maxMsgRetryCount: 6,
    enableAutoSessionRecreation: true,
    enableRecentMessageCache: true,
    ...rawConfig,
    getMessage
  })

  const emitDebug = payload => {
    try {
      socket.ev.emit('sakura.debug', {
        timestamp: Date.now(),
        ...payload
      })
    } catch {}
  }

  const pruneCaches = () => {
    const now = Date.now()
    let removedMessages = 0
    let removedGroups = 0
    let removedLids = 0
    for (const [id, entry] of recentMessages) {
      if (now - entry.storedAt > sakuraMessageCacheTtlMs) {
        recentMessages.delete(id)
        removedMessages += 1
      }
    }
    for (const [jid, entry] of groupMetadataCache) {
      if (now - entry.fetchedAt > sakuraGroupMetadataStaleMs) {
        groupMetadataCache.delete(jid)
        groupMentionCache.delete(jid)
        removedGroups += 1
      }
    }
    for (const [lid, entry] of lidNumberCache) {
      if (now - entry.storedAt > sakuraLidCacheTtlMs) {
        lidNumberCache.delete(lid)
        removedLids += 1
      }
    }
    return { removedMessages, removedGroups, removedLids }
  }

  const rawGroupMetadata = typeof socket.groupMetadata === 'function' ? socket.groupMetadata.bind(socket) : null
  const invalidateGroupMetadata = (jid, reason = 'manual') => {
    const key = String(jid || '')
    const existed = groupMetadataCache.delete(key) || groupMentionCache.delete(key)
    groupMentionCache.delete(key)
    if (existed) metrics.groupMetadataInvalidations += 1
    emitDebug({ subsystem: 'group-metadata', stage: 'invalidate', chat: digitsFromJid(key), reason, existed })
    return existed
  }

  const getGroupMetadataDetailed = async (jid, options = {}) => {
    const key = String(jid || '')
    if (!key || !rawGroupMetadata) throw new Error('Metadados de grupo indisponíveis no socket.')
    const force = Boolean(options.force)
    const allowStale = options.allowStale !== false
    const maxAgeMs = Number.isFinite(Number(options.maxAgeMs)) ? Number(options.maxAgeMs) : sakuraGroupMetadataTtlMs
    const now = Date.now()
    const cached = groupMetadataCache.get(key)
    const ageMs = cached ? now - cached.fetchedAt : -1

    if (!force && cached && ageMs <= maxAgeMs) {
      cached.lastAccess = now
      metrics.groupMetadataHits += 1
      emitDebug({ subsystem: 'group-metadata', stage: 'hit', chat: digitsFromJid(key), cacheHit: true, cacheAgeMs: ageMs, participants: cached.metadata?.participants?.length || 0 })
      return { metadata: cached.metadata, cacheHit: true, stale: false, ageMs, source: 'cache' }
    }

    if (!force && groupMetadataInflight.has(key)) {
      metrics.groupMetadataInflightJoins += 1
      emitDebug({ subsystem: 'group-metadata', stage: 'join-inflight', chat: digitsFromJid(key), cacheAgeMs: ageMs })
      return groupMetadataInflight.get(key)
    }

    metrics.groupMetadataMisses += 1
    const startedAt = Date.now()
    const task = (async () => {
      try {
        const metadata = await rawGroupMetadata(key)
        const entry = { metadata, fetchedAt: Date.now(), lastAccess: Date.now() }
        groupMetadataCache.delete(key)
        groupMetadataCache.set(key, entry)
        groupMentionCache.delete(key)
        while (groupMetadataCache.size > 250) {
          const oldest = groupMetadataCache.keys().next().value
          if (!oldest) break
          groupMetadataCache.delete(oldest)
          groupMentionCache.delete(oldest)
        }
        emitDebug({ subsystem: 'group-metadata', stage: 'fetch-success', chat: digitsFromJid(key), cacheHit: false, participants: metadata?.participants?.length || 0, durationMs: Date.now() - startedAt })
        return { metadata, cacheHit: false, stale: false, ageMs: 0, source: 'network' }
      } catch (error) {
        const staleAgeMs = cached ? Date.now() - cached.fetchedAt : -1
        if (allowStale && cached && staleAgeMs <= sakuraGroupMetadataStaleMs) {
          metrics.groupMetadataStaleHits += 1
          emitDebug({ subsystem: 'group-metadata', stage: 'stale-fallback', chat: digitsFromJid(key), cacheHit: true, stale: true, cacheAgeMs: staleAgeMs, durationMs: Date.now() - startedAt, error })
          return { metadata: cached.metadata, cacheHit: true, stale: true, ageMs: staleAgeMs, source: 'stale-cache', error }
        }
        emitDebug({ subsystem: 'group-metadata', stage: 'fetch-error', chat: digitsFromJid(key), durationMs: Date.now() - startedAt, error })
        throw error
      } finally {
        groupMetadataInflight.delete(key)
      }
    })()
    groupMetadataInflight.set(key, task)
    return task
  }

  if (rawGroupMetadata) {
    socket.groupMetadata = async (jid, options = {}) => (await getGroupMetadataDetailed(jid, options)).metadata
  }

  const rawSendMessage = socket.sendMessage.bind(socket)
  socket.sendMessage = async (...args) => {
    const [jid, content] = args
    const startedAt = Date.now()
    const summary = summarizeSakuraMessage(content)
    const estimatedBytes = estimateSakuraPayload(content)
    metrics.sendCalls += 1
    emitDebug({ subsystem: 'send', stage: 'start', chat: digitsFromJid(jid), messageType: summary.type, estimatedBytes })
    let attempt = 0
    while (true) {
      try {
        const sent = await rawSendMessage(...args)
        rememberMessage(sent)
        metrics.sendSuccess += 1
        if (sent?.key?.id) {
          sentDiagnostics.set(sent.key.id, {
            ...summarizeSakuraMessage(sent.message || content),
            jid: digitsFromJid(jid),
            sentAt: Date.now(),
            durationMs: Date.now() - startedAt,
            estimatedBytes,
            attempt
          })
          while (sentDiagnostics.size > 1_000) sentDiagnostics.delete(sentDiagnostics.keys().next().value)
        }
        emitDebug({ subsystem: 'send', stage: 'success', chat: digitsFromJid(jid), id: sent?.key?.id, messageType: summary.type, estimatedBytes, attempt, durationMs: Date.now() - startedAt })
        return sent
      } catch (error) {
        const transient = isTransientSakuraSendError(error)
        if (transient && attempt < Math.max(0, Number(sakuraSendRetryCount) || 0)) {
          attempt += 1
          metrics.sendRetries += 1
          const delayMs = 150 * attempt
          emitDebug({ subsystem: 'send', stage: 'retry', chat: digitsFromJid(jid), messageType: summary.type, attempt, delayMs, error })
          await new Promise(resolve => setTimeout(resolve, delayMs))
          continue
        }
        metrics.sendErrors += 1
        emitDebug({ subsystem: 'send', stage: 'error', chat: digitsFromJid(jid), messageType: summary.type, estimatedBytes, attempt, durationMs: Date.now() - startedAt, error })
        throw error
      }
    }
  }

  const rawRelayMessage = typeof socket.relayMessage === 'function' ? socket.relayMessage.bind(socket) : null
  if (rawRelayMessage) {
    socket.relayMessage = async (jid, message, options = {}) => {
      const startedAt = Date.now()
      const summary = summarizeSakuraMessage(message)
      metrics.relayCalls += 1
      emitDebug({ subsystem: 'relay', stage: 'start', chat: digitsFromJid(jid), id: options?.messageId, messageType: summary.type, estimatedBytes: estimateSakuraPayload(message) })
      try {
        const result = await rawRelayMessage(jid, message, options)
        metrics.relaySuccess += 1
        emitDebug({ subsystem: 'relay', stage: 'success', chat: digitsFromJid(jid), id: options?.messageId, messageType: summary.type, durationMs: Date.now() - startedAt })
        return result
      } catch (error) {
        metrics.relayErrors += 1
        emitDebug({ subsystem: 'relay', stage: 'error', chat: digitsFromJid(jid), id: options?.messageId, messageType: summary.type, durationMs: Date.now() - startedAt, error })
        throw error
      }
    }
  }

  socket.ev.on('messages.upsert', ({ messages, type, requestId }) => {
    metrics.incomingMessages += messages?.length || 0
    emitDebug({ subsystem: 'receive', stage: 'upsert', upsertType: type, requestId, count: messages?.length || 0 })
    for (const message of messages || []) {
      rememberMessage(message)
      const selection = extractSakuraSelection(message?.message)
      if (selection) {
        metrics.selectionEvents += 1
        socket.ev.emit('sakura.selection', {
          id: message?.key?.id,
          from: digitsFromJid(message?.key?.remoteJid),
          participant: digitsFromJid(message?.key?.participantAlt || message?.key?.participant),
          type,
          selection,
          messageType: summarizeSakuraMessage(message?.message).type
        })
      }
    }
  })

  socket.ev.on('group-participants.update', payload => invalidateGroupMetadata(payload?.id, `participants:${payload?.action || 'update'}`))
  socket.ev.on('groups.update', updates => {
    for (const update of updates || []) invalidateGroupMetadata(update?.id, 'groups.update')
  })

  const define = (name, value, enumerable = false) => Object.defineProperty(socket, name, {
    value,
    enumerable,
    configurable: false,
    writable: false
  })

  define('sakuraFork', SAKURA_FORK_INFO, true)
  define('sakuraMessageCache', recentMessages)
  define('sakuraSentDiagnostics', sentDiagnostics)
  define('sakuraMetrics', metrics)
  define('sakuraGetGroupMetadata', getGroupMetadataDetailed)
  define('sakuraPeekGroupMetadata', jid => {
    const key = String(jid || '')
    const cached = groupMetadataCache.get(key)
    if (!cached) return null
    const ageMs = Date.now() - cached.fetchedAt
    return { metadata: cached.metadata, cacheHit: true, stale: ageMs > sakuraGroupMetadataTtlMs, ageMs, source: 'peek-cache' }
  })
  define('sakuraInvalidateGroupMetadata', invalidateGroupMetadata)
  define('sakuraGetMentionJids', async (jid, options = {}) => {
    const key = String(jid || '')
    const detail = options.metadata
      ? { metadata: options.metadata, cacheHit: true, stale: false, ageMs: 0, source: 'provided' }
      : await getGroupMetadataDetailed(key, options)
    let cached = groupMentionCache.get(key)
    if (cached?.metadata !== detail.metadata) {
      const mentions = buildSakuraMentionJids(detail.metadata)
      cached = { metadata: detail.metadata, mentions }
      groupMentionCache.set(key, cached)
      emitDebug({ subsystem: 'group-mentions', stage: 'prepared', chat: digitsFromJid(key), mentions: mentions.length, metadataSource: detail.source })
    }
    const excluded = new Set((Array.isArray(options.exclude) ? options.exclude : [options.exclude]).map(digitsFromJid).filter(Boolean))
    return cached.mentions.filter(jidValue => !excluded.has(digitsFromJid(jidValue)))
  })
  define('sakuraResolveNumber', async jid => {
    const value = String(jid || '')
    if (!value) return ''
    if (value.includes('@lid')) {
      const cached = lidNumberCache.get(value)
      if (cached && Date.now() - cached.storedAt <= sakuraLidCacheTtlMs) {
        metrics.lidCacheHits += 1
        return cached.number
      }
      metrics.lidCacheMisses += 1
      try {
        const pn = await socket.signalRepository?.lidMapping?.getPNForLID?.(value)
        const number = digitsFromJid(pn)
        if (number) {
          lidNumberCache.set(value, { number, storedAt: Date.now() })
          emitDebug({ subsystem: 'lid', stage: 'resolved', sender: digitsFromJid(value), resolved: number })
          return number
        }
      } catch (error) {
        emitDebug({ subsystem: 'lid', stage: 'resolve-error', sender: digitsFromJid(value), error })
      }
    }
    return digitsFromJid(value)
  })
  define('sakuraPruneCaches', pruneCaches)
  define('sakuraSnapshotDiagnostics', () => ({
    fork: SAKURA_FORK_INFO.version,
    uptimeMs: Date.now() - metrics.startedAt,
    wsOpen: Boolean(socket?.ws?.isOpen ?? socket),
    recentMessages: recentMessages.size,
    sentDiagnostics: sentDiagnostics.size,
    groupMetadataCache: groupMetadataCache.size,
    groupMetadataInflight: groupMetadataInflight.size,
    lidCache: lidNumberCache.size,
    ...metrics
  }))

  return socket
}


export function createSakuraCommandPoll({
  title = '❄️ SAKURA • COMANDOS',
  options = [],
  selectableCount = 1
} = {}) {
  const values = [...new Set((Array.isArray(options) ? options : [])
    .map(value => String(value || '').trim())
    .filter(Boolean))]
    .slice(0, 12)

  if (!values.length) throw new TypeError('A enquete precisa ter ao menos uma opção válida')

  return {
    poll: {
      name: String(title || '❄️ SAKURA • COMANDOS').trim().slice(0, 255),
      values,
      selectableCount: Math.max(1, Math.min(Number(selectableCount) || 1, values.length))
    }
  }
}


const SELECTION_KEYS = Object.freeze([
  'id',
  'selectedId',
  'selected_id',
  'selectedRowId',
  'selected_row_id',
  'rowId',
  'row_id',
  'command',
  'value'
])

function normalizeListSections(sections = []) {
  if (!Array.isArray(sections)) throw new TypeError('sections precisa ser um array')

  const normalizedSections = []
  for (let sectionIndex = 0; sectionIndex < sections.length; sectionIndex += 1) {
    const section = sections[sectionIndex]
    const rows = Array.isArray(section?.rows) ? section.rows : []
    const normalizedRows = rows
      .map((row) => {
        const id = String(row?.id ?? row?.rowId ?? '').trim()
        const title = String(row?.title ?? '').trim()
        if (!id || !title) return null
        return {
          header: String(row?.header ?? '').trim(),
          title: title.slice(0, 200),
          description: String(row?.description ?? '').trim().slice(0, 300),
          id: id.slice(0, 200)
        }
      })
      .filter(Boolean)

    if (!normalizedRows.length) continue
    const pages = Math.ceil(normalizedRows.length / 10)
    for (let page = 0; page < pages; page += 1) {
      const suffix = pages > 1 ? ` • ${page + 1}/${pages}` : ''
      normalizedSections.push({
        title: `${String(section?.title || `Categoria ${sectionIndex + 1}`).slice(0, 180)}${suffix}`.slice(0, 200),
        ...(section?.highlight_label ? { highlight_label: String(section.highlight_label).slice(0, 50) } : {}),
        rows: normalizedRows.slice(page * 10, (page + 1) * 10)
      })
    }
  }
  return normalizedSections
}

export function createSakuraCommandList({
  title = '',
  body = 'Escolha um comando na lista abaixo.',
  footer = '',
  buttonText = 'comandos ↓',
  sections = [],
  responseMode = 'native',
  image = null,
  quickReplies = []
} = {}) {
  const normalizedSections = normalizeListSections(sections)
  if (!normalizedSections.length) throw new TypeError('A lista precisa ter ao menos uma opção válida')

  const text = [String(title).trim(), String(body).trim()].filter(Boolean).join('\n\n')

  if (responseMode === 'native') {
    return {
      ...(image ? { image, caption: text } : { text }),
      ...(footer ? { footer: String(footer).trim() } : {}),
      nativeFlow: [
        {
          text: String(buttonText || 'comandos ↓').slice(0, 40),
          sections: normalizedSections
        },
        ...((Array.isArray(quickReplies) ? quickReplies : []).slice(0, 2).map(item => ({
          text: String(item?.text || item?.displayText || 'abrir').slice(0, 40),
          quickReply: {
            id: String(item?.id || '').slice(0, 200),
            displayText: String(item?.displayText || item?.text || 'abrir').slice(0, 40)
          }
        })).filter(item => item.quickReply.id))
      ],
      // O WhatsApp atual aceita o single_select dentro de InteractiveMessage
      // encapsulado em viewOnce. O listMessage legado recebe ACK 479.
      viewOnce: true,
      interactiveAsTemplate: false
    }
  }

  return {
    text,
    ...(footer ? { footer: String(footer).trim() } : {}),
    buttonText: String(buttonText || 'comandos ↓').slice(0, 40),
    sections: normalizedSections.map(section => ({
      title: section.title,
      rows: section.rows.map(row => ({
        title: row.title,
        description: row.description,
        rowId: row.id
      }))
    }))
  }
}

function findSelection(value, depth = 0) {
  if (depth > 6 || value == null) return ''
  if (typeof value === 'string') return value.trim()
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findSelection(item, depth + 1)
      if (found) return found
    }
    return ''
  }
  if (typeof value !== 'object') return ''

  for (const key of SELECTION_KEYS) {
    if (Object.prototype.hasOwnProperty.call(value, key)) {
      const found = findSelection(value[key], depth + 1)
      if (found) return found
    }
  }

  for (const child of Object.values(value)) {
    if (child && typeof child === 'object') {
      const found = findSelection(child, depth + 1)
      if (found) return found
    }
  }
  return ''
}


export function createSakuraCopyCard({
  body = '',
  footer = '',
  buttonText = '🧊 copiar modelo',
  copyText = ''
} = {}) {
  const text = String(body || '').trim()
  const copy = String(copyText || '').trim()
  if (!text) throw new TypeError('O cartão precisa de texto')
  if (!copy) throw new TypeError('O botão precisa de um texto para copiar')

  return {
    text,
    ...(footer ? { footer: String(footer).trim() } : {}),
    nativeFlow: [{
      text: String(buttonText || '🧊 copiar modelo').slice(0, 40),
      copy: copy.slice(0, 1000)
    }],
    viewOnce: true,
    interactiveAsTemplate: false
  }
}

export function parseSakuraNativeFlowResponse(paramsJson) {
  if (typeof paramsJson !== 'string') return findSelection(paramsJson)
  const raw = paramsJson.trim()
  if (!raw) return ''
  try {
    return findSelection(JSON.parse(raw)) || raw
  } catch {
    return raw
  }
}


export function formatSakuraText(text = '', {
  title = 'SAKURA BOT',
  icon = '❄️',
  linePrefix = '│',
  width = 16
} = {}) {
  const cleanTitle = String(title || 'SAKURA BOT').replace(/[\r\n]+/g, ' ').trim().slice(0, 60)
  const cleanIcon = String(icon || '❄️').replace(/[\r\n]+/g, ' ').trim().slice(0, 8)
  const prefix = String(linePrefix || '│').replace(/[\r\n]+/g, '').trim() || '│'
  const lines = String(text ?? '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map(line => line.replace(/[\t ]+$/g, ''))

  while (lines.length > 1 && lines[0] === '') lines.shift()
  while (lines.length > 1 && lines[lines.length - 1] === '') lines.pop()

  const body = (lines.length ? lines : ['']).map(line => line ? `${prefix} ${line}` : prefix).join('\n')
  const border = '─'.repeat(Math.max(8, Math.min(40, Number(width) || 16)))
  return `╭─〔 ${cleanIcon} ${cleanTitle} 〕\n${body}\n╰${border}`
}

export default makeSakuraSocket

// Compatibilidade com os testes e integrações antigas da Sakura.
// O gerador atual já produz InteractiveMessage diretamente; esta função
// garante apenas o wrapper viewOnce exigido pelos clientes Multi-Device.
export function patchSakuraInteractiveForMd(message = {}) {
  if (message?.viewOnceMessage?.message?.interactiveMessage) return message
  if (message?.interactiveMessage) return { viewOnceMessage: { message } }
  return message
}

// Representação resumida do nó biz usada somente para diagnóstico.
export function getBizBinaryNode(message = {}) {
  return getNativeFlowBizBinaryNode(unwrapSakuraMessage(message) || message)
}
