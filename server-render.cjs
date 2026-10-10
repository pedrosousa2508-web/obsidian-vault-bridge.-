const http = require("http");
const crypto = require("crypto");
const { createClient } = require("redis");

const PORT = Number(process.env.PORT || 10000);
const OWNER_TOKEN = process.env.BRIDGE_TOKEN || "";
const REDIS_URL = process.env.REDIS_URL || "";
const MAX = 512 * 1024;

const redis = createClient({ url: REDIS_URL });
redis.on("error", (err) => console.error("redis", err));
let ready = redis.connect();

function send(res, status, obj) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(JSON.stringify(obj));
}

function authContext(req) {
  const h = String(req.headers.authorization || "");
  if (!h.startsWith("Bearer ")) return null;

  const token = h.slice(7).trim();
  if (token.length < 16) return null;

  if (OWNER_TOKEN && token === OWNER_TOKEN) {
    return { namespace: "owner", prefix: "note:" };
  }

  const id = crypto
    .createHash("sha256")
    .update(token)
    .digest("hex")
    .slice(0, 32);

  return { namespace: id, prefix: `user:${id}:note:` };
}

function safePath(v) {
  if (typeof v !== "string") throw new Error("path must be a string");

  const p = v.trim().replace(/\\/g, "/");

  if (!p || !p.endsWith(".md")) {
    throw new Error("Only .md paths are allowed");
  }

  if (
    p.startsWith("/") ||
    p.includes("../") ||
    p.startsWith(".obsidian/") ||
    p.includes("/.obsidian/")
  ) {
    throw new Error("Unsafe path");
  }

  return p;
}

function checkedContent(v) {
  if (typeof v !== "string") throw new Error("content must be a string");
  if (Buffer.byteLength(v) > MAX) throw new Error("Note too large");
  return v;
}

async function readBody(req) {
  let s = "";

  for await (const c of req) {
    s += c;
    if (Buffer.byteLength(s) > MAX + 65536) {
      throw new Error("body too large");
    }
  }

  return s ? JSON.parse(s) : {};
}

const key = (ctx, p) => `${ctx.prefix}${p}`;

async function put(ctx, p, c, mtime) {
  const n = {
    path: p,
    content: c,
    mtime: Number.isFinite(Number(mtime)) ? Number(mtime) : Date.now(),
    updatedAt: new Date().toISOString()
  };

  await redis.set(key(ctx, p), JSON.stringify(n));
  return n;
}

async function get(ctx, p) {
  const s = await redis.get(key(ctx, p));
  return s ? JSON.parse(s) : null;
}

async function paths(ctx) {
  const arr = [];

  for await (const k of redis.scanIterator({
    MATCH: `${ctx.prefix}*`,
    COUNT: 200
  })) {
    arr.push(String(k).slice(ctx.prefix.length));
  }

  return arr.sort();
}

async function search(ctx, q) {
  q = String(q || "").toLowerCase();
  const out = [];

  for (const p of await paths(ctx)) {
    if (out.length >= 50) break;

    const n = await get(ctx, p);
    if (!n) continue;

    const h = (p + "\n" + n.content).toLowerCase();

    if (!q || h.includes(q)) {
      const idx = q ? h.indexOf(q) : 0;
      const s = Math.max(0, idx - 100);

      out.push({
        path: p,
        snippet: n.content.slice(s, s + 400),
        updatedAt: n.updatedAt
      });
    }
  }

  return out;
}

const tools = [
  {
    name: "list_notes",
    description: "List synchronized Obsidian Markdown notes for the authenticated user.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false
    },
    annotations: {
      readOnlyHint: true,
      openWorldHint: false,
      destructiveHint: false
    }
  },
  {
    name: "search_notes",
    description: "Search the authenticated user's synchronized notes by path or text.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" }
      },
      required: ["query"],
      additionalProperties: false
    },
    annotations: {
      readOnlyHint: true,
      openWorldHint: false,
      destructiveHint: false
    }
  },
  {
    name: "read_note",
    description: "Read one authenticated-user note by vault-relative path.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" }
      },
      required: ["path"],
      additionalProperties: false
    },
    annotations: {
      readOnlyHint: true,
      openWorldHint: false,
      destructiveHint: false
    }
  },
  {
    name: "write_note",
    description: "Create or replace one synchronized Markdown note for the authenticated user.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
        content: { type: "string" }
      },
      required: ["path", "content"],
      additionalProperties: false
    },
    annotations: {
      readOnlyHint: false,
      openWorldHint: false,
      destructiveHint: true
    }
  },
  {
    name: "delete_note",
    description: "Delete one synchronized Markdown note for the authenticated user.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" }
      },
      required: ["path"],
      additionalProperties: false
    },
    annotations: {
      readOnlyHint: false,
      openWorldHint: false,
      destructiveHint: true
    }
  }
];

async function callTool(ctx, name, a) {
  if (name === "list_notes") {
    const p = await paths(ctx);
    return {
      content: [{ type: "text", text: p.join("\n") || "(no notes)" }],
      structuredContent: { paths: p }
    };
  }

  if (name === "search_notes") {
    const r = await search(ctx, a.query);
    return {
      content: [{
        type: "text",
        text:
          r.map(x => x.path + "\n" + x.snippet).join("\n\n---\n\n") ||
          "(no matches)"
      }],
      structuredContent: { results: r }
    };
  }

  if (name === "read_note") {
    const p = safePath(a.path);
    const n = await get(ctx, p);

    return n
      ? {
          content: [{ type: "text", text: n.content }],
          structuredContent: n
        }
      : {
          isError: true,
          content: [{ type: "text", text: `Note not found: ${p}` }]
        };
  }

  if (name === "write_note") {
    const p = safePath(a.path);
    const n = await put(ctx, p, checkedContent(a.content), Date.now());

    return {
      content: [{ type: "text", text: `Saved ${p}` }],
      structuredContent: n
    };
  }

  if (name === "delete_note") {
    const p = safePath(a.path);
    await redis.del(key(ctx, p));

    return {
      content: [{ type: "text", text: `Deleted ${p}` }],
      structuredContent: { path: p, deleted: true }
    };
  }

  throw new Error("Unknown tool");
}

async function main(req, res) {
  await ready;

  const u = new URL(
    req.url,
    `http://${req.headers.host || "localhost"}`
  );

  if (u.pathname === "/health") {
    return send(res, 200, {
      ok: true,
      service: "vault-bridge",
      version: "0.3.0",
      multiUser: true
    });
  }

  const ctx = authContext(req);
  if (!ctx) {
    return send(res, 401, { error: "unauthorized" });
  }

  try {
    if (u.pathname === "/api/note" && req.method === "PUT") {
      const d = await readBody(req);
      const p = safePath(d.path);

      return send(
        res,
        200,
        await put(ctx, p, checkedContent(d.content), d.mtime)
      );
    }

    if (u.pathname === "/api/note" && req.method === "GET") {
      const p = safePath(u.searchParams.get("path"));
      const n = await get(ctx, p);

      return n
        ? send(res, 200, n)
        : send(res, 404, { error: "not_found" });
    }

    if (u.pathname === "/api/note" && req.method === "DELETE") {
      const p = safePath(u.searchParams.get("path"));
      await redis.del(key(ctx, p));

      return send(res, 200, {
        path: p,
        deleted: true
      });
    }

    if (u.pathname === "/api/notes" && req.method === "GET") {
      return send(res, 200, {
        results: await search(
          ctx,
          u.searchParams.get("q") || ""
        )
      });
    }

    if (u.pathname === "/mcp" && req.method === "POST") {
      const d = await readBody(req);
      const id = d.id ?? null;

      if (d.method === "initialize") {
        return send(res, 200, {
          jsonrpc: "2.0",
          id,
          result: {
            protocolVersion: "2025-06-18",
            capabilities: { tools: {} },
            serverInfo: {
              name: "vault-bridge",
              version: "0.3.0"
            }
          }
        });
      }

      if (d.method === "notifications/initialized") {
        res.writeHead(202);
        return res.end();
      }

      if (d.method === "ping") {
        return send(res, 200, {
          jsonrpc: "2.0",
          id,
          result: {}
        });
      }

      if (d.method === "tools/list") {
        return send(res, 200, {
          jsonrpc: "2.0",
          id,
          result: { tools }
        });
      }

      if (d.method === "tools/call") {
        const p = d.params || {};

        try {
          const result = await callTool(
            ctx,
            String(p.name || ""),
            (p.arguments && typeof p.arguments === "object")
              ? p.arguments
              : {}
          );

          return send(res, 200, {
            jsonrpc: "2.0",
            id,
            result
          });
        } catch (e) {
          return send(res, 200, {
            jsonrpc: "2.0",
            id,
            error: {
              code: -32000,
              message: e.message
            }
          });
        }
      }

      return send(res, 200, {
        jsonrpc: "2.0",
        id,
        error: {
          code: -32601,
          message: "Method not found"
        }
      });
    }

    return send(res, 404, { error: "not_found" });
  } catch (e) {
    return send(res, 400, {
      error: e.message || "bad_request"
    });
  }
}

http.createServer((req, res) => {
  main(req, res).catch((e) => {
    console.error(e);
    send(res, 500, { error: "internal_error" });
  });
}).listen(PORT, "0.0.0.0", () => {
  console.log(`vault-bridge listening on ${PORT}`);
});
