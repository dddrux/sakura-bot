import { parseSakuraNativeFlowResponse, extractSakuraSelection } from '@sakura-md/baileys'

const WRAPPERS = [
  'ephemeralMessage',
  'viewOnceMessage',
  'viewOnceMessageV2',
  'viewOnceMessageV2Extension',
  'documentWithCaptionMessage',
  'deviceSentMessage',
  'editedMessage',
  'associatedChildMessage',
  'botForwardedMessage',
  'botInvokeMessage',
  'botTaskMessage',
  'groupMentionedMessage',
  'groupStatusMentionMessage',
  'groupStatusMessage',
  'groupStatusMessageV2',
  'pollCreationOptionImageMessage',
  'questionMessage',
  'questionReplyMessage',
  'statusMentionMessage'
]

export function unwrapMessage(message = {}) {
  let current = message || {}
  const chain = []
  for (let depth = 0; depth < 12; depth += 1) {
    let next = null
    let wrapper = ''
    for (const key of WRAPPERS) {
      if (current?.[key]?.message) {
        next = current[key].message
        wrapper = key
        break
      }
    }
    if (!next && current?.protocolMessage?.editedMessage) {
      next = current.protocolMessage.editedMessage
      wrapper = 'protocolMessage.editedMessage'
    }
    if (!next) break
    chain.push(wrapper)
    current = next
  }
  return { content: current || {}, wrappers: chain }
}

function getNativeFlowParams(content) {
  return content?.interactiveResponseMessage?.nativeFlowResponseMessage?.paramsJson
}

export function getSelectionDetails(message = {}) {
  const { content, wrappers } = unwrapMessage(message)
  const nativeParams = getNativeFlowParams(content)
  const candidates = [
    ['buttonsResponseMessage', content.buttonsResponseMessage?.selectedButtonId],
    ['listResponseMessage', content.listResponseMessage?.singleSelectReply?.selectedRowId],
    ['templateButtonReplyMessage', content.templateButtonReplyMessage?.selectedId],
    ['interactiveResponseMessage', extractSakuraSelection?.(content) || parseSakuraNativeFlowResponse(nativeParams)]
  ]

  for (const [source, value] of candidates) {
    const selected = String(value || '').trim()
    if (selected) {
      return {
        selected,
        source,
        wrappers,
        rawParams: typeof nativeParams === 'string' ? nativeParams.slice(0, 1000) : ''
      }
    }
  }
  return { selected: '', source: '', wrappers, rawParams: '' }
}

export function getMessageText(message = {}) {
  const { content } = unwrapMessage(message)
  const selection = getSelectionDetails(message).selected
  return String(
    selection ||
    content.conversation ||
    content.extendedTextMessage?.text ||
    content.imageMessage?.caption ||
    content.videoMessage?.caption ||
    content.documentMessage?.caption ||
    ''
  ).trim()
}

export function getMessageType(message = {}) {
  const { content } = unwrapMessage(message)
  const ignored = new Set(['senderKeyDistributionMessage', 'messageContextInfo'])
  return Object.keys(content).find(key => !ignored.has(key)) || Object.keys(content)[0] || 'unknown'
}

export function getContextInfo(message = {}) {
  const { content } = unwrapMessage(message)
  for (const value of Object.values(content)) {
    if (value?.contextInfo) return value.contextInfo
  }
  return null
}

export function getQuotedMessage(msg) {
  const contextInfo = getContextInfo(msg?.message)
  if (!contextInfo?.quotedMessage) return null
  return {
    key: {
      remoteJid: msg.key.remoteJid,
      fromMe: false,
      id: contextInfo.stanzaId,
      participant: contextInfo.participant,
      participantAlt: contextInfo.participantAlt
    },
    message: contextInfo.quotedMessage
  }
}

export function getMediaTarget(msg) {
  const quoted = getQuotedMessage(msg)
  if (quoted) return quoted
  const { content } = unwrapMessage(msg?.message)
  const hasMedia = Boolean(content.imageMessage || content.videoMessage || content.stickerMessage || content.documentMessage)
  return hasMedia ? msg : null
}

export function getMediaKind(message = {}) {
  const { content } = unwrapMessage(message)
  if (content.imageMessage) return 'image'
  if (content.videoMessage) return 'video'
  if (content.stickerMessage) return 'sticker'
  if (content.documentMessage) return 'document'
  return ''
}

export function normalizeTriggerText(text = '') {
  return String(text)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR')
    .replace(/([^\p{L}\p{N}])+/gu, ' ')
    .replace(/([\p{L}\p{N}])\1{2,}/gu, (run, char) => char === 'k' ? 'kkk' : char)
    .replace(/\s+/g, ' ')
    .trim()
}

export function normalizeCommandText(text = '', prefix = '.') {
  const value = String(text || '').trim()
  if (!value) return ''
  if (value.startsWith(prefix)) return value
  if (/^[a-z0-9_-]+(?:\s|$)/i.test(value)) return `${prefix}${value}`
  return value
}
