# Configuração Sakura-MD V2

A V2 usa um único arquivo principal:

```text
config/sakura.config.json
```

Não existem bancos SQLite em `config/`.

## Seções

- `bot`: identidade, prefixo e release;
- `owners`: donos/subdonos habilitados;
- `ai`: provider, modelo, tokens e limites;
- `ui`: emojis, footer, canal de atualizações, grupo oficial e imagens de menu;
- `economy`: Sakura Coins e multiplicadores;
- `vip`: limites e prioridade;
- `cache`: TTLs e limites de caches;
- `queues`: concorrência, prioridade e filas;
- `runtime`: reconexão, logs, retries e intervalos;
- `panel`: host/porta;
- `reception`: ficha e recepção automática;
- `games`: recompensas e timeouts;
- `paths`: arquivos/pastas usados pelo runtime.

O banco da aplicação fica em `storage/sakura-db.json` e nasce novo na V2; não é necessário importar dados antigos.

## Links oficiais

Os dois destinos ficam no bloco `ui` de `config/sakura.config.json`:

```json
{
  "updateChannel": "https://whatsapp.com/channel/...",
  "officialGroup": ""
}
```

`officialGroup` pode ficar vazio enquanto o grupo oficial não existir; o menu mostra **em breve** e não cria botão quebrado.
