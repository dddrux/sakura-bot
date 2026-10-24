import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
const source = await fs.readFile(new URL('../ai-engine.js', import.meta.url), 'utf8')
assert.match(source, /export function formatAiReply\(/, 'falta helper público da resposta IA')
assert.doesNotMatch(source, /ˢᵃᵏᵘʳᵃ •/, 'assinatura Sakura ainda está embutida no corpo')
assert.match(source, /footer:\s*'mensagem gerada por IA'/, 'aviso da IA não está no footer cinza do WhatsApp')
assert.match(source, /nativeFlow:\s*\[\]/, 'transporte da IA não força o footer interativo discreto')
assert.match(source, /sendMessageFast\(/, 'IA não usa transporte direto para preservar footer sem formatador')
console.log('✅ IA sem formatador e com footer cinza discreto')
