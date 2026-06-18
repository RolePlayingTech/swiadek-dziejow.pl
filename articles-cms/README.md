# Swiadek Dziejow Articles CMS

Small Node.js service used as a Mumro custom CMS target for historical articles.

## Public routes

- `GET /artykuly-historyczne` - article index (hero, featured latest article, grid)
- `GET /artykuly-historyczne/:slug` - public article page (auto table of contents, reading
  progress, share links, related articles, Article JSON-LD)
- `GET /artykuly-historyczne/feed.json` - latest public articles for the home page embed
- `GET /artykuly-historyczne/feed.xml` - RSS 2.0 feed (latest 20 public articles)
- `GET /artykuly-historyczne/sitemap.xml` - sitemap of public article pages

The article pages load the Fraunces + Inter web fonts from Google Fonts; the CSP
allows `fonts.googleapis.com` (styles) and `fonts.gstatic.com` (font files). The
layout degrades to system serif/sans fonts if those hosts are blocked.

## Mumro route

- `GET /api/mumro/articles` - Mumro CMS health-check, requires `Authorization: Bearer <MUMRO_CMS_SECRET>`
- `POST /api/mumro/articles` - upserts article payload sent by Mumro

The service expects Mumro's custom CMS payload with `article` and `site` objects.
Published articles are public immediately. Future articles become public after
their scheduled date. Drafts are stored but not listed publicly.

## Runtime

Systemd unit:

```bash
systemctl status swiadek-dziejow-articles.service
```

Environment file:

```text
/etc/swiadek-dziejow-articles.env
```

The env file stores the shared Mumro CMS secret and must not be committed or
served publicly.

Data file:

```text
/var/www/swiadek-dziejow.pl/articles-cms/data/articles.json
```
