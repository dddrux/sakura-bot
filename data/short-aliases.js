export const SHORT_ALIAS_TARGETS = Object.freeze({
  // Principal
  m: 'menu', cmd: 'comandos', aj: 'ajuda', tut: 'tutorial', gui: 'guia', cal: 'calculadora', clc: 'calc', p: 'ping', bi: 'botinfo', dn: 'dono',
  pa: 'planosaluguel', sd: 'subdono', cfg: 'config', cn: 'conectar', crd: 'creditos',

  // Mídia
  s: 's', tk: 'take', br: 'brat', py: 'play', slt: 's20', fgv: 'figvip', fgs: 'figsorteio', ig: 'instagram', pin: 'pinterest', ti: 'toimg', tv: 'tovideo',

  // Grupo e administração
  af: 'afk', ct: 'cita', bn: 'ban', pr: 'promover', rbx: 'rebaixar', ads: 'admins',
  gp: 'grupo', ng: 'nomegp', dg: 'descgp', lg: 'linkgp', nl: 'novolink', ht: 'hidetag',
  autg: 'automacoes', bv: 'boasvindas', tta: 'tiktokauto', adl: 'autodl', r8: 'rotina8', afd: 'antiflood', alink: 'antilink', sgp: 'statusgp', dsgp: 'delstatusgp', 

  // Dono e diagnóstico
  aut: 'automaticos', as: 'autos', am: 'acaomedia', by: 'baileys', ply: 'player', sm: 'statusmodulos', aud: 'auditoria', bfg: 'bibliotecafig',
  ia: 'ia', iag: 'iagrupo', iat: 'iatoken',

  // Economia
  ec: 'eco', rg: 'registrar', sl: 'saldo', pf: 'perfil', xt: 'extrato', cq: 'conquistas',
  rt: 'rotina', dd: 'diario', of: 'oficio', tr: 'trabalhar', ms: 'missao', jr: 'jornada',
  mn: 'minerar', or: 'ouro', tgo: 'trocarouro', pc: 'picareta', upc: 'melhorarpicareta', cx: 'caixadiaria', pv: 'pvp', pvh: 'pvphistorico', pva: 'pvpatributos', pvr: 'pvpregras', ps: 'pescar', ex: 'explorar', jd: 'jardim', cm: 'crime', bc: 'banco',
  dp: 'depositar', sc: 'sacar', rm: 'rendimento', px: 'pix', lj: 'loja', cp: 'comprar',
  vd: 'vender', mh: 'mochila', us: 'usar', at: 'atelier', ci: 'criar', rec: 'receitas', st: 'sorte', rr: 'roubar',
  inv: 'investir', iv: 'investimentos', oft: 'ofertar', ofs: 'ofertas', ml: 'minhaloja', clj: 'criarloja',
  an: 'anunciar', ld: 'lojade', pt: 'pets', cpt: 'comprarpet', cs: 'casa', dor: 'dormir', eg: 'economiagrupo',
  rel: 'relacionamento', nam: 'namorar', cas: 'casar', fam: 'familia', ado: 'adotar',
  ac: 'acoes', bj: 'beijar', abr: 'abracar', cfn: 'cafune', prs: 'presentear',

  // Rankings
  rk: 'ranks', rkd: 'rankdinheiro', rkp: 'rankpobres', rka: 'rankativo', rki: 'rankinativo',
  rkg: 'rankgay', rgg: 'rankgado', rkc: 'rankcorno', rkl: 'rankmaislindos', rkf: 'rankfeios', rkn: 'rankinteligente',
  rko: 'rankouro', rkm: 'rankmineracao', rkpc: 'rankpicareta', rkv: 'rankpvp', rks: 'ranksequencia',
  rkar: 'rankarena', rkdmg: 'rankdano',
  rkinv: 'rankinvestidores', rkvd: 'rankvendedores', rklj: 'ranklojas', rkpt: 'rankpets', rkcs: 'rankcasas',
  rkcl: 'rankcasais', rkfm: 'rankfamilias', rkac: 'rankacoes',

  // Aluguel
  c: 'contrato', ctt: 'contrato', lct: 'contratos', v: 'vip', lv: 'listavip', tt: 'tiktok'
})

const TARGET_TO_SHORT = new Map()
for (const [alias, target] of Object.entries(SHORT_ALIAS_TARGETS)) {
  if (!TARGET_TO_SHORT.has(target)) TARGET_TO_SHORT.set(target, alias)
}

const GENERATED_ALIAS_TARGETS = new Map()
const GENERATED_TARGET_TO_SHORT = new Map()

function normalizedCommandName(value = '') {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
}

function compactAliasSeed(value = '') {
  const clean = normalizedCommandName(value).replace(/[^a-z0-9]+/g, '')
  if (!clean) return ''
  if (clean.length <= 3) return clean
  const consonants = `${clean[0]}${clean.slice(1).replace(/[aeiou]/g, '')}`
  return consonants.length >= 2 ? consonants : clean
}

function aliasCandidates(target = '') {
  const clean = normalizedCommandName(target).replace(/[^a-z0-9]+/g, '')
  const seed = compactAliasSeed(target)
  const candidates = []
  for (const source of [seed, clean]) {
    for (let size = 2; size <= Math.min(6, source.length); size += 1) candidates.push(source.slice(0, size))
  }
  if (clean) candidates.push(clean.slice(0, 1))
  return [...new Set(candidates.filter(Boolean))]
}

export function resetGeneratedShortAliases() {
  GENERATED_ALIAS_TARGETS.clear()
  GENERATED_TARGET_TO_SHORT.clear()
}

export function ensureShortAliases(commands) {
  if (!(commands instanceof Map)) throw new TypeError('commands precisa ser Map')
  resetGeneratedShortAliases()
  const reserved = new Set([...commands.keys()].map(normalizedCommandName))
  for (const alias of Object.keys(SHORT_ALIAS_TARGETS)) reserved.add(normalizedCommandName(alias))
  const uniqueCommands = [...new Set(commands.values())].filter(Boolean)
  const targets = []
  for (const command of uniqueCommands) {
    if (!command?.hidden && command?.name) targets.push({ target: normalizedCommandName(command.name), command })
    for (const entry of Array.isArray(command?.menuEntries) ? command.menuEntries : []) {
      if (!entry?.hidden && entry?.name) targets.push({ target: normalizedCommandName(entry.name), command })
    }
  }
  const seenTargets = new Set()
  const generated = []
  for (const item of targets.sort((a, b) => a.target.localeCompare(b.target, 'pt-BR'))) {
    const target = item.target
    if (!target || seenTargets.has(target)) continue
    seenTargets.add(target)
    if (TARGET_TO_SHORT.has(target)) continue
    let alias = ''
    for (const candidate of aliasCandidates(target)) {
      if (!reserved.has(candidate)) { alias = candidate; break }
    }
    if (!alias) {
      const seed = compactAliasSeed(target).slice(0, 4) || 'c'
      for (let index = 2; index < 1000; index += 1) {
        const candidate = `${seed}${index}`.slice(0, 6)
        if (!reserved.has(candidate)) { alias = candidate; break }
      }
    }
    if (!alias) continue
    reserved.add(alias)
    GENERATED_ALIAS_TARGETS.set(alias, target)
    GENERATED_TARGET_TO_SHORT.set(target, alias)
    commands.set(alias, item.command)
    generated.push({ alias, target, command: item.command })
  }
  return generated
}

export const MENU_CATEGORY_ALIASES = Object.freeze({
  p: 'Principal', pri: 'Principal', principal: 'Principal',
  m: 'Mídia', mid: 'Mídia', midia: 'Mídia', media: 'Mídia',
  e: 'Economia', ec: 'Economia', eco: 'Economia', economia: 'Economia',
  r: 'Ranks', rk: 'Ranks', rank: 'Ranks', ranks: 'Ranks',
  g: 'Grupo', gp: 'Grupo', grupo: 'Grupo',
  a: 'Administração', adm: 'Administração', admin: 'Administração', administracao: 'Administração',
  al: 'Aluguel', alu: 'Aluguel', aluguel: 'Aluguel',
  d: 'Dono', dn: 'Dono', dono: 'Dono',
  ia: 'Inteligência artificial', ai: 'Inteligência artificial', inteligencia: 'Inteligência artificial',
  v: 'VIP', vip: 'VIP',
  cfg: 'Configuração', conf: 'Configuração', configuracao: 'Configuração', config: 'Configuração',
  dv: 'Diversão', div: 'Diversão', diversao: 'Diversão', fun: 'Diversão',
  o: 'Outros', out: 'Outros', outros: 'Outros'
})

export function canonicalShortTarget(value = '') {
  const alias = normalizedCommandName(value)
  return SHORT_ALIAS_TARGETS[alias] || GENERATED_ALIAS_TARGETS.get(alias) || ''
}

export function shortAliasFor(target = '') {
  const key = normalizedCommandName(target)
  return TARGET_TO_SHORT.get(key) || GENERATED_TARGET_TO_SHORT.get(key) || ''
}

export function menuCategoryFor(value = '') {
  return MENU_CATEGORY_ALIASES[String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()] || ''
}

const CATEGORY_TO_MENU_SHORT = Object.freeze({
  Principal: 'pri',
  'Mídia': 'mid',
  Economia: 'eco',
  Ranks: 'rk',
  Grupo: 'gp',
  'Administração': 'adm',
  Aluguel: 'alu',
  Dono: 'dono',
  'Inteligência artificial': 'ia',
  VIP: 'vip',
  'Configuração': 'cfg',
  'Diversão': 'div',
  Outros: 'out'
})

export function menuShortcutForCategory(category = '') {
  return CATEGORY_TO_MENU_SHORT[String(category || '')] || String(category || '').toLowerCase()
}
