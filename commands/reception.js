import { defineCommand } from '../data/workstation.js'
import {
  approveReceptionMember,
  buildReceptionModel,
  formatReceptionCard,
  getReceptionConfig,
  getReceptionProfile,
  parseReceptionProfileInput,
  saveReceptionProfile,
  setReceptionConfig,
  validateReceptionProfile
} from '../data/reception.js'
import { reply } from '../data/reply.js'
import { sendNativeList } from '../data/interactive.js'

const norm = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()

function validationMessage(result = {}, model = '.ficha Seu nome | Sua idade | Sua cidade') {
  const problems = []
  if (result.missing?.length) problems.push(`faltando: ${result.missing.join(', ')}`)
  if (result.invalid?.length) problems.push(`inválido: ${result.invalid.join(', ')}`)
  return [`Preencha a ficha corretamente${problems.length ? ` (${problems.join(' • ')})` : ''}.`, `Modelo: ${model}`].join('\n')
}

async function panel({ sock, msg, settings, logger }) {
  const cfg = await getReceptionConfig(msg.key.remoteJid)
  const model = buildReceptionModel(cfg, settings.prefix)
  return sendNativeList({
    sock, jid: msg.key.remoteJid, quoted: msg, logger, kind: 'reception',
    body: `🌸 *RECEPÇÃO SAKURA*\n🌸 status: *${cfg.enabled ? 'ativa' : 'desativada'}*\n💮 campos: ${cfg.fields.join(', ')}\n💮 modelo: ${model}`,
    buttonText: '🌸 Configurar recepção',
    sections: [
      { title: '🌸 Recepção', rows: [
        { id: `${settings.prefix}recepcao on`, title: '🌸 Ativar', description: 'Ativa a recepção automática' },
        { id: `${settings.prefix}recepcao off`, title: '🌸 Desativar', description: 'Desativa sem apagar as fichas' },
        { id: `${settings.prefix}ficha`, title: '💮 Minha ficha', description: 'Mostra como preencher sua ficha' }
      ]},
      { title: '🌸 Modelos', rows: [
        { id: `${settings.prefix}recepcao campos nome,idade,cidade`, title: '🌸 Ficha completa', description: 'Nome, idade e cidade' },
        { id: `${settings.prefix}recepcao campos nome,cidade`, title: '🌸 Ficha curta', description: 'Nome e cidade' }
      ]}
    ]
  })
}

export default defineCommand({
  name: 'recepcao',
  aliases: ['recepção', 'ficha', 'minhaficha'],
  category: 'Grupo',
  groupOnly: true,
  usage: '.recepcao | .ficha Nome | 18 | Recife',
  description: 'Gerencia a recepção automática e fichas dos membros.',
  menuEntries: [
    { name: 'recepcao', usage: '.recepcao', description: 'Abre a central de recepção.', menuGroup: 'Recepção' },
    { name: 'ficha', usage: '.ficha Nome | idade | cidade', description: 'Salva sua ficha de apresentação.', menuGroup: 'Recepção' }
  ],
  slash: { model: '.ficha Nome | 18 | Recife', categories: ['grupo', 'recepção'], copyable: true },
  async execute({ sock, msg, args, rawArgs, invokedAs, settings, senderNumber, isAdmin, logger }) {
    const used = norm(invokedAs)
    if (used === 'ficha' || used === 'minhaficha') {
      const cfg = await getReceptionConfig(msg.key.remoteJid)
      const model = buildReceptionModel(cfg, settings.prefix)
      const raw = String(rawArgs || '').trim()
      if (!raw) {
        const profile = await getReceptionProfile(msg.key.remoteJid, senderNumber)
        if (profile) return reply(sock, msg, formatReceptionCard(profile, cfg), { raw: true })
        return reply(sock, msg, 'Copie o modelo, preencha e envie aqui.', {
          title: 'FICHA SAKURA',
          nativeFlow: [{ text: '🌸 Copiar modelo', copy: model }]
        })
      }

      const input = parseReceptionProfileInput(raw, cfg)
      const check = validateReceptionProfile(input, cfg)
      if (!check.valid) {
        return reply(sock, msg, validationMessage(check, model), {
          title: 'FICHA SAKURA',
          nativeFlow: [{ text: '🌸 Copiar modelo', copy: model }]
        })
      }

      const profile = await saveReceptionProfile(msg.key.remoteJid, senderNumber, input)
      await approveReceptionMember(msg.key.remoteJid, senderNumber)
      return reply(sock, msg, `${formatReceptionCard(profile, cfg)}\n\n🌸 *Ficha aprovada. Comandos liberados.*`, {
        raw: true,
        mentions: [`${senderNumber}@s.whatsapp.net`]
      })
    }

    const action = norm(args?.[0])
    if (!action) return panel({ sock, msg, settings, logger })
    if (!isAdmin) return reply(sock, msg, 'A configuração da recepção é exclusiva para administradores.', { title: 'RECEPÇÃO SAKURA' })
    if (['on','ativar','ligar'].includes(action)) { await setReceptionConfig(msg.key.remoteJid, { enabled: true }); return reply(sock, msg, 'Recepção automática ativada.', { title: 'RECEPÇÃO SAKURA' }) }
    if (['off','desativar','desligar'].includes(action)) { await setReceptionConfig(msg.key.remoteJid, { enabled: false }); return reply(sock, msg, 'Recepção automática desativada.', { title: 'RECEPÇÃO SAKURA' }) }
    if (action === 'campos') {
      const fields = String(args.slice(1).join(' ') || '').split(',').map(v => norm(v)).filter(Boolean)
      if (!fields.length) return reply(sock, msg, 'Exemplo: .recepcao campos nome,idade,cidade')
      const cfg = await setReceptionConfig(msg.key.remoteJid, { fields })
      return reply(sock, msg, `Campos atualizados: ${cfg.fields.join(', ')}.`, { title: 'RECEPÇÃO SAKURA' })
    }
    if (action === 'titulo') {
      const title = args.slice(1).join(' ').trim()
      if (!title) return reply(sock, msg, 'Informe um título para a recepção.')
      await setReceptionConfig(msg.key.remoteJid, { title })
      return reply(sock, msg, 'Título da recepção atualizado.', { title: 'RECEPÇÃO SAKURA' })
    }
    return panel({ sock, msg, settings, logger })
  }
})
