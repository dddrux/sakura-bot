import { defineCommand } from '../data/workstation.js'
import { sendNativeList } from '../data/interactive.js'
import { reply } from '../data/reply.js'
import { readConfig, settings, writeConfigSync } from '../data/settings.js'

const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
function validUrl(value='') { try { const url = new URL(value); return /^https?:$/.test(url.protocol) } catch { return false } }

export default defineCommand({
  name: 'config',
  aliases: ['cfg', 'ajustes', 'menuconfig', 'mcfg'],
  category: 'Configuração',
  usage: '.config',
  description: 'Painel central de configurações da Sakura.',
  ownerOnly: true,
  subownerAllowed: true,
  async execute({ sock, msg, args, rawArgs, logger }) {
    const action = normalize(args[0])
    if (['canal', 'grupo'].includes(action)) {
      const url = String(rawArgs || '').replace(/^\S+\s*/, '').trim()
      if (url && !validUrl(url)) return reply(sock, msg, 'Envie um link http/https válido.')
      const current = readConfig()
      const ui = { ...current.ui, [action === 'canal' ? 'updateChannel' : 'officialGroup']: url }
      writeConfigSync({ ui })
      if (action === 'canal') settings.updateChannel = url
      else settings.officialGroup = url
      return reply(sock, msg, `${action === 'canal' ? 'Canal de atualizações' : 'Grupo oficial'} atualizado.`, { title: 'CONFIGURAÇÕES' })
    }
    return sendNativeList({
      sock, jid: msg.key.remoteJid, quoted: msg, logger, kind: 'config-main',
      body: `╭━━⪩ 🪷 *CONFIGURAÇÕES* ⪨━━\n▢ • 💮 *bot:* ${settings.botName}\n▢ • 🌸 *codinome:* ${settings.codename}\n▢ • 💮 *prefixo:* ${settings.prefix}\n╰━━─「🪷」─━━`,
      buttonText: '💮 Abrir categorias',
      sections: [
        { title: '🌸 Aparência e links', rows: [
          { id: `${settings.prefix}menu`, title: '💮 Prévia do menu', description: 'Mostra o menu com o vídeo atual' },
          { id: `${settings.prefix}config canal`, title: '🌸 Canal oficial', description: 'Use .config canal <link>' },
          { id: `${settings.prefix}config grupo`, title: '💮 Grupo oficial', description: 'Use .config grupo <link>' }
        ]},
        { title: '🌸 Inteligência artificial', rows: [
          { id: `${settings.prefix}iaconfig`, title: '💮 Opções da IA', description: 'Estado, modelo e comportamento' },
          { id: `${settings.prefix}iatoken status`, title: '🌸 Tokens rotativos', description: 'Pool em texto simples no config' },
          { id: `${settings.prefix}ia`, title: '💮 IA por grupo', description: 'Modo, limite, contexto e cooldown' }
        ]},
        { title: '🌸 VIP e doações', rows: [
          { id: `${settings.prefix}vip planos`, title: '💮 Planos VIP', description: 'Bloom, Prime e Hanami' },
          { id: `${settings.prefix}doar`, title: '🌸 Apoiar a Sakura', description: 'PIX e benefícios por valor' },
          { id: `${settings.prefix}vip`, title: '💮 Meu VIP', description: 'Plano, validade e benefícios' }
        ]},
        { title: '🌸 Economia', rows: [
          { id: `${settings.prefix}eco`, title: '💮 Sakura Coins', description: 'Conta, banco, loja e jornadas' },
          { id: `${settings.prefix}saldo`, title: '🌸 Meu saldo', description: 'Carteira e banco' },
          { id: `${settings.prefix}ranks`, title: '💮 Rankings', description: 'Rankings econômicos e sociais' }
        ]},
        { title: '🌸 Grupos e recepção', rows: [
          { id: `${settings.prefix}recepcao`, title: '💮 Recepção', description: 'Ficha e boas-vindas automáticas' },
          { id: `${settings.prefix}automacoes`, title: '🌸 Automações', description: 'Rotinas, antiflood e horários' },
          { id: `${settings.prefix}grupo`, title: '💮 Grupo', description: 'Nome, descrição, link e participantes' }
        ]},
        { title: '🌸 Mídia e AutoFig', rows: [
          { id: `${settings.prefix}midia`, title: '💮 Ferramentas de mídia', description: 'Áudio, vídeo e conversões' },
          { id: `${settings.prefix}autofig`, title: '🌸 AutoFig', description: 'Aleatoriedade, chance e anti-repetição' },
          { id: `${settings.prefix}automaticos`, title: '💮 Respostas automáticas', description: 'Gatilhos, áudios e figurinhas' }
        ]},
        { title: '🌸 Sistema', rows: [
          { id: `${settings.prefix}diagnostico`, title: '💮 Diagnóstico', description: 'Memória, filas, IA e sessão' },
          { id: `${settings.prefix}statusmodulos`, title: '🌸 Módulos', description: 'Integridade dos subsistemas' },
          { id: `${settings.prefix}botinfo`, title: '💮 Bot info', description: 'Identidade Hanami e runtime' }
        ]}
      ]
    })
  }
})
