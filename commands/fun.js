import { defineCommand } from '../data/workstation.js'
import { resolveTarget, displayUser, formatMentionName, groupNameMap } from '../data/user-display.js'
import { sendCommandResult } from '../data/fun-media-store.js'
import { reply } from '../data/reply.js'
import { formatMessage } from '../data/formatter.js'

const normalize = value => String(value || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/[^a-z0-9]/g, '')

const TRAITS = Object.freeze({
  gay: ['🌸', 'Gay'],
  corno: ['🌸', 'Corno'],
  lesbica: ['🌸', 'Lésbica'],
  rico: ['🌸', 'Rico'],
  pobre: ['💮', 'Pobre'],
  gostoso: ['🌸', 'Gostoso'],
  feio: ['🌸', 'Feio'],
  casavel: ['💮', 'Casável'],
  otaku: ['🍥', 'Otaku'],
  fedido: ['🌸', 'Fedido'],
  inteligente: ['🌸', 'Inteligente'],
  sortudo: ['💮', 'Sortudo'],
  azarado: ['🌸', 'Azarado'],
  talarico: ['🌸', 'Talarico'],
  mentiroso: ['💮', 'Mentiroso'],
  fofo: ['🌸', 'Fofo'],
  carente: ['🌸', 'Carente'],
  lindo: ['🌸', 'Lindo'],
  chato: ['🌸', 'Chato'],
  burro: ['🌸', 'Burro'],
  viciado: ['🌸', 'Viciado'],
  fitness: ['🌸', 'Fitness'],
  nerd: ['💮', 'Nerd'],
  emo: ['💮', 'Emo'],
  gamer: ['🌸', 'Gamer'],
  safado: ['🌸', 'Safado'],
  romantico: ['🌸', 'Romântico'],
  feliz: ['💮', 'Feliz'],
  estressado: ['💮', 'Estressado'],
  bebado: ['🌸', 'Bêbado'],
  engracado: ['🌸', 'Engraçado'],
  dorminhoco: ['💮', 'Dorminhoco'],
  preguicoso: ['🌸', 'Preguiçoso'],
  rei: ['💮', 'Rei'],
  rainha: ['💮', 'Rainha'],
  bonito: ['💮', 'Bonito'],
  simpatico: ['💮', 'Simpático'],
  ciumento: ['🌸', 'Ciumento'],
  briguento: ['🌸', 'Briguento'],
  calmo: ['🌸', 'Calmo'],
  doido: ['🌸', 'Doido'],
  famoso: ['🌸', 'Famoso'],
  poderoso: ['🌸', 'Poderoso'],
  beijo: ['🌸', 'Beijável'],
  beijavel: ['🌸', 'Beijável'],
  flerte: ['🌸', 'Bom de flerte'],
  gado: ['🌸', 'Gado'],
  humilde: ['🌸', 'Humilde'],
  arrogante: ['🌸', 'Arrogante'],
  dramatico: ['🌸', 'Dramático'],
  toxico: ['🌸', 'Tóxico'],
  fiel: ['🌸', 'Fiel'],
  infiel: ['🌸', 'Infiel'],
  sincero: ['💮', 'Sincero'],
  falso: ['🌸', 'Falso'],
  emocionado: ['💮', 'Emocionado'],
  iludido: ['💮', 'Iludido'],
  apaixonado: ['💮', 'Apaixonado'],
  solteiro: ['💮', 'Solteiro'],
  comprometido: ['🌸', 'Comprometido'],
  crush: ['🌸', 'Crushável'],
  sedutor: ['🌸', 'Sedutor'],
  timido: ['🌸', 'Tímido'],
  extrovertido: ['🌸', 'Extrovertido'],
  antissocial: ['🌸', 'Antissocial'],
  popular: ['🌸', 'Popular'],
  esquecido: ['🌸', 'Esquecido'],
  curioso: ['💮', 'Curioso'],
  fofoqueiro: ['🌸', 'Fofoqueiro'],
  debochado: ['🌸', 'Debochado'],
  ironico: ['💮', 'Irônico'],
  cringe: ['🌸', 'Cringe'],
  sigma: ['🌸', 'Sigma'],
  protagonista: ['💮', 'Protagonista'],
  figurante: ['💮', 'Figurante'],
  heroi: ['💮', 'Herói'],
  vilao: ['🌸', 'Vilão'],
  anjo: ['💮', 'Anjo'],
  demonio: ['🌸', 'Demônio'],
  santo: ['💮', 'Santo'],
  malandro: ['🌸', 'Malandro'],
  trabalhador: ['🌸', 'Trabalhador'],
  enrolado: ['🌸', 'Enrolado'],
  atrasado: ['💮', 'Atrasado'],
  pontual: ['🌸', 'Pontual'],
  organizado: ['💮', 'Organizado'],
  bagunceiro: ['🌸', 'Bagunceiro'],
  cozinheiro: ['💮', 'Cozinheiro'],
  cantor: ['🌸', 'Cantor'],
  dancarino: ['🌸', 'Dançarino'],
  artista: ['🌸', 'Artista'],
  programador: ['🌸', 'Programador'],
  hacker: ['🌸', 'Hacker'],
  influencer: ['🌸', 'Influencer'],
  milionaria: ['🌸', 'Milionária'],
  quebrado: ['🌸', 'Quebrado'],
  economico: ['🌸', 'Econômico'],
  gastador: ['💮', 'Gastador'],
  sortuda: ['💮', 'Sortuda'],
  azarada: ['🌸', 'Azarada'],
  corajoso: ['🌸', 'Corajoso'],
  medroso: ['🌸', 'Medroso'],
  paciente: ['🌸', 'Paciente'],
  impaciente: ['💮', 'Impaciente'],
  responsavel: ['🌸', 'Responsável'],
  irresponsavel: ['🌸', 'Irresponsável'],
  confiavel: ['🌸', 'Confiável'],
  suspeito: ['🌸', 'Suspeito'],
  misterioso: ['💮', 'Misterioso'],
  surtado: ['🌸', 'Surtado'],
  zen: ['🌸', 'Zen'],
  competitivo: ['🌸', 'Competitivo'],
  azarnoamor: ['🌸', 'Azarado no amor'],
  sortenoamor: ['🌸', 'Sortudo no amor'],
  casamenteiro: ['🌸', 'Casamenteiro'],
  mestre: ['🌸', 'Mestre'],
  lenda: ['💮', 'Lenda'],
  divo: ['🌸', 'Divo'],
  diva: ['🌸', 'Diva'],
  perfeito: ['🌸', 'Perfeito'],
  aleatorio: ['💮', 'Aleatório']
})

const aliases = Object.keys(TRAITS).filter(name => !['gay', 'beijo'].includes(name))
const percent = () => Math.floor(Math.random() * 101)
const shipText = value => value >= 90
  ? 'Casal perfeito! 🌸'
  : value >= 70
    ? 'Tem química de sobra 🌸'
    : value >= 50
      ? 'Pode dar certo com esforço.'
      : value >= 21
        ? 'É confuso... mas já vi coisa pior.'
        : 'Nem tenta...'

function verdict(value) {
  if (value >= 90) return 'nível absurdo — a Sakura confirmou sem medo 🌸'
  if (value >= 70) return 'bem acima da média, não tem como esconder.'
  if (value >= 45) return 'equilibrado... depende do dia e da coragem.'
  if (value >= 20) return 'baixo, mas ainda existe esperança.'
  return 'quase nada. Hoje você escapou 🌸'
}

function legacyCaption(title, lines = []) {
  return formatMessage(lines.filter(Boolean).join('\n'), { title })
}

const relationship = value => value >= 90
  ? ['eterno', 'Casal eterno']
  : value >= 80
    ? ['perfeito', 'Casal de milhões']
    : value >= 70
      ? ['fofo', 'Casal fofo e grudento']
      : value >= 55
        ? ['ciumento', 'Casal ciumento e dramático']
        : value >= 35
          ? ['caotico', 'Casal caótico e improvável']
          : value >= 20
            ? ['toxico', 'Casal extremamente tóxico']
            : ['curto', 'Casal que termina em 3 dias']

function traitCatalog(prefix = '.') {
  const names = Object.keys(TRAITS)
  const chunks = []
  for (let index = 0; index < names.length; index += 32) {
    chunks.push(names.slice(index, index + 32).map(name => `${prefix}${name}`).join(' • '))
  }
  return chunks
}

export default defineCommand({
  name: 'gay',
  aliases: ['ship', 'casal', 'porcentagens', 'brincadeiras', ...aliases],
  category: 'Diversão',
  groupOnly: false,
  menuEntries: [
    { name: 'ship', usage: '.ship @pessoa @pessoa', description: 'Calcula a compatibilidade do casal.', menuGroup: 'Casais' },
    { name: 'casal', usage: '.casal', description: 'Sorteia um casal do grupo.', menuGroup: 'Casais' },
    { name: 'brincadeiras', usage: '.brincadeiras', description: 'Mostra todos os testes de porcentagem.', menuGroup: 'Porcentagens' },
    ...Object.entries(TRAITS).slice(0, 20).map(([name, [, label]]) => ({
      name,
      usage: `.${name} @pessoa`,
      description: `Mede o nível de ${label.toLowerCase()}.`,
      menuGroup: 'Porcentagens'
    }))
  ],

  async execute({ sock, msg, args, invokedAs, settings, senderNumber, metadata }) {
    const used = normalize(invokedAs)

    if (used === 'porcentagens' || used === 'brincadeiras') {
      const pages = traitCatalog(settings.prefix)
      for (let index = 0; index < pages.length; index += 1) {
        await reply(sock, msg, pages[index], {
          title: `BRINCADEIRAS ${index + 1}/${pages.length}`,
          icon: '💮'
        })
      }
      return
    }

    const names = await groupNameMap(sock, msg.key.remoteJid, metadata)
    if (used === 'ship') {
      const mentioned = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || []
      const first = await resolveTarget({ sock, msg, args, fallbackNumber: senderNumber })
      let secondNumber = ''
      if (mentioned[1]) secondNumber = String(mentioned[1]).split('@')[0].split(':')[0].replace(/\D/g, '')
      if (!secondNumber) secondNumber = senderNumber === first.number ? '' : senderNumber
      if (!first.number || !secondNumber || first.number === secondNumber) {
        return reply(sock, msg, `Use ${settings.prefix}ship @pessoa @pessoa ou responda uma mensagem.`, { title: 'SAKURA SHIP' })
      }
      const firstUser = displayUser(first.number, names)
      const secondUser = displayUser(secondNumber, names)
      const value = percent()
      return sendCommandResult({
        sock,
        msg,
        command: 'ship',
        percent: value,
        caption: legacyCaption('SAKURA SHIP', [
          `casal: ${formatMentionName(firstUser)} + ${formatMentionName(secondUser)}`,
          `compatibilidade: ${value}%`,
          `resultado: ${shipText(value)}`
        ]),
        mentions: [firstUser.mentionJid || firstUser.phoneJid, secondUser.mentionJid || secondUser.phoneJid].filter(Boolean)
      })
    }

    if (used === 'casal') {
      if (!String(msg.key.remoteJid || '').endsWith('@g.us')) {
        return reply(sock, msg, 'O sorteio de casal funciona apenas em grupos.', { title: 'DIVERSÃO' })
      }
      const hostNumbers = new Set([
        settings.botNumber,
        sock?.user?.id,
        sock?.user?.lid
      ].map(value => String(value || '').split('@')[0].split(':')[0].replace(/\D/g, '')).filter(Boolean))
      const members = [...new Set((metadata?.participants || [])
        .map(item => displayUser(item.phoneNumber || item.id || item.lid || '', names).number)
        .filter(number => number && !hostNumbers.has(number)))]
      if (members.length < 2) return reply(sock, msg, 'Preciso de pelo menos duas pessoas no grupo.', { title: 'DIVERSÃO' })
      const firstNumber = members.splice(Math.floor(Math.random() * members.length), 1)[0]
      const secondNumber = members[Math.floor(Math.random() * members.length)]
      const value = percent()
      const [category, label] = relationship(value)
      const firstUser = displayUser(firstNumber, names)
      const secondUser = displayUser(secondNumber, names)
      return sendCommandResult({
        sock,
        msg,
        command: 'casal',
        percent: value,
        category,
        caption: legacyCaption('CASAL DA SAKURA', [
          `sorteados: ${formatMentionName(firstUser)} + ${formatMentionName(secondUser)}`,
          `compatibilidade: ${value}%`,
          `tipo do relacionamento: ${label}`,
          `veredito: ${shipText(value)}`
        ]),
        mentions: [firstUser.mentionJid || firstUser.phoneJid, secondUser.mentionJid || secondUser.phoneJid].filter(Boolean)
      })
    }

    const trait = TRAITS[used] || TRAITS.gay
    const target = await resolveTarget({ sock, msg, args, fallbackNumber: senderNumber })
    const user = displayUser(target.number || senderNumber, names)
    const value = percent()
    return sendCommandResult({
      sock,
      msg,
      command: used,
      percent: value,
      caption: legacyCaption('BRINCADEIRA DA SAKURA', [
        `pessoa: ${formatMentionName(user)}`,
        `teste: ${trait[0]} ${trait[1]}`,
        `resultado: ${value}%`,
        `veredito: ${verdict(value)}`
      ]),
      mentions: [user.mentionJid || user.phoneJid].filter(Boolean)
    })
  }
})

export { TRAITS, traitCatalog }
