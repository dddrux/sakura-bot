export function isPlausibleAiToken(value = '') {
  const token = String(value || '').trim()
  if (!token || /\s/.test(token) || /^https?:\/\//i.test(token)) return false
  return /^(?:gsk_|sk-)[A-Za-z0-9_.-]{16,}$/i.test(token)
}
