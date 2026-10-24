import { defineCommand } from '../data/workstation.js'
import { activityRanking, economyRanking, goldRanking, miningRanking, pickaxeRanking, pvpRanking, rankDefinitions, stablePercent } from '../data/economy.js'
import { houseRanking, investmentRanking, petRanking, sellerRanking, shopRanking } from '../data/economy-part3.js'
import { actionRanking, coupleRanking, familyRanking } from '../data/social-store.js'
import { groupNameMap, displayUser, formatMentionName } from '../data/user-display.js'
import { reply } from '../data/reply.js'
import { sendNativeList } from '../data/interactive.js'
import { formatMessage } from '../data/formatter.js'
import { formatRankingBody } from '../data/ranking-format.js'

const aliases = ['rankativo','rankativos','topativo','rankinativo','rankinativos','topinativo','rankdinheiro','rankpetalas','rankmoney','rankpobres','rankpobre','rankgay','topgay','rankgado','topgado','rankcorno','rankcornos','topcorno','rankmaislindos','ranklindos','ranklindo','rankfeios','rankfeio','rankinteligente','rankinteligentes','rankouro','topouro','rankmineracao','rankmineradores','rankpicareta','rankpicaretas','rankpvp','rankbatalha','ranksequencia','rankstreak','rankarena','rankrating','rankdano','rankdanopvp','rankinvestidores','rankinvestimento','rankvendedores','ranklojas','rankpets','rankcolecionadores','rankcasas','rankcasais','topcasais','rankfamilias','topfamilias','rankacoes','topacoes']
const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()

function navigation(prefix) {
  return [{
    title: '🌸 Escolha outro ranking',
    rows: [
      { id: `${prefix}rkd`, title: '🌸 Mais Sakura Coins', description: 'Ranking econômico principal' },
      { id: `${prefix}rkp`, title: '💮 Menores fortunas', description: 'Ranking dos pobres' },
      { id: `${prefix}rka`, title: '🌸 Mais ativos', description: 'Mensagens no grupo' },
      { id: `${prefix}rki`, title: '💮 Menos ativos', description: 'Membros mais quietos' },
      { id: `${prefix}rkg`, title: '🌸 Rank gay', description: 'Ranking divertido estável' },
      { id: `${prefix}rgg`, title: '🌸 Rank gado', description: 'Ranking divertido estável' },
      { id: `${prefix}rkc`, title: '🌸 Rank corno', description: 'Ranking divertido estável' },
      { id: `${prefix}rkl`, title: '🌸 Mais lindos', description: 'Ranking divertido estável' },
      { id: `${prefix}rkf`, title: '🌸 Mais feios', description: 'Ranking divertido estável' },
      { id: `${prefix}rkn`, title: '🌸 Mais inteligentes', description: 'Ranking divertido estável' }
    ]
  }, {
    title: '🌸 Economia avançada',
    rows: [
      { id: `${prefix}rankinvestidores`, title: '🌸 Maiores investidores', description: 'Volume total investido' },
      { id: `${prefix}rankvendedores`, title: '🌸 Maiores vendedores', description: 'Volume negociado entre membros' },
      { id: `${prefix}ranklojas`, title: '🌸 Melhores lojas', description: 'Receita das lojas próprias' },
      { id: `${prefix}rankpets`, title: '🌸 Colecionadores de pets', description: 'Quantidade e níveis dos pets' },
      { id: `${prefix}rankcasas`, title: '🌸 Melhores casas', description: 'Nível da moradia e descansos' }
    ]
  }, {
    title: '🌸 Mineração e PVP',
    rows: [
      { id: `${prefix}rankouro`, title: '💮 Mais ouro', description: 'Saldo de ouro atual' },
      { id: `${prefix}rankmineracao`, title: '💮 Mais mineração', description: 'Ouro total extraído' },
      { id: `${prefix}rankpicareta`, title: '🌸 Melhores picaretas', description: 'Nível da picareta' },
      { id: `${prefix}rankpvp`, title: '🌸 Mais vitórias PVP', description: 'Ranking da arena' },
      { id: `${prefix}rankarena`, title: '🌸 Melhor rating', description: 'Pontuação competitiva da arena' },
      { id: `${prefix}rankdano`, title: '💮 Mais dano PVP', description: 'Dano total causado em batalhas' },
      { id: `${prefix}ranksequencia`, title: '🌸 Maiores sequências', description: 'Melhores sequências PVP' }
    ]
  }, {
    title: '🌸 Social e família',
    rows: [
      { id: `${prefix}rankcasais`, title: '🌸 Casais mais antigos', description: 'Namoros e casamentos ativos' },
      { id: `${prefix}rankfamilias`, title: '🌸 Maiores famílias', description: 'Quantidade de vínculos familiares' },
      { id: `${prefix}rankacoes`, title: '🌸 Mais carinhosos', description: 'Ações sociais realizadas no grupo' }
    ]
  }, {
    title: '💮 Navegação',
    rows: [
      { id: `${prefix}m rk`, title: '🌸 Menu de rankings', description: 'Todos os comandos da categoria' },
      { id: `${prefix}m`, title: '💮 Menu principal', description: 'Voltar às categorias' }
    ]
  }]
}

export default defineCommand({
  name: 'rankdinheiro',
  aliases: ['ranks', ...aliases.filter(value => value !== 'rankdinheiro')],
  menuEntries: [
    { name: 'ranks', usage: '.ranks', description: 'Abre o catálogo de rankings.', menuGroup: 'Economia' },
    { name: 'rankdinheiro', usage: '.rankdinheiro', description: 'Mostra quem possui mais Sakura Coins.', menuGroup: 'Economia' },
    { name: 'rankpobres', usage: '.rankpobres', description: 'Mostra as menores fortunas.', menuGroup: 'Economia' },
    { name: 'rankouro', usage: '.rankouro', description: 'Mostra quem possui mais ouro.', menuGroup: 'Mineração' },
    { name: 'rankmineracao', usage: '.rankmineracao', description: 'Mostra quem mais extraiu ouro.', menuGroup: 'Mineração' },
    { name: 'rankpicareta', usage: '.rankpicareta', description: 'Mostra as melhores picaretas.', menuGroup: 'Mineração' },
    { name: 'rankpvp', usage: '.rankpvp', description: 'Mostra quem venceu mais batalhas.', menuGroup: 'PVP' },
    { name: 'rankarena', usage: '.rankarena', description: 'Mostra as maiores pontuações da arena.', menuGroup: 'PVP' },
    { name: 'rankdano', usage: '.rankdano', description: 'Mostra quem causou mais dano em PVP.', menuGroup: 'PVP' },
    { name: 'ranksequencia', usage: '.ranksequencia', description: 'Mostra as maiores sequências PVP.', menuGroup: 'PVP' },
    { name: 'rankinvestidores', usage: '.rankinvestidores', description: 'Mostra quem mais investiu Sakura Coins.', menuGroup: 'Economia avançada' },
    { name: 'rankvendedores', usage: '.rankvendedores', description: 'Mostra maiores vendedores entre membros.', menuGroup: 'Economia avançada' },
    { name: 'ranklojas', usage: '.ranklojas', description: 'Mostra as lojas com maior receita.', menuGroup: 'Economia avançada' },
    { name: 'rankpets', usage: '.rankpets', description: 'Mostra os maiores colecionadores de pets.', menuGroup: 'Economia avançada' },
    { name: 'rankcasas', usage: '.rankcasas', description: 'Mostra as melhores moradias.', menuGroup: 'Economia avançada' },
    { name: 'rankcasais', usage: '.rankcasais', description: 'Mostra casais ativos há mais tempo.', menuGroup: 'Social' },
    { name: 'rankfamilias', usage: '.rankfamilias', description: 'Mostra quem possui mais vínculos familiares.', menuGroup: 'Social' },
    { name: 'rankacoes', usage: '.rankacoes', description: 'Mostra quem mais usa ações sociais.', menuGroup: 'Social' },
    { name: 'rankativo', usage: '.rankativo', description: 'Mostra os membros mais ativos.', menuGroup: 'Atividade' },
    { name: 'rankinativo', usage: '.rankinativo', description: 'Mostra os membros menos ativos.', menuGroup: 'Atividade' },
    { name: 'rankgay', usage: '.rankgay', description: 'Ranking divertido e estável do grupo.', menuGroup: 'Diversão' },
    { name: 'rankgado', usage: '.rankgado', description: 'Ranking divertido e estável do grupo.', menuGroup: 'Diversão' },
    { name: 'rankcorno', usage: '.rankcorno', description: 'Ranking divertido e estável do grupo.', menuGroup: 'Diversão' },
    { name: 'rankmaislindos', usage: '.rankmaislindos', description: 'Ranking divertido e estável do grupo.', menuGroup: 'Diversão' },
    { name: 'rankfeios', usage: '.rankfeios', description: 'Ranking divertido e estável do grupo.', menuGroup: 'Diversão' },
    { name: 'rankinteligente', usage: '.rankinteligente', description: 'Ranking divertido e estável do grupo.', menuGroup: 'Diversão' }
  ],
  category: 'Ranks',
  usage: '.rankdinheiro',
  async execute({ sock, msg, text, settings, chatNumber, logger }) {
    const invoked = normalize(text.slice(settings.prefix.length).trim().split(/\s+/, 1)[0])
    const canonical = ({ topgay:'rankgay', topgado:'rankgado', rankcornos:'rankcorno', topcorno:'rankcorno', ranklindos:'rankmaislindos', ranklindo:'rankmaislindos', rankfeio:'rankfeios', rankinteligentes:'rankinteligente', rankpetalas:'rankdinheiro', rankmoney:'rankdinheiro', rankativos:'rankativo', topativo:'rankativo', rankinativos:'rankinativo', topinativo:'rankinativo', topouro:'rankouro', rankmineradores:'rankmineracao', rankpicaretas:'rankpicareta', rankbatalha:'rankpvp', rankstreak:'ranksequencia', rankrating:'rankarena', rankdanopvp:'rankdano', rankinvestimento:'rankinvestidores', rankcolecionadores:'rankpets', topcasais:'rankcasais', topfamilias:'rankfamilias', topacoes:'rankacoes' })[invoked] || invoked
    const sections = navigation(settings.prefix)

    if (canonical === 'ranks') {
      return sendNativeList({ sock, jid: msg.key.remoteJid, quoted: msg, logger, kind: 'ranks-hub', body: formatMessage('Escolha um ranking no catálogo.', { title: 'RANKINGS', icon: '🌸' }), sections, buttonText: '🌸 Abrir rankings' })
    }

    const isGroup = String(msg.key.remoteJid || '').endsWith('@g.us')
    const metadata = isGroup ? await sock.groupMetadata(msg.key.remoteJid).catch(() => ({ participants: [] })) : { participants: [] }
    const names = await groupNameMap(sock, msg.key.remoteJid, metadata)
    let title = ''
    let rows = []
    const funDef = rankDefinitions.find(([name]) => name === canonical)

    if (canonical === 'rankouro') {
      title = 'RANKING DE OURO'
      rows = (await goldRanking(10)).map(row => ({ ...row, label: `${row.gold.toLocaleString('pt-BR')} ouro` }))
    } else if (canonical === 'rankmineracao') {
      title = 'RANKING DE MINERAÇÃO'
      rows = (await miningRanking(10)).map(row => ({ ...row, label: `${row.totalGold.toLocaleString('pt-BR')} ouro • ${row.sessions} sessões` }))
    } else if (canonical === 'rankpicareta') {
      title = 'RANKING DE PICARETAS'
      rows = (await pickaxeRanking(10)).map(row => ({ ...row, label: `${row.pickaxe.icon} Nv.${row.pickaxe.level} ${row.pickaxe.name}` }))
    } else if (canonical === 'rankpvp') {
      title = 'RANKING PVP'
      rows = (await pvpRanking(10, 'wins')).map(row => ({ ...row, label: `${row.wins} vitórias • rating ${row.rating} • Nv.${row.arenaLevel}` }))
    } else if (canonical === 'rankarena') {
      title = 'RATING DA ARENA'
      rows = (await pvpRanking(10, 'rating')).map(row => ({ ...row, label: `${row.rating} pontos • recorde ${row.bestRating} • ${row.wins} vitórias` }))
    } else if (canonical === 'rankdano') {
      title = 'DANO TOTAL PVP'
      rows = (await pvpRanking(10, 'damage')).map(row => ({ ...row, label: `${row.damageDealt.toLocaleString('pt-BR')} dano • maior golpe ${row.maxHit}` }))
    } else if (canonical === 'ranksequencia') {
      title = 'SEQUÊNCIAS PVP'
      rows = (await pvpRanking(10, 'streak')).map(row => ({ ...row, label: `melhor ${row.bestStreak} • atual ${row.currentStreak}` }))
    } else if (canonical === 'rankinvestidores') {
      title = 'MAIORES INVESTIDORES'
      rows = (await investmentRanking(10)).map(row => ({ ...row, label: `₱${row.invested.toLocaleString('pt-BR')} investidos • resultado ₱${row.profit.toLocaleString('pt-BR')}` }))
    } else if (canonical === 'rankvendedores') {
      title = 'MAIORES VENDEDORES'
      rows = (await sellerRanking(10)).map(row => ({ ...row, label: `₱${row.volume.toLocaleString('pt-BR')} negociados • ${row.sales} vendas` }))
    } else if (canonical === 'ranklojas') {
      title = 'MELHORES LOJAS'
      rows = (await shopRanking(10)).map(row => ({ ...row, label: `${row.name} • ₱${row.revenue.toLocaleString('pt-BR')}` }))
    } else if (canonical === 'rankpets') {
      title = 'COLECIONADORES DE PETS'
      rows = (await petRanking(10)).map(row => ({ ...row, label: `${row.count} pets • ${row.levels} níveis somados` }))
    } else if (canonical === 'rankcasas') {
      title = 'MELHORES CASAS'
      rows = (await houseRanking(10)).map(row => ({ ...row, label: `${row.house.icon} ${row.house.name} • ${row.sleeps} descansos` }))
    } else if (canonical === 'rankcasais') {
      title = 'CASAIS MAIS ANTIGOS'
      rows = coupleRanking(10).map(row => {
        const since = row.status === 'married' ? row.marriedSince : row.datingSince
        const days = Math.max(0, Math.floor((Date.now() - Number(since || Date.now())) / 86400000))
        return { ...row, label: `${row.status === 'married' ? '💮 casados' : '🌸 namorando'} • ${days} dia(s)` }
      })
    } else if (canonical === 'rankfamilias') {
      title = 'MAIORES FAMÍLIAS'
      rows = familyRanking(10).map(row => ({ ...row, label: `${row.links} vínculo(s) familiar(es)` }))
    } else if (canonical === 'rankacoes') {
      title = 'MAIS CARINHOSOS'
      rows = actionRanking(msg.key.remoteJid, 10).map(row => ({ ...row, label: `${row.actions} ação(ões) social(is)` }))
    } else if (funDef) {
      const [, label, trait, emoji] = funDef
      rows = metadata.participants
        .map(item => displayUser(item.phoneNumber || item.id || item.lid || item.jid || '', names).number)
        .filter(number => Boolean(number) && number !== String(settings.botNumber || ''))
        .map(number => ({ number, value: stablePercent(chatNumber, number, trait) }))
        .sort((a, b) => b.value - a.value)
        .slice(0, 10)
        .map(row => ({ ...row, label: `${row.value}% ${emoji}` }))
      title = label
    } else if (canonical === 'rankativo' || canonical === 'rankinativo') {
      const inactive = canonical === 'rankinativo'
      title = inactive ? 'RANK DOS INATIVOS' : 'RANK DOS ATIVOS'
      rows = (await activityRanking(chatNumber, inactive, 10)).map(row => ({ ...row, label: `${row.messages} mensagens` }))
    } else {
      const poor = ['rankpobres', 'rankpobre'].includes(canonical)
      title = poor ? 'RANK DOS POBRES' : 'RANKING DE SAKURA COINS'
      rows = (await economyRanking(10, poor)).map(row => ({ ...row, label: `₱${row.total.toLocaleString('pt-BR')}` }))
    }

    const hostNumber = String(settings.botNumber || '')
    rows = rows.filter(row => row.number !== hostNumber && row.userA !== hostNumber && row.userB !== hostNumber)

    if (!rows.length) return reply(sock, msg, '💮 ranking vazio')
    const mentions = []
    const rankingRows = rows.map(row => {
      if (row.userA && row.userB) {
        const first = displayUser(row.userA, names)
        const second = displayUser(row.userB, names)
        if (first.phoneJid || first.mentionJid || first.jid) mentions.push(first.phoneJid || first.mentionJid || first.jid)
        if (second.phoneJid || second.mentionJid || second.jid) mentions.push(second.phoneJid || second.mentionJid || second.jid)
        return { name: `${formatMentionName(first)} + ${formatMentionName(second)}`, label: row.label }
      }
      const user = displayUser(row.number, names)
      if (user.phoneJid || user.mentionJid || user.jid) mentions.push(user.phoneJid || user.mentionJid || user.jid)
      return { name: formatMentionName(user), label: row.label }
    })
    const body = formatRankingBody(rankingRows, { title })

    return sendNativeList({
      sock,
      jid: msg.key.remoteJid,
      quoted: msg,
      logger,
      kind: `rank:${canonical}`,
      body,
      sections,
      buttonText: '🌸 Trocar ranking',
      mentions: [...new Set(mentions)]
    })
  }
})
