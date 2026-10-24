const PINTEREST_BASE = 'https://www.pinterest.com'
const PINTEREST_RESOURCE = `${PINTEREST_BASE}/resource/BaseSearchResource/get/`
const DEFAULT_TIMEOUT_MS = 14_000
const MAX_IMAGE_BYTES = 14 * 1024 * 1024

const headers = Object.freeze({
  accept: 'application/json, text/javascript, */*; q=0.01',
  'accept-language': 'pt-BR,pt;q=0.9,en;q=0.7',
  'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/140 Safari/537.36',
  'x-requested-with': 'XMLHttpRequest',
  'x-pinterest-pws-handler': 'www/[username]/search/pins.js'
})

function cleanQuery(value = '') {
  return String(value || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120)
}

export function normalizePinterestImageUrl(value = '') {
  let text = String(value || '').trim()
  if (!text) return ''
  text = text
    .replace(/\\u002[fF]/g, '/')
    .replace(/\\\//g, '/')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
  let url
  try { url = new URL(text) } catch { return '' }
  if (url.protocol !== 'https:' || url.hostname !== 'i.pinimg.com') return ''
  return url.toString()
}

function pickImage(pin = {}) {
  const variants = pin?.images || {}
  for (const key of ['orig', '736x', '474x', '236x', '170x']) {
    const row = variants?.[key]
    const url = normalizePinterestImageUrl(row?.url)
    if (!url) continue
    return {
      id: String(pin?.id || url),
      url,
      width: Math.max(0, Number(row?.width) || 0),
      height: Math.max(0, Number(row?.height) || 0),
      title: cleanQuery(pin?.title || pin?.grid_title || pin?.description || '')
    }
  }
  return null
}

export function parsePinterestSearchPayload(payload = {}) {
  const response = payload?.resource_response || payload?.resourceResponse || {}
  const results = Array.isArray(response?.data?.results) ? response.data.results : []
  const seen = new Set()
  const images = []
  for (const pin of results) {
    const image = pickImage(pin)
    if (!image || seen.has(image.url)) continue
    seen.add(image.url)
    images.push(image)
  }
  return { images, bookmark: String(response?.bookmark || '') }
}

async function resourceSearch(query, bookmark = '', { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const sourceUrl = `/search/pins/?q=${encodeURIComponent(query)}`
  const options = {
    query,
    scope: 'pins',
    page_size: 25,
    bookmarks: bookmark ? [bookmark] : []
  }
  const params = new URLSearchParams({
    source_url: sourceUrl,
    data: JSON.stringify({ options, context: {} })
  })
  const response = await fetch(`${PINTEREST_RESOURCE}?${params}`, {
    headers,
    redirect: 'follow',
    signal: AbortSignal.timeout(timeoutMs)
  })
  if (!response.ok) throw new Error(`Pinterest resource HTTP ${response.status}`)
  return parsePinterestSearchPayload(await response.json())
}

function urlsFromHtml(html = '') {
  const text = String(html || '')
  const expressions = [
    /https:\\?\/\\?\/i\.pinimg\.com\\?\/[^"'<>\s]+?\.(?:jpg|jpeg|png|webp)(?:\?[^"'<>\s]*)?/gi,
    /https:\\u002F\\u002Fi\.pinimg\.com\\u002F[^"'<>\s]+?\.(?:jpg|jpeg|png|webp)(?:\\u003F[^"'<>\s]*)?/gi
  ]
  const result = []
  const seen = new Set()
  for (const expression of expressions) {
    for (const match of text.matchAll(expression)) {
      const url = normalizePinterestImageUrl(match[0])
      if (!url || seen.has(url)) continue
      seen.add(url)
      result.push({ id: url, url, width: 0, height: 0, title: '' })
    }
  }
  return result
}

async function htmlSearch(query, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const response = await fetch(`${PINTEREST_BASE}/search/pins/?q=${encodeURIComponent(query)}`, {
    headers: { ...headers, accept: 'text/html,application/xhtml+xml' },
    redirect: 'follow',
    signal: AbortSignal.timeout(timeoutMs)
  })
  if (!response.ok) throw new Error(`Pinterest HTML HTTP ${response.status}`)
  return urlsFromHtml(await response.text())
}

export async function searchPinterestImages(rawQuery, { limit = 5, maxPages = 4, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const query = cleanQuery(rawQuery)
  if (!query) throw new TypeError('Informe o que deseja pesquisar no Pinterest.')
  const wanted = Math.max(1, Math.min(80, Number(limit) || 5))
  const pages = Math.max(1, Math.min(6, Number(maxPages) || 4))
  const seen = new Set()
  const images = []
  let bookmark = ''
  let resourceError = null

  for (let page = 0; page < pages && images.length < wanted; page += 1) {
    try {
      const result = await resourceSearch(query, bookmark, { timeoutMs })
      for (const image of result.images) {
        if (seen.has(image.url)) continue
        seen.add(image.url)
        images.push(image)
        if (images.length >= wanted) break
      }
      if (!result.bookmark || result.bookmark === bookmark) break
      bookmark = result.bookmark
    } catch (error) {
      resourceError = error
      break
    }
  }

  if (images.length < wanted) {
    try {
      const fallback = await htmlSearch(query, { timeoutMs })
      for (const image of fallback) {
        if (seen.has(image.url)) continue
        seen.add(image.url)
        images.push(image)
        if (images.length >= wanted) break
      }
    } catch (error) {
      if (!images.length && resourceError) throw resourceError
      if (!images.length) throw error
    }
  }

  if (!images.length) throw new Error('Pinterest não retornou imagens para essa pesquisa.')
  return images.slice(0, wanted)
}

export async function downloadPinterestImage(rawUrl, { maxBytes = MAX_IMAGE_BYTES, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const url = normalizePinterestImageUrl(rawUrl)
  if (!url) throw new TypeError('URL de imagem do Pinterest inválida.')
  const response = await fetch(url, {
    headers: { 'user-agent': headers['user-agent'], accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8' },
    redirect: 'follow',
    signal: AbortSignal.timeout(timeoutMs)
  })
  if (!response.ok) throw new Error(`Imagem Pinterest HTTP ${response.status}`)
  const finalUrl = normalizePinterestImageUrl(response.url || url)
  if (!finalUrl) throw new Error('Pinterest redirecionou para host não permitido.')
  const type = String(response.headers.get('content-type') || '').toLowerCase()
  if (type && !type.startsWith('image/')) throw new Error('Pinterest retornou conteúdo que não é imagem.')
  const declared = Number(response.headers.get('content-length') || 0)
  const cap = Math.max(256 * 1024, Math.min(25 * 1024 * 1024, Number(maxBytes) || MAX_IMAGE_BYTES))
  if (declared > cap) throw new Error('Imagem Pinterest excede o limite de tamanho.')
  const array = new Uint8Array(await response.arrayBuffer())
  if (!array.length || array.byteLength > cap) throw new Error('Imagem Pinterest vazia ou grande demais.')
  return Buffer.from(array)
}
