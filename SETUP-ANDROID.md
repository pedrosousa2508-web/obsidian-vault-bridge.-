# Instalação rápida no Android

## Servidor
1. Crie uma conta Cloudflare.
2. Use um PC, Termux ou GitHub Codespaces.
3. Entre em `server/`.
4. Rode `npm install`.
5. Rode `npx wrangler login`.
6. Rode `npx wrangler kv namespace create VAULT_NOTES`.
7. Copie o ID para `wrangler.toml`.
8. Rode `npx wrangler secret put BRIDGE_TOKEN`.
9. Rode `npm run deploy`.
10. Guarde a URL HTTPS.

## Plugin
1. Entre em `obsidian-plugin/`.
2. Rode `npm install && npm run build`.
3. Copie `manifest.json`, `main.js` e `styles.css` para `.obsidian/plugins/vault-bridge/`.
4. Ative o plugin no Obsidian.
5. Configure a URL do Worker e o token.

## Primeiro teste
- Abra uma nota.
- Rode `Vault Bridge: Sync current note`.

## MCP
Endpoint: `https://SUA-URL/mcp`
Autorização: `Bearer SEU_TOKEN`
