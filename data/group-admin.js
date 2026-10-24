const digits = value => String(value || '').split('@')[0].split(':')[0].replace(/\D/g, '')
const VALID_USER_JID = /@(lid|hosted\.lid|s\.whatsapp\.net|hosted)$/i

function cleanCandidate(value = '') {
  const raw = String(value || '').trim()
  if (!raw) return ''
  if (VALID_USER_JID.test(raw)) return raw
  const number = digits(raw)
  return number ? `${number}@s.whatsapp.net` : ''
}

function participantAliases(row = {}) {
  return [row.id, row.jid, row.lid, row.phoneNumber, row.participantPn, row.pn]
    .map(value => String(value || '').trim())
    .filter(Boolean)
}

function rowMatches(row, candidate) {
  const raw = cleanCandidate(candidate)
  if (!raw) return false
  const key = digits(raw)
  return participantAliases(row).some(alias => alias === raw || (key && digits(alias) === key))
}

function nativeParticipantJid(row = {}, fallback = '') {
  for (const value of [row.id, row.jid, row.lid, row.phoneNumber, row.participantPn, row.pn]) {
    const jid = String(value || '').trim()
    if (VALID_USER_JID.test(jid)) return jid
  }
  return cleanCandidate(fallback)
}

async function getMetadata(sock, chatJid, supplied = null, { fresh = false } = {}) {
  if (supplied?.participants && !fresh) return supplied
  if (typeof sock?.sakuraGetGroupMetadata === 'function') {
    const detail = await sock.sakuraGetGroupMetadata(chatJid, { allowStale: !fresh })
    return detail?.metadata || detail || null
  }
  return await sock?.groupMetadata?.(chatJid)
}

export async function resolveGroupParticipantJid(sock, chatJid, candidates = [], { metadata = null } = {}) {
  const list = (Array.isArray(candidates) ? candidates : [candidates]).map(cleanCandidate).filter(Boolean)
  if (!list.length) return { jid: '', row: null, metadata: metadata || null }
  const groupMetadata = await getMetadata(sock, chatJid, metadata)
  for (const candidate of list) {
    const row = (groupMetadata?.participants || []).find(item => rowMatches(item, candidate))
    if (row) return { jid: nativeParticipantJid(row, candidate), row, metadata: groupMetadata }
  }
  return { jid: cleanCandidate(list[0]), row: null, metadata: groupMetadata }
}

function resultSucceeded(results = []) {
  if (!Array.isArray(results) || results.length === 0) return true
  return results.every(item => {
    const status = String(item?.status ?? item?.error ?? '200').toLowerCase()
    return status === '200' || status === 'ok' || status === 'success'
  })
}

function resultStatus(results = []) {
  if (!Array.isArray(results) || !results.length) return ''
  return String(results.find(item => String(item?.status ?? item?.error ?? '200') !== '200')?.status || results[0]?.status || '')
}

function actionJidCandidates(resolved = {}) {
  const values = [resolved.jid, ...participantAliases(resolved.row || {})]
  const out = []
  for (const value of values) {
    const jid = cleanCandidate(value)
    if (!jid || out.includes(jid)) continue
    out.push(jid)
  }
  return out
}

async function verifyRole(sock, chatJid, jid, shouldBeAdmin, { attempts = 3 } = {}) {
  if (typeof sock?.sakuraInvalidateGroupMetadata === 'function') sock.sakuraInvalidateGroupMetadata(chatJid)
  let lastMetadata = null
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (attempt > 0) await new Promise(resolve => setTimeout(resolve, 250 * attempt))
    try {
      lastMetadata = await getMetadata(sock, chatJid, null, { fresh: true })
      const row = (lastMetadata?.participants || []).find(item => rowMatches(item, jid))
      if (!row) continue
      const isAdmin = Boolean(row.admin)
      if (isAdmin === shouldBeAdmin) return { verified: true, row, metadata: lastMetadata }
    } catch {}
  }
  return { verified: false, row: null, metadata: lastMetadata }
}

export async function updateGroupParticipant(sock, chatJid, candidates, action, { metadata = null, verify = true } = {}) {
  if (!['promote', 'demote', 'remove'].includes(action)) throw new TypeError(`Ação de participante inválida: ${action}`)
  const resolved = await resolveGroupParticipantJid(sock, chatJid, candidates, { metadata })
  if (!resolved.jid) {
    const error = new Error('Não foi possível identificar o participante do grupo.')
    error.code = 'SAKURA_GROUP_TARGET_NOT_FOUND'
    throw error
  }

  let response = null
  let appliedJid = ''
  let lastError = null
  for (const jid of actionJidCandidates(resolved)) {
    try {
      const attempt = await sock.groupParticipantsUpdate(chatJid, [jid], action)
      if (!resultSucceeded(attempt)) {
        const error = new Error(`O WhatsApp recusou a ação ${action}${resultStatus(attempt) ? ` (status ${resultStatus(attempt)})` : ''}.`)
        error.code = 'SAKURA_GROUP_PARTICIPANT_UPDATE_REJECTED'
        error.status = resultStatus(attempt)
        error.response = attempt
        lastError = error
        continue
      }
      response = attempt
      appliedJid = jid
      break
    } catch (error) {
      lastError = error
    }
  }
  if (!appliedJid) {
    if (lastError) throw lastError
    const error = new Error(`O WhatsApp recusou a ação ${action}.`)
    error.code = 'SAKURA_GROUP_PARTICIPANT_UPDATE_REJECTED'
    throw error
  }

  let verification = { verified: true, row: resolved.row, metadata: resolved.metadata }
  if (verify && action !== 'remove') verification = await verifyRole(sock, chatJid, appliedJid, action === 'promote')
  else if (typeof sock?.sakuraInvalidateGroupMetadata === 'function') sock.sakuraInvalidateGroupMetadata(chatJid)

  return {
    ok: true,
    jid: appliedJid,
    action,
    response,
    verified: verification.verified,
    participant: verification.row || resolved.row || null
  }
}

export function promoteGroupParticipant(sock, chatJid, candidates, options = {}) {
  return updateGroupParticipant(sock, chatJid, candidates, 'promote', options)
}
