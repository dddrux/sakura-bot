import { settings } from './settings.js'
import { sendMessageFast } from './send-manager.js'
import { markCommandCta } from './command-ui-state.js'

const DEFAULT_CHANNEL_LABEL = 'Atualizações'
const DEFAULT_GROUP_LABEL = 'Grupo oficial da sakura'
const DEFAULT_VIP_LABEL = 'Adquira seu VIP'

function vipContactUrl() {
  const number = String(settings.vipContactNumber || '').replace(/\D/g, '')
  if (!number) return ''
  const text = encodeURIComponent('Olá! Quero adquirir o VIP da Sakura-MD. Pode me explicar os planos e como comprar?')
  return `https://wa.me/${number}?text=${text}`
}

export function officialLinkActions({ includeMenu = false, includeOfficial = true, includeVip = false, channelLabel = DEFAULT_CHANNEL_LABEL, groupLabel = DEFAULT_GROUP_LABEL, vipLabel = DEFAULT_VIP_LABEL, includePendingGroup = true } = {}) {
  const actions = []
  if (includeMenu) {
    actions.push({
      text: '🌸 Abrir categorias',
      quickReply: { id: `${settings.prefix}m`, displayText: '🌸 Abrir categorias' }
    })
  }
  if (includeOfficial && settings.updateChannel) actions.push({ text: `💮 ${channelLabel}`, url: settings.updateChannel })
  if (includeOfficial && settings.officialGroup) {
    actions.push({ text: `🔗 ${groupLabel}`, url: settings.officialGroup })
  } else if (includeOfficial && includePendingGroup) {
    actions.push({
      text: `🔗 ${groupLabel}`,
      quickReply: { id: `${settings.prefix}menu grupooficial`, displayText: `🔗 ${groupLabel}` }
    })
  }
  const vipUrl = includeVip ? vipContactUrl() : ''
  if (vipUrl) actions.push({ text: `💎 ${vipLabel}`, url: vipUrl })
  return actions
}

export function officialNativeButtons({ proto, includeMenu = false, includeOfficial = true, includeVip = false, channelLabel = DEFAULT_CHANNEL_LABEL, groupLabel = DEFAULT_GROUP_LABEL, vipLabel = DEFAULT_VIP_LABEL, includePendingGroup = true } = {}) {
  return officialLinkActions({ includeMenu, includeOfficial, includeVip, channelLabel, groupLabel, vipLabel, includePendingGroup }).map(action => {
    if (action.quickReply) {
      return proto.Message.InteractiveMessage.NativeFlowMessage.NativeFlowButton.create({
        name: 'quick_reply',
        buttonParamsJson: JSON.stringify({ display_text: action.quickReply.displayText, id: action.quickReply.id })
      })
    }
    return proto.Message.InteractiveMessage.NativeFlowMessage.NativeFlowButton.create({
      name: 'cta_url',
      buttonParamsJson: JSON.stringify({ display_text: action.text, url: action.url, merchant_url: action.url })
    })
  })
}

// Mantido apenas para painéis seguros que chamem esta função explicitamente.
export async function sendOfficialLinksBar(sock, msg, { includeMenu = true, includeOfficial = true, includeVip = false, channelLabel = DEFAULT_CHANNEL_LABEL, groupLabel = DEFAULT_GROUP_LABEL, includePendingGroup = true, quoted = true } = {}) {
  markCommandCta(msg)
  const nativeFlow = officialLinkActions({ includeMenu, includeOfficial, includeVip, channelLabel, groupLabel, includePendingGroup })
  if (!nativeFlow.length) return null
  return sendMessageFast(sock, msg.key.remoteJid, {
    text: '\u2063',
    footer: '',
    nativeFlow,
    viewOnce: true,
    interactiveAsTemplate: false
  }, quoted ? { quoted: msg } : {})
}
