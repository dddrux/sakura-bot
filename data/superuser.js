const digits = value => String(value ?? '').split('@')[0].split(':')[0].replace(/\D/g, '')

function connectedNumbers(sock, botNumber = '') {
  return new Set([
    digits(botNumber),
    digits(sock?.user?.id),
    digits(sock?.user?.lid)
  ].filter(Boolean))
}

export function shouldProcessOwnMessage({ fromMe = false, text = '', prefix = '.' } = {}) {
  if (!fromMe) return true
  const body = String(text || '').trim()
  const marker = String(prefix || '.').trim() || '.'
  if (body.startsWith(marker) && body.length > marker.length) return true
  // A própria conta conectada também pode conversar com a IA. Mantemos o
  // filtro de ecos: só mensagens naturais que chamam "Sakura" seguem.
  const normalized = body.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim()
  // Mensagens fromMe incluem tanto o que o usuário digita no próprio número
  // quanto respostas que a Sakura acabou de enviar. Para evitar eco, a IA só
  // acorda em texto natural próprio quando é chamada logo no início.
  return /^(?:oi[,! ]+|hey[,! ]+)?sakura(?=$|[^\p{L}\p{N}_])/iu.test(normalized)
}

export function isConnectedSelf({ sock, senderNumber = '', fromMe = false, botNumber = '' } = {}) {
  if (fromMe) return true
  const sender = digits(senderNumber)
  return Boolean(sender && connectedNumbers(sock, botNumber).has(sender))
}

export function connectedSelfNumber({ sock, botNumber = '', fallback = '' } = {}) {
  return digits(sock?.user?.id) || digits(botNumber) || digits(sock?.user?.lid) || digits(fallback)
}
