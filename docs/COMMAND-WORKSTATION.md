# Sakura-MD V2 RC6 — Command Workstation

A workstation é baseada em `defineCommand()` e mantém a implementação livre: um comando pode ser pequeno ou orquestrar IA, mídia, banco JSON, botões, filas e tarefas assíncronas sem trocar de API.

## Local dos comandos

```text
commands/<nome>.js
```

Use:

```bash
npm run new:command -- nome "Categoria"
```

Serviços compartilhados ficam em `data/`; assets ficam em `assets/`; estado persistente estruturado fica em `storage/sakura-db.json`; autenticação fica em `/auth` na raiz.

## Contrato recomendado

```js
export default defineCommand({
  name: 'exemplo',
  aliases: ['ex'],
  category: 'Principal',
  usage: '.exemplo <texto>',
  description: 'Faz uma ação de exemplo.',
  ownerOnly: false,
  subownerAllowed: false,
  adminOnly: false,
  botAdminOnly: false,
  groupOnly: false,
  privateOnly: false,
  vipOnly: false,
  vipPreferred: false,
  cooldownMs: 3000,
  menuEntries: [
    {
      name: 'exemplo',
      usage: '.exemplo <texto>',
      description: 'Faz uma ação de exemplo.',
      menuGroup: 'Utilidades'
    }
  ],
  slash: {
    model: '.exemplo SEU TEXTO',
    categories: ['principal'],
    copyable: true
  },
  async execute(ctx) {
    // lógica livre
  }
})
```

## Regras da RC6

- Toda ação visível deve ter nome completo útil e alias curto único.
- Prefira `xxx on|off|status` em vez de três comandos quase iguais.
- `description` e `usage` devem ser objetivos porque menus e ajuda local da IA os reutilizam.
- `🪷` é apenas divisor; conteúdo usa `💮`/`🌸`; moeda usa `🪙`.
- Use `reply()` para ganhar formatação e quebra inteligente de linhas.
- Use `sendNativeList()` para listas/categorias; ele aplica a mídia de menu configurada.
- Use `firstTargetJid()` para alvo por menção ou resposta.
- Use `groupDisplayName()`/normalizadores centrais para não vazar JID como nome.
- Use `getVipBenefits()` quando limites/recompensas dependem de Bloom/Prime/Hanami.
- Reutilize o yt-dlp central para YouTube e `media-delivery.js` para envio confiável de mídia + botões.
- Não crie SQLite, banco paralelo ou diretório de sessão fora de `/auth`.
- Tokens de IA ficam em `config/sakura.config.json` e são rotacionados pelo engine.

## Contexto

O handler injeta, conforme o comando:

```text
sock, msg, args, rawArgs, text, settings,
senderNumber, chatNumber, metadata,
isGroup, isAdmin, isBotAdmin,
isOwner, isSubowner, isVip,
priority, role, logger, commands,
invokedAs, rawInvokedAs, canonicalAction, sendFast
```

## Subcomandos e aliases

Aliases são atalhos, não títulos de menu. O handler canonicaliza o alias antes de executar a ação e preserva `rawInvokedAs` para diagnóstico.

Exemplo de módulo único:

```text
.setmidia on play
.setmidia off play
.setmidia status play
```

## Formatação

`data/formatter.js` limita largura visual quebrando frases longas em linhas menores. Isso mantém bordas e conteúdo legíveis no celular. Mensagem já moldurada não é envolvida de novo.

## Mídia de menu

`config/sakura.config.json → ui.menuMedia` aponta para `assets/menu/sakura-menu.mp4`. `data/interactive.js` detecta vídeo/imagem e prepara o header correspondente. A configuração `ui.menuMediaFps` é limitada a 60.

## IA e ajuda de comandos

`data/ai-command-guide.js` pesquisa primeiro o catálogo carregado. Isso atende perguntas de uso sem gastar uma chamada LLM quando a resposta já está no metadata do comando. Caso não seja possível resolver localmente, o engine pode continuar para a IA.

## Persistência

Use `openDatabase(namespace, defaults)` dos stores em `data/`. Todos os namespaces são serializados no único `storage/sakura-db.json` por gravação atômica.

## Verificação

```bash
npm run check
npm run test:v2
npm run test:ytdlp
node data/scripts/test-play-card.js
npm run release:audit
```
