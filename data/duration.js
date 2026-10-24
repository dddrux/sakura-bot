const UNIT_MS = Object.freeze({
  minuto: 60_000,
  hora: 3_600_000,
  dia: 86_400_000,
  mes: 30 * 86_400_000
})

const normalize = value => String(value || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .trim()

function unitFromToken(token = '') {
  const value = normalize(token).replace(/[^a-z]/g, '')
  if (['m', 'min', 'mins', 'minuto', 'minutos'].includes(value)) return 'minuto'
  if (['h', 'hr', 'hrs', 'hora', 'horas'].includes(value)) return 'hora'
  if (['d', 'dia', 'dias'].includes(value)) return 'dia'
  if (['mes', 'meses', 'month', 'months'].includes(value)) return 'mes'
  return ''
}

export function parseDuration(value, {
  defaultUnit = 'dia',
  minMs = 60_000,
  maxMs = 5 * 365 * 86_400_000,
  allowPermanent = true
} = {}) {
  const raw = normalize(value).replace(/\s+/g, '')
  if (!raw) return null
  if (allowPermanent && ['vitalicio', 'permanente', 'forever', 'vital'].includes(raw)) {
    return Object.freeze({ permanent: true, ms: 0, value: 0, unit: 'permanente', label: 'vitalício' })
  }

  const match = raw.match(/^(\d{1,5})([a-z]*)$/)
  if (!match) return null
  const amount = Number(match[1])
  const unit = unitFromToken(match[2]) || (match[2] ? '' : defaultUnit)
  if (!Number.isSafeInteger(amount) || amount < 1 || !UNIT_MS[unit]) return null
  const ms = amount * UNIT_MS[unit]
  if (!Number.isSafeInteger(ms) || ms < minMs || ms > maxMs) return null
  const plural = amount === 1 ? unit : unit === 'mes' ? 'meses' : `${unit}s`
  return Object.freeze({ permanent: false, ms, value: amount, unit, label: `${amount} ${plural}` })
}

export function formatDuration(ms, { compact = false } = {}) {
  const value = Math.max(0, Number(ms) || 0)
  if (!value) return compact ? '0m' : '0 minutos'
  const units = [
    ['dia', 86_400_000, 'd'],
    ['hora', 3_600_000, 'h'],
    ['minuto', 60_000, 'min']
  ]
  const parts = []
  let remaining = value
  for (const [name, size, short] of units) {
    const amount = Math.floor(remaining / size)
    if (!amount) continue
    remaining -= amount * size
    parts.push(compact ? `${amount}${short}` : `${amount} ${amount === 1 ? name : `${name}s`}`)
    if (parts.length >= 2) break
  }
  return parts.join(' ') || (compact ? '<1min' : 'menos de 1 minuto')
}

export function formatRemaining(row, at = Date.now()) {
  if (!row) return 'sem contrato'
  if (row.permanent) return 'vitalício'
  const remaining = Math.max(0, Number(row.expiresAt || 0) - Number(at || Date.now()))
  return remaining > 0 ? formatDuration(remaining) : 'expirado'
}

export function expiryDateLabel(expiresAt, timeZone = 'America/Recife') {
  const value = Number(expiresAt || 0)
  if (!value) return 'sem vencimento'
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone,
    dateStyle: 'short',
    timeStyle: 'short'
  }).format(new Date(value))
}
