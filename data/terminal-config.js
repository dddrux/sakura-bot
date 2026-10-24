// Configuração pelo terminal: ler/alterar valores, donos e assistente passo a passo.
// Puro: leitura/escrita entram por `io` ({ read, write, applyLive }) para poder testar sem tocar em arquivos.

const SECRET = /(key|token|secret|pass|senha|pix|cookie)/i
const SECTIONS = ['bot', 'ai', 'tts', 'ui', 'vip', 'runtime', 'panel', 'reception', 'games', 'autoDownload', 'donation']
const READ_ONLY = new Set(['bot.release', 'bot.releaseChannel', 'bot.codename', 'bot.baseName'])
const digits = value => String(value ?? '').replace(/\D/g, '')

const BOOL_TRUE = ['on', 'true', 'sim', 's', 'ligar', 'ligado', '1', 'yes']
const BOOL_FALSE = ['off', 'false', 'nao', 'não', 'n', 'desligar', 'desligado', '0', 'no']

export const isSecretPath = path => SECRET.test(path)
export const maskValue = (path, value) => (isSecretPath(path) && String(value ?? '') !== '' ? '••••••' : value)

// Lista [caminho, valor] de todos os valores simples editáveis (seção.chave).
export function flattenConfig(config = {}) {
  const rows = []
  for (const section of SECTIONS) {
    const block = config[section]
    if (!block || typeof block !== 'object' || Array.isArray(block)) continue
    for (const [key, value] of Object.entries(block)) {
      if (value !== null && typeof value === 'object') continue
      const path = `${section}.${key}`
      if (!READ_ONLY.has(path)) rows.push([path, value])
    }
  }
  return rows
}

export function getValue(config, path) {
  const [section, key] = String(path || '').split('.')
  const value = config?.[section]?.[key]
  return value === undefined ? undefined : maskValue(path, value)
}

export function coerceValue(raw, current) {
  const text = String(raw ?? '').trim()
  if (typeof current === 'boolean') {
    const low = text.toLowerCase()
    if (BOOL_TRUE.includes(low)) return { ok: true, value: true }
    if (BOOL_FALSE.includes(low)) return { ok: true, value: false }
    return { ok: false, error: 'use on/off (ou sim/não)' }
  }
  if (typeof current === 'number') {
    const num = Number(text.replace(',', '.'))
    return Number.isFinite(num) ? { ok: true, value: num } : { ok: false, error: 'precisa ser um número' }
  }
  return { ok: true, value: text }
}

function validate(path, value) {
  if (path === 'bot.prefix' && (!value || value.length > 4 || /\s/.test(value))) return 'prefixo: 1 a 4 caracteres, sem espaço'
  if (path === 'bot.number' && value && digits(value).length < 10) return 'número inválido (use DDI+DDD+número)'
  if (path === 'bot.name' && (!value || value.length > 80)) return 'nome: 1 a 80 caracteres'
  if (/(^|\.)port$/.test(path) && !(value >= 1 && value <= 65535)) return 'porta inválida (1-65535)'
  return ''
}

// Altera um valor simples. Retorna { ok, message, restart }.
export function setValue(io, path, raw) {
  const clean = String(path || '').trim()
  const [section, key, extra] = clean.split('.')
  if (!section || !key || extra !== undefined) return { ok: false, message: 'use seção.chave (ex.: ui.footer)' }
  if (READ_ONLY.has(clean)) return { ok: false, message: `${clean} é somente leitura` }
  const config = io.read()
  if (!SECTIONS.includes(section) || !config[section] || !(key in config[section])) return { ok: false, message: `"${clean}" não existe — digite "config" para ver as opções` }
  const current = config[section][key]
  if (current !== null && typeof current === 'object') return { ok: false, message: `${clean} é uma lista/objeto; edite pelo painel ou pelo arquivo` }
  const coerced = coerceValue(raw, current)
  if (!coerced.ok) return { ok: false, message: `${clean}: ${coerced.error}` }
  let value = coerced.value
  if (clean === 'bot.number') value = digits(value)
  const problem = validate(clean, value)
  if (problem) return { ok: false, message: problem }
  io.write({ [section]: { [key]: value } })
  const live = Boolean(io.applyLive?.(clean, value))
  return { ok: true, live, restart: !live, message: `${clean} = ${isSecretPath(clean) ? '••••••' : value}${live ? '' : ' (reinicie a Sakura para valer)'}` }
}

// ---- donos
export function listOwners(io) {
  return io.read().owners.map(o => ({ name: o.name || 'Dono', number: o.number, role: o.role || 'owner', enabled: o.enabled !== false }))
}

export function addOwner(io, numberRaw, name = '') {
  const number = digits(numberRaw)
  if (number.length < 10) return { ok: false, message: 'número inválido (DDI+DDD+número)' }
  const owners = io.read().owners.map(o => ({ ...o }))
  if (owners.some(o => o.number === number)) return { ok: false, message: 'esse número já é dono' }
  owners.push({ name: String(name || 'Dono').trim().slice(0, 40) || 'Dono', number, role: owners.length ? 'subowner' : 'owner', enabled: true })
  io.write({ owners })
  io.applyLive?.('owners', owners)
  return { ok: true, message: `dono adicionado: ${number}` }
}

export function removeOwner(io, numberRaw) {
  const number = digits(numberRaw)
  const owners = io.read().owners.map(o => ({ ...o }))
  const target = owners.find(o => o.number === number)
  if (!target) return { ok: false, message: 'esse número não está na lista de donos' }
  if (owners.filter(o => o.enabled !== false).length <= 1) return { ok: false, message: 'não dá para remover o único dono' }
  const next = owners.filter(o => o.number !== number)
  if (!next.some(o => o.role === 'owner')) next[0].role = 'owner'
  io.write({ owners: next })
  io.applyLive?.('owners', next)
  return { ok: true, message: `dono removido: ${number}` }
}

// ---- assistente passo a passo (Enter mantém o valor atual)
export const WIZARD_STEPS = Object.freeze([
  { id: 'bot.name', label: 'Nome do bot', kind: 'text' },
  { id: 'bot.number', label: 'Número do bot (DDI+DDD+número, só dígitos)', kind: 'number' },
  { id: 'owner.name', label: 'Seu nome (dono)', kind: 'text' },
  { id: 'owner.number', label: 'Seu número (dono, DDI+DDD+número)', kind: 'number' },
  { id: 'bot.prefix', label: 'Prefixo dos comandos', kind: 'text' },
  { id: 'ai.enabled', label: 'IA ligada? (on/off)', kind: 'bool' },
  { id: 'panel.enabled', label: 'Painel web ligado? (on/off)', kind: 'bool' }
])

export function createWizard(io) {
  const config = io.read()
  const main = config.owners.find(o => o.role === 'owner') || config.owners[0] || null
  const current = {
    'bot.name': config.bot.name, 'bot.number': config.bot.number, 'owner.name': main?.name || '',
    'owner.number': main?.number || '', 'bot.prefix': config.bot.prefix,
    'ai.enabled': config.ai.enabled, 'panel.enabled': config.panel.enabled
  }
  const answers = {}
  let index = 0
  const show = v => (typeof v === 'boolean' ? (v ? 'on' : 'off') : v || 'vazio')
  const prompt = () => `(${index + 1}/${WIZARD_STEPS.length}) ${WIZARD_STEPS[index].label} [${show(current[WIZARD_STEPS[index].id])}]`

  function finish() {
    const messages = []
    for (const [id, value] of Object.entries(answers)) {
      if (id.startsWith('owner.')) continue
      const res = setValue(io, id, typeof value === 'boolean' ? (value ? 'on' : 'off') : value)
      if (!res.ok) messages.push(res.message)
    }
    if ('owner.name' in answers || 'owner.number' in answers) {
      const number = digits(answers['owner.number'] ?? current['owner.number'])
      const name = answers['owner.name'] ?? current['owner.name'] ?? 'Dono'
      if (number.length >= 10) {
        const owners = io.read().owners.map(o => ({ ...o }))
        const mainIndex = Math.max(0, owners.findIndex(o => o.role === 'owner'))
        if (owners.length) owners[mainIndex] = { ...owners[mainIndex], name, number }
        else owners.push({ name, number, role: 'owner', enabled: true })
        io.write({ owners })
        io.applyLive?.('owners', owners)
      } else messages.push('número do dono ignorado (inválido)')
    }
    return messages
  }

  return {
    prompt,
    answer(line) {
      const text = String(line ?? '').trim()
      if (/^(cancelar|cancel|sair)$/i.test(text)) return { done: true, cancelled: true, message: 'assistente cancelado — nada foi salvo' }
      const step = WIZARD_STEPS[index]
      if (text) {
        const coerced = step.kind === 'bool' ? coerceValue(text, true) : { ok: true, value: step.kind === 'number' ? digits(text) : text }
        if (!coerced.ok) return { done: false, error: coerced.error, message: prompt() }
        if (step.kind === 'number' && coerced.value.length < 10) return { done: false, error: 'número inválido', message: prompt() }
        if (step.id === 'bot.prefix' && (text.length > 4 || /\s/.test(text))) return { done: false, error: 'prefixo: 1 a 4 caracteres, sem espaço', message: prompt() }
        answers[step.id] = coerced.value
      }
      index += 1
      if (index < WIZARD_STEPS.length) return { done: false, message: prompt() }
      const problems = finish()
      return { done: true, problems, message: problems.length ? `salvo com avisos: ${problems.join('; ')}` : 'configuração salva (nome e número do bot podem exigir reiniciar a Sakura)' }
    }
  }
}
