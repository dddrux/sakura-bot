import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { openDatabase } from './database.js'
import { settings } from './settings.js'

const SCHEMA_VERSION = 2
const REQUEST_TTL_MS = 15 * 60_000
const store = openDatabase(settings.socialDb, {
  version: SCHEMA_VERSION,
  requests: {},
  couples: {},
  familyLinks: {},
  history: [],
  actionMedia: {},
  actionStats: {}
})

export const SOCIAL_REQUEST_TYPES = Object.freeze(['dating', 'marriage', 'adoption'])

export const SOCIAL_ACTIONS = Object.freeze({
  beijar: { label: 'beijar', emoji: '🌸' },
  abracar: { label: 'abraçar', emoji: '🌸' },
  cafune: { label: 'fazer cafuné em', emoji: '💮' },
  acariciar: { label: 'acariciar', emoji: '🌸' },
  cumprimentar: { label: 'cumprimentar', emoji: '🌸' },
  darmao: { label: 'dar a mão para', emoji: '💮' },
  presentear: { label: 'dar um presente para', emoji: '🌸' }
})

const digits = value => String(value || '').split('@')[0].split(':')[0].replace(/\D/g, '')
const cleanChat = value => String(value || '').trim().slice(0, 180)
const cleanText = (value, max = 180) => String(value || '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max)
const requestId = () => `SOC-${randomUUID().replace(/-/g, '').slice(0, 10).toUpperCase()}`
const eventId = () => randomUUID()
const clone = value => structuredClone(value)

function ensure(db) {
  db.version = SCHEMA_VERSION
  db.requests ||= {}
  db.couples ||= {}
  db.familyLinks ||= {}
  db.history ||= []
  db.actionMedia ||= {}
  db.actionStats ||= {}
  return db
}

function history(db, eventType, actor, target = '', chat = '', details = {}) {
  ensure(db).history.unshift({
    id: eventId(),
    eventType: cleanText(eventType, 60),
    actor: digits(actor),
    target: digits(target),
    chat: cleanChat(chat),
    details: clone(details || {}),
    createdAt: Date.now()
  })
  if (db.history.length > 5000) db.history.length = 5000
}

function expireRequests(db, at = Date.now()) {
  let changes = 0
  for (const row of Object.values(ensure(db).requests)) {
    if (row.status === 'pending' && Number(row.expiresAt || 0) <= at) {
      row.status = 'expired'
      row.resolvedAt = at
      row.resolvedBy = ''
      changes++
    }
  }
  return changes
}

function activeCouple(db, number) {
  const key = digits(number)
  if (!key) return null
  return Object.values(ensure(db).couples)
    .filter(row => row.active !== false && (row.userA === key || row.userB === key))
    .sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0))[0] || null
}

function coupleBetween(db, first, second) {
  const a = digits(first)
  const b = digits(second)
  if (!a || !b) return null
  return Object.values(ensure(db).couples).find(row => row.active !== false && ((row.userA === a && row.userB === b) || (row.userA === b && row.userB === a))) || null
}

function activeFamilyLink(db, parent, child) {
  const p = digits(parent)
  const c = digits(child)
  return Object.values(ensure(db).familyLinks).find(row => row.active !== false && row.parent === p && row.child === c) || null
}

function createsFamilyCycle(db, parent, child) {
  const target = digits(parent)
  const start = digits(child)
  if (!target || !start) return false
  const links = Object.values(ensure(db).familyLinks).filter(row => row.active !== false)
  const queue = [start]
  const seen = new Set()
  while (queue.length) {
    const current = queue.shift()
    if (current === target) return true
    if (seen.has(current)) continue
    seen.add(current)
    for (const link of links) if (link.parent === current) queue.push(link.child)
  }
  return false
}

function normalizeRequest(row) {
  if (!row) return null
  return {
    id: row.id,
    type: row.type,
    chat: row.chat,
    requester: row.requester,
    target: row.target,
    status: row.status,
    createdAt: Number(row.createdAt || 0),
    expiresAt: Number(row.expiresAt || 0),
    resolvedAt: Number(row.resolvedAt || 0),
    resolvedBy: row.resolvedBy || ''
  }
}

function assertPeople(from, to) {
  const requester = digits(from)
  const target = digits(to)
  if (requester.length < 8 || target.length < 8) throw new TypeError('Participante inválido.')
  if (requester === target) throw new TypeError('Você não pode criar esse vínculo consigo mesmo.')
  return { requester, target }
}

export function createSocialRequest({ type, chat, requester: rawRequester, target: rawTarget, ttlMs = REQUEST_TTL_MS } = {}) {
  if (!SOCIAL_REQUEST_TYPES.includes(type)) throw new TypeError('Tipo de solicitação social inválido.')
  const { requester, target } = assertPeople(rawRequester, rawTarget)
  const group = cleanChat(chat)
  if (!group.endsWith('@g.us')) throw new TypeError('A solicitação precisa ser criada em um grupo.')
  const safeTtl = Math.max(60_000, Math.min(60 * 60_000, Math.floor(Number(ttlMs) || REQUEST_TTL_MS)))
  return store.updateSync(db => {
    ensure(db)
    const now = Date.now()
    expireRequests(db, now)
    if (type === 'dating') {
      if (activeCouple(db, requester)) throw new TypeError('Você já possui um relacionamento ativo.')
      if (activeCouple(db, target)) throw new TypeError('Essa pessoa já possui um relacionamento ativo.')
    }
    if (type === 'marriage') {
      const couple = coupleBetween(db, requester, target)
      if (!couple || couple.status !== 'dating') throw new TypeError('O pedido de casamento só pode ser feito ao namoro atual.')
    }
    if (type === 'adoption') {
      if (activeFamilyLink(db, requester, target)) throw new TypeError('Esse vínculo familiar já existe.')
      if (createsFamilyCycle(db, requester, target)) throw new TypeError('Essa adoção criaria um ciclo familiar inválido.')
      if (coupleBetween(db, requester, target)) throw new TypeError('Não é possível adotar a pessoa do relacionamento atual.')
    }
    const duplicate = Object.values(db.requests).find(row => row.type === type && row.status === 'pending' && ((row.requester === requester && row.target === target) || (row.requester === target && row.target === requester)))
    if (duplicate) throw new TypeError(`Já existe uma solicitação pendente (${duplicate.id}).`)
    const row = { id: requestId(), type, chat: group, requester, target, status: 'pending', createdAt: now, expiresAt: now + safeTtl, resolvedAt: 0, resolvedBy: '' }
    db.requests[row.id] = row
    history(db, `${type}.request`, requester, target, group, { requestId: row.id, expiresAt: row.expiresAt })
    return clone(row)
  })
}

export function findPendingRequest({ id = '', type = '', target = '', requester = '', chat = '' } = {}) {
  let result = null
  store.updateSync(db => {
    ensure(db)
    expireRequests(db)
    const safeId = cleanText(id, 40).toUpperCase()
    const rows = Object.values(db.requests).filter(row => row.status === 'pending' && (!safeId || row.id === safeId) && (!type || row.type === type) && (!target || row.target === digits(target)) && (!requester || row.requester === digits(requester)) && (!chat || row.chat === cleanChat(chat)))
      .sort((a, b) => Number(b.createdAt) - Number(a.createdAt))
    result = normalizeRequest(rows[0])
  })
  return result
}

export function resolveSocialRequest({ id = '', type = '', actor: rawActor, chat = '', decision = 'accepted' } = {}) {
  if (!['accepted', 'rejected'].includes(decision)) throw new TypeError('Decisão inválida.')
  const actor = digits(rawActor)
  const group = cleanChat(chat)
  return store.updateSync(db => {
    ensure(db)
    const now = Date.now()
    expireRequests(db, now)
    const safeId = cleanText(id, 40).toUpperCase()
    const row = Object.values(db.requests).filter(item => item.status === 'pending' && (safeId ? item.id === safeId : item.target === actor && (!type || item.type === type) && (!group || item.chat === group)))
      .sort((a, b) => Number(b.createdAt) - Number(a.createdAt))[0]
    const request = normalizeRequest(row)
    if (!request) return { ok: false, reason: 'not-found' }
    if (request.target !== actor) return { ok: false, reason: 'target' }
    if (group && request.chat !== group) return { ok: false, reason: 'chat' }
    if (decision === 'rejected') {
      Object.assign(row, { status: 'rejected', resolvedAt: now, resolvedBy: actor })
      history(db, `${request.type}.reject`, actor, request.requester, request.chat, { requestId: request.id })
      return { ok: true, decision, request: normalizeRequest(row) }
    }
    let result = null
    if (request.type === 'dating') {
      if (activeCouple(db, request.requester) || activeCouple(db, request.target)) return { ok: false, reason: 'relationship' }
      const idCouple = randomUUID()
      const couple = { id: idCouple, userA: request.requester, userB: request.target, status: 'dating', chat: request.chat, datingSince: now, marriedSince: 0, active: true, endedAt: 0, endedBy: '', endReason: '', updatedAt: now }
      db.couples[idCouple] = couple
      result = clone(couple)
    } else if (request.type === 'marriage') {
      const couple = coupleBetween(db, request.requester, request.target)
      if (!couple || couple.status !== 'dating') return { ok: false, reason: 'relationship' }
      Object.assign(couple, { status: 'married', marriedSince: now, updatedAt: now })
      result = clone(couple)
    } else if (request.type === 'adoption') {
      if (activeFamilyLink(db, request.requester, request.target)) return { ok: false, reason: 'duplicate' }
      if (createsFamilyCycle(db, request.requester, request.target)) return { ok: false, reason: 'cycle' }
      const idLink = randomUUID()
      const link = { id: idLink, parent: request.requester, child: request.target, chat: request.chat, active: true, createdAt: now, endedAt: 0, endedBy: '' }
      db.familyLinks[idLink] = link
      result = clone(link)
    }
    Object.assign(row, { status: 'accepted', resolvedAt: now, resolvedBy: actor })
    history(db, `${request.type}.accept`, actor, request.requester, request.chat, { requestId: request.id })
    return { ok: true, decision, request: normalizeRequest(row), result }
  })
}

export function cancelSocialRequest({ id = '', actor: rawActor, chat = '' } = {}) {
  const actor = digits(rawActor)
  return store.updateSync(db => {
    ensure(db)
    expireRequests(db)
    const safeId = cleanText(id, 40).toUpperCase()
    const group = cleanChat(chat)
    const row = Object.values(db.requests).filter(item => item.status === 'pending' && (safeId ? item.id === safeId : item.requester === actor && (!group || item.chat === group)))
      .sort((a, b) => Number(b.createdAt) - Number(a.createdAt))[0]
    const request = normalizeRequest(row)
    if (!request) return { ok: false, reason: 'not-found' }
    if (request.requester !== actor) return { ok: false, reason: 'requester' }
    const at = Date.now()
    Object.assign(row, { status: 'cancelled', resolvedAt: at, resolvedBy: actor })
    history(db, `${request.type}.cancel`, actor, request.target, request.chat, { requestId: request.id })
    return { ok: true, request: normalizeRequest(row) }
  })
}

export function getRelationship(number) {
  const row = activeCouple(store.readSync(), number)
  if (!row) return null
  const copy = clone(row)
  return { ...copy, partner: copy.userA === digits(number) ? copy.userB : copy.userA }
}

export function endRelationship({ actor: rawActor, expectedStatus = '', chat = '', reason = '' } = {}) {
  const actor = digits(rawActor)
  return store.updateSync(db => {
    ensure(db)
    const row = activeCouple(db, actor)
    if (!row) return { ok: false, reason: 'not-found' }
    if (expectedStatus && row.status !== expectedStatus) return { ok: false, reason: 'status', relationship: clone(row) }
    const at = Date.now()
    const partner = row.userA === actor ? row.userB : row.userA
    Object.assign(row, { active: false, endedAt: at, endedBy: actor, endReason: cleanText(reason || (row.status === 'married' ? 'divorce' : 'breakup'), 60), updatedAt: at })
    for (const request of Object.values(db.requests)) {
      if (request.status === 'pending' && request.type === 'marriage' && ((request.requester === actor && request.target === partner) || (request.requester === partner && request.target === actor))) {
        Object.assign(request, { status: 'cancelled', resolvedAt: at, resolvedBy: actor })
      }
    }
    history(db, row.status === 'married' ? 'marriage.divorce' : 'dating.end', actor, partner, cleanChat(chat || row.chat), { relationshipId: row.id })
    return { ok: true, relationship: { ...clone(row), partner } }
  })
}

export function getFamily(number) {
  const key = digits(number)
  const db = ensure(store.readSync())
  const parents = Object.values(db.familyLinks).filter(row => row.active !== false && row.child === key).sort((a, b) => Number(a.createdAt) - Number(b.createdAt)).map(clone)
  const children = Object.values(db.familyLinks).filter(row => row.active !== false && row.parent === key).sort((a, b) => Number(a.createdAt) - Number(b.createdAt)).map(clone)
  return { number: key, parents, children }
}

export function removeFamilyLink({ actor: rawActor, target: rawTarget = '', chat = '' } = {}) {
  const actor = digits(rawActor)
  const target = digits(rawTarget)
  return store.updateSync(db => {
    ensure(db)
    const rows = Object.values(db.familyLinks).filter(row => row.active !== false && (target
      ? ((row.parent === actor && row.child === target) || (row.parent === target && row.child === actor))
      : (row.parent === actor || row.child === actor)))
      .sort((a, b) => Number(b.createdAt) - Number(a.createdAt))
    if (!rows.length) return { ok: false, reason: 'not-found' }
    if (!target && rows.length > 1) return { ok: false, reason: 'ambiguous', links: rows.map(clone) }
    const link = rows[0]
    const at = Date.now()
    Object.assign(link, { active: false, endedAt: at, endedBy: actor })
    history(db, 'family.remove', actor, link.parent === actor ? link.child : link.parent, cleanChat(chat || link.chat), { linkId: link.id })
    return { ok: true, link: clone(link) }
  })
}

export function listSocialHistory(number, limit = 15) {
  const key = digits(number)
  const safeLimit = Math.max(1, Math.min(50, Math.floor(Number(limit) || 15)))
  return (ensure(store.readSync()).history || []).filter(row => row.actor === key || row.target === key).sort((a, b) => Number(b.createdAt) - Number(a.createdAt)).slice(0, safeLimit).map(clone)
}

export function recordSocialAction({ chat, action, actor: rawActor, target: rawTarget } = {}) {
  if (!SOCIAL_ACTIONS[action]) throw new TypeError('Ação social inválida.')
  const { requester: actor, target } = assertPeople(rawActor, rawTarget)
  const group = cleanChat(chat)
  const at = Date.now()
  return store.updateSync(db => {
    ensure(db)
    const key = `${group}|${action}|${actor}|${target}`
    const row = db.actionStats[key] || { chat: group, action, actor, target, count: 0, lastAt: 0 }
    row.count = Number(row.count || 0) + 1
    row.lastAt = at
    db.actionStats[key] = row
    history(db, `action.${action}`, actor, target, group)
    return { chat: group, action, actor, target, at }
  })
}

export function setActionMedia({ action, kind, filename, mimeType = '', sizeBytes = 0, actor = '' } = {}) {
  if (!SOCIAL_ACTIONS[action]) throw new TypeError('Ação social inválida.')
  if (!['image', 'video'].includes(kind)) throw new TypeError('Tipo de mídia inválido.')
  const safeFile = path.basename(String(filename || ''))
  if (!safeFile || safeFile !== String(filename || '')) throw new TypeError('Nome de arquivo inválido.')
  const row = { action, kind, filename: safeFile, mimeType: cleanText(mimeType, 80), sizeBytes: Math.max(0, Math.floor(Number(sizeBytes) || 0)), updatedBy: digits(actor), updatedAt: Date.now() }
  store.updateSync(db => { ensure(db).actionMedia[action] = row })
  return clone(row)
}

export function getActionMedia(action) {
  if (!SOCIAL_ACTIONS[action]) return null
  const row = ensure(store.readSync()).actionMedia[action]
  return row ? clone(row) : null
}

export function listActionMedia() {
  return Object.values(ensure(store.readSync()).actionMedia).sort((a, b) => a.action.localeCompare(b.action)).map(clone)
}

export function removeActionMedia(action) {
  let old = null
  store.updateSync(db => {
    ensure(db)
    if (db.actionMedia[action]) { old = clone(db.actionMedia[action]); delete db.actionMedia[action] }
  })
  return old
}

export function coupleRanking(limit = 10) {
  const safe = Math.max(1, Math.min(50, Math.floor(Number(limit) || 10)))
  return Object.values(ensure(store.readSync()).couples).filter(row => row.active !== false).sort((a, b) => Number(a.marriedSince || a.datingSince) - Number(b.marriedSince || b.datingSince)).slice(0, safe).map(({ userA, userB, status, datingSince, marriedSince, chat }) => ({ userA, userB, status, datingSince, marriedSince, chat }))
}

export function familyRanking(limit = 10) {
  const safe = Math.max(1, Math.min(50, Math.floor(Number(limit) || 10)))
  const counts = new Map()
  for (const row of Object.values(ensure(store.readSync()).familyLinks).filter(row => row.active !== false)) {
    counts.set(row.parent, (counts.get(row.parent) || 0) + 1)
    counts.set(row.child, (counts.get(row.child) || 0) + 1)
  }
  return [...counts.entries()].map(([number, links]) => ({ number, links })).sort((a, b) => b.links - a.links || a.number.localeCompare(b.number)).slice(0, safe)
}

export function actionRanking(chat = '', limit = 10) {
  const safe = Math.max(1, Math.min(50, Math.floor(Number(limit) || 10)))
  const group = cleanChat(chat)
  const counts = new Map()
  for (const row of Object.values(ensure(store.readSync()).actionStats)) {
    if (group && row.chat !== group) continue
    counts.set(row.actor, (counts.get(row.actor) || 0) + Number(row.count || 0))
  }
  return [...counts.entries()].map(([number, actions]) => ({ number, actions })).sort((a, b) => b.actions - a.actions || a.number.localeCompare(b.number)).slice(0, safe)
}

export function getSocialStatus() {
  const db = ensure(store.readSync())
  const now = Date.now()
  return {
    schemaVersion: Number(db.version || SCHEMA_VERSION),
    couples: Object.values(db.couples).filter(row => row.active !== false).length,
    familyLinks: Object.values(db.familyLinks).filter(row => row.active !== false).length,
    pending: Object.values(db.requests).filter(row => row.status === 'pending' && Number(row.expiresAt || 0) > now).length,
    actionMedia: Object.keys(db.actionMedia).length
  }
}

export function closeSocialStore() {}
