function clean(value = '') {
  return String(value ?? '').replace(/\r?\n+/g, ' ').replace(/\s+/g, ' ').trim()
}

export function rankingMarker(index) {
  if (index === 0) return '🥇'
  if (index === 1) return '🥈'
  if (index === 2) return '🥉'
  return `🌸 ${index + 1}º`
}

export function formatRankingBody(rows = [], { title = 'RANKING' } = {}) {
  const safeTitle = clean(title).toUpperCase() || 'RANKING'
  const entries = rows.map((row, index) => {
    const name = clean(row?.name) || 'Usuário'
    const label = clean(row?.label) || '—'
    return `${rankingMarker(index)} ${name}\n   ${label}`
  })

  return [
    `╭━━⪩ 🪷 *${safeTitle}* ⪨━━`,
    '',
    ...entries.flatMap((entry, index) => index === entries.length - 1 ? [entry] : [entry, '']),
    '╰━━─「🪷」─━━'
  ].join('\n')
}
