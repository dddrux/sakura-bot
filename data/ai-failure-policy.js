export function aiFailurePolicy(statusCode = 0, retryAfterMs = 0) {
  const status = Number(statusCode) || 0
  const retryAfter = Math.max(0, Number(retryAfterMs) || 0)
  if ([400, 404, 422].includes(status)) {
    return { rotateToken: false, retryLater: false, tokenCooldownMs: 0, kind: 'provider-config' }
  }
  if ([401, 403].includes(status)) {
    return { rotateToken: true, retryLater: false, tokenCooldownMs: 15 * 60_000, kind: 'invalid-token' }
  }
  if (status === 429) {
    return { rotateToken: true, retryLater: true, tokenCooldownMs: retryAfter || 90_000, kind: 'rate-limit' }
  }
  if (!status || status >= 500) {
    return { rotateToken: true, retryLater: true, tokenCooldownMs: retryAfter || 15_000, kind: 'temporary' }
  }
  return { rotateToken: false, retryLater: false, tokenCooldownMs: retryAfter, kind: 'provider-error' }
}
