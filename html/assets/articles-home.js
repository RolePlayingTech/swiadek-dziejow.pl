(function () {
  var articlesPath = "/artykuly-historyczne";

  function addStyles() {
    if (document.getElementById("historical-articles-home-style")) return;

    var style = document.createElement("style");
    style.id = "historical-articles-home-style";
    style.textContent = [
      "#artykuly-historyczne-home{position:relative;padding:4rem 1.25rem 5rem}",
      "#artykuly-historyczne-home .articles-wrap{max-width:72rem;margin:0 auto}",
      "#artykuly-historyczne-home .articles-head{max-width:50rem;margin-bottom:2rem}",
      "#artykuly-historyczne-home .articles-kicker{font-size:10px;font-weight:600;letter-spacing:.4em;text-transform:uppercase;color:var(--color-accent);margin-bottom:1rem;font-family:var(--font-display)}",
      "#artykuly-historyczne-home h2{font-size:clamp(2rem,6vw,4.8rem);line-height:1.02;letter-spacing:-.04em;margin:0 0 1rem;font-family:var(--font-display)}",
      "#artykuly-historyczne-home .articles-lead{color:var(--color-fg-muted);font-size:clamp(.95rem,2vw,1.12rem);line-height:1.75;max-width:42rem;margin:0}",
      "#artykuly-historyczne-home .articles-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:1rem;margin:2rem 0}",
      "#artykuly-historyczne-home .article-card{display:block;min-height:210px;padding:1.35rem;border:1px solid rgba(212,160,84,.22);border-radius:1.125rem;background:linear-gradient(145deg,rgba(255,255,255,.06),rgba(0,0,0,.2)),radial-gradient(circle at 16% 0%,rgba(212,160,84,.09),transparent 14rem);text-decoration:none;transition:transform .2s ease,border-color .2s ease,box-shadow .2s ease}",
      "#artykuly-historyczne-home .article-card:hover{transform:translateY(-4px);border-color:rgba(212,160,84,.5)}",
      "#artykuly-historyczne-home .article-date{font-size:10px;letter-spacing:.22em;text-transform:uppercase;color:var(--color-fg-dim);margin-bottom:.85rem;font-family:var(--font-display)}",
      "#artykuly-historyczne-home .article-title{font-size:1.15rem;line-height:1.22;color:var(--color-fg);font-weight:700;margin:0 0:.75rem;font-family:var(--font-display)}",
      "#artykuly-historyczne-home .article-excerpt{font-size:.85rem;line-height:1.65;color:var(--color-fg-muted);margin:0;font-family:var(--font-body)}",
      "#artykuly-historyczne-home .articles-empty{border:1px dashed rgba(212,160,84,.25);border-radius:1.25rem;padding:1.5rem;color:var(--color-fg-muted);background:rgba(255,255,255,.03);font-size:.9rem}",
      "@media (min-width:768px){#artykuly-historyczne-home{padding:7rem 1.25rem 8rem}}",
    ].join("");
    document.head.appendChild(style);
  }

  function addNavLink() {
    var nav = document.querySelector(".site-nav");
    if (!nav || nav.querySelector('a[href="' + articlesPath + '"]')) return;

    var link = document.createElement("a");
    link.href = articlesPath;
    link.textContent = "Artykuły";
    nav.appendChild(link);
  }

  function createSection() {
    if (document.getElementById("artykuly-historyczne-home")) {
      return document.getElementById("artykuly-historyczne-home");
    }

    var section = document.createElement("section");
    section.id = "artykuly-historyczne-home";
    section.innerHTML =
      '<div class="articles-wrap">' +
      '<div class="articles-head section-header">' +
      '<p class="articles-kicker">Artykuły</p>' +
      '<h2><span class="text-gradient-warm">Dłuższe historie</span><br><span class="text-[var(--color-fg)]">do spokojnego czytania.</span></h2>' +
      '<p class="articles-lead">Klasyczne teksty historyczne: opowieści o ludziach, systemach, decyzjach i momentach, które zmieniały bieg dziejów.</p>' +
      "</div>" +
      '<div class="articles-grid" data-articles-grid></div>' +
      '<a href="' + articlesPath + '" class="project-cta"><span>Przejdź do artykułów</span><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M13 7l5 5m0 0l-5 5m5-5H6"></path></svg></a>' +
      "</div>";

    var coming = document.getElementById("coming");
    if (coming && coming.parentNode) {
      coming.parentNode.insertBefore(section, coming);
    } else {
      document.querySelector("main")?.appendChild(section);
    }
    return section;
  }

  function formatDate(value) {
    if (!value) return "Nowy wpis";
    var date = new Date(value);
    if (Number.isNaN(date.getTime())) return "Nowy wpis";
    return new Intl.DateTimeFormat("pl-PL", { year: "numeric", month: "long", day: "numeric" }).format(date);
  }

  function renderCards(section, items) {
    var grid = section.querySelector("[data-articles-grid]");
    if (!grid) return;
    grid.textContent = "";

    if (!items.length) {
      var empty = document.createElement("div");
      empty.className = "articles-empty";
      empty.textContent = "Nie ma jeszcze opublikowanych artykułów.";
      grid.appendChild(empty);
      return;
    }

    items.slice(0, 3).forEach(function (item) {
      var card = document.createElement("a");
      card.className = "article-card";
      card.href = item.url || articlesPath;

      var date = document.createElement("div");
      date.className = "article-date";
      date.textContent = formatDate(item.published_at);

      var title = document.createElement("h3");
      title.className = "article-title";
      title.textContent = item.title || "Artykuł historyczny";

      var excerpt = document.createElement("p");
      excerpt.className = "article-excerpt";
      excerpt.textContent = item.excerpt || "Przeczytaj najnowszy tekst Świadka Dziejów.";

      card.appendChild(date);
      card.appendChild(title);
      card.appendChild(excerpt);
      grid.appendChild(card);
    });
  }

  function init() {
    addStyles();
    addNavLink();
    var section = createSection();

    fetch("/artykuly-historyczne/feed.json", { headers: { Accept: "application/json" } })
      .then(function (response) {
        return response.ok ? response.json() : { items: [] };
      })
      .then(function (data) {
        renderCards(section, Array.isArray(data.items) ? data.items : []);
      })
      .catch(function () {
        renderCards(section, []);
      });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
