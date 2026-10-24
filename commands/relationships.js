import { defineCommand } from '../data/workstation.js'
import { reply } from '../data/reply.js'
import { sendNativeList } from '../data/interactive.js'
import { formatMessage } from '../data/formatter.js'
import { formatDuration } from '../data/duration.js'
import {
  cancelSocialRequest,
  createSocialRequest,
  endRelationship,
  findPendingRequest,
  getFamily,
  getRelationship,
  listSocialHistory,
  removeFamilyLink,
  resolveSocialRequest
} from '../data/social-store.js'
import { displayUser, formatMentionName, groupNameMap, resolveTarget } from '../data/user-display.js'

const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '')

const TYPE_INFO = Object.freeze({
  dating: { noun: 'namoro', request: 'pedido de namoro', accept: 'aceitarnamoro', reject: 'recusarnamoro', emoji: '🌸' },
  marriage: { noun: 'casamento', request: 'pedido de casamento', accept: 'aceitarcasamento', reject: 'recusarcasamento', emoji: '💮' },
  adoption: { noun: 'adoção', request: 'pedido de adoção', accept: 'aceitaradocao', reject: 'recusaradocao', emoji: '🌸' }
})

function usedCommand(invokedAs, text, prefix) {
  return normalize(invokedAs || String(text || '').slice(String(prefix || '.').length).trim().split(/\s+/, 1)[0])
}

function typeFromWord(value = '') {
  const token = normalize(value)
  if (['namoro', 'namorar', 'dating'].includes(token)) return 'dating'
  if (['casamento', 'casar', 'marriage'].includes(token)) return 'marriage'
  if (['adocao', 'adotar', 'adoption'].includes(token)) return 'adoption'
  return ''
}

function requestTypeForCommand(command) {
  if (['namorar', 'pedirnamoro'].includes(command)) return 'dating'
  if (['casar', 'pedircasamento'].includes(command)) return 'marriage'
  if (['adotar', 'pediradocao'].includes(command)) return 'adoption'
  return ''
}

function decisionTypeForCommand(command) {
  if (command.includes('namoro')) return 'dating'
  if (command.includes('casamento')) return 'marriage'
  if (command.includes('adocao')) return 'adoption'
  return ''
}

function dateLabel(timestamp) {
  if (!timestamp) return 'data não registrada'
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'long', timeZone: 'America/Recife' }).format(new Date(timestamp))
}

function relationshipDuration(row) {
  const since = row?.status === 'married' ? row.marriedSince : row?.datingSince
  return since ? formatDuration(Date.now() - since) : 'tempo desconhecido'
}

function historyLabel(eventType = '') {
  const labels = {
    'dating.request': 'pedido de namoro enviado',
    'dating.accept': 'namoro iniciado',
    'dating.reject': 'pedido de namoro recusado',
    'dating.cancel': 'pedido de namoro cancelado',
    'dating.end': 'namoro encerrado',
    'marriage.request': 'pedido de casamento enviado',
    'marriage.accept': 'casamento iniciado',
    'marriage.reject': 'pedido de casamento recusado',
    'marriage.cancel': 'pedido de casamento cancelado',
    'marriage.divorce': 'divórcio registrado',
    'adoption.request': 'pedido de adoção enviado',
    'adoption.accept': 'adoção aceita',
    'adoption.reject': 'adoção recusada',
    'adoption.cancel': 'pedido de adoção cancelado',
    'family.remove': 'vínculo familiar removido'
  }
  return labels[eventType] || eventType.replaceAll('.', ' ')
}

async function namesFor(sock, msg, metadata) {
  return groupNameMap(sock, msg.key.remoteJid, metadata)
}

function userOf(number, names) {
  return displayUser(number, names)
}

function memberExists(number, names) {
  return Boolean(number && names.has(String(number)))
}

async function sendSocialTargetModel({ sock, msg, settings, logger, command, type, note = '' }) {
  const info = TYPE_INFO[type]
  const examples = type === 'dating'
    ? [`${settings.prefix}namorar @pessoa`, `responda uma mensagem da pessoa com ${settings.prefix}namorar`]
    : type === 'marriage'
      ? [`${settings.prefix}casar @pessoa`, `responda uma mensagem do namoro atual com ${settings.prefix}casar`]
      : [`${settings.prefix}adotar @pessoa`, `responda uma mensagem da pessoa com ${settings.prefix}adotar`]

  const body = [
    note,
    `Para enviar um ${info.request}, escolha uma pessoa do grupo.`,
    '',
    `*Modelo com marcação:* ${examples[0]}`,
    `*Modelo respondendo:* ${examples[1]}`,
    '',
    'A Sakura nunca cria o vínculo sem a outra pessoa aceitar.'
  ].filter(Boolean).join('\n')

  return sendNativeList({
    sock,
    jid: msg.key.remoteJid,
    quoted: msg,
    logger,
    kind: `social-model:${type}`,
    body: formatMessage(body, { title: `MODELO DE ${info.noun.toUpperCase()}`, icon: info.emoji }),
    buttonText: `${info.emoji} Opções`,
    sections: [{
      title: 'Ações relacionadas',
      rows: [
        { id: `${settings.prefix}menu command ${command}`, title: `${info.emoji} Copiar modelo`, description: 'Abrir o cartão com comando copiável' },
        { id: `${settings.prefix}pedidossociais`, title: '🌸 Pedidos pendentes', description: 'Ver pedidos que você recebeu' },
        { id: `${settings.prefix}relacionamento`, title: '🌸 Meu relacionamento', description: 'Consultar namoro ou casamento atual' },
        { id: `${settings.prefix}familia`, title: '🌸 Minha família', description: 'Consultar vínculos familiares' }
      ]
    }]
  })
}

async function sendRequest({ sock, msg, settings, logger, names, row }) {
  const info = TYPE_INFO[row.type]
  const from = userOf(row.requester, names)
  const target = userOf(row.target, names)
  const body = [
    `${formatMentionName(from)} enviou um ${info.request} para ${formatMentionName(target)}.`,
    '',
    `Código: *${row.id}*`,
    'Expira em 15 minutos e somente a pessoa marcada pode responder.'
  ].join('\n')
  return sendNativeList({
    sock,
    jid: msg.key.remoteJid,
    quoted: msg,
    logger,
    kind: `social-request:${row.type}`,
    body: formatMessage(body, { title: info.request.toUpperCase(), icon: info.emoji }),
    buttonText: `${info.emoji} Responder`,
    sections: [{
      title: 'Resposta da pessoa convidada',
      rows: [
        { id: `${settings.prefix}${info.accept} ${row.id}`, title: `${info.emoji} Aceitar`, description: `Confirmar ${info.noun}` },
        { id: `${settings.prefix}${info.reject} ${row.id}`, title: '💮 Recusar', description: 'Recusar sem criar vínculo' },
        { id: `${settings.prefix}cancelarpedido ${row.id}`, title: '🌸 Cancelar pedido', description: 'Somente quem enviou' }
      ]
    }],
    mentions: [from.jid, target.jid].filter(Boolean)
  })
}

async function sendRelationshipPanel({ sock, msg, settings, logger, names, number }) {
  const person = userOf(number, names)
  const row = getRelationship(number)
  if (!row) {
    return sendNativeList({
      sock, jid: msg.key.remoteJid, quoted: msg, logger, kind: 'relationship-empty',
      body: formatMessage(`${formatMentionName(person)} não possui namoro ou casamento ativo.`, { title: 'RELACIONAMENTO', icon: '🌸' }),
      buttonText: '🌸 Opções',
      sections: [{ title: 'Relacionamentos', rows: [
        { id: `${settings.prefix}namorar`, title: '🌸 Pedir em namoro', description: 'Use marcando uma pessoa' },
        { id: `${settings.prefix}pedidossociais`, title: '🌸 Pedidos pendentes', description: 'Ver o pedido mais recente recebido' },
        { id: `${settings.prefix}familia`, title: '🌸 Ver família', description: 'Pais e filhos adotivos' }
      ] }],
      mentions: person.jid ? [person.jid] : []
    })
  }
  const partner = userOf(row.partner, names)
  const status = row.status === 'married' ? 'casamento' : 'namoro'
  const since = row.status === 'married' ? row.marriedSince : row.datingSince
  const body = [
    `${formatMentionName(person)} está em *${status}* com ${formatMentionName(partner)}.`,
    `Desde: ${dateLabel(since)}`,
    `Tempo juntos: ${relationshipDuration(row)}`,
    row.status === 'married' ? `Namoro iniciado em: ${dateLabel(row.datingSince)}` : ''
  ].filter(Boolean).join('\n')
  return sendNativeList({
    sock, jid: msg.key.remoteJid, quoted: msg, logger, kind: 'relationship-panel',
    body: formatMessage(body, { title: 'RELACIONAMENTO', icon: row.status === 'married' ? '💮' : '🌸' }),
    buttonText: '🌸 Opções',
    sections: [{ title: 'Relacionamento', rows: [
      row.status === 'dating' ? { id: `${settings.prefix}casar @${row.partner}`, title: '💮 Pedir em casamento', description: 'Exige aceite do namoro atual' } : null,
      row.status === 'dating' ? { id: `${settings.prefix}terminar`, title: '🌸 Terminar namoro', description: 'Encerra apenas o seu relacionamento' } : null,
      row.status === 'married' ? { id: `${settings.prefix}divorciar`, title: '🌸 Divorciar', description: 'Encerra apenas o seu casamento' } : null,
      { id: `${settings.prefix}historicosocial`, title: '🌸 Histórico social', description: 'Últimos eventos do usuário' },
      { id: `${settings.prefix}familia`, title: '🌸 Família', description: 'Ver vínculos familiares' }
    ].filter(Boolean) }],
    mentions: [person.jid, partner.jid].filter(Boolean)
  })
}

async function sendFamilyPanel({ sock, msg, settings, logger, names, number }) {
  const person = userOf(number, names)
  const family = getFamily(number)
  const mentions = [person.jid].filter(Boolean)
  const parents = family.parents.map(row => {
    const user = userOf(row.parent, names)
    if (user.jid) mentions.push(user.jid)
    return formatMentionName(user)
  })
  const children = family.children.map(row => {
    const user = userOf(row.child, names)
    if (user.jid) mentions.push(user.jid)
    return formatMentionName(user)
  })
  const body = [
    `Pessoa: ${formatMentionName(person)}`,
    `Pais/mães adotivos: ${parents.length ? parents.join(', ') : 'nenhum'}`,
    `Filhos(as) adotivos: ${children.length ? children.join(', ') : 'nenhum'}`,
    `Vínculos ativos: ${parents.length + children.length}`
  ].join('\n')
  return sendNativeList({
    sock, jid: msg.key.remoteJid, quoted: msg, logger, kind: 'family-panel',
    body: formatMessage(body, { title: 'FAMÍLIA', icon: '🌸' }),
    buttonText: '🌸 Opções',
    sections: [{ title: 'Família', rows: [
      { id: `${settings.prefix}adotar`, title: '🌸 Pedir adoção', description: 'Marque a pessoa que deseja adotar' },
      { id: `${settings.prefix}removerfamilia`, title: '💮 Remover vínculo', description: 'Marque o familiar quando houver mais de um' },
      { id: `${settings.prefix}relacionamento`, title: '🌸 Relacionamento', description: 'Consultar namoro ou casamento' }
    ] }],
    mentions: [...new Set(mentions)]
  })
}

function decisionError(result) {
  const labels = {
    'not-found': 'Pedido pendente não encontrado ou já expirado.',
    target: 'Somente a pessoa convidada pode responder.',
    chat: 'O pedido precisa ser respondido no grupo em que foi criado.',
    relationship: 'O estado atual do relacionamento não permite concluir esse pedido.',
    duplicate: 'Esse vínculo já existe.',
    cycle: 'A adoção criaria um ciclo familiar inválido.'
  }
  return labels[result?.reason] || 'Não foi possível concluir o pedido.'
}

export default defineCommand({
  name: 'relacionamento',
  aliases: [
    'relacao', 'namorar', 'pedirnamoro', 'aceitarnamoro', 'recusarnamoro', 'terminar',
    'casar', 'pedircasamento', 'aceitarcasamento', 'recusarcasamento', 'divorciar',
    'adotar', 'pediradocao', 'aceitaradocao', 'recusaradocao', 'familia', 'removerfamilia', 'desadotar',
    'aceitar', 'recusar', 'cancelarpedido', 'pedidossociais', 'historicosocial'
  ],
  menuEntries: [
    { name: 'relacionamento', usage: '.relacionamento', description: 'Consulta namoro ou casamento.', menuGroup: 'Social' },
    { name: 'namorar', usage: '.namorar @pessoa', description: 'Envia um pedido de namoro.', menuGroup: 'Social', menuModelOnly: true },
    { name: 'casar', usage: '.casar @pessoa', description: 'Pede o namoro atual em casamento.', menuGroup: 'Social', menuModelOnly: true },
    { name: 'familia', usage: '.familia', description: 'Mostra pais e filhos adotivos.', menuGroup: 'Família' },
    { name: 'adotar', usage: '.adotar @pessoa', description: 'Envia um pedido de adoção.', menuGroup: 'Família', menuModelOnly: true }
  ],
  category: 'Grupo',
  usage: '.relacionamento | .namorar @pessoa | .familia',
  groupOnly: true,
  async execute({ sock, msg, args, text, invokedAs, settings, senderNumber, metadata, logger }) {
    const command = usedCommand(invokedAs, text, settings.prefix)
    const names = await namesFor(sock, msg, metadata)
    const chat = msg.key.remoteJid

    try {
      const requestType = requestTypeForCommand(command)
      if (requestType) {
        const target = await resolveTarget({ sock, msg, args })
        if (!target.number) {
          return sendSocialTargetModel({ sock, msg, settings, logger, command, type: requestType })
        }
        if (!memberExists(target.number, names)) {
          return sendSocialTargetModel({
            sock, msg, settings, logger, command, type: requestType,
            note: 'A pessoa escolhida não foi encontrada entre os participantes deste grupo.'
          })
        }
        if (target.number === String(settings.botNumber || '').replace(/\D/g, '')) {
          return sendSocialTargetModel({
            sock, msg, settings, logger, command, type: requestType,
            note: 'O menu foi enviado pela Sakura, mas o vínculo deve ser direcionado a outra pessoa.'
          })
        }
        const row = createSocialRequest({ type: requestType, chat, requester: senderNumber, target: target.number })
        return sendRequest({ sock, msg, settings, logger, names, row })
      }

      if (['aceitar', 'recusar', 'aceitarnamoro', 'recusarnamoro', 'aceitarcasamento', 'recusarcasamento', 'aceitaradocao', 'recusaradocao'].includes(command)) {
        const decision = command.startsWith('recusar') || command === 'recusar' ? 'rejected' : 'accepted'
        const generic = command === 'aceitar' || command === 'recusar'
        const type = generic ? typeFromWord(args[0]) : decisionTypeForCommand(command)
        const id = String(args[generic && type ? 1 : 0] || '').toUpperCase()
        const result = resolveSocialRequest({ id, type, actor: senderNumber, chat, decision })
        if (!result.ok) return reply(sock, msg, decisionError(result), { title: 'PEDIDO SOCIAL' })
        const from = userOf(result.request.requester, names)
        const target = userOf(result.request.target, names)
        const info = TYPE_INFO[result.request.type]
        const action = decision === 'accepted' ? `${info.noun} confirmado` : `${info.noun} recusado`
        return reply(sock, msg, `${info.emoji} *${action}.*\n${formatMentionName(target)} ${decision === 'accepted' ? 'aceitou' : 'recusou'} o pedido de ${formatMentionName(from)}.`, {
          title: 'PEDIDO SOCIAL',
          mentions: [from.jid, target.jid].filter(Boolean)
        })
      }

      if (command === 'cancelarpedido') {
        const result = cancelSocialRequest({ id: args[0], actor: senderNumber, chat })
        if (!result.ok) return reply(sock, msg, result.reason === 'requester' ? 'Somente quem enviou pode cancelar esse pedido.' : 'Pedido pendente não encontrado.', { title: 'PEDIDO SOCIAL' })
        return reply(sock, msg, `Pedido *${result.request.id}* cancelado sem criar vínculo.`, { title: 'PEDIDO SOCIAL' })
      }

      if (command === 'terminar' || command === 'divorciar') {
        const expectedStatus = command === 'divorciar' ? 'married' : 'dating'
        const result = endRelationship({ actor: senderNumber, expectedStatus, chat })
        if (!result.ok) {
          if (result.reason === 'status') return reply(sock, msg, result.relationship?.status === 'married' ? `Você está casado(a). Use *${settings.prefix}divorciar*.` : `Você está namorando. Use *${settings.prefix}terminar*.`)
          return reply(sock, msg, 'Você não possui esse relacionamento ativo.')
        }
        const partner = userOf(result.relationship.partner, names)
        return reply(sock, msg, `${command === 'divorciar' ? '🌸 Divórcio' : '🌸 Término'} registrado com ${formatMentionName(partner)}. O histórico foi preservado.`, {
          title: command === 'divorciar' ? 'DIVÓRCIO' : 'TÉRMINO',
          mentions: partner.jid ? [partner.jid] : []
        })
      }

      if (command === 'removerfamilia' || command === 'desadotar') {
        const target = await resolveTarget({ sock, msg, args })
        const result = removeFamilyLink({ actor: senderNumber, target: target.number, chat })
        if (!result.ok) {
          if (result.reason === 'ambiguous') return reply(sock, msg, `Você possui mais de um vínculo. Use *${settings.prefix}removerfamilia @pessoa*.`)
          return reply(sock, msg, 'Nenhum vínculo familiar correspondente foi encontrado.')
        }
        const other = result.link.parent === senderNumber ? result.link.child : result.link.parent
        const user = userOf(other, names)
        return reply(sock, msg, `Vínculo familiar com ${formatMentionName(user)} removido.`, { title: 'FAMÍLIA', mentions: user.jid ? [user.jid] : [] })
      }

      if (command === 'pedidossociais') {
        const pending = findPendingRequest({ target: senderNumber, chat })
        if (!pending) return reply(sock, msg, 'Você não possui pedidos sociais pendentes neste grupo.', { title: 'PEDIDOS SOCIAIS' })
        const info = TYPE_INFO[pending.type]
        const from = userOf(pending.requester, names)
        return sendNativeList({
          sock, jid: chat, quoted: msg, logger, kind: 'pending-social-request',
          body: formatMessage(`${formatMentionName(from)} enviou um ${info.request}.\nCódigo: *${pending.id}*`, { title: 'PEDIDO PENDENTE', icon: info.emoji }),
          buttonText: `${info.emoji} Responder`,
          sections: [{ title: 'Resposta', rows: [
            { id: `${settings.prefix}${info.accept} ${pending.id}`, title: `${info.emoji} Aceitar`, description: `Confirmar ${info.noun}` },
            { id: `${settings.prefix}${info.reject} ${pending.id}`, title: '💮 Recusar', description: 'Não criar vínculo' }
          ] }],
          mentions: from.jid ? [from.jid] : []
        })
      }

      if (command === 'historicosocial') {
        const target = await resolveTarget({ sock, msg, args, fallbackNumber: senderNumber })
        const rows = listSocialHistory(target.number, 12)
        if (!rows.length) return reply(sock, msg, 'Ainda não há histórico social para essa pessoa.', { title: 'HISTÓRICO SOCIAL' })
        const mentions = []
        const body = rows.map((row, index) => {
          const otherNumber = row.actor === target.number ? row.target : row.actor
          const other = userOf(otherNumber, names)
          if (other.jid) mentions.push(other.jid)
          const when = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Recife' }).format(new Date(row.createdAt))
          return `${index + 1}. ${historyLabel(row.eventType)}${otherNumber ? ` • ${formatMentionName(other)}` : ''}\n   ${when}`
        }).join('\n')
        return reply(sock, msg, body, { title: 'HISTÓRICO SOCIAL', mentions: [...new Set(mentions)] })
      }

      if (command === 'familia') {
        const target = await resolveTarget({ sock, msg, args, fallbackNumber: senderNumber })
        return sendFamilyPanel({ sock, msg, settings, logger, names, number: target.number })
      }

      const target = await resolveTarget({ sock, msg, args, fallbackNumber: senderNumber })
      return sendRelationshipPanel({ sock, msg, settings, logger, names, number: target.number })
    } catch (error) {
      if (error instanceof TypeError) return reply(sock, msg, error.message, { title: 'SISTEMA SOCIAL' })
      throw error
    }
  }
})
