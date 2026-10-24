# Mapa do código (1 linha por arquivo)

## Raiz
- index.js — entrada; backup → core-store → client

## data/ — núcleo
- client.js — conexão Baileys, eventos
- handler.js — roteia mensagens para commands/
- runtime.js, settings.js, session.js — estado e config em execução
- core-store.js, database.js, cache.js — banco `sakura-db.json` e cache
- backup-manager.js, persistent-mirror.js — backup/restauração em `backup/`
- logger.js, terminal-theme.js, platform.js, env.js — log, terminal, SO, .env
- jid.js, mentions.js, targets.js, target-resolution.js — JIDs e alvos
- permissions.js, superuser.js, private-protection.js, protection-store.js, anti-link.js — acesso e proteções
- reply.js, messages.js, formatter.js, duration.js, ranking-format.js — textos e formatação
- send-manager.js, bulk-send-queue.js, priority-scheduler.js, semaphore.js, media-priority.js — filas de envio
- signal-repair.js — reparo de sessão Signal
- command-correction.js, short-aliases.js, command-ui-state.js, interactive.js — UX de comandos

## data/ — recursos
- ai-*.js — IA (client, engine, store, tokens, wake, guia, falhas)
- afk.js, reception.js, group-admin.js, group-automations.js, group-schedule-store.js, zenk-group-status.js — grupos
- automation-*.js, auto-media-balance.js, fun-media-store.js, global-morning-store.js — automações e mídia
- economy*.js, rentals.js, contracts-scheduler.js, social-*.js, tictactoe.js, tarot.js, calculator.js — economia, social, jogos
- music*.js, play-manager.js, player/ (yt-dlp-engine, cookies), auto-download.js, social-downloader.js, pinterest-search.js — downloads e música
- media*.js, brat-*.js, sticker-*.js, legacy-audio.js, microsoft-tts.js — mídia, figurinhas, áudio, TTS
- panel.js, panel-security.js, release-announcer.js, official-links.js — painel e avisos

## data/scripts/ — manutenção
- setup, configure, doctor, preflight, check, bootstrap-deps, patch-dependencies, reset-session, make-update, new-command, clean-test-artifacts, release-audit — utilitários
- test-*.js — testes por versão (a enxugar)

## Outros
- commands/*.js — um comando por arquivo
- data/vendor/ — `sakura-baileys` (fork principal) e tgz whiskeysockets (usado só em zenk-group-status.js)
