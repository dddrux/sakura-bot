import { settings, readConfig } from './settings.js'


function liveTts() {
  const cfg = readConfig().tts || {}
  return {
    enabled: cfg.enabled !== false,
    key: String(process.env.AZURE_SPEECH_KEY || cfg.key || settings.ttsKey || '').trim(),
    region: String(process.env.AZURE_SPEECH_REGION || cfg.region || settings.ttsRegion || '').trim(),
    defaultVoice: String(cfg.defaultVoice || settings.ttsDefaultVoice || 'pt-BR-GiovannaNeural'),
    maxChars: Math.max(100, Math.min(5000, Number(cfg.maxChars || settings.ttsMaxChars || 1200))),
    voices: Array.isArray(cfg.voices) && cfg.voices.length ? cfg.voices : (settings.ttsVoices || [])
  }
}

function normalize(value = '') {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase()
}

function escapeXml(value = '') {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

export function getMicrosoftVoices() {
  return liveTts().voices.map(item => ({ ...item }))
}

export function resolveMicrosoftVoice(value = '') {
  const requested = normalize(value)
  const voices = getMicrosoftVoices()
  if (!requested) return voices.find(item => item.voice === liveTts().defaultVoice) || voices[0] || null
  return voices.find(item => [item.key, item.name, item.voice].some(candidate => normalize(candidate) === requested)) || null
}

export function getMicrosoftTtsState() {
  const live = liveTts()
  return {
    provider: 'microsoft',
    transport: 'official-rest',
    enabled: live.enabled,
    configured: Boolean(live.key && live.region),
    region: live.region || '',
    defaultVoice: live.defaultVoice,
    maxChars: live.maxChars,
    voices: getMicrosoftVoices()
  }
}

export async function synthesizeMicrosoftTts(text, voiceValue = '', { fetchImpl = globalThis.fetch } = {}) {
  const input = String(text || '').trim()
  const live = liveTts()
  if (!live.enabled) throw Object.assign(new Error('TTS desativado na configuração.'), { code: 'TTS_DISABLED' })
  if (!live.key || !live.region) throw Object.assign(new Error('Configure tts.key/tts.region ou AZURE_SPEECH_KEY/AZURE_SPEECH_REGION.'), { code: 'TTS_NOT_CONFIGURED' })
  if (!input) throw Object.assign(new Error('Texto do TTS vazio.'), { code: 'TTS_EMPTY_TEXT' })
  if (input.length > live.maxChars) throw Object.assign(new Error(`O texto pode ter no máximo ${live.maxChars} caracteres.`), { code: 'TTS_TEXT_TOO_LONG' })
  if (typeof fetchImpl !== 'function') throw Object.assign(new Error('fetch indisponível no runtime.'), { code: 'TTS_TRANSPORT_UNAVAILABLE' })

  const voice = resolveMicrosoftVoice(voiceValue)
  if (!voice) throw Object.assign(new Error('Voz Microsoft não encontrada.'), { code: 'TTS_VOICE_NOT_FOUND' })

  const endpoint = `https://${encodeURIComponent(live.region)}.tts.speech.microsoft.com/cognitiveservices/v1`
  const ssml = `<speak version="1.0" xml:lang="pt-BR"><voice xml:lang="pt-BR" name="${escapeXml(voice.voice)}">${escapeXml(input)}</voice></speak>`
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 45_000)
  timeout.unref?.()
  try {
    const response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': live.key,
        'Content-Type': 'application/ssml+xml',
        'X-Microsoft-OutputFormat': 'audio-16khz-128kbitrate-mono-mp3',
        'User-Agent': 'Sakura-MD'
      },
      body: ssml,
      signal: controller.signal
    })
    if (!response.ok) {
      const detail = String(await response.text().catch(() => '')).replace(/\s+/g, ' ').trim().slice(0, 240)
      throw Object.assign(new Error(`Microsoft Speech respondeu HTTP ${response.status}${detail ? `: ${detail}` : ''}`), { code: 'TTS_MICROSOFT_HTTP', status: response.status })
    }
    const buffer = Buffer.from(await response.arrayBuffer())
    if (buffer.length < 256) throw Object.assign(new Error('A Microsoft retornou um áudio vazio.'), { code: 'TTS_EMPTY_AUDIO' })
    return { buffer, voice }
  } catch (error) {
    if (error?.name === 'AbortError') throw Object.assign(new Error('A Microsoft demorou demais para gerar o áudio.'), { code: 'TTS_TIMEOUT' })
    throw error
  } finally {
    clearTimeout(timeout)
  }
}
