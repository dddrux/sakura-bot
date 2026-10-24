export function messageCallsSakura(text = '') {
  const normalized = String(text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  return /(^|[^\p{L}\p{N}_])sakura(?=$|[^\p{L}\p{N}_])/iu.test(normalized)
}
