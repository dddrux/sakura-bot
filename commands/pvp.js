import { defineCommand } from '../data/workstation.js'
import {
  acceptPvpChallenge,
  beginPvpChallenge,
  cancelPvpChallenge,
  getPvpStatus,
  rejectPvpChallenge
} from '../data/economy.js'
import { duration, money } from '../data/economy-ui.js'
import { formatMessage } from '../data/formatter.js'
import { sendNativeList } from '../data/interactive.js'
import { getContextInfo } from '../data/messages.js'
import { firstTargetJid, firstTargetNumber } from '../data/targets.js'
import { reply } from '../data/reply.js'
import { displayUser, formatMentionName, groupNameMap } from '../data/user-display.js'

const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
const digits = value => String(value || '').split('@')[0].split(':')[0].replace(/\D/g, '')
const percent = value => `${Math.round((Number(value) || 0) * 100)}%`
const signed = value => `${Number(value) >= 0 ? '+' : ''}${Math.trunc(Number(value) || 0)}`

async function resolveTarget(sock, msg, args = []) {
  const context = getContextInfo(msg.message)
  let jid = firstTargetJid(msg, args)
  let number = digits(jid || args.find(value => /\d/.test(value)))
  if (jid && String(jid).includes('@lid') && typeof sock.sakuraResolveNumber === 'function') {
    try { number = digits(await sock.sakuraResolveNumber(jid)) || number } catch {}
  }
  if (!jid && number) jid = `${number}@s.whatsapp.net`
  return { jid, number }
}

function participantHasNumber(metadata, number, jid = '') {
  const target = digits(number)
  const exact = String(jid || '')
  if (!target && !exact) return false
  return (metadata?.participants || []).some(item => [item.id, item.phoneNumber, item.lid].some(value => String(value || '') === exact || (target && digits(value) === target)))
}

function arenaSections(prefix) {
  return [
    {
      title: '🌸 Arena',
      rows: [
        { id: `${prefix}pvp atributos`, title: '🌸 Meus atributos', description: 'Vida, ataque, defesa e chances' },
        { id: `${prefix}pvp historico`, title: '🌸 Meu histórico', description: 'Últimas batalhas e pontuação' },
        { id: `${prefix}rankarena`, title: '🌸 Pontuação de arena', description: 'Melhores ratings do PVP' },
        { id: `${prefix}rankpvp`, title: '🌸 Mais vitórias', description: 'Classificação por vitórias' },
        { id: `${prefix}rankdano`, title: '💮 Mais dano', description: 'Dano acumulado na arena' },
        { id: `${prefix}ranksequencia`, title: '🌸 Maiores sequências', description: 'Melhores sequências de vitórias' }
      ]
    },
    {
      title: '🌸 Ajuda',
      rows: [
        { id: `${prefix}pvp regras`, title: '🌸 Regras da arena', description: 'Rodadas, recompensas e anti-farm' },
        { id: `${prefix}eco`, title: '💮 Economia', description: 'Voltar ao Jardim de Sakura Coins' }
      ]
    }
  ]
}

async function arenaPanel({ sock, msg, senderNumber, chatNumber, settings, logger }) {
  const status = await getPvpStatus(senderNumber, chatNumber)
  const pvp = status.pvp
  const winRate = pvp.battles ? Math.round((pvp.wins / pvp.battles) * 100) : 0
  const pendingLine = status.pending
    ? `💮 *desafio pendente:* ${status.pending.from === senderNumber ? 'enviado' : 'recebido'} • ID ${status.pending.id} • ${duration(status.pending.expiresAt - Date.now())}`
    : '💮 *desafio pendente:* nenhum'
  return sendNativeList({
    sock,
    jid: msg.key.remoteJid,
    quoted: msg,
    logger,
    kind: 'pvp-panel-v2',
    body: formatMessage([
      `🌸 *rating:* ${pvp.rating} • recorde ${pvp.bestRating}`,
      `🌸 *nível de arena:* ${pvp.arenaLevel} • ${pvp.pvpXp} XP PVP`,
      `🌸 *batalhas:* ${pvp.battles} • ${pvp.wins}V/${pvp.losses}D/${pvp.draws}E • ${winRate}%`,
      `🌸 *sequência:* ${pvp.currentStreak} • melhor ${pvp.bestStreak}`,
      `🌸 *vida:* ${status.stats.hp} • 🌸 ataque ${status.stats.attack} • 🌸 defesa ${status.stats.defense}`,
      `💮 *agilidade:* ${status.stats.agility} • crítico ${percent(status.stats.criticalChance)} • esquiva ${percent(status.stats.dodgeChance)}`,
      `💮 *dano causado:* ${pvp.damageDealt} • maior golpe ${pvp.maxHit}`,
      `🌸 *recompensas:* ${money(pvp.totalPetals)} • ${pvp.totalGold} ouro • ${pvp.itemsWon} itens`,
      status.left > 0 ? `💮 *nova batalha em:* ${duration(status.left)}` : '💮 *arena:* disponível',
      pendingLine,
      `🌸 Desafie alguém com *${settings.prefix}pvp @pessoa*.`
    ].join('\n'), { title: 'ARENA SAKURA', icon: '🌸' }),
    buttonText: '🌸 Abrir arena',
    sections: arenaSections(settings.prefix)
  })
}

function combatLog(result, fromUser, toUser) {
  const events = Array.isArray(result?.combat?.events) ? result.combat.events : []
  const grouped = new Map()
  for (const event of events) {
    const list = grouped.get(event.round) || []
    list.push(event)
    grouped.set(event.round, list)
  }
  return [...grouped.entries()].slice(0, 5).map(([round, list]) => {
    const actions = list.map(event => {
      const attacker = event.attacker === 'from' ? fromUser : toUser
      const defender = event.defender === 'from' ? fromUser : toUser
      if (event.dodged) return `${formatMentionName(defender)} desviou de ${formatMentionName(attacker)}`
      return `${formatMentionName(attacker)} causou ${event.damage}${event.critical ? ' CRÍTICO' : ''}`
    })
    return `*R${round}:* ${actions.join(' • ')}`
  })
}

function attributesBody(status) {
  const { pvp, stats, power } = status
  return [
    `🌸 *vida máxima:* ${stats.hp}`,
    `🌸 *ataque:* ${stats.attack}`,
    `🌸 *defesa:* ${stats.defense}`,
    `💮 *agilidade:* ${stats.agility}`,
    `💮 *chance de crítico:* ${percent(stats.criticalChance)}`,
    `🌸 *chance de esquiva:* ${percent(stats.dodgeChance)}`,
    `🌸 *poder estimado:* ${power}`,
    `🌸 *rating:* ${pvp.rating}`,
    `🌸 *nível de arena:* ${pvp.arenaLevel} (${pvp.pvpXp} XP)`,
    '',
    'Os atributos usam nível da conta, picareta, pet ativo, casa e progresso na arena. Nenhum item é consumido durante a batalha.'
  ].join('\n')
}

export default defineCommand({
  name: 'pvp',
  aliases: ['arena', 'duelo', 'desafiar', 'batalhar', 'pvphistorico', 'pvpatributos', 'pvpregras'],
  menuEntries: [
    { name: 'pvp', usage: '.pvp @pessoa', description: 'Desafia outra pessoa para uma batalha em rodadas.', menuGroup: 'Arena' },
    { name: 'pvpatributos', usage: '.pvp atributos', description: 'Mostra seus atributos de combate.', menuGroup: 'Arena' },
    { name: 'pvphistorico', usage: '.pvp historico', description: 'Mostra suas últimas batalhas detalhadas.', menuGroup: 'Arena' },
    { name: 'pvpregras', usage: '.pvp regras', description: 'Explica as regras e proteções da arena.', menuGroup: 'Arena' }
  ],
  category: 'Economia',
  groupOnly: true,
  needsMetadata: true,
  usage: '.pvp @pessoa',
  description: 'Arena PVP em rodadas com rating, XP, dano, histórico, cooldown e anti-farm.',

  async execute({ sock, msg, args, senderNumber, chatNumber, settings, logger, metadata, invokedAs }) {
    const invoked = normalize(invokedAs)
    let action = normalize(args[0])
    if (!action && ['pvphistorico', 'pvh'].includes(invoked)) action = 'historico'
    if (!action && ['pvpatributos', 'pva'].includes(invoked)) action = 'atributos'
    if (!action && ['pvpregras', 'pvr'].includes(invoked)) action = 'regras'
    const names = await groupNameMap(sock, msg.key.remoteJid, metadata).catch(() => new Map())

    if (!action || ['status', 'painel', 'arena'].includes(action)) {
      return arenaPanel({ sock, msg, senderNumber, chatNumber, settings, logger })
    }

    if (['atributos', 'atributo', 'stats', 'statuspvp'].includes(action)) {
      const status = await getPvpStatus(senderNumber, chatNumber)
      return sendNativeList({
        sock, jid: msg.key.remoteJid, quoted: msg, logger, kind: 'pvp-attributes',
        body: formatMessage(attributesBody(status), { title: 'ATRIBUTOS PVP', icon: '🌸' }),
        buttonText: '🌸 Abrir arena', sections: arenaSections(settings.prefix)
      })
    }

    if (['regras', 'regra', 'ajuda', 'help'].includes(action)) {
      return sendNativeList({
        sock, jid: msg.key.remoteJid, quoted: msg, logger, kind: 'pvp-rules',
        body: formatMessage([
          '• O desafio expira em 2 minutos e só o alvo pode aceitar.',
          '• A luta possui até 5 rodadas, com vida, ataque, defesa, críticos e esquivas.',
          '• Existe cooldown de 10 minutos para os dois participantes.',
          '• Rating e XP PVP são atualizados depois de cada batalha.',
          '• Repetir o mesmo adversário em 6 horas reduz e depois bloqueia recompensas e rating.',
          '• Há limite de 8 vitórias recompensadas por dia.',
          '• A pessoa que criou o convite pode cancelá-lo antes do aceite.',
          '• A batalha é resolvida de forma atômica; reinícios não duplicam prêmio nem resultado.'
        ].join('\n'), { title: 'REGRAS DA ARENA', icon: '🌸' }),
        buttonText: '🌸 Abrir arena', sections: arenaSections(settings.prefix)
      })
    }

    if (['historico', 'histórico', 'history'].includes(action)) {
      const status = await getPvpStatus(senderNumber, chatNumber)
      const rows = status.pvp.history.slice(0, 12)
      if (!rows.length) return reply(sock, msg, '🌸 Você ainda não possui batalhas registradas.', { title: 'HISTÓRICO PVP' })
      const mentions = []
      const body = rows.map((entry, index) => {
        const user = displayUser(entry.opponent, names)
        if (user.jid) mentions.push(user.jid)
        const result = entry.result === 'win' ? '🌸 vitória' : entry.result === 'loss' ? '💮 derrota' : '🌸 empate'
        const reward = entry.petals || entry.gold ? ` • +${money(entry.petals)} • +${entry.gold} ouro` : ''
        const rating = Number.isFinite(Number(entry.ratingDelta)) ? ` • rating ${signed(entry.ratingDelta)}` : ''
        const damage = entry.damage ? ` • ${entry.damage} dano` : ''
        return `${index + 1}. ${result} contra *${formatMentionName(user)}*${rating}${damage}${reward}`
      }).join('\n')
      return sendNativeList({
        sock, jid: msg.key.remoteJid, quoted: msg, logger, kind: 'pvp-history-v2',
        body: formatMessage(body, { title: 'HISTÓRICO PVP', icon: '🌸' }),
        buttonText: '🌸 Abrir arena', mentions: [...new Set(mentions)], sections: arenaSections(settings.prefix)
      })
    }

    if (['aceitar', 'accept', 'sim'].includes(action)) {
      const id = String(args[1] || '')
      const result = await acceptPvpChallenge(id, senderNumber, chatNumber)
      if (!result.ok && result.reason === 'cooldown') return reply(sock, msg, `💮 A batalha não começou porque ainda existe cooldown de *${duration(result.left)}*.`)
      if (!result.ok) return reply(sock, msg, '💮 Esse desafio expirou ou não pertence a você.')
      const fromUser = displayUser(result.challenge.from, names)
      const toUser = displayUser(result.challenge.to, names)
      const mentions = [fromUser.jid, toUser.jid].filter(Boolean)
      const rounds = combatLog(result, fromUser, toUser)
      let body
      if (result.result === 'draw') {
        body = [
          `🌸 *empate entre ${formatMentionName(fromUser)} e ${formatMentionName(toUser)}*`,
          `🌸 *vida final:* ${result.combat.from.hp} × ${result.combat.to.hp}`,
          `💮 *dano:* ${result.combat.from.damage} × ${result.combat.to.damage}`,
          `🌸 *rating:* ${signed(result.ratingDeltaFrom)} / ${signed(result.ratingDeltaTo)}`,
          ...rounds,
          '💮 Os dois receberam experiência PVP, mas nenhuma recompensa financeira.'
        ].join('\n')
      } else {
        const winner = displayUser(result.winner, names)
        const loser = displayUser(result.loser, names)
        const winnerIsFrom = result.winner === result.challenge.from
        const winnerDelta = winnerIsFrom ? result.ratingDeltaFrom : result.ratingDeltaTo
        const winnerRating = winnerIsFrom ? result.ratingFrom : result.ratingTo
        const farmLine = result.rewardMultiplier === 0
          ? '🌸 *anti-farm:* sem recompensa por repetição ou limite diário.'
          : result.rewardMultiplier < 1
            ? '🌸 *anti-farm:* recompensa reduzida por revanche recente.'
            : '💮 *recompensa integral liberada.*'
        body = [
          `🌸 *vencedor:* ${formatMentionName(winner)}`,
          `💮 *adversário:* ${formatMentionName(loser)}`,
          `🌸 *vida final:* ${result.combat.from.hp} × ${result.combat.to.hp}`,
          `💮 *dano:* ${result.combat.from.damage} × ${result.combat.to.damage}`,
          `🌸 *rating do vencedor:* ${winnerRating} (${signed(winnerDelta)})`,
          `💮 *Sakura Coins:* +${money(result.petals)}`,
          `💮 *ouro:* +${result.gold}`,
          result.item ? `🌸 *item:* ${result.item.icon} ${result.item.name}` : '',
          ...rounds,
          farmLine
        ].filter(Boolean).join('\n')
      }
      return sendNativeList({
        sock, jid: msg.key.remoteJid, quoted: msg, logger, kind: 'pvp-result-v2',
        body: formatMessage(body, { title: 'RESULTADO DA BATALHA', icon: '🌸' }),
        buttonText: '🌸 Continuar', mentions: [...new Set(mentions)], sections: arenaSections(settings.prefix)
      })
    }

    if (['recusar', 'reject', 'nao', 'não'].includes(action)) {
      const result = await rejectPvpChallenge(String(args[1] || ''), senderNumber, chatNumber)
      return reply(sock, msg, result.ok ? '💮 Desafio recusado. Nenhuma estatística foi alterada.' : '💮 Esse desafio expirou ou não pertence a você.')
    }

    if (['cancelar', 'cancel', 'desistir'].includes(action)) {
      const result = await cancelPvpChallenge(String(args[1] || ''), senderNumber, chatNumber)
      if (!result.ok && result.reason === 'owner') return reply(sock, msg, '💮 Somente quem criou o desafio pode cancelá-lo.')
      return reply(sock, msg, result.ok ? '💮 Desafio cancelado antes da batalha. Nenhuma penalidade foi aplicada.' : '💮 Esse desafio já expirou ou não existe.')
    }

    const target = await resolveTarget(sock, msg, args)
    if (!target.number) return reply(sock, msg, `💮 Use *${settings.prefix}pvp @pessoa*.`)
    if (target.number === senderNumber) return reply(sock, msg, '💮 Você não pode desafiar a própria conta.')
    const botNumber = digits(settings.botNumber || sock.user?.id)
    if (target.number === botNumber) return reply(sock, msg, '💮 A Sakura organiza a arena, mas não participa das batalhas.')
    if (!participantHasNumber(metadata, target.number, target.jid)) return reply(sock, msg, '💮 A pessoa precisa estar neste mesmo grupo para receber o desafio.')

    const result = await beginPvpChallenge(senderNumber, target.number, chatNumber)
    if (!result.ok && result.reason === 'busy') return reply(sock, msg, '💮 Uma das pessoas já possui outro desafio pendente.')
    if (!result.ok && result.reason === 'cooldown') return reply(sock, msg, `💮 Sua arena reabre em *${duration(result.left)}*.`)
    if (!result.ok) return reply(sock, msg, '💮 Não foi possível criar esse desafio.')

    const challenger = displayUser(senderNumber, names)
    const challenged = displayUser(target.number, names)
    const mentions = [challenger.jid, challenged.jid].filter(Boolean)
    return sendNativeList({
      sock, jid: msg.key.remoteJid, quoted: msg, logger, kind: 'pvp-challenge-v2',
      body: formatMessage([
        `🌸 *${formatMentionName(challenger)} desafiou ${formatMentionName(challenged)}*`,
        `🌸 *rating:* ${result.sourceStats.rating} × ${result.targetStats.rating}`,
        `🌸 *nível de arena:* ${result.sourceStats.arenaLevel} × ${result.targetStats.arenaLevel}`,
        `🌸 *vida:* ${result.sourceStats.hp} × ${result.targetStats.hp}`,
        `🌸 *poder estimado:* ${result.sourcePower} × ${result.targetPower}`,
        '💮 O convite expira em 2 minutos.',
        '🌸 Repetições contra a mesma pessoa reduzem recompensas e rating.',
        '🌸 Somente a pessoa desafiada pode aceitar ou recusar.'
      ].join('\n'), { title: 'DESAFIO PVP', icon: '🌸' }),
      buttonText: '🌸 Responder desafio', mentions: [...new Set(mentions)],
      sections: [{ title: '🌸 Resposta', rows: [
        { id: `${settings.prefix}pvp aceitar ${result.id}`, title: '🌸 Aceitar batalha', description: 'Iniciar o confronto em até 5 rodadas' },
        { id: `${settings.prefix}pvp recusar ${result.id}`, title: '💮 Recusar', description: 'Encerrar sem penalidade' },
        { id: `${settings.prefix}pvp cancelar ${result.id}`, title: '🌸 Cancelar convite', description: 'Disponível somente para o desafiante' }
      ] }]
    })
  }
})
