# Vault Bridge — Obsidian ↔ ChatGPT / MCP

Projeto com duas partes:

1. **Plugin para Obsidian (mobile-first)** — sincroniza notas Markdown selecionadas do vault com um servidor remoto.
2. **Servidor remoto MCP + REST (Cloudflare Worker + KV)** — guarda as notas sincronizadas e expõe ferramentas para pesquisar, ler, criar, atualizar e apagar notas.

> O plugin foi desenhado sem Node/Electron no runtime, para funcionar também no Obsidian Mobile.

## Recursos

### No Obsidian
- Sincronizar a nota atual
- Sincronizar todas as notas Markdown
- Baixar a versão remota da nota atual
- Auto-sync opcional ao salvar
- Token privado compartilhado com o servidor

### No MCP
- `list_notes`
- `search_notes`
- `read_note`
- `write_note`
- `delete_note`

### Segurança
- `Authorization: Bearer <token>`
- bloqueio de paths perigosos (`..`, caminho absoluto e `.obsidian/`)
- limite de tamanho por nota
- o servidor só vê notas que o plugin envia

## 1. Publicar o servidor

```bash
cd server
npm install
npx wrangler login
npx wrangler kv namespace create VAULT_NOTES
```

Copie o ID retornado para `wrangler.toml` e configure o token:

```bash
npx wrangler secret put BRIDGE_TOKEN
npm run deploy
```

Teste:

```bash
curl https://SUA-URL/health
```

## 2. Compilar o plugin

```bash
cd obsidian-plugin
npm install
npm run build
```

Copie `manifest.json`, `main.js` e `styles.css` para:

```text
SEU_VAULT/.obsidian/plugins/vault-bridge/
```

No Obsidian, ative **Vault Bridge** e configure:
- Server URL
- Bridge token
- Auto-sync (opcional)

## 3. Usar no celular

Comandos:
- `Vault Bridge: Sync current note`
- `Vault Bridge: Sync all Markdown notes`
- `Vault Bridge: Pull current note from server`

## 4. MCP

Endpoint:

```text
https://SUA-URL/mcp
```

Header:

```text
Authorization: Bearer SEU_TOKEN
```

O endpoint implementa MCP stateless sobre HTTP JSON-RPC com `initialize`, `ping`, `tools/list` e `tools/call`.

## Observação sobre ChatGPT

A disponibilidade de servidor MCP customizado e, principalmente, de ações de escrita depende do plano/ambiente do ChatGPT. O projeto continua utilizável com outros clientes MCP compatíveis e com o plugin do Obsidian.

## Estrutura

```text
obsidian-chatgpt-vault-bridge/
├── README.md
├── SETUP-ANDROID.md
├── obsidian-plugin/
│   ├── manifest.json
│   ├── package.json
│   ├── tsconfig.json
│   ├── esbuild.config.mjs
│   ├── main.ts
│   └── styles.css
└── server/
    ├── package.json
    ├── tsconfig.json
    ├── wrangler.toml
    └── src/index.ts
```
