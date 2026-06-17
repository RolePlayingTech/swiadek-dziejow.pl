import crypto from "node:crypto";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const HOST = process.env.HOST || "127.0.0.1";
const PORT = Number(process.env.PORT || 3004);
const BASE_URL = (process.env.SITE_BASE_URL || "https://swiadek-dziejow.pl").replace(/\/+$/, "");
const CMS_SECRET = process.env.MUMRO_CMS_SECRET || "";
const DATA_DIR = process.env.ARTICLES_DATA_DIR || path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "articles.json");
const MAX_BODY_BYTES = 512 * 1024;

function withSecurityHeaders(res, contentType = "application/json; charset=utf-8") {
  res.setHeader("Content-Type", contentType);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      "base-uri 'self'",
      "frame-ancestors 'self'",
      "img-src 'self' https: data:",
      "style-src 'self' 'unsafe-inline'",
      "script-src 'self' https://app.mumro.io",
      "frame-src https://www.youtube.com https://player.vimeo.com https://www.instagram.com https://www.facebook.com https://www.tiktok.com https://www.dailymotion.com",
      "connect-src 'self'",
      "object-src 'none'",
    ].join("; "),
  );
}

function sendJson(res, statusCode, body) {
  withSecurityHeaders(res);
  res.statusCode = statusCode;
  res.end(JSON.stringify(body));
}

function sendHtml(res, statusCode, html) {
  withSecurityHeaders(res, "text/html; charset=utf-8");
  res.statusCode = statusCode;
  res.end(html);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttr(value) {
  return escapeHtml(value).replaceAll("`", "&#096;");
}

function sanitizeHtml(value) {
  return String(value ?? "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<object\b[^>]*>[\s\S]*?<\/object>/gi, "")
    .replace(/<embed\b[^>]*>[\s\S]*?<\/embed>/gi, "")
    .replace(/<base\b[^>]*>/gi, "")
    .replace(/<meta\b[^>]*>/gi, "")
    .replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/\s(href|src)\s*=\s*(['"])\s*javascript:[\s\S]*?\2/gi, ' $1="#"')
    .replace(/\s(href|src)\s*=\s*javascript:[^\s>]+/gi, ' $1="#"')
    .replace(/\s(href|src)\s*=\s*(['"])\s*data:text\/html[\s\S]*?\2/gi, ' $1="#"')
    .replace(/\s(href|src)\s*=\s*data:text\/html[^\s>]+/gi, ' $1="#"')
    .replace(/\ssrcdoc\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "");
}

function normalizeSlug(input) {
  const mapped = String(input || "")
    .replaceAll("ą", "a")
    .replaceAll("ć", "c")
    .replaceAll("ę", "e")
    .replaceAll("ł", "l")
    .replaceAll("ń", "n")
    .replaceAll("ó", "o")
    .replaceAll("ś", "s")
    .replaceAll("ź", "z")
    .replaceAll("ż", "z")
    .replaceAll("Ą", "a")
    .replaceAll("Ć", "c")
    .replaceAll("Ę", "e")
    .replaceAll("Ł", "l")
    .replaceAll("Ń", "n")
    .replaceAll("Ó", "o")
    .replaceAll("Ś", "s")
    .replaceAll("Ź", "z")
    .replaceAll("Ż", "z");

  const slug = mapped
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 220);

  return slug || "artykul";
}

function articleUrl(article) {
  return `${BASE_URL}/artykuly-historyczne/${encodeURIComponent(article.slug)}`;
}

function cleanIdentifier(value) {
  return String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9:_.-]+/g, "-")
    .slice(0, 128);
}

function compareToken(left, right) {
  const leftBuffer = Buffer.from(left || "", "utf8");
  const rightBuffer = Buffer.from(right || "", "utf8");
  if (!leftBuffer.length || leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function isAuthorized(req) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
  return compareToken(token, CMS_SECRET);
}

async function ensureDataFile() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    await fs.access(DATA_FILE);
  } catch {
    await fs.writeFile(DATA_FILE, "[]\n", { mode: 0o600 });
  }
}

async function loadArticles() {
  await ensureDataFile();
  const raw = await fs.readFile(DATA_FILE, "utf8");
  const parsed = JSON.parse(raw || "[]");
  return Array.isArray(parsed) ? parsed : [];
}

async function saveArticles(articles) {
  await ensureDataFile();
  const tempFile = `${DATA_FILE}.${process.pid}.tmp`;
  await fs.writeFile(tempFile, `${JSON.stringify(articles, null, 2)}\n`, { mode: 0o600 });
  await fs.rename(tempFile, DATA_FILE);
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];

    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(Object.assign(new Error("Request body too large"), { statusCode: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on("error", reject);
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(Object.assign(new Error("Invalid JSON body"), { statusCode: 400 }));
      }
    });
  });
}

function validatePayload(payload) {
  const article = payload?.article;
  const site = payload?.site || {};

  if (!article || typeof article !== "object") {
    return "Missing article object.";
  }
  if (!article.title || typeof article.title !== "string" || article.title.length > 180) {
    return "Invalid article.title.";
  }
  if (article.slug != null && (typeof article.slug !== "string" || article.slug.length > 220)) {
    return "Invalid article.slug.";
  }
  if (article.excerpt != null && (typeof article.excerpt !== "string" || article.excerpt.length > 1000)) {
    return "Invalid article.excerpt.";
  }
  if (article.content_html != null && typeof article.content_html !== "string") {
    return "Invalid article.content_html.";
  }
  if (String(article.content_html || "").length > 200_000) {
    return "article.content_html is too long.";
  }
  if (!["draft", "publish", "future"].includes(article.status)) {
    return "Invalid article.status.";
  }
  if (article.status === "future" && !article.scheduled_at) {
    return "future article requires scheduled_at.";
  }
  if (!site.id) {
    return "Missing site.id.";
  }
  return null;
}

function publicArticles(articles) {
  const now = Date.now();
  return articles
    .filter((article) => {
      if (article.status === "published") return true;
      if (article.status !== "scheduled") return false;
      const scheduledAt = article.scheduled_at ? Date.parse(article.scheduled_at) : NaN;
      return Number.isFinite(scheduledAt) && scheduledAt <= now;
    })
    .sort((left, right) => Date.parse(right.published_at || right.updated_at) - Date.parse(left.published_at || left.updated_at));
}

function ensureUniqueSlug(articles, desiredSlug, externalId) {
  const baseSlug = normalizeSlug(desiredSlug);
  let slug = baseSlug;
  let counter = 2;
  const conflicts = () => articles.some((article) => article.slug === slug && article.external_id !== externalId);

  while (conflicts()) {
    slug = `${baseSlug.slice(0, 210)}-${counter}`;
    counter += 1;
  }

  return slug;
}

function toStoredArticle(payload, articles) {
  const now = new Date().toISOString();
  const incoming = payload.article;
  const site = payload.site || {};
  const sourceKey = `${site.id}:${incoming.id}`;
  const incomingExternalId = cleanIdentifier(incoming.external_id);
  const existing = articles.find((article) => article.external_id === incomingExternalId || article.source_key === sourceKey);
  const externalId = existing?.external_id || incomingExternalId || cleanIdentifier(`sd-${sourceKey}`);
  const status = incoming.status === "publish" ? "published" : incoming.status === "future" ? "scheduled" : "draft";
  const slug = ensureUniqueSlug(articles, incoming.slug || incoming.title, externalId);
  const publishedAt = status === "published" ? existing?.published_at || now : existing?.published_at || null;

  return {
    external_id: externalId,
    source_key: sourceKey,
    mumro_article_id: incoming.id,
    mumro_site_id: site.id,
    site_name: site.name || null,
    site_domain: site.domain || null,
    title: incoming.title.trim(),
    slug,
    excerpt: incoming.excerpt || "",
    content_html: incoming.content_html || "",
    status,
    scheduled_at: incoming.scheduled_at || null,
    metadata: incoming.metadata || {},
    created_at: existing?.created_at || now,
    updated_at: now,
    published_at: publishedAt,
  };
}

async function upsertArticle(payload) {
  const articles = await loadArticles();
  const stored = toStoredArticle(payload, articles);
  const existingIndex = articles.findIndex(
    (article) => article.external_id === stored.external_id || article.source_key === stored.source_key,
  );

  if (existingIndex >= 0) {
    articles[existingIndex] = stored;
  } else {
    articles.push(stored);
  }

  await saveArticles(articles);
  return stored;
}

function pageShell({ title, description, canonicalUrl, body, extraHead = "", ogType = "article" }) {
  const pageTitle = title ? `${title} - Świadek Dziejów` : "Artykuły - Świadek Dziejów";
  const metaDescription = description || "Artykuły historyczne Świadka Dziejów.";

  return `<!doctype html>
<html lang="pl">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(pageTitle)}</title>
  <meta name="description" content="${escapeAttr(metaDescription)}">
  <meta property="og:title" content="${escapeAttr(pageTitle)}">
  <meta property="og:description" content="${escapeAttr(metaDescription)}">
  <meta property="og:type" content="${escapeAttr(ogType)}">
  <meta property="og:url" content="${escapeAttr(canonicalUrl)}">
  <link rel="canonical" href="${escapeAttr(canonicalUrl)}">
  <style>
    :root {
      color-scheme: dark;
      --bg: #08070a;
      --fg: #f0ece4;
      --muted: rgba(240, 236, 228, 0.66);
      --dim: rgba(240, 236, 228, 0.42);
      --accent: #d4a054;
      --accent-bright: #f0c878;
      --tech: #4ecdc4;
      --line: rgba(240, 236, 228, 0.09);
      --accent-line: rgba(212, 160, 84, 0.24);
    }
    * { box-sizing: border-box; }
    html { scroll-behavior: smooth; }
    body {
      margin: 0;
      min-height: 100vh;
      background:
        linear-gradient(180deg, rgba(8, 7, 10, 0.72), var(--bg) 28rem),
        radial-gradient(circle at 18% 0%, rgba(212, 160, 84, 0.16), transparent 34rem),
        radial-gradient(circle at 86% 8%, rgba(78, 205, 196, 0.08), transparent 30rem),
        var(--bg);
      color: var(--fg);
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      line-height: 1.7;
      overflow-x: hidden;
    }
    body:before {
      content: "";
      position: fixed;
      inset: 0;
      pointer-events: none;
      opacity: .12;
      background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 400 400' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='2.4' numOctaves='3'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='.045'/%3E%3C/svg%3E");
      mix-blend-mode: overlay;
      z-index: 5;
    }
    a { color: inherit; }
    .wrap { width: min(1120px, calc(100% - 32px)); margin: 0 auto; }
    .nav {
      display: flex;
      justify-content: space-between;
      gap: 18px;
      align-items: center;
      padding: 24px 0;
      color: var(--muted);
      font-size: 12px;
      position: relative;
      z-index: 10;
    }
    .brand {
      color: var(--accent);
      text-decoration: none;
      letter-spacing: .24em;
      text-transform: uppercase;
      font-weight: 800;
      font-size: 11px;
    }
    .nav-links { display: flex; flex-wrap: wrap; gap: 8px; justify-content: flex-end; }
    .nav-pill {
      text-decoration: none;
      border: 1px solid var(--line);
      border-radius: 999px;
      padding: 9px 14px;
      background: rgba(255, 255, 255, .026);
      transition: color .25s ease, border-color .25s ease, transform .25s ease;
    }
    .nav-pill:hover { color: var(--accent); border-color: rgba(212, 160, 84, .42); transform: translateY(-1px); }
    .hero {
      position: relative;
      padding: 72px 0 44px;
    }
    .hero:before {
      content: "";
      position: absolute;
      inset: -120px -12vw auto;
      height: 360px;
      background:
        linear-gradient(180deg, rgba(8,7,10,.18), var(--bg)),
        url('/assets/hero_bg.png') center 38% / cover;
      filter: brightness(.35) contrast(1.12) saturate(.65);
      opacity: .44;
      z-index: -1;
    }
    .kicker {
      color: var(--accent);
      text-transform: uppercase;
      letter-spacing: .36em;
      font-size: 11px;
      font-weight: 800;
      margin: 0 0 18px;
    }
    h1 {
      font-size: clamp(2.5rem, 7.8vw, 5.9rem);
      line-height: .98;
      margin: 0;
      letter-spacing: -0.045em;
      max-width: 940px;
    }
    .lead {
      max-width: 740px;
      color: var(--muted);
      font-size: clamp(1rem, 2vw, 1.22rem);
      margin: 24px 0 0;
    }
    .index-intro {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(260px, 340px);
      gap: 28px;
      align-items: end;
      padding-bottom: 26px;
      border-bottom: 1px solid var(--line);
    }
    .index-note {
      color: var(--dim);
      border-left: 1px solid var(--accent-line);
      padding-left: 20px;
      font-size: .92rem;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
      gap: 18px;
      padding: 30px 0 86px;
    }
    .card {
      display: block;
      min-height: 260px;
      padding: 24px;
      border: 1px solid var(--accent-line);
      border-radius: 18px;
      background:
        linear-gradient(145deg, rgba(255, 255, 255, .062), rgba(0, 0, 0, .24)),
        radial-gradient(circle at 20% 0%, rgba(212, 160, 84, .09), transparent 16rem);
      text-decoration: none;
      transition: transform .25s ease, border-color .25s ease, box-shadow .25s ease;
    }
    .card:hover {
      transform: translateY(-4px);
      border-color: rgba(212, 160, 84, 0.52);
      box-shadow: 0 22px 70px rgba(0, 0, 0, .28);
    }
    .date {
      color: var(--dim);
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: .2em;
      margin-bottom: 18px;
    }
    .card h2 { margin: 0 0 14px; font-size: 1.5rem; line-height: 1.14; letter-spacing: -.025em; }
    .card p { margin: 0; color: var(--muted); font-size: 14px; }
    .empty { padding: 34px; border: 1px dashed var(--accent-line); border-radius: 18px; color: var(--muted); background: rgba(255,255,255,.025); }
    article { width: min(840px, calc(100% - 32px)); margin: 0 auto; padding: 34px 0 92px; }
    .article-meta {
      color: var(--dim);
      text-transform: uppercase;
      letter-spacing: .18em;
      font-size: 12px;
      margin: 24px 0 40px;
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      align-items: center;
    }
    .article-meta span + span:before { content: ""; display: inline-block; width: 5px; height: 5px; margin: 0 10px 2px 0; border: 1px solid var(--accent); transform: rotate(45deg); opacity: .55; }
    .content {
      color: rgba(240, 236, 228, .86);
      font-size: clamp(1.03rem, 1.8vw, 1.12rem);
    }
    .content > p:first-child {
      color: rgba(240, 236, 228, .92);
      font-size: clamp(1.15rem, 2.2vw, 1.32rem);
      line-height: 1.75;
    }
    .content h2, .content h3 { color: var(--fg); line-height: 1.18; margin: 2.15em 0 .7em; letter-spacing: -.025em; }
    .content h2 { font-size: clamp(1.75rem, 3.2vw, 2.28rem); }
    .content h3 { font-size: 1.45rem; }
    .content p, .content ul, .content ol, .content blockquote { margin: 1.18em 0; }
    .content ul, .content ol { padding-left: 1.25rem; }
    .content li { margin: .48em 0; }
    .content blockquote {
      border-left: 3px solid var(--accent);
      padding: 4px 0 4px 20px;
      color: var(--muted);
      font-size: 1.08rem;
    }
    .content a { color: var(--accent-bright); text-decoration-color: rgba(240, 200, 120, .34); text-underline-offset: 4px; }
    .content .film-link {
      display: inline-flex;
      align-items: center;
      gap: 10px;
      margin: .4rem 0 0;
      padding: 13px 18px;
      border: 1px solid rgba(212, 160, 84, .36);
      border-radius: 999px;
      background: rgba(212, 160, 84, .1);
      color: var(--accent-bright);
      text-decoration: none;
      font-size: .95rem;
      font-weight: 700;
    }
    .content .film-link:hover { border-color: rgba(240, 200, 120, .62); }
    .content img, .content video, .content iframe { max-width: 100%; border-radius: 18px; border: 1px solid var(--accent-line); background: #050505; }
    .content iframe { width: 100%; min-height: 420px; }
    footer { border-top: 1px solid var(--line); color: var(--dim); padding: 28px 0 42px; font-size: 12px; position: relative; z-index: 10; }
    @media (max-width: 700px) {
      .nav { align-items: flex-start; flex-direction: column; }
      .nav-links { justify-content: flex-start; }
      .hero { padding-top: 36px; }
      .index-intro { display: block; }
      .index-note { margin-top: 24px; }
      .content iframe { min-height: 240px; }
      .content .film-link { width: 100%; justify-content: center; border-radius: 16px; }
    }
  </style>
  <link rel="stylesheet" href="/assets/site-polish.css">
  ${extraHead}
</head>
<body>
  <nav class="wrap nav">
    <a class="brand" href="/">Świadek Dziejów</a>
    <div class="nav-links">
      <a class="nav-pill" href="/artykuly-historyczne">Artykuły</a>
      <a class="nav-pill" href="/">Strona główna</a>
    </div>
  </nav>
  ${body}
  <footer class="wrap">2026 · Świadek Dziejów · Artykuły historyczne</footer>
</body>
</html>`;
}

function formatDate(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return "Bez daty";
  return new Intl.DateTimeFormat("pl-PL", { year: "numeric", month: "long", day: "numeric" }).format(date);
}

function renderIndex(articles) {
  const publicItems = publicArticles(articles);
  const cards = publicItems.length
    ? publicItems
        .map(
          (article) => `<a class="card" href="/artykuly-historyczne/${encodeURIComponent(article.slug)}">
  <div class="date">${escapeHtml(formatDate(article.published_at || article.scheduled_at || article.updated_at))}</div>
  <h2>${escapeHtml(article.title)}</h2>
  <p>${escapeHtml(article.excerpt || "Przeczytaj artykuł historyczny opublikowany przez Świadka Dziejów.")}</p>
</a>`,
        )
        .join("\n")
    : `<div class="empty">Nie ma jeszcze opublikowanych artykułów.</div>`;

  return pageShell({
    title: "Artykuły",
    description: "Dłuższe artykuły historyczne Świadka Dziejów.",
    canonicalUrl: `${BASE_URL}/artykuly-historyczne`,
    ogType: "website",
    body: `<header class="wrap hero">
  <div class="index-intro">
    <div>
      <p class="kicker">Artykuły historyczne</p>
      <h1>Dłuższe opowieści o ludziach, decyzjach i epokach.</h1>
      <p class="lead">To miejsce na spokojniejsze teksty historyczne: mniej interakcji, więcej narracji, kontekstu i dobrze opowiedzianej historii.</p>
    </div>
    <p class="index-note">Artykuły są osobną formą od interaktywnych historii. Można je czytać jak klasyczne eseje i wracać do nich bez uruchamiania doświadczeń multimedialnych.</p>
  </div>
</header>
<main class="wrap grid">
${cards}
</main>`,
  });
}

function renderArticle(article) {
  const readingTime = article.metadata?.reading_time || "Esej historyczny";
  return pageShell({
    title: article.title,
    description: article.excerpt || "Artykuł historyczny Świadka Dziejów.",
    canonicalUrl: articleUrl(article),
    body: `<article>
  <p class="kicker">Artykuł historyczny</p>
  <h1>${escapeHtml(article.title)}</h1>
  <div class="article-meta"><span>${escapeHtml(formatDate(article.published_at || article.scheduled_at || article.updated_at))}</span><span>${escapeHtml(readingTime)}</span></div>
  <div class="content">${sanitizeHtml(article.content_html)}</div>
</article>`,
  });
}

function feedPayload(articles) {
  return {
    items: publicArticles(articles)
      .slice(0, 6)
      .map((article) => ({
        title: article.title,
        slug: article.slug,
        excerpt: article.excerpt,
        url: articleUrl(article),
        published_at: article.published_at || article.scheduled_at || article.updated_at,
      })),
  };
}

async function handleCms(req, res) {
  if (!CMS_SECRET) {
    sendJson(res, 503, { error: "cms_secret_not_configured" });
    return;
  }
  if (!isAuthorized(req)) {
    sendJson(res, 401, { error: "unauthorized" });
    return;
  }

  if (req.method === "GET") {
    sendJson(res, 200, { ok: true, service: "swiadek-dziejow-articles-cms" });
    return;
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    sendJson(res, 405, { error: "method_not_allowed" });
    return;
  }

  try {
    const payload = await parseBody(req);
    const validationError = validatePayload(payload);
    if (validationError) {
      sendJson(res, 422, { error: "validation_error", message: validationError });
      return;
    }

    const saved = await upsertArticle(payload);
    sendJson(res, 200, {
      external_id: saved.external_id,
      external_url: saved.status === "draft" ? null : articleUrl(saved),
      status: saved.status,
    });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    sendJson(res, statusCode, {
      error: statusCode === 500 ? "internal_error" : "request_error",
      message: statusCode === 500 ? "Internal error." : error.message,
    });
  }
}

async function handlePublic(req, res, pathname) {
  const articles = await loadArticles();

  if (pathname === "/artykuly-historyczne" || pathname === "/artykuly-historyczne/") {
    sendHtml(res, 200, renderIndex(articles));
    return;
  }

  if (pathname === "/artykuly-historyczne/feed.json") {
    res.setHeader("Cache-Control", "no-store");
    sendJson(res, 200, feedPayload(articles));
    return;
  }

  const slugMatch = pathname.match(/^\/artykuly-historyczne\/([^/]+)$/);
  if (slugMatch) {
    const slug = decodeURIComponent(slugMatch[1]);
    const article = publicArticles(articles).find((item) => item.slug === slug);
    if (!article) {
      sendHtml(
        res,
        404,
        pageShell({
          title: "Nie znaleziono artykułu",
          description: "Nie znaleziono artykułu historycznego.",
          canonicalUrl: `${BASE_URL}/artykuly-historyczne`,
          body: `<main class="wrap hero"><p class="kicker">404</p><h1>Nie znaleziono artykułu.</h1><p class="lead">Ten wpis nie istnieje albo nie został jeszcze opublikowany.</p></main>`,
        }),
      );
      return;
    }
    sendHtml(res, 200, renderArticle(article));
    return;
  }

  sendJson(res, 404, { error: "not_found" });
}

async function handler(req, res) {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    const pathname = url.pathname.replace(/\/+$/, "") || "/";

    if (pathname === "/api/mumro/articles") {
      await handleCms(req, res);
      return;
    }

    if (pathname === "/artykuly-historyczne" || pathname.startsWith("/artykuly-historyczne/")) {
      await handlePublic(req, res, pathname);
      return;
    }

    sendJson(res, 404, { error: "not_found" });
  } catch (error) {
    sendJson(res, 500, { error: "internal_error", message: "Internal error." });
  }
}

await ensureDataFile();

const server = http.createServer(handler);
server.listen(PORT, HOST, () => {
  console.log(`Articles CMS listening on http://${HOST}:${PORT}`);
});
