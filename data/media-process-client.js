import { fork } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { platformInfo } from './platform.js'

let child
let activeLogger
let stopping = false
let inlineModulePromise
const pending = new Map()

function rejectPending(message) {
  for (const { reject, timer } of pending.values()) {
    clearTimeout(timer)
    reject(new Error(message))
  }
  pending.clear()
}

async function executeInline(action, payload = {}) {
  inlineModulePromise ||= import('./music.js')
  const { downloadMusicAudio, downloadResolvedMusic, getMusicPreview, resolveMusic, warmMusicEngine } = await inlineModulePromise
  if (action === 'warm' || action === 'player-health') return warmMusicEngine(activeLogger)
  if (action === 'play-info' || action === 'play-search') return resolveMusic(payload.query, activeLogger)
  if (action === 'play-download') return downloadResolvedMusic(payload.resolved || payload.media || {}, activeLogger)
  if (action === 'play') return downloadMusicAudio(payload.query, activeLogger)
  throw new Error(`Unknown media action: ${action}`)
}

function spawnProcess(logger) {
  if (platformInfo.mediaMode === 'inline') return null
  stopping = false
  activeLogger = logger || activeLogger
  child = fork(fileURLToPath(new URL('./media-process.js', import.meta.url)), [], {
    stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
    serialization: 'advanced',
    execArgv: process.execArgv.filter(arg => !arg.startsWith('--input-type')),
    env: { ...process.env, SAKURA_MEDIA_PROCESS: '1' },
    windowsHide: true
  })

  child.on('message', message => {
    if (message?.type === 'ready') {
      activeLogger?.success?.({ pid: message.pid }, 'segundo processo de mídia iniciado')
      return
    }
    if (message?.type === 'log') {
      activeLogger?.[message.level]?.(message.data, message.message)
      return
    }
    if (message?.type !== 'result') return
    const request = pending.get(message.id)
    if (!request) return
    pending.delete(message.id)
    clearTimeout(request.timer)
    if (message.ok) request.resolve(message.result)
    else {
      const error = new Error(message.error?.message || 'Falha no processo de mídia')
      error.name = message.error?.name || error.name
      error.stack = message.error?.stack || error.stack
      error.code = message.error?.code
      error.status = message.error?.status
      error.errorType = message.error?.errorType
      error.attempts = message.error?.attempts
      request.reject(error)
    }
  })

  child.on('exit', (code, signal) => {
    child = null
    rejectPending(`Processo de mídia encerrou (${code ?? signal ?? 'unknown'})`)
    if (!stopping && !process.exitCode) setTimeout(() => spawnProcess(activeLogger), 750).unref()
  })
  child.on('error', error => activeLogger?.error?.({ error }, 'erro no segundo processo de mídia'))
  return child
}

export function startMediaProcess(logger) {
  activeLogger = logger || activeLogger
  if (platformInfo.mediaMode === 'inline') {
    activeLogger?.debug?.({ mode: 'inline', platform: process.platform, arch: process.arch }, 'mídia executada no processo principal')
    return null
  }
  if (!child?.connected) spawnProcess(logger)
  return child
}

export function stopMediaProcess() {
  stopping = true
  if (child?.connected) child.kill('SIGTERM')
  child = null
}

export function requestMedia(action, payload = {}, { timeoutMs = 210_000 } = {}) {
  if (platformInfo.mediaMode === 'inline') {
    return Promise.race([
      executeInline(action, payload),
      new Promise((_, reject) => setTimeout(() => reject(new Error(`Mídia excedeu ${timeoutMs} ms`)), timeoutMs))
    ])
  }

  if (!child?.connected) spawnProcess(activeLogger)
  const id = randomUUID()
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id)
      reject(new Error(`Processo de mídia excedeu ${timeoutMs} ms`))
    }, timeoutMs)
    pending.set(id, { resolve, reject, timer })
    child.send({ id, action, payload })
  })
}
