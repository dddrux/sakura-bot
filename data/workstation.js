import { settings } from './settings.js'
import { sendMessageFast } from './send-manager.js'

const VALID_REACTIONS = new Set(['🌸', '🌸', '💮'])
const clean = value => String(value ?? '').trim()
const key = value => clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()

function normalizeAliases(aliases = [], name = '') {
  const seen = new Set([key(name)])
  const out = []
  for (const alias of Array.isArray(aliases) ? aliases : []) {
    const value = key(alias)
    if (!value || seen.has(value) || /\s/.test(value)) continue
    seen.add(value)
    out.push(value)
  }
  return out
}

function normalizeMenuEntries(entries = [], command = {}) {
  const source = Array.isArray(entries) && entries.length ? entries : [{ name: command.name, usage: command.usage, description: command.description, menuGroup: command.menuGroup }]
  return source.map(entry => ({
    name: key(entry?.name || command.name),
    usage: clean(entry?.usage || `${settings.prefix}${entry?.name || command.name}`),
    description: clean(entry?.description || command.description),
    menuGroup: clean(entry?.menuGroup || command.menuGroup || 'Comandos'),
    hidden: Boolean(entry?.hidden),
    menuModelOnly: Boolean(entry?.menuModelOnly)
  })).filter(entry => entry.name)
}

export function normalizeCommandDefinition(input = {}) {
  if (!input || typeof input !== 'object') throw new TypeError('Comando inválido: esperado objeto.')
  const name = key(input.name)
  if (!name || /\s/.test(name)) throw new TypeError('Comando inválido: name precisa ser uma palavra.')
  const executor = typeof input.execute === 'function' ? input.execute : typeof input.run === 'function' ? input.run : null
  if (!executor) throw new TypeError(`Comando ${name} precisa de execute() ou run().`)
  const reaction = VALID_REACTIONS.has(input.reaction) ? input.reaction : settings.emojis[0]
  const successReaction = VALID_REACTIONS.has(input.successReaction) ? input.successReaction : settings.emojis[2]
  const errorReaction = VALID_REACTIONS.has(input.errorReaction) ? input.errorReaction : settings.emojis[1]
  const priority = ['low', 'normal', 'high', 'vip'].includes(input.priority) ? input.priority : (input.vipOnly ? 'vip' : 'normal')
  const normalized = {
    ...input,
    name,
    aliases: normalizeAliases(input.aliases, name),
    category: clean(input.category || 'Principal'),
    officialLinks: input.officialLinks === true,
    usage: clean(input.usage || `${settings.prefix}${name}`),
    description: clean(input.description || `Executa ${settings.prefix}${name}.`),
    menuGroup: clean(input.menuGroup || 'Comandos'),
    reaction,
    successReaction,
    errorReaction,
    priority,
    ownerOnly: Boolean(input.ownerOnly),
    subownerAllowed: Boolean(input.subownerAllowed),
    adminOnly: Boolean(input.adminOnly),
    strictAdminOnly: Boolean(input.strictAdminOnly),
    botAdminOnly: Boolean(input.botAdminOnly),
    groupOnly: Boolean(input.groupOnly),
    privateOnly: Boolean(input.privateOnly),
    vipOnly: Boolean(input.vipOnly),
    vipPreferred: input.vipPreferred !== false,
    hidden: Boolean(input.hidden),
    sensitiveArgs: Boolean(input.sensitiveArgs),
    cooldownMs: Math.max(0, Number(input.cooldownMs) || 0),
    slash: input.slash === false ? null : {
      enabled: true,
      model: clean(input.slash?.model || input.usage || `${settings.prefix}${name}`),
      copyable: input.slash?.copyable !== false,
      categories: Array.isArray(input.slash?.categories) ? input.slash.categories.map(clean).filter(Boolean) : []
    }
  }
  normalized.menuEntries = normalizeMenuEntries(input.menuEntries, normalized)
  normalized.execute = executor
  return Object.freeze(normalized)
}

export function defineCommand(spec = {}) {
  const executor = typeof spec.run === 'function' ? spec.run : spec.execute
  return normalizeCommandDefinition({ ...spec, execute: executor })
}

export function commandReaction(command = {}, phase = 'start') {
  if (phase === 'success') return command.successReaction || settings.emojis[2]
  if (phase === 'error') return command.errorReaction || settings.emojis[1]
  return command.reaction || settings.emojis[0]
}

export async function reactToCommand(sock, msg, command, phase = 'start') {
  if (!settings.commandReactions || !sock?.sendMessage || !msg?.key?.remoteJid || !msg?.key?.id) return null
  const text = commandReaction(command, phase)
  try { return await sock.sendMessage(msg.key.remoteJid, { react: { text, key: msg.key } }) } catch { return null }
}

export function workstationContext(base = {}) {
  return Object.freeze({
    ...base,
    ui: Object.freeze({
      emojis: settings.emojis,
      currencyName: settings.currencyName,
      currencyEmoji: settings.currencyEmoji,
      updateChannel: settings.updateChannel,
      officialGroup: settings.officialGroup
    }),
    sendFast: (jid, content, sendOptions = {}, managerOptions = {}) => sendMessageFast(base.sock, jid, content, sendOptions, { priority: base.priority || 'normal', ...managerOptions }),
    commandApiVersion: 2
  })
}
