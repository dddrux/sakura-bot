import { defineCommand } from '../data/workstation.js'
import { readConfig, settings as globalSettings, writeConfigSync } from '../data/settings.js'
import { sendMessageFast } from '../data/send-manager.js'
import { reply } from '../data/reply.js'
import { updateAiGlobalConfig } from '../data/ai-store.js'
import { isPlausibleAiToken } from '../data/ai-token-utils.js'

const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
const mask = token => `${String(token || '').slice(0, 7)}…${String(token || '').slice(-4)}`

function rows() {
  const config = readConfig()
  return (Array.isArray(config.ai?.tokens) ? config.ai.tokens : []).map((entry, index) => {
    const object = typeof entry === 'object' && entry ? entry : { token: entry }
    const token = String(object.token || object.value || '')
    return { index, label: String(object.label || `Token ${index + 1}`), token, valid: isPlausibleAiToken(token), enabled: object.enabled !== false, scopeChat: String(object.scopeChat || object.scope || '*') }
  }).filter(row => row.token)
}

function persist(next) {
  const current = readConfig()
  const tokens = next.map(row => ({ label: row.label, token: row.token, enabled: row.enabled !== false, scopeChat: row.scopeChat || '*' }))
  writeConfigSync({ ai: { ...current.ai, tokens } })
  globalSettings.aiTokens = tokens
}

async function deleteSensitiveMessage(sock, msg) {
  try { await sock.sendMessage(msg.key.remoteJid, { delete: msg.key }); return true } catch { return false }
}

export default defineCommand({
  name: 'iatoken',
  aliases: ['aitk', 'tokenia', 'groqtk'],
  category: 'Inteligência artificial',
  usage: '.iatoken add TOKEN',
  description: 'Gerencia o pool rotativo de tokens da IA no config.json.',
  ownerOnly: true,
  subownerAllowed: true,
  sensitiveArgs: true,
  officialLinks: false,
  fastPath: true,
  skipAfkReferences: true,
  async execute({ sock, msg, args, rawArgs, settings }) {
    const raw = String(rawArgs || '').trim()
    const detectedToken = raw.match(/(?:gsk_|sk-)[A-Za-z0-9_.-]{16,}/)?.[0] || ''
    let action = normalize(args[0] || '')
    // Sintaxe intuitiva: `.iatoken TOKEN` equivale a `.iatoken add TOKEN`.
    if (detectedToken && !['add', 'adicionar'].includes(action)) action = 'add'
    if (!action) action = 'help'
    const pool = rows()
    const help = [
      `Use ${settings.prefix}iatoken add TOKEN`,
      `${settings.prefix}iatoken list`,
      `${settings.prefix}iatoken del 1`,
      `${settings.prefix}iatoken test`
    ].join('\n')

    if (['help', 'ajuda'].includes(action)) return reply(sock, msg, help, { title: 'TOKENS DA IA', officialLinks: false })

    if (['status', 'lista', 'list'].includes(action)) {
      const body = pool.length
        ? pool.map((row, index) => `${index + 1}. ${row.label} • ${mask(row.token)} • ${row.valid ? (row.enabled ? 'ativo' : 'pausado') : 'inválido'} • ${row.scopeChat === '*' ? 'global' : 'grupo'}`).join('\n')
        : 'Nenhum token configurado.'
      return reply(sock, msg, `${body}\n\n${help}`, { title: 'TOKENS DA IA', officialLinks: false })
    }

    if (['add', 'adicionar'].includes(action)) {
      const token = detectedToken
      if (!token) return sendMessageFast(sock, msg.key.remoteJid, { text: help })
      // O token nunca fica citado no chat: apagamos a mensagem antes de confirmar.
      await deleteSensitiveMessage(sock, msg)
      const afterAction = raw.replace(/^\S+\s+/, '')
      const labelPart = (action === 'add' && normalize(args[0]) !== 'add' ? raw : afterAction).replace(token, '').trim()
      const label = labelPart || `Token ${pool.length + 1}`
      if (!pool.some(row => row.token === token)) pool.push({ label, token, enabled: true, scopeChat: '*' })
      persist(pool)
      updateAiGlobalConfig({ globalEnabled: true })
      return sendMessageFast(sock, msg.key.remoteJid, { text: 'token atribuido!' })
    }

    if (action === 'test') {
      const row = pool.find(item => item.enabled !== false && item.valid)
      if (!row) return sendMessageFast(sock, msg.key.remoteJid, { text: `Nenhum token ativo.\n${help}` })
      try {
        const response = await fetch(`${String(globalSettings.aiBaseUrl || '').replace(/\/$/, '')}/models`, {
          headers: { Authorization: `Bearer ${row.token}` }, signal: AbortSignal.timeout(10000)
        })
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        return sendMessageFast(sock, msg.key.remoteJid, { text: `token funcionando! • ${mask(row.token)}` })
      } catch (error) {
        return sendMessageFast(sock, msg.key.remoteJid, { text: `token indisponível: ${String(error?.message || error)}\n${help}` })
      }
    }

    const index = Math.max(0, Number(args[1]) - 1)
    if (!['remover', 'del', 'delete', 'on', 'ativar', 'off', 'desativar'].includes(action)) {
      return sendMessageFast(sock, msg.key.remoteJid, { text: help })
    }
    if (!pool[index]) return sendMessageFast(sock, msg.key.remoteJid, { text: `Token não encontrado.\n${help}` })
    if (['remover', 'del', 'delete'].includes(action)) pool.splice(index, 1)
    else if (['on', 'ativar'].includes(action)) pool[index].enabled = true
    else pool[index].enabled = false
    persist(pool)
    return sendMessageFast(sock, msg.key.remoteJid, { text: 'Configuração de token atualizada.' })
  }
})
