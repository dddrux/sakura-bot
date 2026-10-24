// Console interativo da Sakura: controla o bot pelo terminal.
// Sem dependências pesadas: tudo que toca o bot entra por `api` (injeção), o que permite testar sem WhatsApp.
import readline from 'node:readline'
import { formatConsoleLine, formatConsoleTable, consolePrompt, colorEnabled } from './terminal-theme.js'
import { flattenConfig, getValue, setValue, listOwners, addOwner, removeOwner, createWizard, maskValue } from './terminal-config.js'
import { setConsoleHooks, setConsoleLevel, getConsoleLevel, LOG_LEVELS } from './logger.js'

const norm = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
const digits = value => String(value ?? '').replace(/\D/g, '')

export function parseConsoleLine(line = '') {
  const text = String(line).trim().replace(/^[./]/, '')
  if (!text) return null
  const [first, ...rest] = text.split(/\s+/)
  const name = norm(first)
  const restText = text.slice(first.length).trim()
  return { name, args: rest, rest: restText }
}

export function toJid(target, groups = []) {
  const raw = String(target ?? '').trim()
  if (!raw) return null
  if (/@(s\.whatsapp\.net|g\.us|lid)$/.test(raw)) return raw
  if (/^\d{1,3}$/.test(raw) && groups[Number(raw) - 1]) return groups[Number(raw) - 1].id
  const number = digits(raw)
  return number.length >= 10 ? `${number}@s.whatsapp.net` : null
}

function uptime(seconds) {
  const s = Math.floor(seconds)
  const parts = [[Math.floor(s / 86400), 'd'], [Math.floor(s % 86400 / 3600), 'h'], [Math.floor(s % 3600 / 60), 'm'], [s % 60, 's']]
  return parts.filter(([n], i) => n || i === 3).map(([n, u]) => `${n}${u}`).join(' ')
}

export const CONSOLE_GROUPS = Object.freeze([
  ['Configurar', [
    ['assistente', 'configura nome, números, dono, prefixo, IA e painel passo a passo'],
    ['config', 'lista as opções (config <seção> filtra; config <seção.chave> lê)'],
    ['config <seção.chave> <valor>', 'altera uma opção (ex.: config ui.footer Minha frase)'],
    ['dono [add <número> [nome] | remover <número>]', 'vê/gerencia os donos'],
    ['prefixo <x>', 'muda o prefixo dos comandos'],
    ['nome <texto>', 'muda o nome do bot']
  ]],
  ['Controlar', [
    ['status', 'conexão, uptime, memória, nível de log'],
    ['grupos', 'lista os grupos (use o número no enviar)'],
    ['enviar <número|n> <texto>', 'manda texto para um número ou grupo da lista'],
    ['auto <audio|fig> <on|off>', 'liga/desliga respostas automáticas']
  ]],
  ['Sistema', [
    ['log [nível]', `vê/muda o nível do terminal (${LOG_LEVELS.join(', ')}; "padrao" restaura)`],
    ['backup', 'salva um snapshot de config/db/sessão agora'],
    ['reconectar', 'reinicia a conexão com o WhatsApp'],
    ['limpar', 'limpa a tela'],
    ['sair', 'encerra a Sakura com segurança']
  ]]
])
export const CONSOLE_HELP = CONSOLE_GROUPS.flatMap(([, rows]) => rows)
export const CONSOLE_COMMANDS = Object.freeze(['assistente', 'config', 'dono', 'prefixo', 'nome', 'status', 'grupos', 'enviar', 'auto', 'log', 'backup', 'reconectar', 'limpar', 'ajuda', 'sair'])

const ESSENTIAL = ['bot.name', 'bot.number', 'bot.prefix', 'ai.enabled', 'ai.model', 'tts.enabled', 'panel.enabled', 'panel.port', 'ui.footer', 'vip.enabled', 'runtime.logLevel', 'runtime.loginMode']

// api: { getSocket, getStatus, getRuntime, setRuntime, backup, reconnect, shutdown, defaultLogLevel }
export function createConsoleCommands(api) {
  let groupsCache = []
  let wizard = null
  const cfg = () => { if (!api.config) throw new Error('configuração indisponível neste modo'); return api.config }
  const ok = text => formatConsoleLine('ok', text)
  const err = text => formatConsoleLine('err', text)
  const info = text => formatConsoleLine('info', text)

  const needSocket = () => {
    const sock = api.getSocket?.()
    if (!sock?.user) throw new Error('Sakura ainda não está conectada ao WhatsApp')
    return sock
  }
  const loadGroups = async () => {
    const sock = needSocket()
    const all = await sock.groupFetchAllParticipating()
    groupsCache = Object.values(all).map(g => ({ id: g.id, name: g.subject || g.id, size: g.participants?.length || 0 }))
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
    return groupsCache
  }

  const table = {
    ajuda: async () => CONSOLE_GROUPS.map(([title, rows]) => formatConsoleTable(title, rows)).join('\n\n'),
    assistente: async () => {
      wizard = createWizard(cfg())
      return [info('assistente de configuração — Enter mantém o valor atual, "cancelar" sai'), wizard.prompt()].join('\n')
    },
    config: async ({ args, rest }) => {
      const io = cfg()
      const config = io.read()
      const all = flattenConfig(config)
      const target = args[0] || ''
      if (!target) {
        const rows = ESSENTIAL.map(path => [path, getValue(config, path)]).filter(([, v]) => v !== undefined)
        const sections = [...new Set(all.map(([path]) => path.split('.')[0]))]
        return [formatConsoleTable('Configuração (essenciais)', rows), '', formatConsoleLine('dim', `seções: ${sections.join(', ')} — "config <seção>" mostra tudo; "config <seção.chave> <valor>" altera`)].join('\n')
      }
      if (!target.includes('.')) {
        const rows = all.filter(([path]) => path.startsWith(`${norm(target)}.`) || path.startsWith(`${target}.`)).map(([path, value]) => [path, maskValue(path, value)])
        return rows.length ? formatConsoleTable(`Configuração: ${target}`, rows) : err(`seção "${target}" não existe`)
      }
      if (args.length === 1) {
        const value = getValue(config, target)
        return value === undefined ? err(`"${target}" não existe — digite "config"`) : formatConsoleTable('Configuração', [[target, value]])
      }
      const value = rest.slice(target.length).trim()
      const result = setValue(io, target, value)
      return result.ok ? ok(result.message) : err(result.message)
    },
    dono: async ({ args }) => {
      const io = cfg()
      const action = norm(args[0])
      if (!action || action === 'listar' || action === 'lista') {
        const rows = listOwners(io).map(o => [o.number, `${o.name} (${o.role}${o.enabled ? '' : ', desativado'})`])
        return rows.length ? formatConsoleTable('Donos', rows) : info('nenhum dono configurado — use "assistente" ou "dono add <número> [nome]"')
      }
      if (['add', 'adicionar'].includes(action)) { const r = addOwner(io, args[1], args.slice(2).join(' ')); return r.ok ? ok(r.message) : err(r.message) }
      if (['remover', 'remove', 'rm', 'del'].includes(action)) { const r = removeOwner(io, args[1]); return r.ok ? ok(r.message) : err(r.message) }
      return err('uso: dono [listar | add <número> [nome] | remover <número>]')
    },
    prefixo: async ({ args }) => {
      if (!args[0]) return info(`prefixo atual: ${cfg().read().bot.prefix} — uso: prefixo <x>`)
      const r = setValue(cfg(), 'bot.prefix', args[0]); return r.ok ? ok(r.message) : err(r.message)
    },
    nome: async ({ rest }) => {
      if (!rest) return info(`nome atual: ${cfg().read().bot.name} — uso: nome <texto>`)
      const r = setValue(cfg(), 'bot.name', rest); return r.ok ? ok(r.message) : err(r.message)
    },
    status: async () => {
      const st = api.getStatus?.() || {}
      const mem = process.memoryUsage()
      return formatConsoleTable('Status', [
        ['conexão', st.connected ? 'online' : 'offline'],
        ['número', st.number || '-'],
        ['release', st.release || '-'],
        ['uptime', uptime(process.uptime())],
        ['memória', `${Math.round(mem.rss / 1048576)} MB`],
        ['log (terminal)', getConsoleLevel(api.defaultLogLevel)]
      ])
    },
    grupos: async () => {
      const list = await loadGroups()
      if (!list.length) return info('nenhum grupo encontrado')
      const width = String(list.length).length
      return [formatConsoleLine('info', `${list.length} grupo(s)`), ...list.map((g, i) => `  ${String(i + 1).padStart(width)}  ${g.name} (${g.size})`)].join('\n')
    },
    enviar: async ({ args, rest }) => {
      if (args.length < 2) return err('uso: enviar <número com DDI | n do .grupos> <texto>')
      const sock = needSocket()
      if (!groupsCache.length && /^\d{1,3}$/.test(args[0])) await loadGroups()
      const jid = toJid(args[0], groupsCache)
      if (!jid) return err('destino inválido (use número com DDI, JID ou o número da lista de grupos)')
      const text = rest.slice(args[0].length).trim()
      await sock.sendMessage(jid, { text })
      return ok(`enviado para ${jid.replace(/@.*/, '')}`)
    },
    log: async ({ args }) => {
      const level = norm(args[0])
      if (!level) return info(`nível atual: ${getConsoleLevel(api.defaultLogLevel)} (opções: ${LOG_LEVELS.join(', ')}, padrao)`)
      if (['padrao', 'default', 'reset'].includes(level)) { setConsoleLevel(null); return ok(`nível restaurado (${api.defaultLogLevel || 'warn'})`) }
      if (!LOG_LEVELS.includes(level)) return err(`nível inválido; use: ${LOG_LEVELS.join(', ')}`)
      setConsoleLevel(level)
      return ok(`nível do terminal: ${level}`)
    },
    auto: async ({ args }) => {
      const keys = { audio: 'autoReplyAudio', fig: 'autoReplySticker', figurinha: 'autoReplySticker', sticker: 'autoReplySticker' }
      const key = keys[norm(args[0])]
      const value = { on: true, off: false, ligar: true, desligar: false }[norm(args[1])]
      if (!key || value === undefined) {
        const cur = api.getRuntime?.() || {}
        return info(`auto audio: ${cur.autoReplyAudio ? 'on' : 'off'} · auto fig: ${cur.autoReplySticker ? 'on' : 'off'} — uso: auto <audio|fig> <on|off>`)
      }
      await api.setRuntime({ [key]: value })
      return ok(`${norm(args[0])} automático: ${value ? 'on' : 'off'}`)
    },
    backup: async () => { await api.backup(); return ok('snapshot salvo em backup/') },
    reconectar: async () => { await api.reconnect(); return ok('reconexão solicitada') },
    sair: async () => { await api.shutdown('terminal'); return '' }
  }
  const aliases = { setup: 'assistente', configurar: 'assistente', cfg: 'config', opcoes: 'config', owner: 'dono', donos: 'dono', prefix: 'prefixo', name: 'nome', help: 'ajuda', '?': 'ajuda', h: 'ajuda', s: 'status', g: 'grupos', send: 'enviar', say: 'enviar', exit: 'sair', quit: 'sair', q: 'sair', reconnect: 'reconectar', reiniciar: 'reconectar', logs: 'log', nivel: 'log' }

  const run = async function run(line) {
    if (wizard) {
      const step = wizard.answer(line)
      if (step.done) wizard = null
      if (step.error) return `${err(step.error)}\n${info(step.message)}`
      return step.done ? (step.cancelled ? info(step.message) : ok(step.message)) : info(step.message)
    }
    const parsed = parseConsoleLine(line)
    if (!parsed) return ''
    if (parsed.name === 'limpar' || parsed.name === 'clear' || parsed.name === 'cls') return '\x1bc'
    const handler = table[aliases[parsed.name] || parsed.name]
    if (!handler) return err(`comando "${parsed.name}" não existe — digite "ajuda"`)
    try { return await handler(parsed) } catch (error) { return err(error?.message || String(error)) }
  }
  run.inWizard = () => Boolean(wizard)
  run.complete = line => completeLine(line, api)
  return run
}

// Tab: completa comandos, subcomandos e caminhos de configuração.
export function completeLine(line = '', api = {}) {
  const parts = String(line).replace(/^[./]/, '').split(/\s+/)
  const current = parts[parts.length - 1] || ''
  let options = []
  if (parts.length <= 1) options = CONSOLE_COMMANDS
  else {
    const cmd = norm(parts[0])
    if (cmd === 'config' && parts.length === 2) {
      try { options = flattenConfig(api.config.read()).map(([path]) => path).concat(['bot', 'ai', 'tts', 'ui', 'vip', 'runtime', 'panel']) } catch { options = [] }
    } else if (cmd === 'dono' && parts.length === 2) options = ['listar', 'add', 'remover']
    else if (cmd === 'auto' && parts.length === 2) options = ['audio', 'fig']
    else if (cmd === 'auto' && parts.length === 3) options = ['on', 'off']
    else if (cmd === 'log' && parts.length === 2) options = [...LOG_LEVELS, 'padrao']
  }
  const hits = options.filter(option => option.startsWith(current))
  return [hits.length ? hits : [], current]
}

export function startTerminalConsole(api, { input = process.stdin, output = process.stdout } = {}) {
  if (!input?.isTTY || process.env.SAKURA_NO_CONSOLE === '1') return null
  const color = colorEnabled(output)
  const run = createConsoleCommands(api)
  const rl = readline.createInterface({ input, output, prompt: consolePrompt(color), historySize: 100, completer: line => run.complete(line) })
  let busy = false
  const redraw = () => { if (!busy) rl.prompt(true) }
  setConsoleHooks({
    before: () => { if (output.isTTY) { readline.cursorTo(output, 0); readline.clearLine(output, 0) } },
    after: redraw
  })
  rl.on('line', async line => {
    busy = true
    const result = await run(line)
    busy = false
    if (result) output.write(`${result}\n`)
    rl.setPrompt(run.inWizard() ? consolePrompt(color).replace('sakura', 'config') : consolePrompt(color))
    rl.prompt()
  })
  rl.on('SIGINT', () => { void api.shutdown('SIGINT') })
  rl.on('close', () => setConsoleHooks({}))
  output.write(`${formatConsoleLine('dim', 'terminal ativo — digite "ajuda"', color)}\n`)
  rl.prompt()
  return { close: () => rl.close(), rl }
}
