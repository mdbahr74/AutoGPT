/* ============================================================
   Tiny zero-dependency backend for the TradingView dashboard.
   ------------------------------------------------------------
   - Serves the static frontend (index.html, app.js, styles.css).
   - Proxies Bitunix market data (public) and account/positions
     (private, signed) so the API secret never reaches the browser
     and CORS is not an issue.

   Bitunix signing (per docs):
     digest = SHA256(nonce + timestamp + apiKey + queryParams + body)
     sign   = SHA256(digest + secretKey)
   where queryParams = keys sorted ASC, concatenated as key+value.

   Run:  node server.js   (Node 18+, uses built-in fetch)
   ============================================================ */

"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

/* ---- Minimal .env loader (no dependency) ---- */
function loadEnv() {
  const file = path.join(__dirname, ".env");
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
}
loadEnv();

const PORT = process.env.PORT || 5173;
const API_KEY = process.env.BITUNIX_API_KEY || "";
const API_SECRET = process.env.BITUNIX_API_SECRET || "";
const BITUNIX_BASE = "https://fapi.bitunix.com";

/* ---- Signing helpers ---- */
const sha256 = (s) => crypto.createHash("sha256").update(s, "utf8").digest("hex");

function signedHeaders(query) {
  const nonce = crypto.randomBytes(16).toString("hex");
  const timestamp = Date.now().toString();
  const sortedKeys = Object.keys(query).sort();
  const queryParams = sortedKeys.map((k) => k + query[k]).join("");
  const body = ""; // GET requests only
  const digest = sha256(nonce + timestamp + API_KEY + queryParams + body);
  const sign = sha256(digest + API_SECRET);
  return {
    "api-key": API_KEY,
    nonce,
    timestamp,
    sign,
    language: "en-US",
    "Content-Type": "application/json",
  };
}

function queryString(query) {
  const keys = Object.keys(query);
  if (!keys.length) return "";
  return "?" + keys.map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(query[k])}`).join("&");
}

async function bitunixPublic(pathname, query) {
  const res = await fetch(BITUNIX_BASE + pathname + queryString(query));
  return res.json();
}

async function bitunixPrivate(pathname, query) {
  const res = await fetch(BITUNIX_BASE + pathname + queryString(query), {
    headers: signedHeaders(query),
  });
  return res.json();
}

/* ---- API handlers ---- */
function sendJson(res, status, obj) {
  const data = JSON.stringify(obj);
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(data);
}

async function handleTickers(res, params) {
  const symbols = params.get("symbols") || "";
  try {
    const query = symbols ? { symbols } : {};
    const json = await bitunixPublic("/api/v1/futures/market/tickers", query);
    sendJson(res, 200, { data: json.data || [] });
  } catch (err) {
    sendJson(res, 502, { error: String(err) });
  }
}

async function handleAccount(res) {
  if (!API_KEY || !API_SECRET) {
    return sendJson(res, 200, { ok: false, reason: "no-keys" });
  }
  try {
    const acct = await bitunixPrivate("/api/v1/futures/account", { marginCoin: "USDT" });
    if (acct.code !== undefined && acct.code !== 0 && acct.code !== "0") {
      return sendJson(res, 200, { ok: false, error: acct.msg || acct.message || ("code " + acct.code) });
    }

    // Positions are best-effort; failures here shouldn't hide the balance.
    let positions = [];
    try {
      const pos = await bitunixPrivate("/api/v1/futures/position/get_pending_positions", {});
      if (Array.isArray(pos.data)) positions = pos.data;
    } catch (_) { /* ignore */ }

    sendJson(res, 200, { ok: true, account: acct.data || {}, positions });
  } catch (err) {
    sendJson(res, 502, { ok: false, error: String(err) });
  }
}

/* ---- Static file serving ---- */
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".json": "application/json",
};

function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === "/") rel = "/index.html";
  // Prevent path traversal.
  const filePath = path.join(__dirname, path.normalize(rel).replace(/^(\.\.[/\\])+/, ""));
  if (!filePath.startsWith(__dirname)) {
    res.writeHead(403); res.end("Forbidden"); return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end("Not found"); return; }
    res.writeHead(200, { "Content-Type": MIME[path.extname(filePath)] || "application/octet-stream" });
    res.end(data);
  });
}

/* ---- Router ---- */
const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === "/api/bitunix/tickers") return handleTickers(res, url.searchParams);
  if (url.pathname === "/api/bitunix/account") return handleAccount(res);

  return serveStatic(req, res, url.pathname);
});

server.listen(PORT, () => {
  console.log(`\n  Dashboard running:  http://localhost:${PORT}`);
  console.log(`  Bitunix account:    ${API_KEY && API_SECRET ? "keys loaded ✓" : "no keys (add them to .env for account data)"}\n`);
});
