import { collectRentalNotices } from './rentals.js'
import { collectVipNotices } from './vip.js'
import { expiryDateLabel, formatRemaining } from './duration.js'

let timer = null
let running = false

function stageLabel(stage) {
  if (stage === 1) return 'menos de 3 dias'
  if (stage === 2) return 'menos de 24 horas'
  if (stage === 3) return 'menos de 1 hora'
  return 'expirado'
}

async function runSweep(sock, logger) {
  if (running || !sock) return
  running = true
  try {
    const [rentals, vips] = await Promise.all([collectRentalNotices(), collectVipNotices()])
    for (const row of rentals) {
      try {
        const text = row.expired
          ? '💮 *Contrato expirado.*\nA Sakura ficará silenciosa neste grupo até uma renovação do dono ou subdono.'
          : `💮 *Aviso de contrato*\nTempo restante: ${formatRemaining(row)}.\nVencimento: ${expiryDateLabel(row.expiresAt)}.\nFaixa: ${stageLabel(row.stage)}.`
        await sock.sendMessage(row.chat, { text })
      } catch (error) {
        logger?.warn?.({ error, chat: row.chat, stage: row.stage }, 'falha ao enviar aviso de contrato')
      }
    }
    for (const row of vips) {
      try {
        const jid = `${row.number}@s.whatsapp.net`
        const text = row.expired
          ? '🌸 *Seu Sakura VIP expirou.*\nOs benefícios foram desativados, mas seu histórico foi preservado.'
          : `🌸 *Aviso Sakura VIP*\nTempo restante: ${formatRemaining(row)}.\nVencimento: ${expiryDateLabel(row.expiresAt)}.\nFaixa: ${stageLabel(row.stage)}.`
        await sock.sendMessage(jid, { text })
      } catch (error) {
        logger?.warn?.({ error, user: row.number, stage: row.stage }, 'falha ao enviar aviso VIP')
      }
    }
    if (rentals.length || vips.length) logger?.info?.({ rentals: rentals.length, vips: vips.length }, 'avisos persistentes de contratos processados')
  } catch (error) {
    logger?.warn?.({ error }, 'varredura de contratos falhou sem interromper a Sakura')
  } finally {
    running = false
  }
}

export function startContractScheduler(sock, logger, intervalMs = 15 * 60_000) {
  stopContractScheduler()
  const safeInterval = Math.max(60_000, Math.floor(Number(intervalMs) || 15 * 60_000))
  void runSweep(sock, logger)
  timer = setInterval(() => void runSweep(sock, logger), safeInterval)
  timer.unref?.()
  return stopContractScheduler
}

export function stopContractScheduler() {
  if (timer) clearInterval(timer)
  timer = null
  running = false
}

export async function runContractSweepOnce(sock, logger) {
  return runSweep(sock, logger)
}
