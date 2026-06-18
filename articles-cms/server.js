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
const ARTICLES_PATH = "/artykuly-historyczne";

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
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      "script-src 'self' https://app.mumro.io",
      "frame-src https://www.youtube.com https://www.youtube-nocookie.com https://player.vimeo.com https://www.instagram.com https://www.facebook.com https://www.tiktok.com https://www.dailymotion.com",
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

function sendXml(res, statusCode, xml) {
  withSecurityHeaders(res, "application/xml; charset=utf-8");
  res.statusCode = statusCode;
  res.end(xml);
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

function stripTags(value) {
  return String(value ?? "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// First <img src> in the article body, used as the social/link-preview image
// (og:image) when the article metadata does not set one explicitly.
function firstImageSrc(html) {
  const match = String(html || "").match(/<img\b[^>]*\bsrc\s*=\s*(["'])([\s\S]*?)\1/i);
  const src = match ? match[2].trim() : "";
  return /^https?:\/\//i.test(src) ? src : "";
}

function absoluteUrl(url) {
  const value = String(url || "").trim();
  if (!value) return "";
  if (/^https?:\/\//i.test(value)) return value;
  if (value.startsWith("/")) return `${BASE_URL}${value}`;
  return `${BASE_URL}/${value}`;
}

function extractYouTubeId(url) {
  const match = String(url || "").match(
    /(?:youtube\.com\/(?:watch\?(?:[^"'\s]*&)?v=|embed\/|v\/|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/i,
  );
  return match ? match[1] : null;
}

function renderYouTube(videoId, caption) {
  const safeId = String(videoId).replace(/[^A-Za-z0-9_-]/g, "").slice(0, 11);
  const thumb = `https://i.ytimg.com/vi/${safeId}/hqdefault.jpg`;
  const label = caption ? `Odtwórz film: ${escapeAttr(caption)}` : "Odtwórz film na YouTube";
  return `<figure class="yt-embed">
  <button type="button" class="yt-frame" data-yt="${safeId}" aria-label="${label}">
    <img class="yt-thumb" src="${thumb}" alt="" loading="lazy" decoding="async">
    <span class="yt-play" aria-hidden="true"><svg viewBox="0 0 68 48" width="72" height="50"><path class="yt-btn" d="M66.5 7.7c-.8-2.9-2.5-5.2-5.4-6C55.8.7 34 .7 34 .7s-21.8 0-27.1 1c-2.9.8-4.6 3.1-5.4 6C.5 13 .5 24 .5 24s0 11 1 16.3c.8 2.9 2.5 5.2 5.4 6 5.3 1 27.1 1 27.1 1s21.8 0 27.1-1c2.9-.8 4.6-3.1 5.4-6 1-5.3 1-16.3 1-16.3s0-11-1-16.3z"/><path d="M27 34.5 45 24 27 13.5z" fill="#fff"/></svg></span>
  </button>${caption ? `\n  <figcaption>${escapeHtml(caption)}</figcaption>` : ""}
</figure>`;
}

// Turns paragraphs/links that point to YouTube into a click-to-play embed.
function embedYouTube(html) {
  // 1) A <p> that contains a YouTube link becomes an embed; surrounding text is the caption.
  let output = String(html).replace(/<p\b[^>]*>([\s\S]*?)<\/p>/gi, (match, inner) => {
    const anchor = inner.match(/<a\b[^>]*\bhref\s*=\s*(["'])([\s\S]*?)\1[^>]*>([\s\S]*?)<\/a>/i);
    if (!anchor) return match;
    const id = extractYouTubeId(anchor[2]);
    if (!id) return match;
    const caption = stripTags(inner.replace(anchor[0], "")).trim();
    return renderYouTube(id, caption);
  });

  // 2) Any remaining standalone YouTube anchors become embeds too.
  output = output.replace(
    /<a\b[^>]*\bhref\s*=\s*(["'])([\s\S]*?)\1[^>]*>([\s\S]*?)<\/a>/gi,
    (match, quote, href, inner) => {
      const id = extractYouTubeId(href);
      if (!id) return match;
      return renderYouTube(id, stripTags(inner).trim());
    },
  );

  return output;
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
  return `${BASE_URL}${ARTICLES_PATH}/${encodeURIComponent(article.slug)}`;
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

/* ----------------------------------------------------------------------------
 * Presentation helpers
 * ------------------------------------------------------------------------- */

function formatDate(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return "Bez daty";
  return new Intl.DateTimeFormat("pl-PL", { year: "numeric", month: "long", day: "numeric" }).format(date);
}

function isoDate(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return "";
  return date.toISOString();
}

function articleDate(article) {
  return article.published_at || article.scheduled_at || article.updated_at;
}

function estimateReadingTime(html) {
  const words = stripTags(html).split(/\s+/).filter(Boolean).length;
  const minutes = Math.max(1, Math.round(words / 200));
  return `${minutes} min czytania`;
}

function readingLabel(article) {
  return article.metadata?.reading_time || estimateReadingTime(article.content_html);
}

// Adds stable ids + hover anchors to h2/h3 headings and returns a table of contents.
function processContent(html) {
  const toc = [];
  const used = new Set();

  const processed = html.replace(
    /<h([23])((?:\s[^>]*)?)>([\s\S]*?)<\/h\1>/gi,
    (match, level, attrs, inner) => {
      const text = stripTags(inner);
      if (!text) return match;

      const base = normalizeSlug(text);
      let id = base;
      let counter = 2;
      while (used.has(id)) {
        id = `${base}-${counter}`;
        counter += 1;
      }
      used.add(id);
      toc.push({ level: Number(level), text, id });

      const cleanedAttrs = String(attrs || "").replace(/\sid\s*=\s*(['"]).*?\1/i, "");
      return `<h${level}${cleanedAttrs} id="${id}" class="content-heading"><a class="heading-anchor" href="#${id}" aria-label="Odnośnik do sekcji: ${escapeAttr(text)}">#</a>${inner}</h${level}>`;
    },
  );

  return { html: processed, toc };
}

function renderToc(toc) {
  if (toc.length < 3) return "";
  const items = toc
    .map(
      (item) =>
        `<li class="toc-item toc-l${item.level}"><a href="#${item.id}">${escapeHtml(item.text)}</a></li>`,
    )
    .join("");
  return `<nav class="toc" aria-label="Spis treści">
  <p class="toc-title">W tym artykule</p>
  <ul class="toc-list">${items}</ul>
</nav>`;
}

function renderTags(article) {
  const topic = article.metadata?.topic;
  if (!topic) return "";
  const tags = String(topic)
    .split(/[,;]/)
    .map((tag) => tag.trim())
    .filter(Boolean)
    .slice(0, 6);
  if (!tags.length) return "";
  return `<ul class="tag-row">${tags
    .map((tag) => `<li class="tag">${escapeHtml(tag)}</li>`)
    .join("")}</ul>`;
}

function articleJsonLd(article) {
  const ogImage = absoluteUrl(article.metadata?.og_image || firstImageSrc(article.content_html));
  const data = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: article.title,
    description: article.excerpt || stripTags(article.content_html).slice(0, 200),
    datePublished: isoDate(articleDate(article)),
    dateModified: isoDate(article.updated_at || articleDate(article)),
    author: { "@type": "Organization", name: "Świadek Dziejów" },
    publisher: {
      "@type": "Organization",
      name: "Świadek Dziejów",
      url: BASE_URL,
    },
    mainEntityOfPage: { "@type": "WebPage", "@id": articleUrl(article) },
    inLanguage: "pl-PL",
  };
  if (ogImage) {
    data.image = [ogImage];
  }
  // Escape '<' to keep the JSON-LD safe inside a <script> block.
  return `<script type="application/ld+json">${JSON.stringify(data).replace(/</g, "\\u003c")}</script>`;
}

function renderRelated(article, articles) {
  const others = publicArticles(articles).filter((item) => item.slug !== article.slug);
  if (!others.length) return "";

  // Prefer items sharing a topic keyword, then fall back to the most recent.
  const ownTopics = String(article.metadata?.topic || "")
    .toLowerCase()
    .split(/[,;]/)
    .map((tag) => tag.trim())
    .filter(Boolean);

  const scored = others
    .map((item) => {
      const topics = String(item.metadata?.topic || "").toLowerCase();
      const overlap = ownTopics.filter((tag) => topics.includes(tag)).length;
      return { item, overlap };
    })
    .sort((a, b) => b.overlap - a.overlap);

  const picks = scored.slice(0, 3).map((entry) => entry.item);
  if (!picks.length) return "";

  const cards = picks
    .map(
      (item) => `<a class="related-card" href="${ARTICLES_PATH}/${encodeURIComponent(item.slug)}">
  <span class="related-date">${escapeHtml(formatDate(articleDate(item)))}</span>
  <span class="related-title">${escapeHtml(item.title)}</span>
</a>`,
    )
    .join("\n");

  return `<aside class="related wrap">
  <p class="kicker">Czytaj dalej</p>
  <div class="related-grid">${cards}</div>
</aside>`;
}

const SITE_LOGO = `<a class="brand" href="/" aria-label="Świadek Dziejów — strona główna">
  <span class="brand-mark" aria-hidden="true">SD</span>
  <span class="brand-name">Świadek Dziejów</span>
</a>`;

function pageShell({ title, description, canonicalUrl, body, extraHead = "", ogType = "article", bodyClass = "", ogImage = "" }) {
  const pageTitle = title ? `${title} · Świadek Dziejów` : "Artykuły · Świadek Dziejów";
  const metaDescription = description || "Artykuły historyczne Świadka Dziejów.";
  const ogImageUrl = absoluteUrl(ogImage);
  const ogImageTags = ogImageUrl
    ? `\n  <meta property="og:image" content="${escapeAttr(ogImageUrl)}">\n  <meta name="twitter:image" content="${escapeAttr(ogImageUrl)}">`
    : "";

  return `<!doctype html>
<html lang="pl">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(pageTitle)}</title>
  <meta name="description" content="${escapeAttr(metaDescription)}">
  <meta name="theme-color" content="#08070a">
  <meta property="og:title" content="${escapeAttr(pageTitle)}">
  <meta property="og:description" content="${escapeAttr(metaDescription)}">
  <meta property="og:type" content="${escapeAttr(ogType)}">
  <meta property="og:site_name" content="Świadek Dziejów">
  <meta property="og:url" content="${escapeAttr(canonicalUrl)}">
  <meta name="twitter:card" content="summary_large_image">${ogImageTags}
  <link rel="canonical" href="${escapeAttr(canonicalUrl)}">
  <link rel="alternate" type="application/rss+xml" title="Świadek Dziejów — artykuły" href="${BASE_URL}${ARTICLES_PATH}/feed.xml">
  <link rel="icon" href="/favicon.ico" sizes="any">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600;9..144,700&family=Inter:wght@400;500;600;700&display=swap">
  <style>${PAGE_STYLES}</style>
  <script async src="https://app.mumro.io/api/website-analytics/script.js?p=wa_DRu7oiXMoXiW117JsnANN4fb"></script>
  ${extraHead}
</head>
<body class="${escapeAttr(bodyClass)}">
  <div class="reading-progress" aria-hidden="true"><span></span></div>
  <header class="site-header">
    <div class="wrap site-header-inner">
      ${SITE_LOGO}
      <nav class="site-links" aria-label="Nawigacja">
        <a href="${ARTICLES_PATH}">Artykuły</a>
        <a href="/historia-polski">Historia Polski</a>
        <a href="https://atlas.swiadek-dziejow.pl" target="_blank" rel="noopener noreferrer">Atlas</a>
        <a class="site-link-cta" href="/">Strona główna</a>
      </nav>
    </div>
  </header>
  <main id="top">
${body}
  </main>
  <footer class="site-footer">
    <div class="wrap site-footer-inner">
      <div>
        <p class="footer-brand">Świadek Dziejów</p>
        <p class="footer-note">Historia opowiedziana z perspektywy kogoś, kto tam był.</p>
        <div class="footer-social">
          <a href="https://www.youtube.com/@roleplayinglife_0x" target="_blank" rel="noopener noreferrer" aria-label="YouTube"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M23.5 6.2a3 3 0 0 0-2.1-2.1C19.5 3.5 12 3.5 12 3.5s-7.5 0-9.4.6A3 3 0 0 0 .5 6.2 31 31 0 0 0 0 12a31 31 0 0 0 .5 5.8 3 3 0 0 0 2.1 2.1c1.9.6 9.4.6 9.4.6s7.5 0 9.4-.6a3 3 0 0 0 2.1-2.1A31 31 0 0 0 24 12a31 31 0 0 0-.5-5.8zM9.5 15.5v-7l6.3 3.5-6.3 3.5z"/></svg></a>
          <a href="https://www.instagram.com/swiadek_dziejow/" target="_blank" rel="noopener noreferrer" aria-label="Instagram"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="2" width="20" height="20" rx="5.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="17.6" cy="6.4" r="1.3" fill="currentColor" stroke="none"/></svg></a>
          <a href="https://www.facebook.com/profile.php?id=61588448017737" target="_blank" rel="noopener noreferrer" aria-label="Facebook"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M22 12a10 10 0 1 0-11.6 9.9v-7H7.9V12h2.5V9.8c0-2.5 1.5-3.9 3.8-3.9 1.1 0 2.2.2 2.2.2v2.5h-1.3c-1.2 0-1.6.8-1.6 1.6V12h2.8l-.4 2.9h-2.4v7A10 10 0 0 0 22 12z"/></svg></a>
        </div>
      </div>
      <nav class="footer-links" aria-label="Stopka">
        <a href="${ARTICLES_PATH}">Wszystkie artykuły</a>
        <a href="https://www.youtube.com/@roleplayinglife_0x" target="_blank" rel="noopener noreferrer">YouTube</a>
        <a href="${ARTICLES_PATH}/feed.xml">Kanał RSS</a>
        <a href="/">Strona główna</a>
      </nav>
    </div>
    <div class="wrap footer-meta">© ${new Date().getFullYear()} Świadek Dziejów · Artykuły historyczne</div>
  </footer>
  <script>${PAGE_SCRIPT}</script>
</body>
</html>`;
}

function renderIndex(articles) {
  const publicItems = publicArticles(articles);
  const [featured, ...rest] = publicItems;

  const featuredBlock = featured
    ? `<a class="featured-card" href="${ARTICLES_PATH}/${encodeURIComponent(featured.slug)}">
  <div class="featured-body">
    <span class="featured-flag">Najnowszy artykuł</span>
    <h2>${escapeHtml(featured.title)}</h2>
    <p>${escapeHtml(featured.excerpt || "Przeczytaj najnowszy tekst Świadka Dziejów.")}</p>
    <div class="featured-meta">
      <span>${escapeHtml(formatDate(articleDate(featured)))}</span>
      <span>${escapeHtml(readingLabel(featured))}</span>
    </div>
    <span class="featured-go">Czytaj artykuł <span aria-hidden="true">→</span></span>
  </div>
</a>`
    : "";

  const cards = rest.length
    ? rest
        .map(
          (article) => `<a class="card" href="${ARTICLES_PATH}/${encodeURIComponent(article.slug)}">
  <div class="card-meta">
    <span class="date">${escapeHtml(formatDate(articleDate(article)))}</span>
    <span class="dot" aria-hidden="true"></span>
    <span>${escapeHtml(readingLabel(article))}</span>
  </div>
  <h3>${escapeHtml(article.title)}</h3>
  <p>${escapeHtml(article.excerpt || "Przeczytaj artykuł historyczny opublikowany przez Świadka Dziejów.")}</p>
  <span class="card-go" aria-hidden="true">→</span>
</a>`,
        )
        .join("\n")
    : "";

  const listBlock = !publicItems.length
    ? `<div class="empty wrap">Nie ma jeszcze opublikowanych artykułów. Zajrzyj wkrótce.</div>`
    : `${featuredBlock ? `<section class="wrap featured-wrap">${featuredBlock}</section>` : ""}
${rest.length ? `<section class="wrap grid-section"><p class="kicker grid-kicker">Wszystkie teksty</p><div class="grid">\n${cards}\n</div></section>` : ""}`;

  return pageShell({
    title: "Artykuły",
    description: "Dłuższe artykuły historyczne Świadka Dziejów — eseje o ludziach, decyzjach i epokach.",
    canonicalUrl: `${BASE_URL}${ARTICLES_PATH}`,
    ogType: "website",
    bodyClass: "page-index",
    body: `<header class="wrap hero">
  <p class="kicker">Artykuły historyczne</p>
  <h1>Dłuższe opowieści o&nbsp;ludziach, decyzjach i&nbsp;epokach.</h1>
  <p class="lead">Spokojniejsze teksty historyczne: mniej interakcji, więcej narracji, kontekstu i&nbsp;dobrze opowiedzianej historii. Można je czytać jak klasyczne eseje i&nbsp;wracać do nich bez uruchamiania doświadczeń multimedialnych.</p>
</header>
${listBlock}`,
  });
}

function renderArticle(article, articles) {
  const { html: contentHtml, toc } = processContent(embedYouTube(sanitizeHtml(article.content_html)));
  const tocBlock = renderToc(toc);
  const tags = renderTags(article);
  const related = renderRelated(article, articles);
  const shareUrl = encodeURIComponent(articleUrl(article));
  const shareText = encodeURIComponent(article.title);

  return pageShell({
    title: article.title,
    description: article.excerpt || stripTags(article.content_html).slice(0, 180),
    canonicalUrl: articleUrl(article),
    bodyClass: "page-article",
    ogImage: article.metadata?.og_image || firstImageSrc(article.content_html),
    extraHead: articleJsonLd(article),
    body: `<article class="article">
  <header class="wrap article-head">
    <p class="kicker">Artykuł historyczny</p>
    <h1>${escapeHtml(article.title)}</h1>
    ${article.excerpt ? `<p class="article-standfirst">${escapeHtml(article.excerpt)}</p>` : ""}
    <div class="article-meta">
      <span>${escapeHtml(formatDate(articleDate(article)))}</span>
      <span class="dot" aria-hidden="true"></span>
      <span>${escapeHtml(readingLabel(article))}</span>
    </div>
    ${tags}
  </header>
  <div class="article-body wrap${tocBlock ? " has-toc" : ""}">
    ${tocBlock ? `<div class="toc-col">${tocBlock}</div>` : ""}
    <div class="content">${contentHtml}<p class="end-mark" aria-hidden="true">❧</p></div>
  </div>
  <div class="wrap article-foot">
    <div class="share">
      <span class="share-label">Udostępnij</span>
      <a class="share-link" href="https://www.facebook.com/sharer/sharer.php?u=${shareUrl}" target="_blank" rel="noopener noreferrer">Facebook</a>
      <a class="share-link" href="https://twitter.com/intent/tweet?url=${shareUrl}&text=${shareText}" target="_blank" rel="noopener noreferrer">X</a>
      <a class="share-link" href="${ARTICLES_PATH}">← Wszystkie artykuły</a>
    </div>
  </div>
</article>
${related}`,
  });
}

function notFoundPage() {
  return pageShell({
    title: "Nie znaleziono artykułu",
    description: "Nie znaleziono artykułu historycznego.",
    canonicalUrl: `${BASE_URL}${ARTICLES_PATH}`,
    ogType: "website",
    bodyClass: "page-error",
    body: `<section class="wrap hero error-hero">
  <p class="kicker">404</p>
  <h1>Nie znaleziono artykułu.</h1>
  <p class="lead">Ten wpis nie istnieje albo nie został jeszcze opublikowany.</p>
  <p><a class="back-cta" href="${ARTICLES_PATH}">Przejdź do listy artykułów</a></p>
</section>`,
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
        published_at: articleDate(article),
      })),
  };
}

function feedXml(articles) {
  const items = publicArticles(articles)
    .slice(0, 20)
    .map((article) => {
      const url = articleUrl(article);
      const pubDate = new Date(articleDate(article) || article.updated_at).toUTCString();
      return `  <item>
    <title>${escapeHtml(article.title)}</title>
    <link>${escapeHtml(url)}</link>
    <guid isPermaLink="true">${escapeHtml(url)}</guid>
    <pubDate>${escapeHtml(pubDate)}</pubDate>
    <description>${escapeHtml(article.excerpt || stripTags(article.content_html).slice(0, 280))}</description>
  </item>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
<channel>
  <title>Świadek Dziejów — artykuły historyczne</title>
  <link>${BASE_URL}${ARTICLES_PATH}</link>
  <description>Dłuższe artykuły historyczne Świadka Dziejów.</description>
  <language>pl-PL</language>
${items}
</channel>
</rss>`;
}

function sitemapXml(articles) {
  const urls = [
    { loc: `${BASE_URL}${ARTICLES_PATH}`, lastmod: new Date().toISOString() },
    ...publicArticles(articles).map((article) => ({
      loc: articleUrl(article),
      lastmod: isoDate(article.updated_at || articleDate(article)),
    })),
  ];

  const body = urls
    .map(
      (entry) => `  <url>
    <loc>${escapeHtml(entry.loc)}</loc>${entry.lastmod ? `\n    <lastmod>${escapeHtml(entry.lastmod)}</lastmod>` : ""}
  </url>`,
    )
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${body}
</urlset>`;
}

/* ----------------------------------------------------------------------------
 * Request handling
 * ------------------------------------------------------------------------- */

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

  if (pathname === ARTICLES_PATH || pathname === `${ARTICLES_PATH}/`) {
    sendHtml(res, 200, renderIndex(articles));
    return;
  }

  if (pathname === `${ARTICLES_PATH}/feed.json`) {
    res.setHeader("Cache-Control", "no-store");
    sendJson(res, 200, feedPayload(articles));
    return;
  }

  if (pathname === `${ARTICLES_PATH}/feed.xml`) {
    res.setHeader("Cache-Control", "public, max-age=600");
    sendXml(res, 200, feedXml(articles));
    return;
  }

  if (pathname === `${ARTICLES_PATH}/sitemap.xml`) {
    res.setHeader("Cache-Control", "public, max-age=600");
    sendXml(res, 200, sitemapXml(articles));
    return;
  }

  const slugMatch = pathname.match(/^\/artykuly-historyczne\/([^/]+)$/);
  if (slugMatch) {
    const slug = decodeURIComponent(slugMatch[1]);
    const article = publicArticles(articles).find((item) => item.slug === slug);
    if (!article) {
      sendHtml(res, 404, notFoundPage());
      return;
    }
    sendHtml(res, 200, renderArticle(article, articles));
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

    if (pathname === ARTICLES_PATH || pathname.startsWith(`${ARTICLES_PATH}/`)) {
      await handlePublic(req, res, pathname);
      return;
    }

    sendJson(res, 404, { error: "not_found" });
  } catch (error) {
    sendJson(res, 500, { error: "internal_error", message: "Internal error." });
  }
}

/* ----------------------------------------------------------------------------
 * Inline styles & progressive-enhancement script
 * ------------------------------------------------------------------------- */

const PAGE_STYLES = `
:root {
  color-scheme: dark;
  --bg: #08070a;
  --bg-soft: #0e0c11;
  --fg: #f1ece2;
  --muted: rgba(241, 236, 226, 0.68);
  --dim: rgba(241, 236, 226, 0.44);
  --faint: rgba(241, 236, 226, 0.14);
  --accent: #d4a054;
  --accent-bright: #f0c878;
  --tech: #4ecdc4;
  --line: rgba(241, 236, 226, 0.09);
  --accent-line: rgba(212, 160, 84, 0.22);
  --serif: "Fraunces", Georgia, "Times New Roman", serif;
  --sans: "Inter", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  --wrap: min(1140px, calc(100% - 40px));
  --read: min(720px, calc(100% - 40px));
}
* { box-sizing: border-box; }
html { scroll-behavior: smooth; scroll-padding-top: 96px; }
@media (prefers-reduced-motion: reduce) {
  html { scroll-behavior: auto; }
  *, *::before, *::after { animation-duration: .01ms !important; transition-duration: .01ms !important; }
}
body {
  margin: 0;
  min-height: 100vh;
  background:
    radial-gradient(circle at 16% -4%, rgba(212, 160, 84, 0.16), transparent 36rem),
    radial-gradient(circle at 88% 4%, rgba(78, 205, 196, 0.09), transparent 32rem),
    var(--bg);
  color: var(--fg);
  font-family: var(--sans);
  font-size: 17px;
  line-height: 1.7;
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
  overflow-x: hidden;
}
body::before {
  content: "";
  position: fixed;
  inset: 0;
  z-index: 1;
  pointer-events: none;
  opacity: .05;
  mix-blend-mode: overlay;
  background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='1.8' numOctaves='3'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
}
a { color: inherit; text-decoration: none; }
.wrap { width: var(--wrap); margin-inline: auto; }
h1, h2, h3 { font-family: var(--serif); font-weight: 600; letter-spacing: -0.015em; }

/* reading progress */
.reading-progress { position: fixed; top: 0; left: 0; right: 0; height: 3px; z-index: 60; background: transparent; }
.reading-progress span { display: block; height: 100%; width: 0; background: linear-gradient(90deg, var(--accent), var(--accent-bright), var(--tech)); box-shadow: 0 0 14px rgba(212, 160, 84, .4); transition: width .12s ease-out; }
.page-index .reading-progress, .page-error .reading-progress { display: none; }

/* header */
.site-header { position: sticky; top: 0; z-index: 50; backdrop-filter: blur(16px); background: rgba(8, 7, 10, 0.72); border-bottom: 1px solid var(--line); }
.site-header-inner { display: flex; align-items: center; justify-content: space-between; gap: 18px; min-height: 64px; }
.brand { display: inline-flex; align-items: center; gap: 12px; }
.brand-mark { display: inline-grid; place-items: center; width: 34px; height: 34px; border-radius: 9px; font-family: var(--serif); font-weight: 700; font-size: 14px; color: #14100a; background: linear-gradient(135deg, var(--accent-bright), var(--accent)); }
.brand-name { font-family: var(--serif); font-weight: 600; font-size: 15px; letter-spacing: .01em; }
.site-links { display: flex; align-items: center; gap: 6px; font-size: 13px; }
.site-links a { color: var(--muted); padding: 8px 13px; border-radius: 8px; transition: color .2s ease, background .2s ease; }
.site-links a:hover { color: var(--fg); background: rgba(255, 255, 255, .05); }
.site-link-cta { color: var(--accent-bright) !important; border: 1px solid var(--accent-line); }
.site-link-cta:hover { border-color: rgba(240, 200, 120, .5); }

/* hero */
.kicker { color: var(--accent); text-transform: uppercase; letter-spacing: .34em; font-size: 11px; font-weight: 700; margin: 0 0 18px; font-family: var(--sans); }
.hero { padding: 92px 0 40px; position: relative; }
.hero h1 { font-size: clamp(2.6rem, 7vw, 5.4rem); line-height: 1.02; margin: 0; max-width: 16ch; text-wrap: balance; }
.lead { max-width: 60ch; color: var(--muted); font-size: clamp(1.02rem, 1.6vw, 1.2rem); margin: 26px 0 0; }

/* featured */
.featured-wrap { padding: 18px 0 8px; }
.featured-card { display: block; position: relative; padding: clamp(28px, 4vw, 52px); border: 1px solid var(--accent-line); border-radius: 22px; background: linear-gradient(140deg, rgba(212, 160, 84, .14), rgba(255, 255, 255, .03) 42%, rgba(78, 205, 196, .06)); overflow: hidden; transition: transform .3s ease, border-color .3s ease, box-shadow .3s ease; }
.featured-card::after { content: ""; position: absolute; inset: 0; background: radial-gradient(circle at 82% 0%, rgba(212, 160, 84, .18), transparent 22rem); pointer-events: none; }
.featured-card:hover { transform: translateY(-4px); border-color: rgba(240, 200, 120, .5); box-shadow: 0 30px 80px rgba(0, 0, 0, .35); }
.featured-body { position: relative; z-index: 1; max-width: 64ch; }
.featured-flag { display: inline-block; font-size: 10px; letter-spacing: .26em; text-transform: uppercase; font-weight: 700; color: var(--accent-bright); margin-bottom: 18px; }
.featured-card h2 { font-size: clamp(1.9rem, 4vw, 3.1rem); line-height: 1.06; margin: 0 0 16px; }
.featured-card p { color: var(--muted); font-size: 1.06rem; margin: 0 0 22px; max-width: 56ch; }
.featured-meta { display: flex; gap: 16px; color: var(--dim); font-size: 12px; letter-spacing: .12em; text-transform: uppercase; margin-bottom: 22px; }
.featured-go { display: inline-flex; align-items: center; gap: 8px; font-weight: 600; color: var(--accent-bright); }

/* grid */
.grid-section { padding: 46px 0 90px; }
.grid-kicker { margin-bottom: 22px; }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 18px; }
.card { position: relative; display: flex; flex-direction: column; min-height: 230px; padding: 26px; border: 1px solid var(--line); border-radius: 18px; background: linear-gradient(150deg, rgba(255, 255, 255, .045), rgba(0, 0, 0, .18)); transition: transform .25s ease, border-color .25s ease, box-shadow .25s ease; }
.card:hover { transform: translateY(-4px); border-color: var(--accent-line); box-shadow: 0 22px 60px rgba(0, 0, 0, .3); }
.card-meta { display: flex; align-items: center; gap: 10px; color: var(--dim); font-size: 11px; text-transform: uppercase; letter-spacing: .16em; margin-bottom: 16px; }
.dot { width: 4px; height: 4px; border-radius: 50%; background: var(--accent); opacity: .6; }
.card h3 { font-size: 1.42rem; line-height: 1.14; margin: 0 0 12px; }
.card p { margin: 0; color: var(--muted); font-size: .95rem; line-height: 1.6; }
.card-go { margin-top: auto; padding-top: 16px; color: var(--accent); font-size: 1.1rem; transition: transform .25s ease; }
.card:hover .card-go { transform: translateX(4px); }
.empty { margin: 30px auto 80px; padding: 36px; border: 1px dashed var(--accent-line); border-radius: 18px; color: var(--muted); background: rgba(255, 255, 255, .025); text-align: center; }

/* article */
.article-head { padding: 84px 0 0; max-width: 56rem; }
.article-head h1 { font-size: clamp(2.3rem, 5.4vw, 4rem); line-height: 1.04; margin: 0; max-width: 20ch; text-wrap: balance; }
.article-standfirst { color: var(--muted); font-size: clamp(1.1rem, 2vw, 1.3rem); line-height: 1.6; margin: 22px 0 0; max-width: 54ch; font-family: var(--serif); font-weight: 400; }
.article-meta { display: flex; align-items: center; gap: 12px; color: var(--dim); font-size: 12px; text-transform: uppercase; letter-spacing: .16em; margin: 28px 0 0; }
.tag-row { list-style: none; display: flex; flex-wrap: wrap; gap: 8px; padding: 0; margin: 22px 0 0; }
.tag { font-size: 11px; letter-spacing: .1em; text-transform: uppercase; color: var(--muted); border: 1px solid var(--faint); border-radius: 999px; padding: 5px 12px; }

.article-body { margin-top: 48px; }
.article-body.has-toc { display: grid; grid-template-columns: 1fr; gap: 0; }
@media (min-width: 1040px) {
  .article-body.has-toc { grid-template-columns: 230px minmax(0, 1fr); gap: 56px; align-items: start; width: min(980px, calc(100% - 40px)); }
}
.toc-col { display: none; }
@media (min-width: 1040px) { .toc-col { display: block; } }
.toc { position: sticky; top: 92px; border-left: 1px solid var(--accent-line); padding-left: 18px; }
.toc-title { font-size: 10px; letter-spacing: .24em; text-transform: uppercase; color: var(--dim); margin: 0 0 14px; }
.toc-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.toc-item a { color: var(--muted); font-size: 13px; line-height: 1.4; transition: color .2s ease; }
.toc-item a:hover, .toc-item.is-active a { color: var(--accent-bright); }
.toc-l3 a { padding-left: 14px; font-size: 12px; color: var(--dim); }

.content { color: rgba(241, 236, 226, .85); font-size: 1.12rem; line-height: 1.82; width: var(--read); margin-inline: auto; }
.article-body.has-toc .content { width: auto; margin-inline: 0; }
.content > p:first-of-type { font-size: 1.24rem; line-height: 1.7; color: rgba(241, 236, 226, .94); }
.content > p:first-of-type::first-letter { font-family: var(--serif); font-weight: 700; float: left; font-size: 3.6rem; line-height: .82; padding: 6px 14px 0 0; color: var(--accent-bright); }
.content h2, .content h3 { color: var(--fg); line-height: 1.16; margin: 2.2em 0 .65em; position: relative; }
.content h2 { font-size: clamp(1.7rem, 3vw, 2.2rem); }
.content h3 { font-size: 1.4rem; }
.heading-anchor { position: absolute; left: -1.1em; color: var(--accent); opacity: 0; text-decoration: none; transition: opacity .2s ease; font-family: var(--sans); }
.content-heading:hover .heading-anchor { opacity: .6; }
.content p, .content ul, .content ol, .content blockquote { margin: 1.2em 0; }
.content ul, .content ol { padding-left: 1.3rem; }
.content li { margin: .5em 0; }
.content li::marker { color: var(--accent); }
.content blockquote { border-left: 3px solid var(--accent); padding: 6px 0 6px 22px; margin-left: 0; color: var(--fg); font-family: var(--serif); font-size: 1.28rem; line-height: 1.5; font-style: italic; }
.content a { color: var(--accent-bright); text-decoration: underline; text-decoration-color: rgba(240, 200, 120, .35); text-underline-offset: 4px; }
.content a:hover { text-decoration-color: var(--accent-bright); }
.content .film-link { display: inline-flex; align-items: center; gap: 10px; margin-top: .4rem; padding: 13px 20px; border: 1px solid var(--accent-line); border-radius: 12px; background: rgba(212, 160, 84, .1); color: var(--accent-bright); text-decoration: none; font-weight: 700; font-size: .95rem; }
.content .film-link:hover { border-color: rgba(240, 200, 120, .6); background: rgba(212, 160, 84, .16); }
.content img, .content video, .content iframe { max-width: 100%; border-radius: 14px; border: 1px solid var(--line); background: #050505; }
.content iframe { width: 100%; min-height: 420px; }
.content figure { margin: 1.6em 0; }
.content figcaption { color: var(--dim); font-size: .85rem; margin-top: 8px; text-align: center; }
.yt-embed { margin: 1.9em 0; }
.yt-frame { display: block; position: relative; width: 100%; aspect-ratio: 16 / 9; padding: 0; border: 1px solid var(--line); border-radius: 16px; overflow: hidden; cursor: pointer; background: #000; }
.yt-thumb { width: 100%; height: 100%; object-fit: cover; opacity: .8; transition: opacity .3s ease, transform .6s var(--ease, ease); border: 0; border-radius: 0; }
.yt-frame:hover .yt-thumb, .yt-frame:focus-visible .yt-thumb { opacity: 1; transform: scale(1.04); }
.yt-frame::after { content: ""; position: absolute; inset: 0; background: linear-gradient(180deg, rgba(0,0,0,.1), rgba(0,0,0,.35)); pointer-events: none; }
.yt-play { position: absolute; inset: 0; display: grid; place-items: center; z-index: 1; }
.yt-play .yt-btn { fill: #21201f; opacity: .82; transition: fill .2s ease, opacity .2s ease; }
.yt-play svg { filter: drop-shadow(0 6px 18px rgba(0, 0, 0, .5)); transition: transform .2s ease; }
.yt-frame:hover .yt-btn, .yt-frame:focus-visible .yt-btn { fill: #ff0000; opacity: 1; }
.yt-frame:hover .yt-play svg, .yt-frame:focus-visible .yt-play svg { transform: scale(1.08); }
.yt-iframe { display: block; width: 100%; aspect-ratio: 16 / 9; min-height: 0; border: 1px solid var(--line); border-radius: 16px; background: #000; margin: 1.9em 0; }
@media (max-width: 700px) { .content iframe, .yt-iframe { min-height: 0; } }
.end-mark { text-align: center; color: var(--accent); font-size: 1.6rem; margin: 2.4em 0 0; opacity: .7; }

.article-foot { margin: 56px auto 0; padding-top: 28px; border-top: 1px solid var(--line); max-width: 56rem; }
.share { display: flex; align-items: center; flex-wrap: wrap; gap: 12px; }
.share-label { font-size: 11px; text-transform: uppercase; letter-spacing: .2em; color: var(--dim); }
.share-link { font-size: 13px; color: var(--muted); border: 1px solid var(--faint); border-radius: 999px; padding: 8px 16px; transition: color .2s ease, border-color .2s ease; }
.share-link:hover { color: var(--accent-bright); border-color: var(--accent-line); }

/* related */
.related { margin: 80px auto 100px; max-width: 56rem; }
.related-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 14px; margin-top: 18px; }
.related-card { display: flex; flex-direction: column; gap: 8px; padding: 20px; border: 1px solid var(--line); border-radius: 14px; background: rgba(255, 255, 255, .025); transition: transform .25s ease, border-color .25s ease; }
.related-card:hover { transform: translateY(-3px); border-color: var(--accent-line); }
.related-date { font-size: 10px; text-transform: uppercase; letter-spacing: .18em; color: var(--dim); }
.related-title { font-family: var(--serif); font-size: 1.08rem; line-height: 1.2; color: var(--fg); }

/* error */
.error-hero { padding-bottom: 120px; }
.back-cta { display: inline-block; margin-top: 14px; color: var(--accent-bright); border: 1px solid var(--accent-line); border-radius: 999px; padding: 12px 22px; font-weight: 600; }
.back-cta:hover { border-color: rgba(240, 200, 120, .6); }

/* footer */
.site-footer { border-top: 1px solid var(--line); margin-top: 40px; padding: 44px 0 30px; background: linear-gradient(180deg, transparent, rgba(212, 160, 84, .03)); }
.site-footer-inner { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 24px; }
.footer-brand { font-family: var(--serif); font-size: 1.3rem; margin: 0 0 6px; }
.footer-note { color: var(--dim); margin: 0; max-width: 40ch; font-size: .95rem; }
.footer-links { display: flex; flex-direction: column; gap: 8px; font-size: 14px; }
.footer-links a { color: var(--muted); }
.footer-links a:hover { color: var(--accent-bright); }
.footer-meta { color: var(--dim); font-size: 12px; margin-top: 30px; padding-top: 20px; border-top: 1px solid var(--line); }
.footer-social { display: flex; gap: 10px; margin-top: 16px; }
.footer-social a { width: 40px; height: 40px; display: grid; place-items: center; border: 1px solid var(--line); border-radius: 11px; color: var(--muted); transition: color .2s ease, border-color .2s ease, transform .2s ease, background .2s ease; }
.footer-social a:hover { color: var(--fg); border-color: var(--accent-line); transform: translateY(-2px); background: rgba(255, 255, 255, .04); }
.footer-social svg { width: 19px; height: 19px; }

@media (max-width: 720px) {
  body { font-size: 16px; }
  .site-links { gap: 2px; font-size: 12px; }
  .site-links a { padding: 7px 9px; }
  .site-links a[href="/historia-polski"], .site-links a[href^="https://atlas"] { display: none; }
  .hero { padding-top: 56px; }
  .article-head { padding-top: 52px; }
  .content > p:first-of-type::first-letter { font-size: 3rem; }
}
`;

const PAGE_SCRIPT = `
(function () {
  var bar = document.querySelector(".reading-progress span");
  var article = document.querySelector(".article-body");
  if (bar && article) {
    var update = function () {
      var rect = article.getBoundingClientRect();
      var total = rect.height - window.innerHeight;
      var scrolled = Math.min(Math.max(-rect.top, 0), Math.max(total, 1));
      bar.style.width = (total > 0 ? (scrolled / total) * 100 : 0) + "%";
    };
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update, { passive: true });
    update();
  }

  var ytButtons = Array.prototype.slice.call(document.querySelectorAll(".yt-frame"));
  ytButtons.forEach(function (button) {
    button.addEventListener("click", function () {
      var id = button.getAttribute("data-yt");
      if (!id) return;
      var iframe = document.createElement("iframe");
      iframe.className = "yt-iframe";
      iframe.src = "https://www.youtube-nocookie.com/embed/" + encodeURIComponent(id) + "?autoplay=1&rel=0";
      iframe.title = "Film YouTube";
      iframe.setAttribute("allow", "autoplay; encrypted-media; picture-in-picture; web-share");
      iframe.setAttribute("allowfullscreen", "");
      iframe.setAttribute("loading", "lazy");
      var figure = button.closest(".yt-embed") || button;
      button.replaceWith(iframe);
      iframe.focus();
      void figure;
    });
  });

  var tocLinks = Array.prototype.slice.call(document.querySelectorAll(".toc-item a"));
  if (tocLinks.length && "IntersectionObserver" in window) {
    var map = {};
    tocLinks.forEach(function (link) {
      var id = link.getAttribute("href").slice(1);
      map[id] = link.parentElement;
    });
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          tocLinks.forEach(function (l) { l.parentElement.classList.remove("is-active"); });
          var active = map[entry.target.id];
          if (active) active.classList.add("is-active");
        }
      });
    }, { rootMargin: "-20% 0px -70% 0px" });
    document.querySelectorAll(".content-heading").forEach(function (heading) {
      observer.observe(heading);
    });
  }
})();
`;

await ensureDataFile();

const server = http.createServer(handler);
server.listen(PORT, HOST, () => {
  console.log(`Articles CMS listening on http://${HOST}:${PORT}`);
});
