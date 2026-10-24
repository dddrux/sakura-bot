import { openDatabase } from './database.js'
import { settings } from './settings.js'

const store = openDatabase('reception', { version: 2, groups: {}, profiles: {}, admissions: {} })
const digits = value => String(value || '').replace(/\D/g, '')
const clean = (value, max = 80) => String(value || '').replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max)

const FIELD_ALIASES = Object.freeze({
  nome: 'nome', name: 'nome',
  idade: 'idade', age: 'idade',
  cidade: 'cidade', city: 'cidade'
})

const FIELD_LABELS = Object.freeze({
  nome: 'Seu nome',
  idade: 'Sua idade',
  cidade: 'Sua cidade'
})

function normalizedField(value = '') {
  const key = String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
  return FIELD_ALIASES[key] || key
}

function admissionId(chat, number) {
  return `${String(chat || '')}:${digits(number)}`
}

function profileValue(profile = {}, field = '') {
  const key = normalizedField(field)
  if (key === 'nome') return clean(profile.nome || profile.name, 70)
  if (key === 'idade') return clean(profile.idade || profile.age, 20)
  if (key === 'cidade') return clean(profile.cidade || profile.city, 70)
  return clean(profile.extras?.[key], 120)
}

export function defaultReceptionConfig(chat = '') {
  const base = settings.receptionConfig || {}
  return {
    chat: String(chat || ''),
    enabled: Boolean(base.enabledByDefault),
    fields: Array.isArray(base.fields) && base.fields.length ? base.fields.map(normalizedField) : ['nome', 'idade', 'cidade'],
    requireName: base.requireName !== false,
    autoMention: base.autoMention !== false,
    title: clean(base.title || 'RECEPÇÃO SAKURA', 60),
    template: String(base.template || '🌸 Bem-vindo(a), {mention}!\n🌸 Preencha sua ficha:\n💮 Nome: {nome}\n🌸 Idade: {idade}\n🌸 Cidade: {cidade}')
  }
}

export async function getReceptionConfig(chat) {
  const db = await store.read()
  return { ...defaultReceptionConfig(chat), ...(db.groups?.[chat] || {}), chat }
}

export async function setReceptionConfig(chat, patch = {}) {
  if (!chat) throw new TypeError('Grupo inválido.')
  return store.update(db => {
    db.groups ||= {}
    const current = { ...defaultReceptionConfig(chat), ...(db.groups[chat] || {}) }
    const next = {
      ...current,
      ...patch,
      chat,
      fields: Array.isArray(patch.fields) ? patch.fields.map(normalizedField).filter(Boolean).slice(0, 8) : current.fields,
      title: patch.title == null ? current.title : clean(patch.title, 60),
      template: patch.template == null ? current.template : String(patch.template).slice(0, 1200)
    }
    db.groups[chat] = next
    return structuredClone(next)
  })
}

export function buildReceptionModel(config = defaultReceptionConfig(''), prefix = '.') {
  const fields = Array.isArray(config?.fields) && config.fields.length ? config.fields.map(normalizedField) : ['nome', 'idade', 'cidade']
  const placeholders = fields.map(field => FIELD_LABELS[field] || `Seu ${field}`)
  return `${String(prefix || '.')}ficha ${placeholders.join(' | ')}`
}

export function parseReceptionProfileInput(raw = '', config = defaultReceptionConfig('')) {
  const fields = Array.isArray(config?.fields) && config.fields.length ? config.fields.map(normalizedField) : ['nome', 'idade', 'cidade']
  const values = String(raw || '').split('|').map(value => clean(value, 120))
  const profile = { nome: '', idade: '', cidade: '', extras: {} }
  fields.forEach((field, index) => {
    const value = values[index] || ''
    if (field === 'nome' || field === 'idade' || field === 'cidade') profile[field] = value
    else profile.extras[field] = value
  })
  return profile
}

export function validateReceptionProfile(profile = {}, config = defaultReceptionConfig('')) {
  const fields = Array.isArray(config?.fields) && config.fields.length ? config.fields.map(normalizedField) : ['nome', 'idade', 'cidade']
  const missing = []
  const invalid = []

  for (const field of fields) {
    const value = profileValue(profile, field)
    if (!value) {
      missing.push(field)
      continue
    }
    if (field === 'nome' && value.length < 2) invalid.push(field)
    if (field === 'cidade' && value.length < 2) invalid.push(field)
    if (field === 'idade') {
      const age = Number(value)
      if (!/^\d{1,3}$/.test(value) || !Number.isInteger(age) || age < 1 || age > 120) invalid.push(field)
    }
  }

  if (config?.requireName !== false && !profileValue(profile, 'nome') && !missing.includes('nome')) missing.push('nome')
  return { valid: missing.length === 0 && invalid.length === 0, missing, invalid }
}

export async function saveReceptionProfile(chat, number, profile = {}) {
  const key = digits(number)
  if (!chat || !key) throw new TypeError('Ficha inválida.')
  return store.update(db => {
    db.profiles ||= {}
    const id = `${chat}:${key}`
    const row = {
      chat,
      number: key,
      nome: clean(profile.nome || profile.name, 70),
      idade: clean(profile.idade || profile.age, 20),
      cidade: clean(profile.cidade || profile.city, 70),
      extras: profile.extras && typeof profile.extras === 'object'
        ? Object.fromEntries(Object.entries(profile.extras).map(([field, value]) => [normalizedField(field), clean(value, 120)]))
        : {},
      updatedAt: Date.now()
    }
    db.profiles[id] = row
    return structuredClone(row)
  })
}

export async function getReceptionProfile(chat, number) {
  const db = await store.read()
  return structuredClone(db.profiles?.[`${chat}:${digits(number)}`] || null)
}

export async function markReceptionPending(chat, number, details = {}) {
  const key = digits(number)
  if (!chat || !key) throw new TypeError('Membro inválido para recepção.')
  return store.update(db => {
    db.admissions ||= {}
    const id = admissionId(chat, key)
    const previous = db.admissions[id] || {}
    const row = {
      chat,
      number: key,
      status: 'pending',
      source: clean(details.source || previous.source || 'join', 30),
      joinedAt: Date.now(),
      approvedAt: 0,
      updatedAt: Date.now()
    }
    db.admissions[id] = row
    return structuredClone(row)
  })
}

export async function approveReceptionMember(chat, number) {
  const key = digits(number)
  if (!chat || !key) throw new TypeError('Membro inválido para recepção.')
  return store.update(db => {
    db.admissions ||= {}
    const id = admissionId(chat, key)
    const previous = db.admissions[id] || {}
    const row = {
      chat,
      number: key,
      ...previous,
      status: 'approved',
      approvedAt: Date.now(),
      updatedAt: Date.now()
    }
    db.admissions[id] = row
    return structuredClone(row)
  })
}

export async function getReceptionGate(chat, number) {
  const key = digits(number)
  if (!String(chat || '').endsWith('@g.us') || !key) return { enabled: false, pending: false, approved: true, admission: null, config: defaultReceptionConfig(chat) }
  const db = await store.read()
  const config = { ...defaultReceptionConfig(chat), ...(db.groups?.[chat] || {}), chat }
  const admission = db.admissions?.[admissionId(chat, key)] || null
  if (!config.enabled) return { enabled: false, pending: false, approved: true, admission: structuredClone(admission), config }
  if (!admission) return { enabled: true, pending: false, approved: true, admission: null, config }
  const pending = admission.status === 'pending'
  return { enabled: true, pending, approved: !pending, admission: structuredClone(admission), config }
}

export function formatReceptionCard(profile = {}, config = defaultReceptionConfig('')) {
  const name = clean(profile.nome || profile.name || 'Não informado', 70)
  const age = clean(profile.idade || profile.age || 'Não informado', 20)
  const city = clean(profile.cidade || profile.city || 'Não informado', 70)
  const number = digits(profile.number)
  const mention = number ? `@${number}` : name
  const values = { mention, nome: name, name, idade: age, age, cidade: city, city }
  let body = String(config.template || defaultReceptionConfig('').template)
  for (const [key, value] of Object.entries(values)) body = body.replaceAll(`{${key}}`, value)
  return `🌸 *${config.title || 'RECEPÇÃO SAKURA'}*\n\n${body}\n\n💮 Sakura-MD`
}

export async function buildWelcomeReception(chat, number, fallbackName = '') {
  const config = await getReceptionConfig(chat)
  if (!config.enabled) return null
  const profile = await getReceptionProfile(chat, number)
  return {
    config,
    profile,
    model: buildReceptionModel(config, settings.prefix),
    text: formatReceptionCard({ number, nome: profile?.nome || fallbackName, idade: profile?.idade, cidade: profile?.cidade }, config)
  }
}
