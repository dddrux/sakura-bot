import {
  createSakuraCommandList,
  createSakuraCopyCard,
  extractSakuraSelection,
  formatSakuraText,
  generateWAMessageContent,
  getBizBinaryNode,
  normalizeMessageContent,
  patchSakuraInteractiveForMd,
  proto
} from '@sakura-md/baileys'
import { buildCommandSections, buildMenuHeader, sendSelectableCommandMenu } from '../interactive.js'

const logger = new Proxy({}, { get: () => () => {} })
const commands = new Map([
  ['menu', { name: 'menu', category: 'Principal', usage: '.menu' }],
  ['ping', { name: 'ping', category: 'Principal', usage: '.ping' }],
  ['s', { name: 's', category: 'Mídia', usage: '.s' }],
  ['brat', { name: 'brat', category: 'Mídia', usage: '.brat seu texto' }],
  ['eco', { name: 'eco', category: 'Economia', usage: '.eco', menuEntries: [
    { name: 'eco', usage: '.eco', description: 'Painel' },
    { name: 'saldo', usage: '.saldo', description: 'Conta' },
    { name: 'pix', usage: '.pix @pessoa 100', description: 'Transferência' }
  ] }]
])

const header = buildMenuHeader(commands)
if (header.includes('Star Memories') || header.includes('.catalogo')) throw new Error('menu contém texto removido')
const expectedIdentity = [
  '╭━━⪩ 🧊 *MENU PRINCIPAL* ⪨━━',
  '▢ • ❄️ *Sakura-MD*',
  '▢ • 💎 *dono:* *Drux*',
  '▢ • ❄️ *prefixo:* *.*',
  '╰━━─「🧊」─━━'
]
for (const line of expectedIdentity) if (!header.includes(line)) throw new Error(`identidade visual ausente: ${line}`)
if (/\*base:\*|\*atalhos:\*|\*categorias:\*/i.test(header)) throw new Error('menu principal ainda contém informações desnecessárias')
if (/\*ações:\*/i.test(header)) throw new Error('menu principal ainda mostra quantidade de ações')
if (!header.includes('Escolha um comando no catálogo:')) throw new Error('instrução do catálogo não foi atualizada')
const economy = buildCommandSections(commands).find(section => section.title === 'Economia')
if (!economy || !economy.commands.some(command => command.name === 'pix')) throw new Error('entradas virtuais da economia não foram expandidas')

const content = createSakuraCommandList({
  title: '',
  body: buildMenuHeader(commands),
  buttonText: '❄️ comandos',
  responseMode: 'native',
  image: Buffer.from([1, 2, 3]),
  sections: [
    { title: '❄️ Principal', rows: [{ id: '.ping', title: '🧊 .ping' }] },
    { title: '🧊 Mídia', rows: [{ id: '.s', title: '❄️ .s' }] }
  ]
})
if (!content.nativeFlow || content.nativeFlow[0]?.sections?.[0]?.rows?.[0]?.id !== '.ping') throw new Error('lista do menu inválida')

const generated = await generateWAMessageContent(content, {
  logger,
  upload: async () => ({ mediaUrl: 'https://example.invalid/menu.jpg', directPath: '/menu.jpg' }),
  mediaUploadTimeoutMs: 1000
})
const normalizedGenerated = normalizeMessageContent(generated)
const generatedButtons = normalizedGenerated?.interactiveMessage?.nativeFlowMessage?.buttons || []
if (generatedButtons[0]?.name !== 'single_select' || !generatedButtons[0]?.buttonParamsJson?.includes('.ping')) throw new Error('single_select não foi compilado')
if (generated?.viewOnceMessage?.message?.messageContextInfo?.deviceListMetadataVersion !== 2) throw new Error('messageContextInfo MD ausente')
const patched = patchSakuraInteractiveForMd(generated)
if (!patched.viewOnceMessage?.message?.interactiveMessage) throw new Error('wrapper viewOnce MD não foi preservado')
const biz = getBizBinaryNode(patched)
if (biz?.tag !== 'biz' || biz?.content?.[0]?.tag !== 'interactive' || biz?.content?.[0]?.content?.[0]?.attrs?.name !== 'mixed') throw new Error('nó biz/native_flow completo não foi restaurado')

const copyCard = createSakuraCopyCard({
  body: formatSakuraText('.brat seu texto', { title: '.BRAT', icon: '🧊' }),
  copyText: '.brat seu texto'
})
const copyGenerated = await generateWAMessageContent(copyCard, { logger })
const copyButton = normalizeMessageContent(copyGenerated)?.interactiveMessage?.nativeFlowMessage?.buttons?.[0]
if (copyButton?.name !== 'cta_copy' || !copyButton.buttonParamsJson?.includes('.brat seu texto')) throw new Error('botão de copiar não foi compilado')

const response = { interactiveResponseMessage: { nativeFlowResponseMessage: { paramsJson: JSON.stringify({ id: '.ping' }) } } }
if (extractSakuraSelection(response) !== '.ping') throw new Error('parser Native Flow falhou')
const encoded = proto.Message.encode(proto.Message.fromObject(response)).finish()
if (!encoded.length) throw new Error('protobuf vazio')

const relays = []
const runtimeSock = {
  user: { id: '5581999999999@s.whatsapp.net' },
  waUploadToServer: async () => ({ mediaUrl: 'https://example.invalid/menu.jpg', directPath: '/menu.jpg' }),
  async relayMessage(jid, message, options) {
    relays.push({ jid, message, options })
    return options.messageId
  }
}
const runtimeMsg = { key: { remoteJid: '120363000000000000@g.us', id: 'MENU-TEST-IN' } }
const sent = await sendSelectableCommandMenu({ sock: runtimeSock, msg: runtimeMsg, commands, logger })
if (relays.length !== 1) throw new Error(`menu deveria usar um único relay: ${relays.length}`)
const inner = relays[0].message?.viewOnceMessage?.message
if (!inner?.interactiveMessage?.header?.imageMessage) throw new Error('logo não está integrada no cabeçalho interativo')
if (inner?.interactiveMessage?.footer?.text !== 'Sakura-MD • Drux Domina') throw new Error('rodapé do menu não foi atualizado')
if (inner?.interactiveMessage?.nativeFlowMessage?.buttons?.[0]?.name !== 'single_select') throw new Error('botão single_select ausente no relay')
if (!relays[0].options?.additionalNodes?.some(node => node?.tag === 'biz')) throw new Error('nó biz não foi enviado no relay')
if (!sent?.key?.id) throw new Error('mensagem interativa não retornou ID')

const multiline = formatSakuraText('/teste de frase não\ncompletada')
if (!multiline.includes('│ /teste de frase não') || !multiline.includes('│ completada')) throw new Error('formatador de linhas falhou')
console.log('✅ Menu: logo integrada, single_select, contexto MD, nó biz completo, parser e copiar aprovados')
