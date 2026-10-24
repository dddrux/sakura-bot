# Sakura-MD Baileys 1.8.5-group-status.1

- Base: WhiskeySockets/Baileys 7.0.0-rc13.
- Restaura os nós binários `biz` do fork modificado anterior.
- Native Flow `single_select` usa `interactive/native_flow v1` e `native_flow mixed v9`.
- Anexa `quality_control`, `decision_source`, `actual_actors`, `host_storage` e `privacy_mode_ts`.
- Conversas privadas recebem também o nó `bot biz_bot=1`.
- Mensagens interativas são envolvidas em `viewOnceMessage` com contexto Multi-Device.
- A logo pode ser enviada dentro do cabeçalho da própria mensagem interativa.
- Não existe fallback textual no menu da Sakura-MD.

# @sakura-md/baileys 1.7.8-trigger-bundle.1

Fork local de teste da Sakura-MD, baseado no `@itsliaaa/baileys`.

## Camada Sakura

- botões e listas selecionáveis Multi-Device;
- parser de botões, listas, templates e Native Flow;
- divisão automática de seções com mais de 10 linhas;
- diagnóstico de ACK 479 e erros de stanza;
- resolução e cache de LID para número;
- cache de mensagens recentes para retry;
- recuperação de sessões de criptografia e retry de mensagens indecifráveis;
- diagnóstico de envio, relay, seleção, LID e metadados de grupos;
- cache de metadados de grupo com invalidação por eventos de participantes;
- deduplicação de consultas simultâneas de `groupMetadata`;
- fallback temporário para metadados antigos quando a rede falha;
- cache da lista de menções usado pelo `.cita`;
- métricas acessíveis por `sakuraSnapshotDiagnostics()`;
- logs sem chaves privadas ou material de sessão.

## 1.7.6-cita-debug.1

- Novo cache de metadados com TTL de 2 minutos e invalidação imediata em mudanças do grupo.
- Chamadas simultâneas para o mesmo grupo compartilham uma única consulta de rede.
- `sendMessage` e `relayMessage` agora emitem diagnóstico de início, sucesso, duração e erro.
- Retry de descriptografia emite os estágios `retry-scheduled`, `retry-sent` e `retry-error`.
- Cache LID-PN, cache de mensagens e cache de grupo possuem contadores hit/miss.
- `sakuraGetMentionJids()` prioriza `phoneNumber`, `participantPn` e `jid` PN, evitando menções LID incorretas.
- `sakuraPruneCaches()` remove entradas vencidas durante a manutenção.
- Reenvio de alto nível permanece desativado por padrão para não duplicar mensagens; o retry criptográfico interno continua ativo.

A base continua experimental e deve ser testada inicialmente com uma conta secundária.


## 1.7.8-trigger-bundle.1

- Logs individuais de resolução de dispositivos LID foram movidos para `trace`.
- O nível `debug` recebe um resumo por consulta com usuários, dispositivos e mapeamentos.
- Migração de sessões LID não imprime mais listas completas de dispositivos no terminal.
- O bot filtra mensagens `fromMe` antes de colocá-las na fila do grupo.
- Compatível com o disparo combinado de áudio e figurinha da Sakura.

## 1.8.5-group-status.1

- Native Flow grava `mentionedJid` no `InteractiveMessage.contextInfo` correto.
- Menções priorizam PN (`phoneNumber`/`participantPn`/`jid`) e usam LID apenas como alias.
- Status de grupo usa `groupStatusMessageV2` com `messageSecret` compartilhado no envelope e na mídia.
