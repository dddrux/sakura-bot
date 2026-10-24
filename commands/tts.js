import { defineCommand } from '../data/workstation.js'
import { sendNativeList } from '../data/interactive.js'
import { reply } from '../data/reply.js'
import { getMicrosoftTtsState, resolveMicrosoftVoice, synthesizeMicrosoftTts } from '../data/microsoft-tts.js'
import { settings } from '../data/settings.js'

function parseRequest(rawArgs = '') {
  const raw = String(rawArgs || '').trim()
  if (!raw) return { mode: 'voices', voice: '', text: '' }
  if (/^(vozes|voices|lista)$/i.test(raw)) return { mode: 'voices', voice: '', text: '' }
  const model = raw.match(/^modelo\s+([^\s]+)$/i)
  if (model) return { mode: 'model', voice: model[1], text: '' }
  const split = raw.split('|')
  if (split.length >= 2) return { mode: 'speak', voice: split.shift().trim(), text: split.join('|').trim() }
  return { mode: 'speak', voice: '', text: raw }
}

async function sendVoiceMenu({ sock, msg, logger }) {
  const state = getMicrosoftTtsState()
  const rows = state.voices.map(item => ({
    id: `${settings.prefix}tts modelo ${item.key}`,
    title: `💮 ${item.name}`,
    description: `${item.gender || 'voz'} • Microsoft • ${item.voice}`
  }))
  return sendNativeList({
    sock,
    jid: msg.key.remoteJid,
    quoted: msg,
    logger,
    kind: 'tts-voices',
    body: [
      '💮 *VOZES MICROSOFT*',
      '🌸 Escolha uma voz para receber o modelo pronto.',
      state.configured ? '🌸 TTS pronto para uso.' : '🌸 Falta configurar a chave e a região da Microsoft.'
    ].join('\n'),
    buttonText: '💮 Escolher voz',
    sections: [{ title: '🌸 Vozes em português', rows }]
  })
}

export default defineCommand({
  name: 'tts',
  aliases: ['voz', 'fala', 'falar', 'ttsvoz', 'ttsvozes'],
  category: 'Mídia',
  usage: '.tts giovanna | texto ou .tts vozes',
  description: 'Transforma texto em áudio com vozes Microsoft.',
  menuEntries: [
    { name: 'tts', usage: '.tts voz | texto', description: 'Criar áudio com uma voz Microsoft.', menuGroup: 'Áudio' },
    { name: 'ttsvozes', usage: '.tts vozes', description: 'Escolher entre as vozes Microsoft disponíveis.', menuGroup: 'Áudio' }
  ],
  slash: { model: '.tts giovanna | Olá, eu sou a Sakura.', categories: ['mídia', 'áudio'], copyable: true },
  async execute({ sock, msg, rawArgs, logger }) {
    const request = parseRequest(rawArgs)
    if (request.mode === 'voices') return sendVoiceMenu({ sock, msg, logger })
    if (request.mode === 'model') {
      const voice = resolveMicrosoftVoice(request.voice)
      if (!voice) return reply(sock, msg, '💮 Essa voz não existe. Use *.tts vozes* para escolher uma opção.')
      return reply(sock, msg, `🌸 *${voice.name}*\n\nCopie o modelo abaixo e troque o texto:\n\n${settings.prefix}tts ${voice.key} | Olá, eu sou a Sakura.`)
    }
    try {
      const result = await synthesizeMicrosoftTts(request.text, request.voice)
      return sock.sendMessage(msg.key.remoteJid, {
        audio: result.buffer,
        mimetype: 'audio/mpeg',
        ptt: false,
        fileName: `sakura-tts-${result.voice.key}.mp3`
      }, { quoted: msg })
    } catch (error) {
      logger?.warn?.({ error, provider: 'microsoft' }, 'falha no TTS Microsoft')
      if (error?.code === 'TTS_NOT_CONFIGURED') return reply(sock, msg, '💮 O TTS Microsoft ainda não tem chave/região configuradas. Preencha `tts.key` e `tts.region` no `config/sakura.config.json`.')
      if (error?.code === 'TTS_VOICE_NOT_FOUND') return reply(sock, msg, '💮 Voz não encontrada. Use *.tts vozes*.')
      return reply(sock, msg, `💮 Não consegui gerar o TTS.${error?.message ? ` ${error.message}` : ''}`)
    }
  }
})
