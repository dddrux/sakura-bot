import { formatMessage } from './formatter.js'
import { settings } from './settings.js'
import { sendMessageFast } from './send-manager.js'

export async function reply(sock, msg, text, extra = {}) {
  const {
    raw = false,
    title,
    icon,
    width,
    footer = settings.footer,
    interactive = true,
    nativeFlow = [],
    quoted = true,
    ...messageExtra
  } = extra || {}
  const body = raw || !settings.autoFormatMessages ? String(text) : formatMessage(text, { title, icon, width })
  const sendOptions = quoted === false ? {} : { quoted: quoted && typeof quoted === 'object' ? quoted : msg }
  if (raw || !interactive) return sendMessageFast(sock, msg.key.remoteJid, { text: body, ...messageExtra }, sendOptions)

  const actions = [...nativeFlow]
  if (!actions.length) return sendMessageFast(sock, msg.key.remoteJid, { text: body, ...messageExtra }, sendOptions)
  return sendMessageFast(sock, msg.key.remoteJid, {
    text: body,
    footer,
    nativeFlow: actions,
    viewOnce: true,
    interactiveAsTemplate: false,
    ...messageExtra
  }, sendOptions)
}
