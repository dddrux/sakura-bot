import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { normalizeGroqBaseUrl } from './ai-provider-utils.js'
import { mirrorFileToBackupSync } from './persistent-mirror.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
export const rootDir = path.resolve(__dirname, '..')
const require = createRequire(import.meta.url)

const onlyDigits = value => String(value ?? '').replace(/\D/g, '')
const bool = (value, fallback) => value == null ? fallback : /^(1|true|yes|sim)$/i.test(String(value))
const number = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback
const clone = value => structuredClone(value)
const resolveRoot = value => path.resolve(rootDir, String(value || ''))

export const configDir = path.join(rootDir, 'config')
export const configPath = process.env.SAKURA_CONFIG_FILE || path.join(configDir, 'sakura.config.json')

const DEFAULT_CONFIG = Object.freeze({
  schemaVersion: 2,
  bot: { name: 'Sakura-MD', baseName: 'Sakura', codename: 'Hanami', number: '', prefix: '.', release: '2.0.0-rc.11', releaseChannel: 'v2-rc' },
  owners: [],
  ai: { enabled: true, provider: 'groq', baseUrl: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile', models: [], tokens: [], concurrency: 4, rotationMaxAttempts: 8, deferredRetryLimit: 2, maxDeferredRetryMs: 600000 },
  tts: { enabled: true, provider: 'microsoft', key: '', region: '', defaultVoice: 'pt-BR-GiovannaNeural', maxChars: 1200, voices: [] },
  ui: { emojis: ['💮', '🌸', '💮'], contentEmojis: ['💮', '🌸'], dividerEmoji: '🪷', footer: 'Sakura-MD • Drux Domina', updateChannel: 'https://whatsapp.com/channel/0029VbD1RJ39Bb5uJ7tk8a2Z', officialGroup: '', autoFormat: true, commandReactions: true, showReceivedMessages: true, menuImage: 'assets/menu/sakura-logo.png', menuMedia: 'assets/menu/sakura-menu.mp4', menuMediaFps: 60, vipMenuImage: 'assets/menu/sakura-vip-menu.png', menuThumbnail: 'assets/menu/sakura-menu-cover.jpg' },
  economy: { currencyName: 'Sakura Coins', currencyEmoji: '🪙', vipDailyMultiplier: 1.5, vipWorkMultiplier: 1.2 },
  vip: { enabled: true, contactNumber: '558199434137', priorityMultiplier: 2, freeMediaLimitMb: 48, vipMediaLimitMb: 95, plans: [{ key: 'bloom', name: 'Bloom', price: 4.99, days: 7 }, { key: 'prime', name: 'Prime', price: 8.99, days: 30 }, { key: 'hanami', name: 'Hanami', price: 13.99, days: 60 }] },
  donation: { pix: '5581999434137', name: 'Manassés Matheus de Souza Santana', tiers: [] },
  cache: { groupMetadataTtlMs: 120000, groupMetadataStaleMs: 300000, messageMax: 5000, messageTtlMs: 21600000, lidTtlMs: 21600000, profileTtlMs: 600000, commandTtlMs: 0 },
  queues: { maxConcurrentGroups: 8, autoMediaConcurrency: 6, autoMediaQueuePerChat: 6, messageConcurrency: 4, mediaConcurrency: 3, vipBurst: 3, maxPending: 1200, tiktokPerChat: 4, socialPerChat: 4, bulkPerMinute: 18, bulkMinDelayMs: 1800, bulkMaxDelayMs: 4200, bulkPerChatDelayMs: 2500 },
  runtime: { loginMode: 'qr', pairingNumber: '', logLevel: 'info', logFileLevel: 'debug', baileysLogLevel: 'warn', baileysLogFileLevel: 'debug', baileysDetailedDebug: false, versionTimeoutMs: 5000, maxReconnectAttempts: 8, reconnectBaseDelayMs: 1200, debugHeartbeatMs: 60000, baileysMaintenanceMs: 300000, staleSocketMs: 720000, versionRefreshMs: 21600000, autoResetInvalidSession: false, sendRetryCount: 1, autoTriggerCooldownMs: 12000, autoTriggerMaxAgeMs: 180000, contractSweepMs: 900000, automationSweepMs: 30000, welcomeBatchMs: 4000 },
  panel: { enabled: true, host: '127.0.0.1', port: 3000 },
  reception: { enabledByDefault: false, fields: ['nome', 'idade', 'cidade'], requireName: true, autoMention: true, title: 'RECEPÇÃO SAKURA' },
  games: { ticTacToeReward: 180, ticTacToeDrawReward: 60, ticTacToeTimeoutMs: 900000 },
  releaseAnnouncements: { enabled: true, channel: '', channelJid: '', lastAnnouncedVersion: '', lastMessageId: '', lastChannelJid: '', lastAnnouncedAt: 0 },
  autoDownload: { enabledByDefault: false, maxLinksPerMessage: 3 },
  paths: { database: 'storage/sakura-db.json', session: 'auth', logs: 'storage/logs', temp: 'storage/temp', updates: 'storage/updates', backups: 'storage/backups', cache: 'storage/cache', stickerLibrary: 'storage/sticker-library', commandMedia: 'storage/command-media', youtubeCookies: 'config/private/youtube-cookies.txt' }
})

function mergeConfig(base, next) {
  const out = clone(base)
  for (const [key, value] of Object.entries(next || {})) {
    if (value && typeof value === 'object' && !Array.isArray(value) && out[key] && typeof out[key] === 'object' && !Array.isArray(out[key])) out[key] = { ...out[key], ...value }
    else out[key] = clone(value)
  }
  return out
}

function ensureConfigFile() {
  fs.mkdirSync(configDir, { recursive: true })
  if (!fs.existsSync(configPath)) fs.writeFileSync(configPath, `${JSON.stringify(DEFAULT_CONFIG, null, 2)}\n`)
}

export function readConfig() {
  ensureConfigFile()
  let parsed = {}
  try { parsed = JSON.parse(fs.readFileSync(configPath, 'utf8')) } catch {}
  const merged = mergeConfig(DEFAULT_CONFIG, parsed)
  const owners = Array.isArray(merged.owners) ? merged.owners.map(owner => ({ ...owner, number: onlyDigits(owner?.number), enabled: owner?.enabled !== false })).filter(owner => owner.number) : []
  return Object.freeze({ ...merged, owners })
}

export function writeConfigSync(next = {}) {
  const current = readConfig()
  const patch = next.bot || next.owners || next.ai || next.tts || next.ui || next.runtime || next.paths || next.economy || next.vip || next.cache || next.queues || next.panel || next.reception || next.games || next.donation || next.releaseAnnouncements || next.autoDownload
    ? next
    : { bot: {
      name: next.botName ?? next.nomeBot ?? current.bot.name,
      number: onlyDigits(next.botNumber ?? next.numeroBot ?? current.bot.number),
      prefix: String(next.prefix ?? next.prefixo ?? current.bot.prefix).trim().slice(0, 4) || '.'
    }}
  const merged = mergeConfig(current, patch)
  if (Array.isArray(patch.owners)) merged.owners = patch.owners.map(owner => ({ ...owner, number: onlyDigits(owner?.number) })).filter(owner => owner.number)
  fs.mkdirSync(path.dirname(configPath), { recursive: true })
  const temp = `${configPath}.${process.pid}.tmp`
  fs.writeFileSync(temp, `${JSON.stringify(merged, null, 2)}\n`, { mode: 0o600 })
  fs.renameSync(temp, configPath)
  try { mirrorFileToBackupSync(configPath, 'config/sakura.config.json', { rootDir }) } catch {}
  return merged
}

export const config = readConfig()
const owner = config.owners.find(item => item.enabled !== false && item.role === 'owner') || config.owners.find(item => item.enabled !== false) || { name: 'Dono', number: '' }
const storageDir = path.join(rootDir, 'storage')

function resolveFfmpeg() {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH
  try { return require('@ffmpeg-installer/ffmpeg').path || 'ffmpeg' } catch { return 'ffmpeg' }
}

const runtime = config.runtime || {}
const cache = config.cache || {}
const queues = config.queues || {}
const ai = config.ai || {}
const tts = config.tts || {}
const ui = config.ui || {}
const paths = config.paths || {}
const panel = config.panel || {}
const vip = config.vip || {}
export const settings = {
  rootDir, configDir, configPath,
  release: config.bot.release || '2.0.0-rc.11', releaseChannel: config.bot.releaseChannel || 'v2-rc',
  botNumber: onlyDigits(config.bot.number), ownerNumber: onlyDigits(owner.number), owners: config.owners,
  prefix: String(config.bot.prefix || '.').slice(0, 4), botName: String(config.bot.name || 'Sakura-MD').slice(0, 80), ownerName: String(owner.name || 'Dono').slice(0, 80), baseName: config.bot.baseName || 'Sakura', codename: String(config.bot.codename || 'Hanami'), testMode: false,
  emojis: Object.freeze(Array.isArray(ui.emojis) && ui.emojis.length >= 3 ? ui.emojis.slice(0, 3) : ['💮', '🌸', '💮']),
  contentEmojis: Object.freeze(Array.isArray(ui.contentEmojis) && ui.contentEmojis.length >= 2 ? ui.contentEmojis.slice(0, 2) : ['💮', '🌸']), dividerEmoji: String(ui.dividerEmoji || '🪷'),
  currencyName: config.economy?.currencyName || 'Sakura Coins', currencyEmoji: config.economy?.currencyEmoji || '🪙',
  updateChannel: ui.updateChannel || 'https://whatsapp.com/channel/0029VbD1RJ39Bb5uJ7tk8a2Z', officialGroup: String(ui.officialGroup || '').trim(), footer: ui.footer || 'Sakura-MD • Drux Domina',
  ttsEnabled: tts.enabled !== false, ttsProvider: String(tts.provider || 'microsoft'), ttsKey: String(process.env.AZURE_SPEECH_KEY || tts.key || '').trim(), ttsRegion: String(process.env.AZURE_SPEECH_REGION || tts.region || '').trim(), ttsDefaultVoice: String(tts.defaultVoice || 'pt-BR-GiovannaNeural'), ttsMaxChars: Math.max(100, Math.min(5000, number(tts.maxChars, 1200))), ttsVoices: Object.freeze(Array.isArray(tts.voices) ? tts.voices.map(item => ({ ...item })) : []),
  autoFormatMessages: ui.autoFormat !== false, commandReactions: ui.commandReactions !== false, showReceivedMessages: ui.showReceivedMessages !== false,
  vipEnabled: vip.enabled !== false, vipContactNumber: onlyDigits(vip.contactNumber || '558199434137'), vipPlans: Object.freeze(Array.isArray(vip.plans) ? vip.plans.map(plan => ({ ...plan })) : []), donationPix: String(config.donation?.pix || ''), donationName: String(config.donation?.name || ''), donationTiers: Object.freeze(Array.isArray(config.donation?.tiers) ? config.donation.tiers.map(item => ({ ...item })) : []), vipPriorityMultiplier: Math.max(1, number(vip.priorityMultiplier, 2)), freeMediaLimitMb: Math.max(1, number(vip.freeMediaLimitMb, 48)), vipMediaLimitMb: Math.max(1, number(vip.vipMediaLimitMb, 95)), vipDailyMultiplier: Math.max(1, number(config.economy?.vipDailyMultiplier, 1.5)), vipWorkMultiplier: Math.max(1, number(config.economy?.vipWorkMultiplier, 1.2)),
  profilePictureTtlMs: Math.max(1000, number(cache.profilePictureTtlMs ?? cache.profileTtlMs, 600000)), mediaResultTtlMs: Math.max(1000, number(cache.mediaResultTtlMs, 900000)), aiResponseTtlMs: Math.max(1000, number(cache.aiResponseTtlMs, 120000)),
  messageConcurrency: Math.max(1, number(queues.messageConcurrency, 4)), mediaConcurrency: Math.max(1, number(queues.mediaConcurrency, 3)), vipBurst: Math.max(1, number(queues.vipBurst, 3)), maxPendingMessages: Math.max(20, number(queues.maxPending, 1200)),
  receptionConfig: config.reception || {}, ticTacToeReward: Math.max(0, number(config.games?.ticTacToeReward, 180)), ticTacToeDrawReward: Math.max(0, number(config.games?.ticTacToeDrawReward, 60)), ticTacToeTimeoutMs: Math.max(60000, number(config.games?.ticTacToeTimeoutMs, 900000)),
  loginMode: String(process.env.LOGIN_MODE || runtime.loginMode || 'qr').toLowerCase() === 'pair' ? 'pair' : 'qr',
  pairingNumber: onlyDigits(process.env.PAIRING_NUMBER || runtime.pairingNumber || config.bot.number),
  logLevel: String(process.env.LOG_LEVEL || runtime.logLevel || 'info').toLowerCase(), baileysLogLevel: String(process.env.BAILEYS_LOG_LEVEL || runtime.baileysLogLevel || 'warn').toLowerCase(),
  logFileLevel: String(process.env.LOG_FILE_LEVEL || runtime.logFileLevel || 'debug').toLowerCase(), baileysLogFileLevel: String(process.env.BAILEYS_LOG_FILE_LEVEL || runtime.baileysLogFileLevel || 'debug').toLowerCase(),
  versionTimeoutMs: number(process.env.WA_VERSION_TIMEOUT_MS, runtime.versionTimeoutMs || 5000), autoResetInvalidSession: bool(process.env.AUTO_RESET_INVALID_SESSION, runtime.autoResetInvalidSession || false),
  maxReconnectAttempts: number(process.env.MAX_RECONNECT_ATTEMPTS, runtime.maxReconnectAttempts || 8), reconnectBaseDelayMs: number(process.env.RECONNECT_BASE_DELAY_MS, runtime.reconnectBaseDelayMs || 1200), debugHeartbeatMs: number(process.env.DEBUG_HEARTBEAT_MS, runtime.debugHeartbeatMs || 60000),
  baileysMaintenanceMs: number(process.env.BAILEYS_MAINTENANCE_MS, runtime.baileysMaintenanceMs || 300000), staleSocketMs: number(process.env.BAILEYS_STALE_SOCKET_MS, runtime.staleSocketMs || 720000), versionRefreshMs: number(process.env.BAILEYS_VERSION_REFRESH_MS, runtime.versionRefreshMs || 21600000),
  baileysDetailedDebug: bool(process.env.BAILEYS_DETAILED_DEBUG, runtime.baileysDetailedDebug || false),
  groupMetadataTtlMs: number(process.env.GROUP_METADATA_TTL_MS, cache.groupMetadataTtlMs || 120000), groupMetadataStaleMs: number(process.env.GROUP_METADATA_STALE_MS, cache.groupMetadataStaleMs || 300000),
  messageCacheMax: number(process.env.MESSAGE_CACHE_MAX, cache.messageMax || 5000), messageCacheTtlMs: number(process.env.MESSAGE_CACHE_TTL_MS, cache.messageTtlMs || 21600000), lidCacheTtlMs: number(process.env.LID_CACHE_TTL_MS, cache.lidTtlMs || 21600000),
  sendRetryCount: number(process.env.SEND_RETRY_COUNT, runtime.sendRetryCount ?? 1), autoTriggerCooldownMs: number(process.env.AUTO_TRIGGER_COOLDOWN_MS, runtime.autoTriggerCooldownMs || 12000), autoTriggerMaxAgeMs: number(process.env.AUTO_TRIGGER_MAX_AGE_MS, runtime.autoTriggerMaxAgeMs || 180000),
  deleteMenuSelections: false, ffmpegPath: resolveFfmpeg(), panelHost: process.env.PANEL_HOST || panel.host || '127.0.0.1', panelPort: number(process.env.PANEL_PORT, panel.port || 3000),
  dataDir: path.join(rootDir, 'data'), storageDir,
  databaseFile: process.env.SAKURA_DB_FILE || resolveRoot(paths.database || 'storage/sakura-db.json'),
  sessionDir: resolveRoot(paths.session || 'auth'), logsDir: resolveRoot(paths.logs || 'storage/logs'), tmpDir: resolveRoot(paths.temp || 'storage/temp'), updatesDir: resolveRoot(paths.updates || 'storage/updates'), backupsDir: resolveRoot(paths.backups || 'storage/backups'), cacheDir: resolveRoot(paths.cache || 'storage/cache'),
  economyDb: 'economy', triggersDb: 'auto-replies', panelDb: 'web-panel', afkDb: 'afk', runtimeDb: 'runtime', protectionDb: 'protection', rentalDb: 'rentals', vipDb: 'vip', socialDb: 'social', coreDb: 'core', stickerLibraryDb: 'stickers', aiDb: 'ai', automationDb: 'automation', commandMediaDb: 'command-media',
  privateProtectionDb: 'private-protection', globalMorningDb: 'global-morning', groupScheduleDb: 'group-schedule', funMediaDb: 'fun-media',
  scriptsDir: path.join(rootDir, 'data', 'scripts'), vendorDir: path.join(rootDir, 'data', 'vendor'), commandsDir: path.join(rootDir, 'commands'),
  assetsDir: path.join(rootDir, 'assets'), audioDir: path.join(rootDir, 'assets', 'audio'), stickerDir: path.join(rootDir, 'assets', 'stickers'), stickerLibraryDir: resolveRoot(paths.stickerLibrary || 'storage/sticker-library'), commandMediaDir: resolveRoot(paths.commandMedia || 'storage/command-media'),
  menuImageDir: path.join(rootDir, 'assets', 'menu'), menuLogoPath: resolveRoot(ui.menuImage || 'assets/menu/sakura-logo.png'), menuMediaPath: resolveRoot(ui.menuMedia || 'assets/menu/sakura-menu.mp4'), menuMediaFps: Math.max(1, Math.min(60, number(ui.menuMediaFps, 60))), menuThumbnailPath: resolveRoot(ui.menuThumbnail || 'assets/menu/sakura-menu-cover.jpg'), vipMenuLogoPath: resolveRoot(ui.vipMenuImage || 'assets/menu/sakura-vip-menu.png'),
  youtubeCookieFile: resolveRoot(paths.youtubeCookies || 'config/private/youtube-cookies.txt'),
  aiEnabled: ai.enabled !== false, aiModels: Object.freeze(Array.isArray(ai.models) ? ai.models.map(item => ({ ...item })) : []), aiProvider: ai.provider || 'groq', aiTokens: Array.isArray(ai.tokens) ? ai.tokens : [], aiBaseUrl: normalizeGroqBaseUrl(process.env.GROQ_BASE_URL || ai.baseUrl, { allowCustom: Boolean(process.env.GROQ_BASE_URL) }), aiModel: process.env.GROQ_MODEL || ai.model || 'llama-3.3-70b-versatile',
  aiConcurrency: Math.max(1, Math.min(16, number(process.env.AI_CONCURRENCY, ai.concurrency || 4))), aiRotationMaxAttempts: Math.max(1, Math.min(40, number(process.env.AI_ROTATION_MAX_ATTEMPTS, ai.rotationMaxAttempts || 8))), aiDeferredRetryLimit: Math.max(0, Math.min(8, number(process.env.AI_DEFERRED_RETRY_LIMIT, ai.deferredRetryLimit || 2))), aiMaxDeferredRetryMs: Math.max(15000, Math.min(3600000, number(process.env.AI_MAX_DEFERRED_RETRY_MS, ai.maxDeferredRetryMs || 600000))),
  maxConcurrentGroups: Math.max(1, number(process.env.MAX_CONCURRENT_GROUPS, queues.maxConcurrentGroups || 8)), autoMediaConcurrency: Math.max(1, number(process.env.AUTO_MEDIA_CONCURRENCY, queues.autoMediaConcurrency || 6)), autoMediaQueuePerChat: Math.max(1, number(process.env.AUTO_MEDIA_QUEUE_PER_CHAT, queues.autoMediaQueuePerChat || 6)),
  contractSweepMs: Math.max(60000, number(process.env.CONTRACT_SWEEP_MS, runtime.contractSweepMs || 900000)), automationSweepMs: Math.max(15000, number(process.env.AUTOMATION_SWEEP_MS, runtime.automationSweepMs || 30000)), welcomeBatchMs: Math.max(1500, number(process.env.WELCOME_BATCH_MS, runtime.welcomeBatchMs || 4000)),
  tiktokAutoQueuePerChat: Math.max(1, Math.min(10, number(process.env.TIKTOK_AUTO_QUEUE_PER_CHAT, queues.tiktokPerChat || 4))), socialAutoQueuePerChat: Math.max(1, Math.min(10, number(process.env.SOCIAL_AUTO_QUEUE_PER_CHAT, queues.socialPerChat || 4))),
  releaseAnnouncements: Object.freeze({ ...(config.releaseAnnouncements || {}) }), autoDownloadEnabledByDefault: config.autoDownload?.enabledByDefault === true, autoDownloadMaxLinksPerMessage: Math.max(1, Math.min(10, number(config.autoDownload?.maxLinksPerMessage, 3))),
  bulkSendMinDelayMs: Math.max(500, number(process.env.BULK_SEND_MIN_DELAY_MS, queues.bulkMinDelayMs || 1800)), bulkSendMaxDelayMs: Math.max(1000, number(process.env.BULK_SEND_MAX_DELAY_MS, queues.bulkMaxDelayMs || 4200)), bulkSendPerMinute: Math.max(3, Math.min(60, number(process.env.BULK_SEND_PER_MINUTE, queues.bulkPerMinute || 18))), bulkSendPerChatDelayMs: Math.max(500, number(process.env.BULK_SEND_PER_CHAT_DELAY_MS, queues.bulkPerChatDelayMs || 2500))
}

let ownersConfigMtime = -1
function liveOwners() {
  try {
    const mtime = fs.statSync(configPath).mtimeMs
    if (mtime !== ownersConfigMtime) {
      const next = readConfig().owners
      settings.owners = next
      ownersConfigMtime = mtime
    }
  } catch {}
  return Array.isArray(settings.owners) ? settings.owners : []
}

export function isConfiguredOwner(numberValue = '') {
  const key = onlyDigits(numberValue)
  return Boolean(key && liveOwners().some(item => item.enabled !== false && item.number === key))
}

export function syncConnectedBotNumber(value = '') {
  const digits = onlyDigits(value)
  if (digits.length < 10) return { changed: false, number: settings.botNumber || '' }
  const changed = settings.botNumber !== digits
  settings.botNumber = digits
  settings.pairingNumber = digits
  if (changed) {
    try { writeConfigSync({ bot: { ...readConfig().bot, number: digits } }) } catch {}
  }
  return { changed, number: digits }
}

export const ICE_EMOJIS = Object.freeze([...settings.emojis])
export const TEST_NOTICE = `${settings.emojis[0]} SAKURA-MD V2`
