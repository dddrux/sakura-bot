# Backup persistente da Sakura-MD RC11

Esta pasta é persistente e deve ser preservada durante atualizações.

## Como atualizar e restaurar

1. Pare a Sakura normalmente.
2. Preserve a pasta `backup/` na raiz da instalação.
3. Extraia a nova versão por cima da instalação, sem apagar `backup/`.
4. Inicie com `npm start`.
5. Antes de carregar configurações, banco, sessão e runtime, a Sakura restaura automaticamente o conteúdo de `backup/`.

A partir deste fix, alterações em `config/sakura.config.json` (incluindo donos/tokens/configurações) e em `storage/sakura-db.json` (incluindo contratos, VIP, economia, subdonos, recepção e demais namespaces) também são espelhadas imediatamente em `backup/`, além dos snapshots periódicos e no desligamento seguro.

A restauração automática aceita backups RC10/RC11 com manifest e também conteúdo válido sem manifest.

Itens preservados: `.env` (quando existir), `config/sakura.config.json`, `config/ai-personality.txt`, `config/private/`, `auth/`, `storage/sakura-db.json` e bibliotecas persistentes de mídia/figurinhas.

`auth/.process.lock` nunca é salvo nem restaurado.
