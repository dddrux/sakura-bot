import fs from 'node:fs/promises'
import path from 'node:path'
import { createSakuraCopyCard, generateWAMessageFromContent, getBizBinaryNode, isJidGroup, prepareWAMessageMedia, proto } from '@sakura-md/baileys'
import { settings } from './settings.js'
import { formatMessage } from './formatter.js'
import { reply } from './reply.js'
import { shortAliasFor, menuShortcutForCategory } from './short-aliases.js'
import { markCommandCta } from './command-ui-state.js'
import { officialNativeButtons } from './official-links.js'
import { botInfoLines, buttonLabel, itemTitle, menuBox, sectionTitle, stripLeading } from './menu-style.js'

const DEFAULT_CATEGORY = 'Outros'
const AI_MENU_TITLE = 'Opções da IA'
const ROWS_PER_SECTION = 10
const MAX_NATIVE_SECTIONS = 10
const CATALOG_PAGE_SIZE = 30
const SEARCH_LIMIT = 30
const CATEGORY_ORDER = ['Principal', 'Mídia', 'Economia', 'VIP', 'Inteligência artificial', 'Diversão', 'Grupo', 'Administração', 'Configuração', 'Ranks', 'Aluguel', 'Dono', DEFAULT_CATEGORY]
const CATEGORY_DESCRIPTIONS = Object.freeze({
  Principal: 'Informações, ajuda e utilidades principais',
  'Mídia': 'Figurinhas, Brat e downloads de mídia',
  Economia: 'Conta, rotinas, itens, jornadas e transferências',
  VIP: 'Benefícios, prioridade e recursos exclusivos',
  'Inteligência artificial': 'Assistentes, IA automática e configuração de modelos',
  Diversão: 'Jogos, brincadeiras, ações e entretenimento',
  Ranks: 'Rankings do grupo e da economia',
  Grupo: 'Presença, AFK e convivência',
  'Administração': 'Ferramentas para administrar o grupo',
  Configuração: 'Personalização da Sakura e do comportamento do grupo',
  Aluguel: 'Controle dos grupos alugados',
  Dono: 'Configurações exclusivas do proprietário',
  Outros: 'Outros recursos da Sakura-MD'
})
const COMMAND_DESCRIPTIONS = Object.freeze({
  menu: 'Abre as categorias, catálogos e a pesquisa', ping: 'Mostra latência e tempo de atividade', botinfo: 'Mostra informações da Sakura-MD', creditos: 'Créditos dos áudios e figurinhas',
  s: 'Cria figurinha de foto ou vídeo', take: 'Troca os créditos da figurinha', brat: 'Cria figurinha de texto no estilo Brat', play: 'Pesquisa e envia áudio do YouTube',
  saldo: 'Mostra conta, Sakura Coins, banco e nível', ranks: 'Mostra rankings disponíveis', admin: 'Ferramentas de administração do grupo', cita: 'Reenvia a mensagem citada marcando todos',
  aluguel: 'Gerencia o aluguel do grupo'
})
const sentInteractive = new Map()

function normalize(value = '') {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR').trim()
}

function commandCategory(command = {}) {
  const category = String(command.category || DEFAULT_CATEGORY).trim() || DEFAULT_CATEGORY
  if (category === 'Rankings') return 'Ranks'
  if (category === 'Admin') return 'Administração'
  return category
}

function categoryIndex(name) {
  const index = CATEGORY_ORDER.indexOf(name)
  return index === -1 ? 999 : index
}

function uniqueByName(entries = []) {
  const result = new Map()
  for (const entry of entries) {
    const key = normalize(entry?.name)
    if (!key || result.has(key)) continue
    result.set(key, entry)
  }
  return [...result.values()]
}

function visibleEntry(command, entry = {}) {
  const name = String(entry.name || command.name || '').trim()
  const category = String(entry.category || commandCategory(command)).trim() || DEFAULT_CATEGORY
  return {
    ...command,
    ...entry,
    name,
    category: category === 'Rankings' ? 'Ranks' : category === 'Admin' ? 'Administração' : category,
    usage: String(entry.usage || `${settings.prefix}${name}`).trim(),
    description: String(entry.description || command.description || COMMAND_DESCRIPTIONS[name] || '').trim(),
    menuGroup: String(entry.menuGroup || command.menuGroup || 'Comandos').trim(),
    menuSource: String(command.name || name),
    shortAlias: shortAliasFor(name),
    sourceCommand: command
  }
}

export function registerInteractive(sent, metadata = {}) {
  const id = sent?.key?.id
  if (!id) return
  sentInteractive.set(id, { ...metadata, at: Date.now() })
  if (sentInteractive.size > 200) sentInteractive.delete(sentInteractive.keys().next().value)
}

export function getInteractiveMetadata(id) { return sentInteractive.get(id) || null }
export function pruneInteractiveCache(maxAgeMs = 30 * 60_000) {
  const now = Date.now()
  let removed = 0
  for (const [id, metadata] of sentInteractive) {
    if (now - Number(metadata?.at || 0) > maxAgeMs) { sentInteractive.delete(id); removed += 1 }
  }
  return { removed, size: sentInteractive.size }
}

export function getUniqueCommands(commands) {
  return [...new Map([...commands.values()].map(command => [normalize(command.name), command])).values()]
}

export function getVisibleMenuCommands(commands) {
  return uniqueByName(getUniqueCommands(commands).flatMap(command => {
    if (command.hidden) return []
    const entries = Array.isArray(command.menuEntries) ? command.menuEntries.filter(entry => !entry?.hidden) : []
    if (!entries.length) return [visibleEntry(command)]
    return entries.map(entry => visibleEntry(command, entry))
  }))
}

export function getAliasCatalogEntries(commands) {
  const curated = new Map(getVisibleMenuCommands(commands).map(entry => [normalize(entry.name), entry]))
  const entries = []
  for (const [registeredName, command] of commands.entries()) {
    if (!command || command.hidden) continue
    const name = String(registeredName || '').trim()
    if (!name || command.menuHiddenAliases?.includes?.(name)) continue
    const custom = curated.get(normalize(name))
    entries.push(custom || visibleEntry(command, {
      name,
      usage: `${settings.prefix}${name}`,
      description: normalize(name) === normalize(command.name)
        ? String(command.description || COMMAND_DESCRIPTIONS[command.name] || `Executa ${settings.prefix}${command.name}.`)
        : `Nome alternativo de ${settings.prefix}${command.name}.`,
      menuGroup: normalize(name) === normalize(command.name) ? 'Principais' : 'Atalhos'
    }))
  }
  return uniqueByName(entries).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
}

export function resolveCatalogEntry(commands, selectedName = '') {
  const key = normalize(selectedName)
  if (!key) return null
  const curated = getVisibleMenuCommands(commands).find(entry => normalize(entry.name) === key)
  if (curated) return curated
  const command = commands.get(String(selectedName || '').toLocaleLowerCase('pt-BR'))
    || [...commands.entries()].find(([registeredName]) => normalize(registeredName) === key)?.[1]
  if (!command || command.hidden) return null
  return visibleEntry(command, {
    name: selectedName,
    usage: `${settings.prefix}${selectedName}`,
    description: key === normalize(command.name)
      ? command.description
      : `Nome alternativo de ${settings.prefix}${command.name}.`,
    menuGroup: key === normalize(command.name) ? 'Principais' : 'Atalhos'
  })
}

export function buildCommandSections(commands) {
  const grouped = new Map()
  for (const command of getVisibleMenuCommands(commands)) {
    const category = commandCategory(command)
    if (!grouped.has(category)) grouped.set(category, [])
    grouped.get(category).push(command)
  }
  return [...grouped.entries()]
    .sort(([a], [b]) => categoryIndex(a) - categoryIndex(b) || a.localeCompare(b, 'pt-BR'))
    .map(([category, categoryCommands]) => ({
      title: category,
      description: CATEGORY_DESCRIPTIONS[category] || CATEGORY_DESCRIPTIONS.Outros,
      commands: categoryCommands.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
    }))
}

export function prepareNativeSections(sections = [], options = {}) {
  const rowsPerSection = Math.max(1, Math.min(10, Number(options.rowsPerSection || ROWS_PER_SECTION)))
  const maxSections = Math.max(1, Number(options.maxSections || MAX_NATIVE_SECTIONS))
  const expanded = []
  let totalRows = 0

  for (const section of Array.isArray(sections) ? sections : []) {
    const rows = (Array.isArray(section?.rows) ? section.rows : []).filter(row => String(row?.id || '').trim() && String(row?.title || '').trim())
    totalRows += rows.length
    if (!rows.length) continue
    const pages = Math.ceil(rows.length / rowsPerSection)
    for (let index = 0; index < pages; index += 1) {
      const suffix = pages > 1 ? ` • ${index + 1}/${pages}` : ''
      expanded.push({
        ...section,
        title: `${String(section.title || 'Opções').trim()}${suffix}`.slice(0, 200),
        rows: rows.slice(index * rowsPerSection, (index + 1) * rowsPerSection)
      })
    }
  }

  const normalized = expanded.slice(0, maxSections)
  const visibleRows = normalized.reduce((sum, section) => sum + section.rows.length, 0)
  return { sections: normalized, totalRows, visibleRows, hiddenRows: Math.max(0, totalRows - visibleRows), totalSections: expanded.length }
}

export function formatUptime(totalSeconds = process.uptime()) {
  const seconds = Math.max(0, Math.floor(Number(totalSeconds) || 0))
  const days = Math.floor(seconds / 86400), hours = Math.floor((seconds % 86400) / 3600), minutes = Math.floor((seconds % 3600) / 60), rest = seconds % 60
  return [days ? `${days}d` : '', hours ? `${hours}h` : '', minutes ? `${minutes}m` : '', `${rest}s`].filter(Boolean).join(' ')
}


export function buildMenuHeader(commands) {
  return menuBox('MENU PRINCIPAL', botInfoLines({ botName: settings.botName, ownerName: settings.ownerName, prefix: settings.prefix, uptime: formatUptime() }))
}

function catalogCategoryTitle(value = '') {
  const category = String(value || '').trim()
  if (normalize(category) === normalize('Inteligência artificial')) return 'IA'
  return category.toUpperCase()
}

export function buildCompleteCatalogText(commands) {
  const blocks = [menuBox('MENU COMPLETO', botInfoLines({ botName: settings.botName, ownerName: settings.ownerName, prefix: settings.prefix, uptime: formatUptime() }))]
  for (const section of buildCommandSections(commands)) {
    blocks.push(menuBox(catalogCategoryTitle(section.title), section.commands.map(command => `*${settings.prefix}${command.name}*`)))
  }
  return blocks.join('\n\n')
}

let menuMediaPromise = null
export async function getMenuMedia() {
  if (menuMediaPromise) return menuMediaPromise
  menuMediaPromise = (async () => {
    const filePath = settings.menuMediaPath
    try {
      const buffer = await fs.readFile(filePath)
      const extension = path.extname(filePath).toLowerCase()
      const kind = ['.mp4', '.mov', '.mkv', '.webm'].includes(extension) ? 'video' : 'image'
      const thumbnail = kind === 'video' ? await fs.readFile(settings.menuThumbnailPath).catch(() => null) : null
      return { kind, fileName: path.basename(filePath), buffer, fps: settings.menuMediaFps, ...(thumbnail ? { thumbnail } : {}) }
    } catch {
      try {
        const buffer = await fs.readFile(settings.menuLogoPath)
        return { kind: 'image', fileName: path.basename(settings.menuLogoPath), buffer }
      } catch { return null }
    }
  })()
  return menuMediaPromise
}

// Compatibilidade com módulos antigos: a nova API preferida é getMenuMedia().
export async function getMenuLogo() {
  const media = await getMenuMedia()
  return media?.kind === 'image' ? media : null
}

function getCommandUsage(command) {
  const fallback = `${settings.prefix}${command?.name || ''}`
  const raw = String(command?.usage || fallback).trim() || fallback
  return raw.replace(/^[.!/#]/, settings.prefix)
}

function describeCommand(command) {
  return String(command.description || COMMAND_DESCRIPTIONS[command.name] || `Use ${getCommandUsage(command)}`).slice(0, 90)
}

function encodeToken(value = '') { return encodeURIComponent(String(value || '').trim()) }

function categorySections(commands, requesterNumber = '') {
  const requester = String(requesterNumber || '').replace(/\D/g, '')
  const commandSections = buildCommandSections(commands)
  const actions = getVisibleMenuCommands(commands).length
  const aliases = getAliasCatalogEntries(commands).length
  return [
    {
      title: 'Começar e utilidades',
      rows: [
        { id: `${settings.prefix}tutorial`, title: 'Tutorial da Sakura', description: 'Guia por cargo, VIP e sistema' },
        { id: `${settings.prefix}calc 200 * 10%`, title: 'Calculadora', description: 'Soma, porcentagem, parênteses e potência' },
        { id: requester ? `${settings.prefix}perfil ${requester}` : `${settings.prefix}perfil`, title: 'Meu perfil', description: 'Economia, PVP, VIP e relacionamentos' }
      ]
    },
    {
      title: 'Catálogos',
      rows: [
        { id: `${settings.prefix}comandos`, title: 'Catálogo completo', description: 'Tudo da Sakura reunido no mesmo catálogo' },
        { id: `${settings.prefix}m aliases 1`, title: 'Atalhos rápidos', description: 'Nomes curtos para digitar menos' },
        { id: `${settings.prefix}m search`, title: 'Pesquisar comando', description: `Use ${settings.prefix}m buscar palavra` }
      ]
    },
    {
      title: 'Categorias',
      rows: commandSections.map(section => ({
        id: `${settings.prefix}m ${menuShortcutForCategory(section.title)}`,
        title: section.title,
        description: String(section.description || 'Escolha uma função desta categoria').slice(0, 90)
      }))
    }
  ]
}

function commandNeedsModel(command = {}) {
  if (command.menuModelOnly === true) return true
  if (command.menuDirect === true) return false
  const usage = getCommandUsage(command)
  // Comandos que precisam de menção, mídia, texto, link, ID ou outro argumento
  // não devem ser disparados vazios ao tocar no catálogo. O menu abre o cartão
  // com modelo copiável e o usuário completa o parâmetro antes de enviar.
  return /@[\p{L}\p{N}_-]+/u.test(usage)
    || /<[^>]+>/.test(usage)
    || /\[[^\]]+\]/.test(usage)
    || /(?:responda|marque|link|texto|legenda|imagem|v[ií]deo|id)/i.test(usage)
}

function rowsForEntries(entries = [], { directExecute = false } = {}) {
  return entries.map(command => {
    const restriction = command.ownerOnly ? 'Dono • ' : command.adminOnly ? 'Admin • ' : command.groupOnly ? 'Grupo • ' : ''
    const short = command.shortAlias || shortAliasFor(command.name)
    const directId = `${settings.prefix}${command.name}`
    const openModel = !directExecute || commandNeedsModel(command)
    const shortcut = short && short !== command.name ? `Atalho ${settings.prefix}${short} • ` : ''
    return {
      id: openModel ? `${settings.prefix}menu command ${encodeToken(command.name)}` : directId,
      title: `${(commandNeedsModel(command) && getCommandUsage(command).length <= 42) ? getCommandUsage(command) : `${settings.prefix}${command.name}`}`.slice(0, 200),
      description: `${restriction}${shortcut}${openModel ? 'Modelo • ' : ''}${describeCommand(command)}`.slice(0, 90)
    }
  })
}

function groupedEntrySections(entries = [], { categoryInTitle = false, directExecute = false } = {}) {
  const groups = new Map()
  for (const entry of entries) {
    const category = commandCategory(entry)
    const group = String(entry.menuGroup || 'Comandos')
    const key = categoryInTitle ? category : group
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(entry)
  }
  return [...groups.entries()].map(([title, groupEntries]) => ({
    title: `${categoryInTitle ? '' : ''}${title}`.trim(),
    rows: rowsForEntries(groupEntries.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')), { directExecute })
  }))
}

function navigationSection(rows = []) {
  return { title: 'Navegação', rows: rows.filter(Boolean) }
}

function categoryCommandSections(commands, category) {
  const normalized = normalize(category)
  const section = buildCommandSections(commands).find(item => normalize(item.title) === normalized)
  if (!section) return []
  const groups = groupedEntrySections(section.commands, { directExecute: true })
  groups.push(navigationSection([
    { id: `${settings.prefix}m`, title: 'Voltar às categorias', description: 'Abrir o menu principal' },
    { id: `${settings.prefix}comandos`, title: 'Catálogo completo', description: 'Abrir o catálogo completo da Sakura' }
  ]))
  return groups
}

function paginate(entries = [], requestedPage = 1, pageSize = CATALOG_PAGE_SIZE) {
  const totalPages = Math.max(1, Math.ceil(entries.length / pageSize))
  const page = Math.max(1, Math.min(totalPages, Number(requestedPage) || 1))
  return { page, totalPages, items: entries.slice((page - 1) * pageSize, page * pageSize), total: entries.length }
}

function catalogNavigation(mode, page, totalPages) {
  return navigationSection([
    page > 1 ? { id: `${settings.prefix}m ${mode} ${page - 1}`, title: 'Página anterior', description: `Ir para ${page - 1}/${totalPages}` } : null,
    page < totalPages ? { id: `${settings.prefix}m ${mode} ${page + 1}`, title: 'Próxima página', description: `Ir para ${page + 1}/${totalPages}` } : null,
    mode === 'catalog'
      ? { id: `${settings.prefix}m aliases 1`, title: 'Ver atalhos', description: 'Nomes curtos e alternativos' }
      : { id: `${settings.prefix}comandos`, title: 'Ver comandos', description: 'Abrir o catálogo completo' },
    { id: `${settings.prefix}m`, title: 'Menu principal', description: 'Voltar às categorias' }
  ])
}

function catalogPageSections(commands, requestedPage = 1, mode = 'catalog') {
  const entries = mode === 'aliases' ? getAliasCatalogEntries(commands) : getVisibleMenuCommands(commands)
  const sorted = [...entries].sort((a, b) => categoryIndex(commandCategory(a)) - categoryIndex(commandCategory(b)) || a.name.localeCompare(b.name, 'pt-BR'))
  const pageData = paginate(sorted, requestedPage)
  const sections = groupedEntrySections(pageData.items, { categoryInTitle: true })
  sections.push(catalogNavigation(mode, pageData.page, pageData.totalPages))
  return { ...pageData, sections }
}

function searchEntries(commands, query = '') {
  const needle = normalize(query)
  if (!needle) return []
  const merged = uniqueByName([...getVisibleMenuCommands(commands), ...getAliasCatalogEntries(commands)])
  return merged
    .map(entry => {
      const name = normalize(entry.name)
      const category = normalize(commandCategory(entry))
      const description = normalize(entry.description)
      let score = 99
      if (name === needle) score = 0
      else if (name.startsWith(needle)) score = 1
      else if (name.includes(needle)) score = 2
      else if (category.includes(needle)) score = 3
      else if (description.includes(needle)) score = 4
      return { entry, score }
    })
    .filter(result => result.score < 99)
    .sort((a, b) => a.score - b.score || a.entry.name.localeCompare(b.entry.name, 'pt-BR'))
    .slice(0, SEARCH_LIMIT)
    .map(result => result.entry)
}

function stripThemePrefix(value = '') { return stripLeading(value) }

export function styleNativeSections(sections = []) {
  return (Array.isArray(sections) ? sections : []).map(section => ({
    ...section,
    title: sectionTitle(section?.title || 'Opções').slice(0, 200),
    rows: (Array.isArray(section?.rows) ? section.rows : []).map((row, index) => ({
      ...row,
      title: itemTitle(row?.title || '', index).slice(0, 200)
    }))
  }))
}

export function styleButtonText(value = '') {
  return buttonLabel(value, 'Abrir menu').slice(0, 40)
}

function normalizeNativeBody(body = '', kind = '') {
  const text = String(body || '').trim()
  if (!text) return formatMessage('Escolha uma opção abaixo.', { title: 'SAKURA' })
  if (/^╭━━⪩\s*🪷/u.test(text)) return text
  const title = String(kind || 'SAKURA')
    .replace(/[:_/-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleUpperCase('pt-BR')
    .slice(0, 28) || 'SAKURA'
  return formatMessage(text, { title })
}

async function buildNativeInteractiveMessage({ sock, jid, body, sections = [], buttonText, quickReplies = [], media = null, quoted = null, mentions = [], includeUpdateCta = false, includeVipCta = false }) {
  const buttons = []
  if (sections.length) buttons.push(
    proto.Message.InteractiveMessage.NativeFlowMessage.NativeFlowButton.create({
      name: 'single_select',
      buttonParamsJson: JSON.stringify({
        title: String(buttonText || 'Abrir menu').slice(0, 40),
        sections: sections.map(section => ({
          title: String(section.title || 'Opções').slice(0, 200),
          ...(section.highlight_label ? { highlight_label: String(section.highlight_label).slice(0, 50) } : {}),
          rows: (section.rows || []).map(row => ({
            ...(row.header ? { header: String(row.header).slice(0, 100) } : {}),
            title: String(row.title || '').slice(0, 200),
            description: String(row.description || '').slice(0, 300),
            id: String(row.id || '').slice(0, 200)
          }))
        }))
      })
    })
  )
  for (const item of quickReplies.slice(0, 3)) {
    buttons.push(proto.Message.InteractiveMessage.NativeFlowMessage.NativeFlowButton.create({
      name: 'quick_reply',
      buttonParamsJson: JSON.stringify({ display_text: sentenceCase(String(item?.text || 'Opção')).slice(0, 40), id: String(item?.id || '').slice(0, 200) })
    }))
  }
  if (includeUpdateCta || includeVipCta) {
    buttons.push(...officialNativeButtons({ proto, includeMenu: false, includeOfficial: includeUpdateCta, includeVip: includeVipCta }))
  }

  let header = proto.Message.InteractiveMessage.Header.create({
    title: '',
    subtitle: '',
    hasMediaAttachment: false
  })

  if (media?.buffer) {
    const preparedMedia = media.kind === 'video'
      ? await prepareWAMessageMedia({ video: media.buffer }, { upload: sock.waUploadToServer })
      : await prepareWAMessageMedia({ image: media.buffer }, { upload: sock.waUploadToServer })
    if (media.kind === 'video' && media.thumbnail && preparedMedia.videoMessage) preparedMedia.videoMessage.jpegThumbnail = media.thumbnail
    header = proto.Message.InteractiveMessage.Header.create({
      ...(media.kind === 'video'
        ? { videoMessage: preparedMedia.videoMessage }
        : { imageMessage: preparedMedia.imageMessage }),
      title: '',
      subtitle: '',
      hasMediaAttachment: true
    })
  }

  const mentionJids = [...new Set((mentions || []).map(String).filter(Boolean))]
  const interactiveMessage = proto.Message.InteractiveMessage.create({
    header,
    body: proto.Message.InteractiveMessage.Body.create({ text: String(body || '').trim() }),
    footer: proto.Message.InteractiveMessage.Footer.create({ text: settings.footer }),
    ...(mentionJids.length ? { contextInfo: { mentionedJid: mentionJids } } : {}),
    nativeFlowMessage: proto.Message.InteractiveMessage.NativeFlowMessage.create({
      buttons,
      messageParamsJson: '{}',
      messageVersion: 1
    })
  })

  const waMessage = generateWAMessageFromContent(jid, {
    viewOnceMessage: {
      message: {
        messageContextInfo: {
          deviceListMetadata: {},
          deviceListMetadataVersion: 2,
          // Mantido também no envelope para clientes antigos; o campo funcional
          // da menção fica em interactiveMessage.contextInfo.
          ...(mentionJids.length ? { mentionedJid: mentionJids } : {})
        },
        interactiveMessage
      }
    }
  }, {
    userJid: sock.user?.id
  })

  const bizNode = getBizBinaryNode(waMessage.message)
  const additionalNodes = isJidGroup(jid)
    ? [bizNode]
    : [{ tag: 'bot', attrs: { biz_bot: '1' } }, bizNode]

  await sock.relayMessage(jid, waMessage.message, {
    messageId: waMessage.key.id,
    additionalNodes
  })
  return waMessage
}

export async function sendQuickButtons({ sock, jid, body, buttons = [], logger, kind = 'quick-buttons', quoted = null, media = null, menuMedia = false, mentions = [], includeUpdateCta = false, includeVipCta = false }) {
  if (quoted) markCommandCta(quoted)
  const resolvedUpdateCta = Boolean(includeUpdateCta)
  const resolvedMedia = media || (menuMedia ? await getMenuMedia() : null)
  if (!buttons.length) throw new TypeError('Botões interativos vazios')
  const sent = await buildNativeInteractiveMessage({
    sock, jid, body: normalizeNativeBody(body, kind), quickReplies: buttons,
    media: resolvedMedia, quoted, mentions, includeUpdateCta: resolvedUpdateCta, includeVipCta: Boolean(includeVipCta)
  })
  registerInteractive(sent, { type: 'native-quick-replies', kind, jid, rows: buttons.length })
  logger?.success?.({ chat: jid, action: kind, count: buttons.length }, 'botões interativos enviados')
  return sent
}

export async function sendNativeList({ sock, jid, body, sections, logger, kind, buttonText = 'Abrir lista', quoted = null, image = null, media = null, menuMedia = true, mentions = [], includeUpdateCta = false, includeVipCta = false }) {
  if (quoted) markCommandCta(quoted)
  const prepared = prepareNativeSections(styleNativeSections(sections))
  const resolvedUpdateCta = Boolean(includeUpdateCta)
  const resolvedMedia = media || (image?.buffer ? { kind: 'image', ...image } : (menuMedia ? await getMenuMedia() : null))
  if (!prepared.sections.length) throw new TypeError('Lista interativa vazia')
  if (prepared.hiddenRows > 0) logger?.warn?.({ action: kind, count: prepared.hiddenRows, sections: prepared.totalSections }, 'linhas excedentes detectadas no menu')

  try {
    const sent = await buildNativeInteractiveMessage({
      sock,
      jid,
      body: normalizeNativeBody(body, kind),
      sections: prepared.sections,
      buttonText: styleButtonText(buttonText),
      media: resolvedMedia,
      quoted,
      mentions,
      includeUpdateCta: resolvedUpdateCta,
      includeVipCta: Boolean(includeVipCta)
    })
    registerInteractive(sent, { type: 'native-list', kind, jid, sections: prepared.sections.length, rows: prepared.visibleRows })
    logger?.success?.({
      chat: jid,
      format: resolvedMedia?.buffer ? `native-single-select-${resolvedMedia.kind || 'media'}` : 'native-single-select',
      sections: prepared.sections.length,
      count: prepared.visibleRows,
      id: sent?.key?.id,
      action: kind,
      bizNode: true,
      integratedMedia: Boolean(resolvedMedia?.buffer), mediaKind: resolvedMedia?.kind || ''
    }, 'lista interativa enviada por relay nativo')
    return sent
  } catch (error) {
    logger?.error?.({ error, chat: jid, action: kind, sections: prepared.sections.length, rows: prepared.visibleRows }, 'Native Flow falhou; menu não enviado porque o transporte interativo exige correção')
    throw error
  }
}

export async function sendCommandModel({ sock, msg, commands, command = null, selectedName = '', logger }) {
  markCommandCta(msg)
  const jid = msg?.key?.remoteJid || ''
  const visibleCommand = command || resolveCatalogEntry(commands, selectedName)
  if (!jid || !visibleCommand) return null
  const source = visibleCommand.sourceCommand || commands?.get?.(normalize(visibleCommand.menuSource || visibleCommand.name)) || visibleCommand
  const model = getCommandUsage(visibleCommand)
  const aliases = [...new Set(source.aliases || [])].filter(alias => normalize(alias) !== normalize(visibleCommand.name)).slice(0, 10)
  const body = [
    `*${settings.prefix}${String(visibleCommand.name || '').toUpperCase()}*`,
    describeCommand(visibleCommand),
    '',
    `*Categoria:* ${commandCategory(visibleCommand)}`,
    normalize(visibleCommand.name) !== normalize(source.name) ? `*Executado por:* ${settings.prefix}${source.name}` : '',
    visibleCommand.shortAlias ? `*Atalho rápido:* ${settings.prefix}${visibleCommand.shortAlias}` : '',
    aliases.length ? `*Outros atalhos:* ${aliases.map(alias => `${settings.prefix}${alias}`).join(', ')}` : '',
    `*Modelo:* ${model}`
  ].filter(Boolean).join('\n')
  const content = createSakuraCopyCard({ body: formatMessage(body, { title: 'COMANDO', width: 22 }), footer: settings.footer, buttonText: 'Copiar comando', copyText: model })
  const sent = await sock.sendMessage(jid, content)
  registerInteractive(sent, { type: 'command-model', command: visibleCommand.name, source: source.name, jid, model })
  logger?.success?.({ chat: jid, command: visibleCommand.name, alias: normalize(visibleCommand.name) !== normalize(source.name) ? source.name : undefined, id: sent?.key?.id }, 'modelo do comando enviado')
  return sent
}

export async function sendCommandList({ sock, msg, commands, category = '', logger }) {
  const jid = msg?.key?.remoteJid || ''
  if (!jid) return null
  const sections = categoryCommandSections(commands, category)
  if (!sections.length) {
    return reply(sock, msg, `Categoria não encontrada: ${category}\nUse ${settings.prefix}m para voltar.`, { title: 'CATÁLOGO' })
  }
  return sendNativeList({
    sock, jid, logger, quoted: msg, kind: `category:${category}`,
    body: formatMessage([`*${category}*`, 'Escolha sem pressa. A Sakura deixou só o que importa aqui.', 'Toque em uma opção; se ela precisar de dados, eu abro o modelo certo.'].join('\n'), { title: normalize(category) === normalize('Inteligência artificial') ? AI_MENU_TITLE : `OPÇÕES • ${String(category).toUpperCase()}` }),
    sections, buttonText: 'Ver comandos', includeUpdateCta: false
  })
}

export async function sendCompleteCommandCatalog({ sock, msg, commands, logger }) {
  const jid = msg?.key?.remoteJid || ''
  if (!jid) return null
  markCommandCta(msg)
  const body = buildCompleteCatalogText(commands)
  return sendNativeList({
    sock, jid, logger, quoted: null, kind: 'complete-catalog',
    body,
    buttonText: 'Opções do catálogo',
    includeUpdateCta: false,
    sections: [{
      title: 'Navegação',
      rows: [
        { id: `${settings.prefix}menu`, title: 'Menu principal', description: 'Voltar ao menu compacto' },
        { id: `${settings.prefix}m aliases 1`, title: 'Atalhos', description: 'Ver nomes alternativos e aliases' },
        { id: `${settings.prefix}m search`, title: 'Pesquisar', description: 'Encontrar um comando pelo nome ou função' }
      ]
    }]
  })
}

export async function sendCommandCatalog(options) {
  return sendCompleteCommandCatalog(options)
}

export async function sendAliasCatalog({ sock, msg, commands, page = 1, logger }) {
  const jid = msg?.key?.remoteJid || ''
  if (!jid) return null
  const catalog = catalogPageSections(commands, page, 'aliases')
  return sendNativeList({
    sock, jid, logger, quoted: msg, kind: `aliases:${catalog.page}`,
    body: formatMessage(`*atalhos da Sakura*\npágina ${catalog.page}/${catalog.totalPages}\nEscolha um nome curto para abrir o comando correspondente.`, { title: 'ATALHOS' }),
    sections: catalog.sections, buttonText: `Atalhos ${catalog.page}/${catalog.totalPages}`, includeUpdateCta: false
  })
}

export async function sendCommandSearch({ sock, msg, commands, query = '', logger }) {
  const jid = msg?.key?.remoteJid || ''
  if (!jid) return null
  const cleanQuery = String(query || '').trim()
  if (!cleanQuery) {
    return sendNativeList({
      sock, jid, logger, quoted: msg, kind: 'search-help',
      body: formatMessage(`Digite ${settings.prefix}m buscar palavra\nExemplo: ${settings.prefix}m buscar figurinha`, { title: 'PESQUISAR' }),
      buttonText: 'Buscas rápidas',
      includeUpdateCta: false,
      sections: [{
        title: 'Sugestões',
        rows: [
          { id: `${settings.prefix}m search economia`, title: 'Economia', description: 'Conta, banco, loja e jornadas' },
          { id: `${settings.prefix}m search figurinha`, title: 'Figurinhas', description: 'Sticker, Brat e créditos' },
          { id: `${settings.prefix}m search grupo`, title: 'Grupo', description: 'Administração e convivência' },
          { id: `${settings.prefix}m`, title: 'Menu principal', description: 'Voltar às categorias' }
        ]
      }]
    })
  }
  const results = searchEntries(commands, cleanQuery)
  if (!results.length) {
    return reply(sock, msg, `Nenhum comando encontrado para: ${cleanQuery}\nUse ${settings.prefix}comandos para abrir o catálogo.`, { title: 'PESQUISA' })
  }
  const sections = groupedEntrySections(results, { categoryInTitle: true })
  sections.push(navigationSection([
    { id: `${settings.prefix}m search`, title: 'Nova pesquisa', description: 'Ver exemplos de pesquisa' },
    { id: `${settings.prefix}comandos`, title: 'Catálogo completo', description: 'Ver todas as ações' },
    { id: `${settings.prefix}m`, title: 'Menu principal', description: 'Voltar às categorias' }
  ]))
  return sendNativeList({
    sock, jid, logger, quoted: msg, kind: `search:${normalize(cleanQuery)}`,
    body: formatMessage(`*${cleanQuery}*\n${results.length} resultado(s) encontrado(s).`, { title: 'PESQUISA', brandFooter: true }),
    sections, buttonText: 'Ver resultados', includeUpdateCta: false
  })
}

export async function sendSelectableCommandMenu({ sock, msg, commands, logger, requesterNumber = '' }) {
  const jid = msg?.key?.remoteJid || ''
  if (!jid) return null
  markCommandCta(msg)
  const sent = await sendNativeList({
    sock,
    jid,
    logger,
    quoted: null,
    kind: 'main-menu',
    body: buildMenuHeader(commands),
    sections: categorySections(commands, requesterNumber),
    buttonText: 'Abrir categorias',
    includeUpdateCta: true,
    includeVipCta: true
  })

  logger?.debug?.({ chat: jid, integratedImage: true, listSent: Boolean(sent), action: 'main-menu-complete' }, 'menu principal nativo concluído')
  return sent
}
