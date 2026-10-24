import { defineCommand } from '../data/workstation.js'
import { reply } from '../data/reply.js'
import { formatMessage } from '../data/formatter.js'
import { sendNativeList } from '../data/interactive.js'
import { runtimeSettings, updateRuntimeSettings } from '../data/runtime.js'
import {
  getTriggerStats,
  getTriggersDatabase,
  matchAudioTrigger,
  matchStickerTrigger,
  reloadTriggers,
  setTriggerEnabled,
  setTriggerMode
} from '../data/triggers.js'
import { settings } from '../data/settings.js'

const onWords = new Set(['on', 'ligar', 'ativar', 'sim'])
const offWords = new Set(['off', 'desligar', 'desativar', 'nao', 'não'])
const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
const stateWord = value => value ? 'ligado' : 'desligado'

function lines() {
  const runtime = runtimeSettings()
  const stats = getTriggerStats()
  return [
    `áudios: ${stateWord(runtime.autoReplyAudio)} • ${stats.audioEnabled}/${stats.audioAvailable}`,
    `figurinhas: ${stateWord(runtime.autoReplySticker)} • ${stats.stickerEnabled}/${stats.stickerAvailable}`,
    `autofig aleatória: ${stateWord(runtime.autoStickerRandom)} • ${Math.round((Number(runtime.autoStickerLibraryChance) || 0) * 100)}% da biblioteca`,
    `frases de áudio: ${stats.audioPhrases}`,
    `frases de figurinha: ${stats.stickerPhrases}`,
    `antispam: ${Math.round(settings.autoTriggerCooldownMs / 1000)}s`,
    `mensagem atrasada: ignorada após ${Math.round(settings.autoTriggerMaxAgeMs / 60000)} min`,
    'combo: mesma frase envia áudio + figurinha juntos'
  ]
}

async function sendPanel(sock, msg, logger) {
  const runtime = runtimeSettings()
  return sendNativeList({
    sock,
    jid: msg.key.remoteJid,
    quoted: msg,
    logger,
    kind: 'automaticos-panel',
    body: formatMessage([...lines(), 'Escolha uma ação:'].join('\n'), { title: 'RESPOSTAS AUTOMÁTICAS' }),
    buttonText: 'Configurar',
    sections: [
      {
        title: 'Estado rápido',
        rows: [
          { id: `${settings.prefix}automaticos audio ${runtime.autoReplyAudio ? 'off' : 'on'}`, title: `${runtime.autoReplyAudio ? '🌸' : '🌸'} ${runtime.autoReplyAudio ? 'Desligar' : 'Ligar'} áudios`, description: 'Ativa ou pausa somente os áudios automáticos' },
          { id: `${settings.prefix}automaticos fig ${runtime.autoReplySticker ? 'off' : 'on'}`, title: `${runtime.autoReplySticker ? '🌸' : '💮'} ${runtime.autoReplySticker ? 'Desligar' : 'Ligar'} figurinhas`, description: 'Ativa ou pausa somente as figurinhas automáticas' },
          { id: `${settings.prefix}automaticos recarregar`, title: '🌸 Recarregar respostas', description: 'Lê novamente o banco e os arquivos sem reiniciar' }
        ]
      },
      {
        title: 'AutoFig aleatória',
        rows: [
          { id: `${settings.prefix}automaticos autofig ${runtime.autoStickerRandom ? 'off' : 'on'}`, title: `${runtime.autoStickerRandom ? '🌸' : '🌸'} ${runtime.autoStickerRandom ? 'Desligar' : 'Ligar'} AutoFig`, description: 'Alterna figurinhas da biblioteca sem repetir sempre a mesma' },
          { id: `${settings.prefix}automaticos autofig chance 25`, title: '25% aleatória', description: 'Troca ocasionalmente a figurinha automática' },
          { id: `${settings.prefix}automaticos autofig chance 50`, title: '50% aleatória', description: 'Equilíbrio entre gatilho e biblioteca' },
          { id: `${settings.prefix}automaticos autofig chance 75`, title: '75% aleatória', description: 'Mais variedade nas respostas automáticas' }
        ]
      },
      {
        title: 'Modos',
        rows: [
          { id: `${settings.prefix}automaticos modo classico`, title: 'Modo clássico', description: 'Bom dia, boa tarde, boa noite, Sakura, dog, beijo e clássicos' },
          { id: `${settings.prefix}automaticos modo completo`, title: 'Modo completo', description: 'Ativa todos os áudios e figurinhas disponíveis' },
          { id: `${settings.prefix}automaticos modo off`, title: 'Pausar tudo', description: 'Desliga as respostas automáticas sem apagar nada' }
        ]
      },
      {
        title: 'Catálogo e teste',
        rows: [
          { id: `${settings.prefix}automaticos lista audio`, title: 'Lista de áudios', description: 'Mostra os gatilhos ativos e inativos' },
          { id: `${settings.prefix}automaticos lista fig`, title: 'Lista de figurinhas', description: 'Mostra os gatilhos ativos e inativos' },
          { id: `${settings.prefix}automaticos teste bom diaaa`, title: 'Testar reconhecimento', description: 'Exemplo de teste sem enviar mídia' }
        ]
      }
    ]
  })
}

async function sendCatalog(sock, msg, type, requestedPage = 1, logger) {
  const db = await getTriggersDatabase()
  const collection = type === 'fig' || type === 'sticker' ? 'stickers' : 'audio'
  const entries = Object.entries(db[collection] || {}).sort((a, b) => Number(b[1]?.enabled) - Number(a[1]?.enabled) || a[0].localeCompare(b[0], 'pt-BR'))
  const pageSize = 40
  const totalPages = Math.max(1, Math.ceil(entries.length / pageSize))
  const page = Math.max(1, Math.min(totalPages, Number(requestedPage) || 1))
  const pageEntries = entries.slice((page - 1) * pageSize, page * pageSize)
  const sections = []
  for (let index = 0; index < pageEntries.length; index += 10) {
    sections.push({
      title: `${collection === 'audio' ? 'Áudios' : 'Figurinhas'} • ${page}/${totalPages} • ${index / 10 + 1}`,
      rows: pageEntries.slice(index, index + 10).map(([id, entry]) => {
        const locked = (collection === 'audio' && entry.lockedDisabled === true) || (collection === 'stickers' && entry.commandOnly === true)
        return {
          id: locked
            ? `${settings.prefix}automaticos bloqueado ${encodeURIComponent(id)}`
            : `${settings.prefix}automaticos toggle ${collection === 'audio' ? 'audio' : 'fig'} ${encodeURIComponent(id)} ${page}`,
          title: `${locked ? '🌸' : entry.enabled === false ? '💮' : '🌸'} ${id}`,
          description: locked
            ? entry.commandOnly === true ? 'usada somente pelo comando correspondente' : `substituído pela figurinha ${entry.replacedBySticker || id}`
            : `${entry.enabled === false ? 'inativo' : 'ativo'} • ${(entry.phrases || []).slice(0, 3).join(' | ')}`.slice(0, 90)
        }
      })
    })
  }
  sections.push({
    title: 'Navegação',
    rows: [
      page > 1 ? { id: `${settings.prefix}automaticos lista ${collection === 'audio' ? 'audio' : 'fig'} ${page - 1}`, title: '🌸 Página anterior', description: `Ir para ${page - 1}/${totalPages}` } : null,
      page < totalPages ? { id: `${settings.prefix}automaticos lista ${collection === 'audio' ? 'audio' : 'fig'} ${page + 1}`, title: '💮 Próxima página', description: `Ir para ${page + 1}/${totalPages}` } : null,
      { id: `${settings.prefix}automaticos`, title: 'Voltar', description: 'Retornar ao painel automático' }
    ].filter(Boolean)
  })
  return sendNativeList({
    sock,
    jid: msg.key.remoteJid,
    quoted: msg,
    logger,
    kind: `automaticos-${collection}-${page}`,
    body: formatMessage(`Página ${page}/${totalPages}\nToque para ativar ou desativar.`, { title: 'CATÁLOGO AUTOMÁTICO' }),
    buttonText: 'Abrir catálogo',
    sections
  })
}

export default defineCommand({
  name: 'automaticos',
  aliases: ['autos', 'gatilhos', 'respostasauto', 'audioauto', 'figauto', 'autofig'],
  menuEntries: [
    { name: 'automaticos', usage: '.automaticos', description: 'Painel intuitivo de áudios e figurinhas automáticas.', menuGroup: 'Configuração' },
    { name: 'autos', usage: '.autos', description: 'Atalho do painel de respostas automáticas.', menuGroup: 'Configuração' },
    { name: 'autofig', usage: '.autofig [on|off|chance 50]', description: 'Controla a seleção aleatória e anti-repetição das figurinhas automáticas.', menuGroup: 'Configuração' }
  ],
  category: 'Dono',
  usage: '.automaticos',
  description: 'Gerencia, testa e recarrega áudios e figurinhas automáticas, incluindo modo aleatorio AutoFig.',
  ownerOnly: true,
  async execute({ sock, msg, args, logger, invokedAs }) {
    const invoked = normalize(invokedAs)
    let action = normalize(args?.[0])
    const autofigArgs = invoked === 'autofig' ? args : args.slice(1)
    if (invoked === 'autofig') action = 'autofig'
    if (!action) return sendPanel(sock, msg, logger)

    if (action === 'audio' || action === 'fig' || action === 'sticker') {
      const enabled = onWords.has(normalize(args[1])) ? true : offWords.has(normalize(args[1])) ? false : null
      if (enabled == null) return reply(sock, msg, `Use *${settings.prefix}automaticos ${action} on* ou *off*.`, { title: 'RESPOSTAS AUTOMÁTICAS', icon: '💮' })
      await updateRuntimeSettings(action === 'audio' ? { autoReplyAudio: enabled } : { autoReplySticker: enabled })
      return sendPanel(sock, msg, logger)
    }


    if (action === 'autofig') {
      const mode = normalize(autofigArgs?.[0])
      if (!mode) return sendPanel(sock, msg, logger)
      if (onWords.has(mode) || offWords.has(mode)) {
        await updateRuntimeSettings({ autoStickerRandom: onWords.has(mode) })
        return sendPanel(sock, msg, logger)
      }
      if (mode === 'chance' || mode === 'probabilidade') {
        const percent = Math.max(0, Math.min(100, Number(autofigArgs?.[1]) || 0))
        await updateRuntimeSettings({ autoStickerLibraryChance: percent / 100 })
        return sendPanel(sock, msg, logger)
      }
      return reply(sock, msg, `Use *${settings.prefix}autofig on*, *off* ou *chance 50*.`, { title: 'AUTOFIG ALEATÓRIA', icon: '🌸' })
    }

    if (action === 'modo') {
      const mode = normalize(args[1] || 'classico')
      if (['off', 'desligado'].includes(mode)) {
        await setTriggerMode('off')
        await updateRuntimeSettings({ autoReplyAudio: false, autoReplySticker: false })
      } else {
        await setTriggerMode(['completo', 'all'].includes(mode) ? 'all' : 'classic')
        await updateRuntimeSettings({ autoReplyAudio: true, autoReplySticker: true })
      }
      return sendPanel(sock, msg, logger)
    }

    if (action === 'recarregar' || action === 'reload') {
      await reloadTriggers()
      return sendPanel(sock, msg, logger)
    }

    if (action === 'lista' || action === 'catalogo') return sendCatalog(sock, msg, normalize(args[1]), Number(args[2] || 1), logger)

    if (action === 'bloqueado') {
      const id = decodeURIComponent(String(args[1] || ''))
      return reply(sock, msg, `O gatilho *${id}* é protegido: áudios de risada ficam desligados e mídias de comando não disparam por conversa comum.`, { title: 'RESPOSTAS AUTOMÁTICAS', icon: '🌸' })
    }

    if (action === 'toggle') {
      const type = normalize(args[1]) === 'fig' ? 'sticker' : 'audio'
      const id = decodeURIComponent(String(args[2] || ''))
      const page = Number(args[3] || 1)
      const db = await getTriggersDatabase()
      const collection = type === 'sticker' ? 'stickers' : 'audio'
      const entry = db?.[collection]?.[id]
      if (!entry) return reply(sock, msg, 'Esse gatilho não existe.', { title: 'RESPOSTAS AUTOMÁTICAS', icon: '💮' })
      await setTriggerEnabled(type, id, entry.enabled === false)
      return sendCatalog(sock, msg, type === 'sticker' ? 'fig' : 'audio', page, logger)
    }

    if (action === 'teste' || action === 'test') {
      const phrase = args.slice(1).join(' ').trim()
      const audio = matchAudioTrigger(phrase, { mentionedBot: true, isGroup: true })
      const sticker = matchStickerTrigger(phrase, { mentionedBot: true, isGroup: true })
      return reply(sock, msg, [
        `▢ • 💮 *texto:* ${phrase || '(vazio)'}`,
        `▢ • 🌸 *áudio:* ${audio?.value?.id || 'nenhum'}`,
        `▢ • 💮 *figurinha:* ${sticker?.value?.id || 'nenhuma'}`,
        `▢ • 💮 *frase reconhecida:* ${audio?.matched || sticker?.matched || 'nenhuma'}`,
        `▢ • 💮 *envio combinado:* ${audio && sticker && audio.matched === sticker.matched ? 'sim' : 'não'}`
      ].join('\n'), { title: 'TESTE AUTOMÁTICO', icon: '🌸' })
    }

    return sendPanel(sock, msg, logger)
  }
})
