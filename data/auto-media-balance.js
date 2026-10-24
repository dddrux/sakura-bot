// Gerenciador adaptativo local das respostas automáticas.
// Ele evita depender de token/latência da IA externa para decidir cada mensagem,
// mas usa contexto recente da conversa para equilibrar áudio e figurinha.
const chats = new Map()
const WINDOW_MS = 5 * 60_000
const BURST_GAP_MS = 14_000
const COMBO_GAP_MS = 90_000
const SAME_TRIGGER_MS = 2 * 60_000
const MAX_EVENTS_2MIN = 4

function stateFor(chat) {
  const key = String(chat || '')
  const state = chats.get(key) || { events: [], lastTrigger: new Map(), lastType: '' }
  chats.set(key, state)
  return state
}

function prune(state, now) {
  state.events = state.events.filter(event => now - event.at <= WINDOW_MS)
  for (const [key, at] of state.lastTrigger) if (now - at > WINDOW_MS) state.lastTrigger.delete(key)
}

export function resetAutoMediaBalance(chat = '') {
  if (chat) chats.delete(String(chat))
  else chats.clear()
}

export function evaluateAutoMedia({ chat, audioId = '', stickerId = '', audio = false, sticker = false, combined = false, now = Date.now() } = {}) {
  const state = stateFor(chat)
  prune(state, now)
  const last = state.events.at(-1)
  const recent2m = state.events.filter(event => now - event.at <= 120_000)
  const sameKey = combined ? `combo:${audioId}+${stickerId}` : audio ? `audio:${audioId}` : `sticker:${stickerId}`
  const sameAt = state.lastTrigger.get(sameKey) || 0

  if (last && now - last.at < BURST_GAP_MS) return { audio: false, sticker: false, reason: 'pausa-curta' }
  if (sameAt && now - sameAt < SAME_TRIGGER_MS) return { audio: false, sticker: false, reason: 'gatilho-repetido' }
  if (recent2m.length >= MAX_EVENTS_2MIN) return { audio: false, sticker: false, reason: 'limite-conversa' }

  let allowAudio = Boolean(audio)
  let allowSticker = Boolean(sticker)
  const audioCount = recent2m.filter(event => event.type === 'audio').length
  const stickerCount = recent2m.filter(event => event.type === 'sticker').length

  if (combined) {
    const sinceLast = last ? now - last.at : Number.POSITIVE_INFINITY
    if (sinceLast < COMBO_GAP_MS) {
      // Em conversa ativa, o combo vira uma única mídia e alterna o tipo menos usado.
      if (audioCount < stickerCount) allowSticker = false
      else if (stickerCount < audioCount) allowAudio = false
      else if (state.lastType === 'audio') allowAudio = false
      else allowSticker = false
    }
  } else if (allowAudio && allowSticker) {
    if (audioCount > stickerCount) allowAudio = false
    else if (stickerCount > audioCount) allowSticker = false
  }

  const reserved = []
  if (allowSticker) reserved.push({ at: now, type: 'sticker', trigger: stickerId })
  if (allowAudio) reserved.push({ at: now + (allowSticker ? 1 : 0), type: 'audio', trigger: audioId })
  if (reserved.length) {
    state.events.push(...reserved)
    state.lastTrigger.set(sameKey, now)
    state.lastType = reserved.at(-1).type
  }
  return { audio: allowAudio, sticker: allowSticker, reason: reserved.length ? (combined && reserved.length === 1 ? 'combo-equilibrado' : 'permitido') : 'suprimido' }
}

export function autoMediaBalanceSnapshot(chat = '') {
  const state = stateFor(chat)
  const now = Date.now()
  prune(state, now)
  return { events: state.events.length, lastType: state.lastType, recent: state.events.slice(-6) }
}
