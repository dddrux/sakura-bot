# Workstation de comandos — Sakura-MD V2 RC6

Todos os comandos novos entram por:

```text
commands/<nome>.js
```

Se a lógica crescer, mantenha o ponto de entrada em `commands/` e extraia serviços reutilizáveis para `data/<dominio>.js`. Não crie um segundo sistema de fila, banco, parser de JID ou formatter dentro de um comando.

## Gerador

```bash
npm run new:command -- exemplo "Principal"
```

## Estrutura mínima

```js
import { defineCommand } from '../data/workstation.js'
import { reply } from '../data/reply.js'

export default defineCommand({
  name: 'exemplo',
  aliases: ['ex'],
  category: 'Principal',
  usage: '.exemplo <texto>',
  description: 'Exemplo Sakura.',
  menuEntries: [
    {
      name: 'exemplo',
      usage: '.exemplo <texto>',
      description: 'Exemplo Sakura.',
      menuGroup: 'Utilidades'
    }
  ],
  async execute(ctx) {
    const { sock, msg, args } = ctx
    return reply(sock, msg, `Você escreveu: ${args.join(' ')}`)
  }
})
```

## `defineCommand()`

Campos mais usados:

- `name`: nome canônico.
- `aliases`: atalhos. O carregador garante alias curto único para ações visíveis sem atalho adequado.
- `category`: categoria principal.
- `usage`: modelo copiável.
- `description`: explicação curta usada em menus e pela ajuda local da IA.
- `menuEntries`: subações visíveis sem criar vários arquivos.
- `ownerOnly`: dono ou superusuário.
- `subownerAllowed`: subdono pode acessar quando a função administrativa permitir.
- `adminOnly`: exige admin do grupo ou superusuário do emissor.
- `botAdminOnly`: a conta da Sakura precisa ser admin real no grupo.
- `groupOnly` / `privateOnly`.
- `vipOnly`: exige VIP/dono/superusuário.
- `vipPreferred`: eleva prioridade de fila.
- `antifloodCost` e `cooldownMs`.
- `slash`: modelo/categorias copiáveis.
- `execute(ctx)`: lógica livre, inclusive assíncrona.

## Contexto de execução

Dependendo do fluxo, `ctx` fornece:

```text
sock
msg
args
rawArgs
text
commands
settings
logger
invokedAs
rawInvokedAs
canonicalAction
senderNumber
chatNumber
isGroup
isAdmin
isBotAdmin
isOwner
isSubowner
isVip
priority
role
metadata
ui
sendFast
```

O número da própria conta conectada é superusuário automático do bot.

## Subcomandos

Prefira uma API coerente:

```text
.bemvindo on
.bemvindo off
.bemvindo status
```

em vez de criar arquivos `bemvindoon.js`, `bemvindooff.js` etc. Aliases antigos podem continuar aceitos sem aparecer como itens separados no menu.

```js
menuEntries: [
  {
    name: 'bemvindo',
    usage: '.bemvindo on|off|status',
    description: 'Configura as boas-vindas.',
    menuGroup: 'Recepção'
  }
]
```

## Respostas e formatação

Texto comum:

```js
return reply(sock, msg, 'Sua mensagem', { title: 'TÍTULO' })
```

O formatter central:

- usa `🪷` só nas divisórias;
- usa `💮`/`🌸` no conteúdo;
- quebra linhas longas automaticamente;
- não duplica uma moldura já pronta.

Não monte dezenas de variações de borda manualmente dentro de comandos.

## Menus e Native Flow

Use `sendNativeList()` de `data/interactive.js`. Menus comuns recebem automaticamente a mídia configurada em `ui.menuMedia`, atualmente um MP4 60 FPS.

Botões devem ter texto curto e português natural, começando com maiúscula quando aplicável.

Links oficiais vêm de:

```json
"ui": {
  "updateChannel": "https://whatsapp.com/channel/...",
  "officialGroup": ""
}
```

Não envie uma segunda mensagem escrita “Atualizações oficiais da Sakura”. Use as ações oficiais existentes.

## Mídia

Para comandos que produzem sticker/áudio e depois mostram ações, use `data/media-delivery.js`. Ele garante ordem:

```text
mídia real → confirmação do envio, sem CTA concorrente
```

Prefira `Buffer` para arquivos locais já gerados, evitando `{ url: caminhoLocal }` quando a mídia precisa sobreviver ao atraso entre geração e upload.

Para YouTube, reutilize `data/player/yt-dlp-engine.js`. `.play` é yt-dlp-only.

## Menções, JIDs e grupos

Não leia apenas `mentionedJid`.

```js
import { firstTargetJid } from '../data/targets.js'
const target = firstTargetJid(msg, args)
```

O resolvedor aceita menção, número e autor da mensagem respondida.

Para nomes de grupo:

```js
import { groupDisplayName } from '../data/user-display.js'
const groupName = await groupDisplayName(sock, msg.key.remoteJid, metadata)
```

Não exiba `1203...@g.us` quando um assunto de grupo puder ser resolvido.

## JSON e configuração

Não use SQLite. O banco central é `storage/sakura-db.json` e os stores ficam em `data/`.

Configuração permanente fica em `config/sakura.config.json`. Isso inclui links, IA, tokens, TTS, VIP, doações, filas e paths.

Sessão não fica no banco: fica em `/auth` na raiz.

## IA

Antes de gastar tokens para explicar um comando, use/integre o catálogo local. O `data/ai-command-guide.js` já sabe pesquisar aliases/descrições e montar respostas breves.

Tokens ficam em `ai.tokens` em texto simples e são rotacionados pelo `data/ai-engine.js`. Não crie criptografia paralela nem grave token em arquivo de comando.

## VIP

Quando comportamento depende do plano, use:

```js
import { getVipBenefits } from '../data/vip.js'
const benefits = await getVipBenefits(senderNumber)
```

Assim Bloom, Prime e Hanami podem ter limites de mídia, multiplicadores e prioridade realmente diferentes.

## Sakura Coins

O nome é `Sakura Coins` e o emoji é `🪙`. Leia sempre de `settings.currencyName`/`settings.currencyEmoji` em vez de hardcode.

## Checklist de um comando novo

1. Criar `commands/<nome>.js` com `defineCommand()`.
2. Definir `usage` e `description` úteis — a IA reutiliza esses campos.
3. Adicionar `menuEntries` se houver subações.
4. Usar resolvedores centrais de alvo/JID/grupo.
5. Usar `reply()`/`sendNativeList()`/media-delivery.
6. Reutilizar JSON, filas e caches existentes.
7. Rodar:

```bash
npm run check
npm run test:v2
npm run release:audit
```


## Política de links oficiais

`officialLinks` agora é **opt-in**. Todo comando nasce com `officialLinks: false`; somente superfícies seguras que realmente precisam dos links externos devem declarar `officialLinks: true` ou `includeUpdateCta: true`. O menu/catálogos fazem isso explicitamente. Respostas administrativas, de dono, IA, mídia, áudio, vídeo e stickers nunca recebem esses botões por herança.

### Figurinhas e metadata

Comandos que geram WebP devem usar `addSakuraStickerMetadata()` e `buildSakuraStickerDescription()` de `data/sticker-metadata.js`. O nome do grupo deve vir de `groupDisplayName()`; não grave JID bruto no metadata.

## RC9: toggles, IA, hierarquia e AutoDownload

- Para configurações `on/off`, prefira `sendQuickButtons()` com ações `Ativar`, `Desativar` e `Ver estado`; mantenha também a sintaxe textual.
- Modelos da IA ficam em `ai.models` no `config/sakura.config.json`; `.iaconfig modelos` é o catálogo oficial de seleção.
- Tokens usam `.iatoken add TOKEN` (ou `.iatoken TOKEN`) e a confirmação sensível não deve usar quote nem links oficiais.
- Hierarquia é gerenciada por `.dono add/del/list` e `.subdono add/del/list`; use `firstTargetNumber()` para aceitar menção ou resposta.
- AutoDownload fica em `data/auto-download.js`; ele deve validar URL pública antes de rede/download e nunca deve aceitar localhost/rede privada.
- Para stickers, sempre use `buildSakuraStickerDescription()` + `addSakuraStickerMetadata()` e resolva o nome real do grupo antes.
