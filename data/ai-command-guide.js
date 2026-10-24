import { getMessageText, getQuotedMessage } from './messages.js'
import { sendCommandModel, sendCommandSearch } from './interactive.js'

const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR').trim()
const commandToken = value => String(value || '').match(/(?:^|\s)[.!/#]([a-z0-9_-]+)/i)?.[1] || ''

function uniqueCommands(commands) {
  if (!commands?.values) return []
  return [...new Map([...commands.values()].map(command => [normalize(command.name), command])).values()].filter(command => command && !command.hidden)
}

function resolveCommand(commands, name = '') {
  const key = normalize(name)
  if (!key) return null
  return commands?.get?.(key) || uniqueCommands(commands).find(command => normalize(command.name) === key || (command.aliases || []).some(alias => normalize(alias) === key)) || null
}

function searchIntent(value = '') {
  const current = normalize(value)
  return /(?:como\s+(?:usa|usar)|como\s+funciona|qual\s+(?:e\s+o\s+)?comando|comando\s+(?:pra|para)|pesquis(?:a|ar).*comando|procur(?:a|ar).*comando|acha.*comando|encontra.*comando|quero\s+um\s+comando)/i.test(current)
}

function cleanQuery(value = '') {
  return String(value || '')
    .replace(/sakura[,.]?/ig, ' ')
    .replace(/como\s+(?:usa|usar|funciona)/ig, ' ')
    .replace(/qual\s+(?:e\s+o\s+)?comando/ig, ' ')
    .replace(/comando\s+(?:pra|para)/ig, ' ')
    .replace(/pesquis(?:a|ar)|procur(?:a|ar)|acha|encontra|quero\s+um\s+comando/ig, ' ')
    .replace(/[.!/#][a-z0-9_-]+/ig, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export async function tryLocalCommandHelp({ sock, msg, text = '', commands, logger } = {}) {
  if (!commands?.size) return false
  const current = String(text || '').trim()
  const asksHow = searchIntent(current)
  if (!asksHow) return false

  const quoted = getQuotedMessage(msg)
  const quotedText = quoted ? getMessageText(quoted.message) : ''
  const explicit = commandToken(current) || commandToken(quotedText)
  if (explicit) {
    const command = resolveCommand(commands, explicit)
    if (command) {
      await sendCommandModel({ sock, msg, commands, command, logger })
      return true
    }
  }

  await sendCommandSearch({ sock, msg, commands, query: cleanQuery(current), logger })
  return true
}
