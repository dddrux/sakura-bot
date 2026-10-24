// Estilo único dos menus da Sakura (WhatsApp): o padrão 💮/🌸 alternado em TUDO.
// Fonte da verdade dos ícones; nenhum outro lugar do menu escolhe emoji.
export const THEME = Object.freeze({ pattern: ['💮', '🌸'], brand: '🪷', link: '🔗' })

// Emoji do índice i (0 → 💮, 1 → 🌸, 2 → 💮 ...).
export const alt = (index = 0) => THEME.pattern[Math.abs(Number(index) || 0) % THEME.pattern.length]

const LEADING = /^(?:[\p{Extended_Pictographic}\uFE0F\u200D]+\s*)+/u

// Remove emojis/decoração do começo; o ícone volta a ser decidido pelo padrão.
export function stripLeading(value = '') {
  return String(value || '').replace(/^▢\s*•\s*/u, '').replace(LEADING, '').trim()
}

export const itemTitle = (value = '', index = 0) => `${alt(index)} ${stripLeading(value)}`.trim()
export const sectionTitle = (value = '') => `${THEME.brand} ${stripLeading(value) || 'Opções'}`

export function buttonLabel(value = '', fallback = 'Abrir menu') {
  const raw = String(value || '').trim()
  const clean = stripLeading(raw) || fallback
  const text = `${clean.charAt(0).toLocaleUpperCase('pt-BR')}${clean.slice(1)}`
  return `${/^🔗/u.test(raw) ? THEME.link : alt(0)} ${text}`
}

// Bloco: ╭━━⪩ 🪷 *TÍTULO* ⪨━━ / ▢ • 💮 linha / ▢ • 🌸 linha / ╰━━─「🪷」─━━
export function menuBox(title, lines = []) {
  return [
    `╭━━⪩ ${THEME.brand} *${title}* ⪨━━`,
    ...lines.map((line, index) => `▢ • ${alt(index)} ${line}`),
    `╰━━─「${THEME.brand}」─━━`
  ].join('\n')
}

export function botInfoLines({ botName, ownerName, prefix, uptime }) {
  return [`*${botName}*`, `*dono:* ${ownerName}`, `*prefixo:* ${prefix}`, `*uptime:* ${uptime}`]
}
