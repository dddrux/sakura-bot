import fs from 'node:fs/promises'
import path from 'node:path'

const HTTP_ONLY_PREFIX = '#HttpOnly_'

function parseNetscapeLine(rawLine) {
  let line = String(rawLine || '').trim()
  if (!line) return null

  // Netscape exports mark HTTP-only cookies as comments. They are still real
  // cookies and must be parsed after removing this special prefix.
  if (line.startsWith(HTTP_ONLY_PREFIX)) line = line.slice(HTTP_ONLY_PREFIX.length)
  else if (line.startsWith('#')) return null

  const fields = line.split('\t')
  if (fields.length < 7) return null
  const [domain, includeSubdomains, cookiePath, secure, expires, name, ...valueParts] = fields
  const value = valueParts.join('\t')
  if (!String(name || '').trim()) return null

  return {
    domain: String(domain || '').trim(),
    includeSubdomains: String(includeSubdomains).toUpperCase() === 'TRUE',
    path: cookiePath || '/',
    secure: String(secure).toUpperCase() === 'TRUE',
    expires: Number(expires) || 0,
    name: String(name).trim(),
    value: String(value || '').trim()
  }
}

export function parseNetscapeCookies(text = '') {
  const now = Math.floor(Date.now() / 1000)
  return String(text)
    .split(/\r?\n/)
    .map(parseNetscapeLine)
    .filter(Boolean)
    .filter(cookie => !cookie.expires || cookie.expires > now)
}

function isRelevantCookie(cookie) {
  const domain = String(cookie?.domain || '').replace(/^\./, '').toLowerCase()
  return domain === 'google.com' || domain === 'youtube.com' || domain.endsWith('.youtube.com')
}

export function serializeCookieHeader(cookies = []) {
  const seen = new Set()
  const preferred = [
    'SAPISID', '__Secure-1PAPISID', '__Secure-3PAPISID', 'APISID',
    'SID', '__Secure-1PSID', '__Secure-3PSID', 'HSID', 'SSID',
    'LOGIN_INFO', 'PREF', 'YSC', 'VISITOR_INFO1_LIVE',
    'VISITOR_PRIVACY_METADATA', 'CONSENT'
  ]
  const rank = name => {
    const index = preferred.indexOf(name)
    return index < 0 ? preferred.length : index
  }

  return [...cookies]
    .filter(isRelevantCookie)
    .sort((a, b) => rank(a.name) - rank(b.name))
    .filter(cookie => {
      if (seen.has(cookie.name)) return false
      seen.add(cookie.name)
      return true
    })
    .map(cookie => `${cookie.name}=${cookie.value}`)
    .join('; ')
}

export async function loadCookieFile(filePath) {
  try {
    const text = await fs.readFile(filePath, 'utf8')
    const cookies = parseNetscapeCookies(text)
    const relevantCookies = cookies.filter(isRelevantCookie)
    return {
      filePath: path.resolve(filePath),
      count: cookies.length,
      relevantCount: relevantCookies.length,
      cookieHeader: serializeCookieHeader(relevantCookies),
      hasYouTubeDomain: relevantCookies.some(cookie => /(^|\.)youtube\.com$/i.test(cookie.domain)),
      hasGoogleAuth: relevantCookies.some(cookie => ['SAPISID', '__Secure-1PAPISID', '__Secure-3PAPISID'].includes(cookie.name))
    }
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return {
        filePath: path.resolve(filePath),
        count: 0,
        relevantCount: 0,
        cookieHeader: '',
        hasYouTubeDomain: false,
        hasGoogleAuth: false
      }
    }
    throw error
  }
}
