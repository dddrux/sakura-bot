import { loadCommands } from '../handler.js'
import { getVisibleMenuCommands } from '../interactive.js'
import { menuCategoryFor, shortAliasFor, SHORT_ALIAS_TARGETS } from '../short-aliases.js'
import economyCommand from '../../commands/economy.js'
import menuCommand from '../../commands/menu.js'

const logger = new Proxy({}, { get: () => () => {} })
const commands = await loadCommands(logger)
const visible = getVisibleMenuCommands(commands)

const missing = visible.filter(entry => !shortAliasFor(entry.name))
if (missing.length) throw new Error(`Ações sem atalho curto: ${missing.map(item => item.name).join(', ')}`)
for (const [alias, target] of Object.entries(SHORT_ALIAS_TARGETS)) {
  if (!commands.get(alias)) throw new Error(`Atalho não registrado: .${alias}`)
  if (commands.get(alias) !== commands.get(target)) throw new Error(`Atalho .${alias} não aponta para .${target}`)
}
if (menuCategoryFor('eco') !== 'Economia' || menuCategoryFor('economia') !== 'Economia') throw new Error('.m eco/.m economia não resolvem Economia')

const relays = []
const sock = {
  user: { id: '5581999999999@s.whatsapp.net' },
  waUploadToServer: async () => ({ mediaUrl: 'https://example.invalid/profile.jpg', directPath: '/profile.jpg' }),
  profilePictureUrl: async () => 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z9a0AAAAASUVORK5CYII=',
  sakuraResolveNumber: async jid => String(jid).replace(/\D/g, ''),
  async relayMessage(jid, message, options) {
    relays.push({ jid, message, options })
    return options.messageId
  },
  async sendMessage(jid, content) {
    relays.push({ jid, content, mode: 'send' })
    return { key: { id: `SEND-${relays.length}`, remoteJid: jid }, message: content }
  }
}
const msg = {
  key: { remoteJid: '120363000000000000@g.us', participant: '5581888888888@s.whatsapp.net', id: 'PROFILE-TEST' },
  pushName: 'Pessoa teste',
  message: { extendedTextMessage: { text: '.perfil', contextInfo: { mentionedJid: ['5581777777777@s.whatsapp.net'] } } }
}

const menuStart = relays.length
await menuCommand.execute({
  sock,
  msg: { ...msg, key: { ...msg.key, id: 'MENU-ECO-TEST' }, message: { conversation: '.m eco' } },
  args: ['eco'],
  text: '.menu eco',
  invokedAs: 'm',
  commands,
  logger
})
const menuRelay = relays.slice(menuStart).find(item => item.message?.viewOnceMessage?.message?.interactiveMessage)
if (!menuRelay) throw new Error('.m eco não abriu lista Native Flow')
const menuButton = menuRelay.message.viewOnceMessage.message.interactiveMessage.nativeFlowMessage?.buttons?.find(item => item.name === 'single_select')
const menuSections = JSON.parse(menuButton?.buttonParamsJson || '{}').sections || []
const menuIds = menuSections.flatMap(section => section.rows || []).map(row => row.id)
if (!menuIds.includes('.dp') || !(menuIds.includes('.pf') || menuIds.includes('.menu command perfil'))) throw new Error(`.m eco não trouxe depósito/modelo de perfil: ${menuIds.join(',')}`)

const profileStart = relays.length
await economyCommand.execute({
  sock,
  msg,
  args: ['@5581777777777'],
  text: '.perfil @5581777777777',
  settings: { prefix: '.' },
  senderNumber: '5581888888888',
  logger
})
const profileRelay = relays.slice(profileStart).find(item => item.message?.viewOnceMessage?.message?.interactiveMessage)
if (!profileRelay) throw new Error('Perfil não foi enviado como Native Flow')
const interactive = profileRelay.message.viewOnceMessage.message.interactiveMessage
if (!interactive.header?.hasMediaAttachment) throw new Error('Perfil não incluiu foto de perfil')
if (!String(interactive.body?.text || '').includes('+5581777777777')) throw new Error('Perfil não mostrou o celular completo')

const beforeDepositRelays = relays.length
await economyCommand.execute({
  sock,
  msg: { ...msg, key: { ...msg.key, id: 'DEPOSIT-TEST' }, message: { conversation: '.depositar' } },
  args: [],
  text: '.depositar',
  settings: { prefix: '.' },
  senderNumber: '5581888888888',
  logger
})
const depositRelay = relays.slice(beforeDepositRelays).find(item => item.message?.viewOnceMessage?.message?.interactiveMessage)
if (!depositRelay) throw new Error('.depositar sem valor não abriu o banco interativo')

console.log(`✅ Atalhos: ${visible.length} ações com alias curto, .m eco/.m economia, perfil com foto/celular e depósito interativo aprovados`)
