# Sakura-BOT (Sakura-MD V2 RC11)

Bot de WhatsApp em Node.js (ESM) sobre fork do Baileys (`data/vendor`).

## Requisitos
- Node >= 22.5, npm >= 10
- ffmpeg (opcional via `@ffmpeg-installer/ffmpeg`), sharp (opcional; em ARM use ImageMagick)
- Internet no primeiro start: o `yt-dlp` é baixado para `storage/bin/`

## Rodar
```
npm run install:full   # ou install:core
npm run configure      # donos, tokens, config/sakura.config.json
npm start              # prestart roda bootstrap-deps + preflight
npm run doctor         # diagnóstico
npm run reset-session  # apaga auth/ e pareia de novo
```

## Terminal da Sakura
Ao rodar `npm start` num terminal aparece o prompt `sakura›` (Tab completa comandos e opções; `SAKURA_NO_CONSOLE=1` desliga).
- `assistente` — configura nome, números, dono, prefixo, IA e painel passo a passo (Enter mantém o valor)
- `config` / `config <seção>` / `config <seção.chave> <valor>` — ver e alterar opções (segredos aparecem mascarados)
- `dono`, `prefixo`, `nome` — atalhos de configuração; prefixo, nome, IA, rodapé e donos valem na hora
- `status`, `grupos`, `enviar`, `auto`, `log`, `backup`, `reconectar`, `limpar`, `sair`; `ajuda` lista tudo

Sem iniciar o bot: `npm run configure` abre o mesmo assistente.

## Testes
`npm test` roda a suíte principal. Testes por versão: `npm run test:<nome>` (ver `package.json`).

## Pastas
- `index.js` — entrada: restaura backup, abre store, inicia cliente
- `commands/` — um arquivo por comando (ver `commands/README.md`)
- `data/` — serviços e lógica (mapa em `docs/mapa.md`)
- `config/` — `sakura.config.json`, personalidade da IA, `private/` (segredos)
- `storage/` — DB (`sakura-db.json`), logs, cache, binários (regenerável, exceto o DB)
- `auth/` — sessão WhatsApp (**secreto**)
- `backup/` — espelho automático de config/db/auth (recriado pelo bot)
- `assets/` — áudios, figurinhas, menu, tarot

Pendências: `PENDENCIAS.md`.
