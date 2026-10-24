import { defineCommand } from '../data/workstation.js'
import { sendNativeList, sendQuickButtons } from '../data/interactive.js'
import { reply } from '../data/reply.js'
import { readConfig, settings, writeConfigSync } from '../data/settings.js'
import { getAiGlobalConfig, updateAiGlobalConfig } from '../data/ai-store.js'

const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()

function configuredModels() {
  const cfg = readConfig()
  const rows = Array.isArray(cfg.ai?.models) ? cfg.ai.models : []
  return rows.filter(row => row?.id).map(row => ({
    id: String(row.id),
    name: String(row.name || row.id),
    description: String(row.description || 'Modelo disponível para a IA da Sakura.')
  }))
}

async function modelCatalog({ sock, msg, logger }) {
  const models = configuredModels()
  const activeModel = getAiGlobalConfig().model || settings.aiModel
  return sendNativeList({
    sock, jid: msg.key.remoteJid, quoted: msg, logger, kind: 'ai-models',
    body: `╭━━⪩ 🪷 *MODELOS DA IA* ⪨━━\n▢ • 💮 *ativo:* ${activeModel}\n▢ • 🌸 *escolha:* selecione abaixo\n╰━━─「🪷」─━━`,
    buttonText: '🌸 Escolher modelo',
    sections: [{
      title: 'Modelos',
      rows: models.map(model => ({
        id: `${settings.prefix}iaconfig modelo ${encodeURIComponent(model.id)}`,
        title: model.name,
        description: `${model.id === activeModel ? 'Ativo • ' : ''}${model.description}`.slice(0, 280)
      }))
    }],
    includeUpdateCta: false
  })
}

export default defineCommand({
  name: 'iaconfig',
  aliases: ['iacfg', 'cfgia'],
  category: 'Inteligência artificial',
  usage: '.iaconfig',
  description: 'Configura a IA, tokens, modelo e comportamento.',
  ownerOnly: true,
  subownerAllowed: true,
  async execute({ sock, msg, args, logger }) {
    const action = normalize(args[0])
    if (action === 'on' || action === 'off') {
      const current = readConfig()
      const enabled = action === 'on'
      writeConfigSync({ ai: { ...current.ai, enabled } })
      settings.aiEnabled = enabled
      updateAiGlobalConfig({ globalEnabled: enabled })
      return reply(sock, msg, `IA ${enabled ? 'ativada' : 'desativada'}.`, { title: 'OPÇÕES DA IA' })
    }
    if (['modelos', 'models'].includes(action)) return modelCatalog({ sock, msg, logger })
    if (['modelo', 'model'].includes(action)) {
      const requested = decodeURIComponent(String(args.slice(1).join(' ') || '').trim())
      const model = configuredModels().find(row => row.id === requested)
      if (!model) return reply(sock, msg, `Modelo inválido. Use ${settings.prefix}iaconfig modelos.`, { title: 'OPÇÕES DA IA' })
      const current = readConfig()
      writeConfigSync({ ai: { ...current.ai, model: model.id } })
      settings.aiModel = model.id
      updateAiGlobalConfig({ model: model.id })
      return reply(sock, msg, `Modelo selecionado: *${model.name}*.`, { title: 'OPÇÕES DA IA' })
    }
    if (!action) {
      return sendQuickButtons({
        sock, jid: msg.key.remoteJid, quoted: msg, logger, kind: 'ai-config-toggle', menuMedia: true,
        body: `╭━━⪩ 🪷 *OPÇÕES DA IA* ⪨━━\n▢ • 💮 *estado:* ${settings.aiEnabled ? 'ativa' : 'pausada'}\n▢ • 🌸 *modelo:* ${settings.aiModel}\n▢ • 💮 *tokens:* ${(settings.aiTokens || []).length}\n╰━━─「🪷」─━━`,
        includeUpdateCta: false,
        buttons: [
          { id: `${settings.prefix}iaconfig ${settings.aiEnabled ? 'off' : 'on'}`, text: settings.aiEnabled ? '💮 Desativar IA' : '🌸 Ativar IA' },
          { id: `${settings.prefix}iaconfig modelos`, text: '🌸 Modelos' },
          { id: `${settings.prefix}iatoken list`, text: '💮 Tokens' }
        ]
      })
    }
    return sendNativeList({
      sock, jid: msg.key.remoteJid, quoted: msg, logger, kind: 'ai-config',
      body: `╭━━⪩ 🪷 *OPÇÕES DA IA* ⪨━━\n▢ • 💮 *estado:* ${settings.aiEnabled ? 'ativa' : 'pausada'}\n▢ • 🌸 *modelo:* ${settings.aiModel}\n╰━━─「🪷」─━━`,
      buttonText: '💮 Abrir opções',
      sections: [{ title: 'Configuração da IA', rows: [
        { id: `${settings.prefix}iaconfig modelos`, title: 'Modelos', description: 'Catálogo interativo de modelos' },
        { id: `${settings.prefix}iatoken list`, title: 'Tokens rotativos', description: 'Gerenciar tokens no config.json' }
      ]}], includeUpdateCta: false
    })
  }
})
