/* ============================================================================
   Lokalny dev-server dla swiadek-dziejow.pl
   - serwuje statyczny katalog html/ (strona główna, historia-polski, assets)
   - proxuje /artykuly-historyczne* i /api/mumro* do CMS-a (articles-cms)
   - uruchamia CMS jako proces potomny

   Uruchomienie:  node dev-server.js
   Następnie:     http://127.0.0.1:8080
   Bez zależności zewnętrznych (tylko moduły wbudowane Node.js).
   ========================================================================== */

import http from "node:http";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.DEV_PORT || 8080);
const HOST = process.env.DEV_HOST || "127.0.0.1";
const CMS_PORT = Number(process.env.CMS_PORT || 3004);
const CMS_HOST = "127.0.0.1";
const ROOT = path.join(__dirname, "html");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".xml": "application/xml; charset=utf-8",
  ".map": "application/json; charset=utf-8",
};

/* ---- spawn the articles CMS so a single command runs everything ---- */
function startCms() {
  const child = spawn(process.execPath, [path.join(__dirname, "articles-cms", "server.js")], {
    env: { ...process.env, PORT: String(CMS_PORT), HOST: CMS_HOST },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (d) => process.stdout.write(`[cms] ${d}`));
  child.stderr.on("data", (d) => process.stderr.write(`[cms] ${d}`));
  child.on("exit", (code) => console.log(`[cms] exited with code ${code}`));
  const shutdown = () => {
    child.kill();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  return child;
}

/* ---- proxy article + api requests to the CMS ---- */
function proxyToCms(req, res) {
  const options = {
    host: CMS_HOST,
    port: CMS_PORT,
    method: req.method,
    path: req.url,
    headers: { ...req.headers, host: `${CMS_HOST}:${CMS_PORT}` },
  };
  const upstream = http.request(options, (cmsRes) => {
    res.writeHead(cmsRes.statusCode || 502, cmsRes.headers);
    cmsRes.pipe(res);
  });
  upstream.on("error", () => {
    res.writeHead(502, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("CMS niedostępny (articles-cms). Uruchom go lub poczekaj chwilę.");
  });
  req.pipe(upstream);
}

/* ---- safe static file resolution (no directory traversal) ---- */
function resolvePath(urlPath) {
  const decoded = decodeURIComponent(urlPath.split("?")[0].split("#")[0]);
  const clean = path.normalize(decoded).replace(/^(\.\.[/\\])+/, "");
  let target = path.join(ROOT, clean);
  if (!target.startsWith(ROOT)) return null;
  return target;
}

async function serveStatic(req, res) {
  let target = resolvePath(req.url);
  if (!target) {
    res.writeHead(403).end("Forbidden");
    return;
  }

  let stat = null;
  try {
    stat = await fsp.stat(target);
  } catch {
    /* fall through to .html / 404 below */
  }

  if (stat && stat.isDirectory()) {
    target = path.join(target, "index.html");
    try {
      stat = await fsp.stat(target);
    } catch {
      stat = null;
    }
  }

  // Try appending .html for extensionless routes.
  if (!stat && !path.extname(target)) {
    try {
      const asHtml = `${target}.html`;
      stat = await fsp.stat(asHtml);
      if (stat.isFile()) target = asHtml;
    } catch {
      stat = null;
    }
  }

  if (!stat || !stat.isFile()) {
    const notFound = path.join(ROOT, "404.html");
    if (fs.existsSync(notFound)) {
      res.writeHead(404, { "Content-Type": MIME[".html"] });
      fs.createReadStream(notFound).pipe(res);
    } else {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("404 Not Found");
    }
    return;
  }

  const ext = path.extname(target).toLowerCase();
  res.writeHead(200, {
    "Content-Type": MIME[ext] || "application/octet-stream",
    "Cache-Control": "no-cache",
    "X-Content-Type-Options": "nosniff",
  });
  fs.createReadStream(target).pipe(res);
}

const server = http.createServer((req, res) => {
  const url = req.url || "/";
  if (url === "/artykuly-historyczne" || url.startsWith("/artykuly-historyczne/") || url.startsWith("/api/mumro")) {
    proxyToCms(req, res);
    return;
  }
  serveStatic(req, res).catch(() => {
    res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" }).end("Internal error");
  });
});

startCms();
server.listen(PORT, HOST, () => {
  console.log("");
  console.log("  Świadek Dziejów — dev-server");
  console.log(`  Strona:    http://${HOST}:${PORT}`);
  console.log(`  Artykuły:  http://${HOST}:${PORT}/artykuly-historyczne  (proxy -> CMS:${CMS_PORT})`);
  console.log("  Zatrzymaj: Ctrl+C");
  console.log("");
});
