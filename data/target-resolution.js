const digits = value => String(value || '').split('@')[0].split(':')[0].replace(/\D/g, '')
const isLid = value => /@(lid|hosted\.lid)$/i.test(String(value || ''))

async function fromMetadata(sock, chatJid, candidate, supplied = null) {
  if (!String(chatJid || '').endsWith('@g.us')) return ''
  let metadata = supplied
  try {
    if (!metadata?.participants) {
      const detail = typeof sock?.sakuraGetGroupMetadata === 'function'
        ? await sock.sakuraGetGroupMetadata(chatJid, { allowStale: true })
        : await sock?.groupMetadata?.(chatJid)
      metadata = detail?.metadata || detail || null
    }
  } catch { return '' }
  const raw = String(candidate || '')
  const key = digits(raw)
  for (const row of metadata?.participants || []) {
    const aliases = [row.id, row.jid, row.lid, row.phoneNumber, row.participantPn, row.pn].filter(Boolean).map(String)
    if (!aliases.some(value => value === raw || digits(value) === key)) continue
    const phone = aliases.find(value => /@(s\.whatsapp\.net|hosted)$/i.test(value))
    if (phone) return digits(phone)
  }
  return ''
}

export async function resolveTargetIdentityNumber(sock, chatJid = '', candidates = [], { metadata = null } = {}) {
  const list = (Array.isArray(candidates) ? candidates : [candidates]).map(String).filter(Boolean)
  for (const candidate of list) {
    const metadataNumber = await fromMetadata(sock, chatJid, candidate, metadata)
    if (metadataNumber) return metadataNumber
    if (isLid(candidate) && typeof sock?.sakuraResolveNumber === 'function') {
      try {
        const resolved = digits(await sock.sakuraResolveNumber(candidate))
        if (resolved) return resolved
      } catch {}
    }
    if (!isLid(candidate)) {
      const plain = digits(candidate)
      if (plain) return plain
    }
  }
  return ''
}
