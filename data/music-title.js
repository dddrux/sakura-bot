function clean(value = '') {
  return String(value || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim()
}

function sameLoose(a = '', b = '') {
  const normalize = value => clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
  const left = normalize(a)
  const right = normalize(b)
  return Boolean(left && right && (left === right || left.includes(right) || right.includes(left)))
}

export function summarizeMusicTitle(value = '', author = '', maxLength = 64) {
  let title = clean(value) || 'Música'
  const noise = /\b(?:official\s+(?:music\s+)?video|official\s+audio|music\s+video|lyric\s+video|lyrics?|visuali[sz]er|audio\s+only|vídeo\s+oficial|video\s+oficial|áudio\s+oficial|audio\s+oficial|legendado|tradu[cç][aã]o|4k|8k|hd|hq)\b/i

  // Remove blocos decorativos do YouTube apenas quando são rótulos de vídeo, não parte real do nome.
  title = title.replace(/\s*[\[(][^\])]{0,80}[\])]/g, block => noise.test(block) ? ' ' : block)
  title = title.replace(/\s*[-–—|•:]?\s*\b(?:official\s+(?:music\s+)?video|official\s+audio|music\s+video|lyric\s+video|lyrics?|visuali[sz]er|audio\s+only|vídeo\s+oficial|video\s+oficial|áudio\s+oficial|audio\s+oficial|legendado|tradu[cç][aã]o|4k|8k|hd|hq)\b.*$/i, '')
  title = clean(title).replace(/^[\-–—|•:]+|[\-–—|•:]+$/g, '').trim()

  const split = title.match(/^(.{1,70}?)\s+[-–—|]\s+(.{1,120})$/)
  if (split) {
    const [, left, right] = split
    if (sameLoose(left, author) || clean(left).length <= 45) title = clean(right)
  }

  title = title.replace(/\s{2,}/g, ' ').trim() || 'Música'
  const limit = Math.max(24, Math.min(100, Number(maxLength) || 64))
  return title.length > limit ? `${title.slice(0, limit - 1).trimEnd()}…` : title
}
