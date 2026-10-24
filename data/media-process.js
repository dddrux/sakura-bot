import { downloadMusicAudio, downloadResolvedMusic, getMusicPreview, resolveMusic, warmMusicEngine } from './music.js'

const logger = {
  debug(data, message) { process.send?.({ type: 'log', level: 'debug', data: serialize(data), message }) },
  info(data, message) { process.send?.({ type: 'log', level: 'info', data: serialize(data), message }) },
  warn(data, message) { process.send?.({ type: 'log', level: 'warn', data: serialize(data), message }) },
  success(data, message) { process.send?.({ type: 'log', level: 'success', data: serialize(data), message }) }
}

function serialize(value) {
  if (value instanceof Error) return {
    name: value.name,
    message: value.message,
    stack: value.stack,
    code: value.code,
    status: value.status,
    errorType: value.errorType,
    attempts: value.attempts
  }
  if (!value || typeof value !== 'object') return value
  return JSON.parse(JSON.stringify(value, (_, item) => item instanceof Error ? { name: item.name, message: item.message, stack: item.stack } : item))
}

async function execute(action, payload) {
  if (action === 'warm' || action === 'player-health') return warmMusicEngine(logger)
  if (action === 'play-info' || action === 'play-search') return resolveMusic(payload.query, logger)
  if (action === 'play-download') return downloadResolvedMusic(payload.resolved || payload.media || {}, logger)
  if (action === 'play') return downloadMusicAudio(payload.query, logger)
  throw new Error(`Unknown media action: ${action}`)
}

process.on('message', async message => {
  if (!message?.id || !message?.action) return
  try {
    const result = await execute(message.action, message.payload || {})
    process.send?.({ type: 'result', id: message.id, ok: true, result })
  } catch (error) {
    process.send?.({ type: 'result', id: message.id, ok: false, error: serialize(error) })
  }
})

process.send?.({ type: 'ready', pid: process.pid })
