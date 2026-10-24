import { randomUUID } from 'node:crypto'
import { openDatabase } from './database.js'
import { settings } from './settings.js'

const store = openDatabase(settings.groupScheduleDb, { version: 2, schedules: {} })
const validTime = value => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(value || ''))

export function addGroupSchedule({ chat, action, time, timezone = 'America/Recife', actor = '' }) {
  if (!String(chat).endsWith('@g.us')) throw new TypeError('Agendamento disponível apenas em grupos.')
  if (!['close', 'open'].includes(action)) throw new TypeError('Ação inválida.')
  if (!validTime(time)) throw new TypeError('Use horário no formato HH:MM.')
  new Intl.DateTimeFormat('pt-BR', { timeZone: timezone }).format(new Date())
  const row = {
    id: randomUUID(), chat, action, local_time: time, timezone, enabled: 1,
    last_local_date: '', created_by: String(actor), created_at: Date.now()
  }
  store.updateSync(db => {
    db.version = 2
    db.schedules ||= {}
    for (const [id, item] of Object.entries(db.schedules)) {
      if (item.chat === chat && item.action === action) delete db.schedules[id]
    }
    db.schedules[row.id] = row
  })
  return { ...row }
}

export function listGroupSchedules(chat) {
  return Object.values(store.readSync().schedules || {})
    .filter(row => row.chat === chat && row.enabled !== 0)
    .sort((a, b) => String(a.local_time).localeCompare(String(b.local_time)) || String(a.action).localeCompare(String(b.action)))
    .map(row => ({ ...row }))
}

export function cancelGroupSchedules(chat, action = '') {
  let changes = 0
  store.updateSync(db => {
    db.schedules ||= {}
    for (const [id, row] of Object.entries(db.schedules)) {
      if (row.chat === chat && (!action || row.action === action)) {
        delete db.schedules[id]
        changes += 1
      }
    }
  })
  return changes
}

export function listAllGroupSchedules() {
  return Object.values(store.readSync().schedules || {})
    .filter(row => row.enabled !== 0)
    .sort((a, b) => String(a.chat).localeCompare(String(b.chat)) || String(a.local_time).localeCompare(String(b.local_time)))
    .map(row => ({ ...row }))
}

export function claimGroupSchedule(id, date) {
  let claimed = false
  store.updateSync(db => {
    const row = db.schedules?.[id]
    if (row && row.last_local_date !== date) {
      row.last_local_date = date
      claimed = true
    }
  })
  return claimed
}
