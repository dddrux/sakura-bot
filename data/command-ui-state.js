const ctaState = new Map()
const officialLinksPolicy = new Map()
const keyOf = msg => String(msg?.key?.id || '')

export function clearCommandCta(msg) { const key=keyOf(msg); if(key) ctaState.delete(key) }
export function markCommandCta(msg) { const key=keyOf(msg); if(!key)return false; ctaState.set(key,Date.now()); if(ctaState.size>2000)ctaState.delete(ctaState.keys().next().value); return true }
export function consumeCommandCta(msg) { const key=keyOf(msg); if(!key)return false; const found=ctaState.has(key); ctaState.delete(key); return found }

export function setCommandOfficialLinks(msg, enabled = true) { const key=keyOf(msg); if(!key)return false; officialLinksPolicy.set(key, Boolean(enabled)); if(officialLinksPolicy.size>2000)officialLinksPolicy.delete(officialLinksPolicy.keys().next().value); return true }
export function suppressCommandOfficialLinks(msg) { return setCommandOfficialLinks(msg, false) }
export function commandOfficialLinksAllowed(msg) { const key=keyOf(msg); if(!key)return false; return officialLinksPolicy.get(key) === true }
export function clearCommandOfficialLinks(msg) { const key=keyOf(msg); if(key) officialLinksPolicy.delete(key) }

export function pruneCommandCta(maxAgeMs=30*60_000){const now=Date.now();let removed=0;for(const [key,at] of ctaState){if(now-at>maxAgeMs){ctaState.delete(key);officialLinksPolicy.delete(key);removed++}}return removed}
