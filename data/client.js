import readline from 'node:readline/promises'
import process from 'node:process'
import os from 'node:os'
import qrcode from 'qrcode-terminal'
import makeWASocket, {
  analyzeDisconnect,
  makeCacheableSignalKeyStore,
  resolveSakuraWaVersion,
  useMultiFileAuthState
} from '@sakura-md/baileys'
import { settings, TEST_NOTICE, syncConnectedBotNumber, readConfig, writeConfigSync } from './settings.js'
import { createMessageHandler } from './handler.js'
import { getMessageText } from './messages.js'
import { announceReleaseIfNeeded } from './release-announcer.js'
import { shouldProcessOwnMessage } from './superuser.js'
import { createLogger } from './logger.js'
import { acquireSessionProcessLock, backupAndResetSession, inspectSession } from './session.js'
import { numberFromJid, resolveNumber } from './jid.js'
import { assertFfmpeg } from './media.js'
import { getInteractiveMetadata, pruneInteractiveCache } from './interactive.js'
import { startMediaProcess, stopMediaProcess } from './media-process-client.js'
import { warmPlayManager } from './play-manager.js'
import { repairCopiedSignalState } from './signal-repair.js'
import { startPanel } from './panel.js'
import { FairSemaphore } from './semaphore.js'
import { platformInfo, platformLabel } from './platform.js'
import { startContractScheduler, stopContractScheduler } from './contracts-scheduler.js'
import { handleGroupParticipantsUpdate, startGroupAutomationScheduler, stopGroupAutomationScheduler } from './group-automations.js'
import { installMentionResolver } from './mentions.js'
import { closePrivateProtectionStore, handleIncomingCalls } from './private-protection.js'
import { clearBulkSendQueue } from './bulk-send-queue.js'
import { clearAiDeferredRetries } from './ai-engine.js'
import { closeCommandMediaStore } from './fun-media-store.js'
import { startTerminalConsole } from './terminal-console.js'
import { runtimeSettings, updateRuntimeSettings } from './runtime.js'
import { snapshotPersistentBackup, startPersistentBackupScheduler, stopPersistentBackupScheduler } from './backup-manager.js'

const log = createLogger({ scope: 'SYSTEM', level: settings.logLevel, fileLevel: settings.logFileLevel, logsDir: settings.logsDir })
const connectionLog = log.child({ scope: 'CONNECTION' })
const baileysLog = createLogger({ scope: 'BAILEYS', level: settings.baileysLogLevel, fileLevel: settings.baileysLogFileLevel, logsDir: settings.logsDir })
const baileysDiagLog = createLogger({ scope: 'BAILEYS-DIAG', level: settings.logLevel, fileLevel: settings.logFileLevel, logsDir: settings.logsDir })
const eventsLog = log.child({ scope: 'EVENTS' })
const commandsLog = log.child({ scope: 'COMMANDS' })
const backupLog = log.child({ scope: 'BACKUP' })

function maskNumber(value = '') {
  const digits = numberFromJid(value) || String(value).replace(/\D/g, '')
  if (digits.length < 6) return digits || 'desconhecido'
  return `${digits.slice(0, 3)}***${digits.slice(-2)}`
}


async function askPairingNumber() {
  if (settings.pairingNumber) return settings.pairingNumber
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  const answer = await rl.question('Número com DDI e DDD, somente dígitos: ')
  rl.close()
  return answer.replace(/\D/g, '')
}

class ConnectionManager {
  constructor() {
    this.socket = null
    this.reconnectTimer = null
    this.heartbeatTimer = null
    this.maintenanceTimer = null
    this.reconnectAttempts = 0
    this.connecting = false
    this.stopping = false
    this.autoResetUsed = false
    this.qrCount = 0
    this.versionInfo = null
    this.versionResolvedAt = 0
    this.startedAt = Date.now()
    this.lastEventAt = Date.now()
    this.lastMessageAt = 0
    this.hasRegisteredCreds = false
    this.messageQueues = new Map()
    this.chatQueueDepth = new Map()
    this.queuedMessages = 0
    this.activeMessageTasks = 0
    this.messageSlots = new FairSemaphore(settings.maxConcurrentGroups)
  }

  stopHeartbeat() {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer)
    this.heartbeatTimer = null
  }

  touchEvent(kind = 'event') {
    this.lastEventAt = Date.now()
    if (kind === 'message') this.lastMessageAt = this.lastEventAt
  }

  enqueueMessage(handleMessage, msg, type, { requestId, batchIndex = 0 } = {}) {
    const chatKey = String(msg?.key?.remoteJid || 'unknown')
    const previous = this.messageQueues.get(chatKey) || Promise.resolve()
    const enqueuedAt = Date.now()
    const nextDepth = (this.chatQueueDepth.get(chatKey) || 0) + 1
    this.chatQueueDepth.set(chatKey, nextDepth)
    this.queuedMessages += 1

    let task
    let releaseSlot = null
    task = previous.catch(() => {}).then(async () => {
      releaseSlot = await this.messageSlots.acquire()
      const queueWaitMs = Date.now() - enqueuedAt
      this.queuedMessages = Math.max(0, this.queuedMessages - 1)
      this.activeMessageTasks += 1
      eventsLog.debug({
        stage: 'message-queue-start',
        chat: numberFromJid(chatKey),
        id: msg?.key?.id,
        upsertType: type,
        requestId,
        batchIndex,
        queueWaitMs,
        queueDepth: this.chatQueueDepth.get(chatKey) || 1,
        activeChats: this.messageQueues.size,
        queuedMessages: this.queuedMessages,
        activeMessages: this.activeMessageTasks,
        workerLimit: settings.maxConcurrentGroups,
        workerWaiting: this.messageSlots.snapshot().waiting
      }, 'mensagem liberada pela fila por chat')
      await handleMessage(msg, type, { queueWaitMs, requestId, batchIndex })
    }).catch(error => {
      eventsLog.error({ error, stage: 'message-queue-error', chat: numberFromJid(chatKey), id: msg?.key?.id, requestId, batchIndex }, 'falha fora do handler na fila de mensagens')
    }).finally(() => {
      try { releaseSlot?.() } catch {}
      this.activeMessageTasks = Math.max(0, this.activeMessageTasks - 1)
      const depth = Math.max(0, (this.chatQueueDepth.get(chatKey) || 1) - 1)
      if (depth) this.chatQueueDepth.set(chatKey, depth)
      else this.chatQueueDepth.delete(chatKey)
      if (this.messageQueues.get(chatKey) === task) this.messageQueues.delete(chatKey)
    })

    this.messageQueues.set(chatKey, task)
    eventsLog.debug({
      stage: 'message-queue-enqueue',
      chat: numberFromJid(chatKey),
      id: msg?.key?.id,
      requestId,
      batchIndex,
      queueDepth: nextDepth,
      activeChats: this.messageQueues.size,
      queuedMessages: this.queuedMessages
    }, 'mensagem adicionada à fila independente do chat')
    return task
  }

  stopMaintenance() {
    if (this.maintenanceTimer) clearInterval(this.maintenanceTimer)
    this.maintenanceTimer = null
  }

  startMaintenance() {
    this.stopMaintenance()
    if (!Number.isFinite(settings.baileysMaintenanceMs) || settings.baileysMaintenanceMs <= 0) return
    const run = async () => {
      const startedAt = Date.now()
      const socket = this.socket
      const wsOpen = Boolean(socket?.ws?.isOpen ?? socket)
      const idleMs = Date.now() - this.lastEventAt
      const cache = pruneInteractiveCache()
      const forkPrune = socket?.sakuraPruneCaches?.() || {}
      const forkDiagnostics = socket?.sakuraSnapshotDiagnostics?.() || {}
      const session = await inspectSession(settings.sessionDir).catch(() => ({ hasCreds: false, fileCount: 0 }))

      if (this.versionInfo && Date.now() - this.versionResolvedAt > settings.versionRefreshMs) {
        this.versionInfo = null
        this.versionResolvedAt = 0
        connectionLog.debug({ stage: 'maintenance', action: 'version-cache-reset' }, 'cache de versão do WhatsApp renovado')
      }

      if (!socket || !wsOpen) {
        connectionLog.warn({ stage: 'maintenance', action: 'socket-recovery', idleMs, sessionFiles: session.fileCount }, 'socket inativo detectado pela manutenção')
        this.scheduleReconnect('manutenção detectou socket inativo', 1200, true)
        return
      }

      if (idleMs >= settings.staleSocketMs) {
        try {
          await socket.sendPresenceUpdate?.('available')
          this.touchEvent('maintenance')
          connectionLog.info({ stage: 'maintenance', action: 'keepalive', idleMs }, 'Baileys reativado após período ocioso')
        } catch (error) {
          connectionLog.warn({ error, stage: 'maintenance', action: 'keepalive-failed', idleMs }, 'keepalive do Baileys falhou')
        }
      }

      connectionLog.debug({
        stage: 'maintenance',
        connection: wsOpen ? 'open' : 'closed',
        idleMs,
        lastMessageAgoMs: this.lastMessageAt ? Date.now() - this.lastMessageAt : -1,
        sessionFiles: session.fileCount,
        interactiveCache: cache.size,
        prunedInteractive: cache.removed,
        ...forkPrune,
        ...forkDiagnostics,
        queueDepth: this.queuedMessages,
        activeChats: this.messageQueues.size,
        executionMs: Date.now() - startedAt
      }, 'manutenção periódica do Baileys concluída')
    }
    void run()
    this.maintenanceTimer = setInterval(() => void run(), settings.baileysMaintenanceMs)
    this.maintenanceTimer.unref?.()
  }

  startHeartbeat() {
    this.stopHeartbeat()
    if (!Number.isFinite(settings.debugHeartbeatMs) || settings.debugHeartbeatMs <= 0) return
    const emit = () => {
      const memory = process.memoryUsage()
      const forkDiagnostics = this.socket?.sakuraSnapshotDiagnostics?.() || {}
      connectionLog.debug({
        stage: 'heartbeat',
        connection: this.socket ? 'open' : 'closed',
        user: maskNumber(this.socket?.user?.id),
        uptimeSec: Math.floor(process.uptime()),
        rssMb: Math.round(memory.rss / 1024 / 1024),
        heapMb: Math.round(memory.heapUsed / 1024 / 1024),
        externalMb: Math.round(memory.external / 1024 / 1024),
        reconnectAttempts: this.reconnectAttempts,
        queueDepth: this.queuedMessages,
        activeChats: this.messageQueues.size,
        activeMessages: this.activeMessageTasks,
        ...forkDiagnostics,
        heartbeatMs: settings.debugHeartbeatMs
      }, 'diagnóstico periódico da Sakura')
    }
    emit()
    this.heartbeatTimer = setInterval(emit, settings.debugHeartbeatMs)
    this.heartbeatTimer.unref?.()
  }

  async resolveVersion() {
    if (this.versionInfo) return this.versionInfo
    connectionLog.info('consultando versão do WhatsApp Web com timeout')
    this.versionInfo = await resolveSakuraWaVersion({ timeoutMs: settings.versionTimeoutMs, logger: baileysLog })
    this.versionResolvedAt = Date.now()
    connectionLog.info({ version: this.versionInfo.version?.join('.'), source: this.versionInfo.source }, 'versão selecionada')
    return this.versionInfo
  }

  async start(reason = 'inicialização') {
    if (this.connecting || this.stopping) return
    this.connecting = true
    clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null

    try {
      await repairCopiedSignalState({ sessionDir: settings.sessionDir, backupsDir: settings.backupsDir, logger: connectionLog })
      const session = await inspectSession(settings.sessionDir)
      connectionLog.info({ reason, hasCreds: session.hasCreds, sessionFiles: session.fileCount }, 'iniciando socket')
      const { state, saveCreds } = await useMultiFileAuthState(settings.sessionDir)
      this.hasRegisteredCreds = Boolean(state.creds.registered)
      const versionInfo = await this.resolveVersion()
      const socket = makeWASocket({
        ...(versionInfo.version ? { version: versionInfo.version } : {}),
        auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, baileysLog) },
        logger: baileysLog,
        shouldIgnoreJid: jid => jid === 'status@broadcast',
        syncFullHistory: false,
        retryRequestDelayMs: 350,
        maxMsgRetryCount: 6,
        enableAutoSessionRecreation: true,
        enableRecentMessageCache: true,
        transactionOpts: { maxCommitRetries: 16, delayBetweenTriesMs: 250 },
        sakuraGroupMetadataTtlMs: settings.groupMetadataTtlMs,
        sakuraGroupMetadataStaleMs: settings.groupMetadataStaleMs,
        sakuraMessageCacheMax: settings.messageCacheMax,
        sakuraMessageCacheTtlMs: settings.messageCacheTtlMs,
        sakuraLidCacheTtlMs: settings.lidCacheTtlMs,
        sakuraSendRetryCount: settings.sendRetryCount
      })

      installMentionResolver(socket, eventsLog.child({ scope: 'MENTIONS' }))
      this.socket = socket
      this.attachEvents(socket, saveCreds)
      const handleMessage = await createMessageHandler(socket, commandsLog)
      this.attachMessageEvents(socket, handleMessage)
      if (!state.creds.registered && settings.loginMode === 'pair') await this.requestPairingCode(socket)
    } catch (error) {
      connectionLog.error({ error }, 'falha ao criar socket')
      this.scheduleReconnect('falha de inicialização')
    } finally {
      this.connecting = false
    }
  }

  attachEvents(socket, saveCreds) {
    socket.ev.on('creds.update', async update => {
      try {
        await saveCreds()
        eventsLog.debug({ fields: Object.keys(update || {}) }, 'credenciais salvas')
      } catch (error) { eventsLog.error({ error }, 'falha ao salvar credenciais') }
    })

    socket.ev.on('connection.update', update => { this.touchEvent('connection'); void this.handleConnectionUpdate(socket, update) })

    socket.ev.on('messages.update', updates => {
      this.touchEvent('message-update')
      for (const item of updates || []) {
        const code = Number(item?.update?.messageStubParameters?.[0] || 0)
        const id = item?.key?.id
        const interactive = getInteractiveMetadata(id)
        if (code || item?.update?.status === 8) {
          eventsLog.warn({ id, statusCode: code || 'erro', chat: numberFromJid(item?.key?.remoteJid), interactive }, 'servidor rejeitou ou marcou mensagem como erro')
        } else eventsLog.debug({ event: 'messages.update', id, interactive }, 'estado de mensagem atualizado')
      }
    })

    socket.ev.on('sakura.debug', payload => {
      if (!settings.baileysDetailedDebug) return
      this.touchEvent('sakura-debug')
      baileysDiagLog.debug(payload, 'diagnóstico interno do fork Sakura/Baileys')
    })

    socket.ev.on('sakura.decryption', payload => {
      this.touchEvent('decryption')
      const writer = payload?.stage === 'retry-error' ? baileysDiagLog.warn.bind(baileysDiagLog) : baileysDiagLog.debug.bind(baileysDiagLog)
      writer({ ...payload, chat: numberFromJid(payload?.from), sender: numberFromJid(payload?.participant) }, 'diagnóstico de descriptografia e retry')
    })

    socket.ev.on('sakura.stanza-error', payload => {
      this.touchEvent('stanza-error')
      const interactive = getInteractiveMetadata(payload?.id)
      eventsLog.warn({ ...payload, interactive, chat: numberFromJid(payload?.from) }, 'diagnóstico de stanza emitido pelo fork')
    })

    socket.ev.on('sakura.selection', payload => {
      this.touchEvent('selection')
      eventsLog.debug({ ...payload, chat: payload?.from, sender: payload?.participant }, 'seleção interativa decodificada pelo fork')
    })

    const countEvent = event => payload => {
      this.touchEvent(event)
      const count = Array.isArray(payload) ? payload.length : Array.isArray(payload?.messages) ? payload.messages.length : 1
      eventsLog.debug({ event, count }, 'evento recebido')
    }
    socket.ev.on('messages.delete', countEvent('messages.delete'))
    socket.ev.on('message-receipt.update', countEvent('message-receipt.update'))
    socket.ev.on('chats.update', countEvent('chats.update'))
    socket.ev.on('contacts.update', countEvent('contacts.update'))
    socket.ev.on('groups.update', countEvent('groups.update'))
    socket.ev.on('group-participants.update', payload => {
      this.touchEvent('group-participants.update')
      eventsLog.info({ chat: numberFromJid(payload?.id), action: payload?.action, count: payload?.participants?.length || 0 }, 'participantes do grupo atualizados')
      handleGroupParticipantsUpdate(socket, payload, eventsLog)
    })
    socket.ev.on('call', calls => { this.touchEvent('call'); eventsLog.info({ count: calls?.length || 0 }, 'evento de chamada recebido'); void handleIncomingCalls(socket, calls, eventsLog) })
    socket.ev.on('messaging-history.set', history => { this.touchEvent('history'); eventsLog.info({ chats: history?.chats?.length || 0, contacts: history?.contacts?.length || 0, messages: history?.messages?.length || 0, progress: history?.progress }, 'sincronização de histórico') })
  }

  attachMessageEvents(socket, handleMessage) {
    socket.ev.on('messages.upsert', ({ messages, type, requestId }) => {
      this.touchEvent('message')
      const list = messages || []
      eventsLog.debug({
        type,
        count: list.length,
        requestId,
        ids: list.slice(0, 10).map(item => item?.key?.id).filter(Boolean),
        chats: [...new Set(list.slice(0, 25).map(item => numberFromJid(item?.key?.remoteJid)).filter(Boolean))].length,
        queueDepth: this.queuedMessages,
        activeChats: this.messageQueues.size
      }, 'messages.upsert')
      if (type !== 'notify') return
      let skippedOwn = 0
      list.forEach((msg, batchIndex) => {
        if (msg?.key?.fromMe) {
          const ownText = getMessageText(msg?.message || {})
          if (!shouldProcessOwnMessage({ fromMe: true, text: ownText, prefix: settings.prefix })) {
            skippedOwn += 1
            return
          }
        }
        this.enqueueMessage(handleMessage, msg, type, { requestId, batchIndex })
      })
      if (skippedOwn) {
        eventsLog.debug({ stage: 'message-queue-skip-own', skippedOwn, requestId }, 'ecos normais da própria Sakura ignorados antes da fila')
      }
    })
  }

  async requestPairingCode(socket) {
    const phoneNumber = await askPairingNumber()
    if (phoneNumber.length < 10) throw new Error('Número inválido para pareamento.')
    await new Promise(resolve => setTimeout(resolve, 1500))
    const code = await socket.requestPairingCode(phoneNumber)
    connectionLog.success({ user: maskNumber(phoneNumber) }, 'código de pareamento gerado')
    console.log(`\nCódigo de pareamento: ${code?.match(/.{1,4}/g)?.join('-') || code}\n`)
  }

  async syncConnectedIdentity(socket) {
    const number = await resolveNumber(
      socket,
      socket?.user?.id,
      socket?.user?.jid,
      socket?.user?.pn,
      socket?.user?.lid
    )
    if (!number || number.length < 10) return { changed: false, number: '' }
    const result = syncConnectedBotNumber(number)
    if (result.changed) {
      connectionLog.info({ user: maskNumber(number), stage: 'identity-sync' }, 'número da Sakura detectado e salvo automaticamente')
    }
    return result
  }

  async handleConnectionUpdate(socket, update) {
    if (socket !== this.socket) return
    const { connection, lastDisconnect, qr, isNewLogin, isOnline, receivedPendingNotifications } = update
    eventsLog.debug({ connection, isNewLogin, isOnline, receivedPendingNotifications, hasQr: Boolean(qr) }, 'connection.update')

    if (qr && settings.loginMode === 'qr') {
      this.qrCount += 1
      connectionLog.info({ count: this.qrCount }, 'QR Code recebido; escaneie em Aparelhos conectados')
      console.log('\nEscaneie o QR Code no WhatsApp:\n')
      qrcode.generate(qr, { small: true })
      console.log('\n')
    }

    if (connection === 'connecting') connectionLog.info('conectando aos servidores do WhatsApp')
    if (connection === 'open') {
      this.reconnectAttempts = 0
      await this.syncConnectedIdentity(socket)
      this.startHeartbeat()
      this.startMaintenance()
      startContractScheduler(socket, eventsLog, settings.contractSweepMs)
      startGroupAutomationScheduler(socket, eventsLog, settings.automationSweepMs)
      connectionLog.success({ user: socket.user?.name || maskNumber(socket.user?.id), id: maskNumber(settings.botNumber || socket.user?.id), uptimeMs: Date.now() - this.startedAt }, 'conexão aberta e autenticada')
      void announceReleaseIfNeeded(socket, eventsLog).catch(error => eventsLog.warn({ error, stage: 'release-announcer' }, 'anúncio automático de release falhou sem afetar a conexão'))
      return
    }
    if (connection !== 'close') return

    this.socket = null
    this.stopHeartbeat()
    this.stopMaintenance()
    stopContractScheduler()
    stopGroupAutomationScheduler()
    const error = lastDisconnect?.error
    const diagnosis = analyzeDisconnect(error)
    if (diagnosis.statusCode === 408 && !this.hasRegisteredCreds) {
      connectionLog.info({ statusCode: 408, reason: diagnosis.reasonName }, 'conexão inicial adiada pelo WhatsApp; nova tentativa automática')
      if (!this.stopping) this.scheduleReconnect('conexão inicial adiada', 900, true)
      return
    }
    if (diagnosis.statusCode === 515) {
      connectionLog.info({ statusCode: 515, reason: diagnosis.reasonName }, 'WhatsApp solicitou reinício do socket')
      if (!this.stopping) this.scheduleReconnect('reinício solicitado pelo WhatsApp', 750, true)
      return
    }

    const writer = connectionLog[diagnosis.severity] || connectionLog.error
    writer.call(connectionLog, { ...diagnosis, error }, 'conexão encerrada')
    log.diagnosis('DIAGNÓSTICO DA DESCONEXÃO', [
      ['Código', diagnosis.statusCode || 'não informado'], ['Motivo', diagnosis.reasonName],
      ['Conflito', diagnosis.conflictType || 'nenhum subtipo informado'], ['Mensagem', diagnosis.message],
      ['Reconectável', diagnosis.retryable ? 'sim' : 'não'], ['Reset de sessão', diagnosis.resetSession ? 'necessário' : 'não'],
      ['Ação', diagnosis.action]
    ])

    if (this.stopping) return
    if (diagnosis.resetSession && !settings.autoResetInvalidSession) {
      connectionLog.fatal('sessão inválida: reconexão automática desativada')
      console.log('Execute: npm run reset-session\nDepois: npm start\n')
      return
    }
    if (diagnosis.resetSession && settings.autoResetInvalidSession && !this.autoResetUsed) {
      this.autoResetUsed = true
      try {
        const { backupDir } = await backupAndResetSession(settings.sessionDir, String(diagnosis.statusCode || 'erro'))
        connectionLog.warn({ backupDir }, 'sessão inválida preservada em backup')
        this.scheduleReconnect('sessão renovada automaticamente', 1500)
      } catch (resetError) { connectionLog.fatal({ error: resetError }, 'não foi possível renovar a sessão') }
      return
    }
    if (diagnosis.retryable) return this.scheduleReconnect(diagnosis.reasonName)
    connectionLog.fatal('reconexão automática interrompida para evitar loop')
  }

  scheduleReconnect(reason, customDelay, quiet = false) {
    if (this.stopping || this.reconnectTimer) return
    this.stopHeartbeat()
    this.stopMaintenance()
    this.reconnectAttempts += 1
    if (this.reconnectAttempts > settings.maxReconnectAttempts) {
      connectionLog.fatal({ attempt: this.reconnectAttempts - 1 }, 'limite de reconexões atingido')
      return
    }
    const delayMs = customDelay ?? Math.min(settings.reconnectBaseDelayMs * (2 ** (this.reconnectAttempts - 1)), 30_000)
    const writer = quiet ? connectionLog.info.bind(connectionLog) : connectionLog.warn.bind(connectionLog)
    writer({ reason, attempt: this.reconnectAttempts, delayMs }, 'reconexão agendada')
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      void this.start(`reconexão: ${reason}`)
    }, delayMs)
  }

  async stop(signal = 'encerramento') {
    if (this.stopping) return
    this.stopping = true
    clearTimeout(this.reconnectTimer)
    this.stopHeartbeat()
    this.stopMaintenance()
    stopContractScheduler()
    stopGroupAutomationScheduler()
    clearAiDeferredRetries()
    clearBulkSendQueue(signal)
    closePrivateProtectionStore()
    closeCommandMediaStore()
    connectionLog.warn({ signal }, 'encerrando bot')
    try { this.socket?.end?.(new Error(`Sakura shutdown: ${signal}`)) } catch {}
  }
}

export async function startClient() {
  log.info({ release: settings.release, platform: platformLabel() }, `Sakura-MD ${settings.release} iniciando`)
  log.debug({
    stage: 'startup',
    platform: process.platform,
    platformLabel: platformLabel(),
    mediaMode: platformInfo.mediaMode,
    release: os.release(),
    arch: process.arch,
    node: process.version,
    cpus: os.cpus().length,
    totalMemoryMb: Math.round(os.totalmem() / 1024 / 1024),
    freeMemoryMb: Math.round(os.freemem() / 1024 / 1024),
    logLevel: settings.logLevel,
    baileysLogLevel: settings.baileysLogLevel,
    heartbeatMs: settings.debugHeartbeatMs,
    maintenanceMs: settings.baileysMaintenanceMs,
    staleSocketMs: settings.staleSocketMs,
    detailedBaileysDebug: settings.baileysDetailedDebug,
    groupMetadataTtlMs: settings.groupMetadataTtlMs,
    groupMetadataStaleMs: settings.groupMetadataStaleMs,
    messageCacheMax: settings.messageCacheMax,
    logFlushMs: Number(process.env.LOG_FLUSH_MS) || 150,
    pid: process.pid
  }, 'diagnóstico de ambiente carregado')
  startMediaProcess(log.child({ scope: 'MEDIA' }))
  warmPlayManager(log.child({ scope: 'MEDIA' })).catch(() => {})
  const releaseSessionLock = await acquireSessionProcessLock(settings.sessionDir)
  try {
    await assertFfmpeg()
    log.success({ file: settings.ffmpegPath }, 'FFmpeg disponível para .s e .brat')
  } catch (error) {
    log.warn({ error }, 'FFmpeg não encontrado; .s e .brat não funcionarão até instalar ffmpeg')
  }

  const panelServer = await startPanel(log.child({ scope: 'PANEL' })).catch(error => {
    log.error({ error }, 'painel web não iniciado')
    return null
  })
  const manager = new ConnectionManager()
  let shutdownStarted = false
  const closePanel = () => new Promise(resolve => {
    if (!panelServer?.close) return resolve()
    try { panelServer.close(() => resolve()) } catch { resolve() }
  })
  const shutdown = async (signal = 'encerramento', exitCode = 0, fatalError = null) => {
    if (shutdownStarted) return
    shutdownStarted = true
    const forceExit = setTimeout(() => process.exit(exitCode || 1), 10_000)
    forceExit.unref?.()
    if (fatalError) log.fatal({ error: fatalError, signal }, 'falha fatal; encerramento seguro iniciado')
    else log.warn({ signal }, 'encerramento seguro iniciado')
    try { await closePanel() } catch (error) { log.warn({ error }, 'painel não encerrou normalmente') }
    try { stopMediaProcess() } catch {}
    try { await manager.stop(signal) } catch (error) { log.warn({ error }, 'socket não encerrou normalmente') }
    try { await stopPersistentBackupScheduler({ rootDir: settings.rootDir, logger: backupLog, flush: true }) } catch (error) { log.warn({ error }, 'backup persistente não foi concluído no encerramento') }
    try { await releaseSessionLock() } catch (error) { log.warn({ error }, 'lock de sessão não foi liberado normalmente') }
    clearTimeout(forceExit)
    process.exit(exitCode)
  }

  process.on('unhandledRejection', error => log.error({ error }, 'promise rejeitada sem tratamento'))
  process.once('uncaughtException', error => { void shutdown('uncaughtException', 1, error) })
  process.on('warning', warning => log.warn({ warning }, 'aviso do Node.js'))
  process.once('SIGINT', () => { void shutdown('SIGINT', 0) })
  process.once('SIGTERM', () => { void shutdown('SIGTERM', 0) })
  await manager.start()
  const terminalConsole = startTerminalConsole({
    getSocket: () => manager.socket,
    getStatus: () => ({ connected: Boolean(manager.socket?.user), number: numberFromJid(manager.socket?.user?.id || ''), release: settings.release }),
    getRuntime: runtimeSettings,
    setRuntime: updateRuntimeSettings,
    backup: () => snapshotPersistentBackup({ rootDir: settings.rootDir, logger: backupLog }),
    reconnect: async () => { try { manager.socket?.end?.(new Error('reconexão pedida pelo terminal')) } catch {} ; manager.scheduleReconnect('terminal', 500, true) },
    shutdown: signal => shutdown(signal, 0),
    defaultLogLevel: settings.logLevel,
    config: {
      read: readConfig,
      write: writeConfigSync,
      // Aplica na hora o que dá; o resto avisa "reinicie".
      applyLive: (key, value) => {
        if (key === 'bot.prefix') { settings.prefix = String(value).slice(0, 4); return true }
        if (key === 'bot.name') { settings.botName = String(value).slice(0, 80); return true }
        if (key === 'ai.enabled') { settings.aiEnabled = Boolean(value); return true }
        if (key === 'ui.footer') { settings.footer = String(value); return true }
        if (key === 'owners') {
          settings.owners = value
          const main = value.find(o => o.enabled !== false && o.role === 'owner') || value.find(o => o.enabled !== false)
          if (main) { settings.ownerNumber = String(main.number).replace(/\D/g, ''); settings.ownerName = String(main.name || 'Dono') }
          return true
        }
        return false
      }
    }
  })
  startPersistentBackupScheduler({ rootDir: settings.rootDir, logger: backupLog })
  void snapshotPersistentBackup({ rootDir: settings.rootDir, logger: backupLog }).catch(error => backupLog.warn({ error, stage: 'persistent-backup-initial' }, 'snapshot inicial do backup persistente falhou'))
  return manager
}
