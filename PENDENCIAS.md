# PENDENCIAS — Sakura-BOT (fonte da verdade)

## Feito
- limpeza.1: removidos logs, cache, temp, yt-dlp (rebaixa sozinho), .ptt-cache, backup/ duplicado (regenera), docs/superpowers, .process.lock. Adicionado .gitignore.

- patchDocs.1: README.md e docs/mapa.md criados; vendor/tgz confirmado em uso (zenk-group-status.js), manter.
- patchTerm.1: console interativo (data/terminal-console.js: ajuda, status, grupos, enviar, log, auto, backup, reconectar, limpar, sair), novo formato de log alinhado (terminal-theme.js), sem cor fora de TTY/NO_COLOR, QR/diagnóstico padronizados. SAKURA_NO_CONSOLE=1 desativa.
- patchMenu.1/.2: menus do WhatsApp padronizados em data/menu-style.js (fonte única): padrão 💮/🌸 alternado por posição em listas, botões, cabeçalho e catálogo (emoji de origem ignorado), seção sempre 🪷, link 🔗; Ranks/Rankings unificados; cabeçalho sem duplicação/negrito duplo. formatter.js e config de tema intactos. backup/.gitkeep restaurado.

- patchReadme.1: README reescrito (emojis só 💮/🌸/🪷/🔗, sem logo, sem rodapé Drux Domina, seção Criando comandos, alertas nativos); banner.svg quadrado só com pétalas; chat-demo.svg com foto de perfil real embutida (base64). (VIS) conferir renderização no GitHub.

- patchReadme.2: banner largo (1200x300, cantos retos, só pétalas); chat-demo.svg em tema escuro estilo WhatsApp (status bar, header com vídeo/ligação, input com ícones); removida a conversa em texto; tabela da Visão geral com cabeçalho; commit.sh + `npm run commit`. (VIS) conferir no GitHub.

0. patchMenu.3: auditar fora do menu os pontos que quebram o padrão 💮/🌸 (ex.: economy-ui.js `ready ? '🌸' : '🌸'`, linhas com emoji fixo repetido em commands/economy.js, fun.js, pvp.js, tutorial.js).
0b. patchMenu.4: revisar textos/título de commands/menu.js e data/short-aliases.js.
1. data/scripts: ~100 test-v*.js de versões antigas; consolidar e enxugar scripts do package.json.
2. auth/: 1372 lid-mapping + 809 pre-key (sessão viva; só limpar com reset-session se o usuário quiser).

## Não mexer
- auth/ (sessão), config/, storage/sakura-db.json, assets/.

## Ambiente
- Sem node_modules no sandbox: test-menu e test-handler não rodam aqui (dependência ausente, pré-existente). Rodar `npm test` na máquina real.
- ATENÇÃO: rodar testes sempre numa CÓPIA do projeto (cp -r); vários testes reescrevem config/sakura.config.json e storage/sakura-db.json.
