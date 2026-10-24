import { createAnimatedBratSticker, createStaticBratSticker, wrapBratText } from '../media.js'

const two = wrapBratText('blond, rich, skinny, bitch!')
if (JSON.stringify(two) !== JSON.stringify(['blond,    rich,', 'skinny,    bitch!'])) throw new Error(`formato 4 inesperado: ${JSON.stringify(two)}`)

const mixed = wrapBratText('teste de figurinha cu exemplo brat')
if (!Array.isArray(mixed) || mixed.length < 2) throw new Error(`formato misto inesperado: ${JSON.stringify(mixed)}`)

const staticBuffer = await createStaticBratSticker('blond, rich, skinny, bitch!', { theme: 'verde' })
if (staticBuffer.subarray(0, 4).toString() !== 'RIFF' || staticBuffer.subarray(8, 12).toString() !== 'WEBP') throw new Error('brat não é WebP')
if (staticBuffer.includes(Buffer.from('ANMF'))) throw new Error('brat estático ainda está animado')
if (staticBuffer.length > 1_000_000) throw new Error(`Arquivo brat acima de 1 MB: ${staticBuffer.length}`)

const animatedBuffer = await createAnimatedBratSticker('wow', { theme: 'rosa' })
if (!animatedBuffer.includes(Buffer.from('ANMF'))) throw new Error('brat animado não contém frames animados')
if (animatedBuffer.length > 1_500_000) throw new Error(`Arquivo brat animado acima de 1.5 MB: ${animatedBuffer.length}`)

let animationError = ''
try {
  await createAnimatedBratSticker('duas palavras', { theme: 'azul' })
} catch (error) {
  animationError = error?.message || ''
}
if (!/apenas uma palavra/i.test(animationError)) throw new Error('animação deveria aceitar apenas uma palavra')

console.log(`✅ Brat estático/animado ok: ${staticBuffer.length} bytes | ${animatedBuffer.length} bytes`)
