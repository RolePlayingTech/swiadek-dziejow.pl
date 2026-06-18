/* ============================================================================
   Świadek Dziejów — strona główna (logika, vanilla JS)
   ========================================================================== */
(function () {
  "use strict";

  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function ready(fn) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", fn, { once: true });
    } else {
      fn();
    }
  }

  /* ---- scroll progress bar ---- */
  function initProgress() {
    var bar = document.querySelector(".scroll-progress span");
    if (!bar) return;
    var tick = function () {
      var doc = document.documentElement;
      var max = doc.scrollHeight - doc.clientHeight;
      var pct = max > 0 ? (doc.scrollTop / max) * 100 : 0;
      bar.style.width = pct + "%";
    };
    window.addEventListener("scroll", tick, { passive: true });
    window.addEventListener("resize", tick, { passive: true });
    tick();
  }

  /* ---- header scrolled state ---- */
  function initHeader() {
    var header = document.getElementById("siteHeader");
    if (!header) return;
    var tick = function () {
      header.classList.toggle("is-scrolled", window.scrollY > 30);
    };
    window.addEventListener("scroll", tick, { passive: true });
    tick();
  }

  /* ---- mobile nav ---- */
  function initNav() {
    var toggle = document.querySelector(".nav-toggle");
    var links = document.getElementById("navLinks");
    if (!toggle || !links) return;
    toggle.addEventListener("click", function () {
      var open = links.classList.toggle("open");
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
    });
    links.addEventListener("click", function (event) {
      if (event.target.closest("a")) {
        links.classList.remove("open");
        toggle.setAttribute("aria-expanded", "false");
      }
    });
  }

  /* ---- reveal on scroll ---- */
  function initReveal() {
    var items = Array.prototype.slice.call(document.querySelectorAll(".reveal"));
    if (!items.length) return;
    if (reduceMotion || !("IntersectionObserver" in window)) {
      items.forEach(function (el) { el.classList.add("in"); });
      return;
    }
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add("in");
          observer.unobserve(entry.target);
        }
      });
    }, { rootMargin: "0px 0px -10% 0px", threshold: 0.12 });
    items.forEach(function (el) { observer.observe(el); });
  }

  /* ---- count-up stats ---- */
  function animateCount(el) {
    var target = parseInt(el.getAttribute("data-count"), 10);
    var suffix = el.getAttribute("data-suffix") || "";
    if (!isFinite(target)) return;
    if (reduceMotion) { el.textContent = target.toLocaleString("pl-PL") + suffix; return; }
    var start = performance.now();
    var duration = 1600;
    var step = function (now) {
      var p = Math.min((now - start) / duration, 1);
      var eased = 1 - Math.pow(1 - p, 3);
      el.textContent = Math.round(target * eased).toLocaleString("pl-PL") + suffix;
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
  function initCounters() {
    var nums = Array.prototype.slice.call(document.querySelectorAll("[data-count]"));
    if (!nums.length) return;
    if (!("IntersectionObserver" in window)) { nums.forEach(animateCount); return; }
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) { animateCount(entry.target); observer.unobserve(entry.target); }
      });
    }, { threshold: 0.5 });
    nums.forEach(function (el) { observer.observe(el); });
  }

  /* ---- typewriter tagline ---- */
  function initTyped() {
    var el = document.getElementById("typed");
    if (!el) return;
    var cursor = el.querySelector(".cursor");
    var words = (el.getAttribute("data-words") || "").split("|").filter(Boolean);
    if (!words.length) return;

    if (reduceMotion) {
      el.insertBefore(document.createTextNode(words[0] + " "), cursor);
      return;
    }

    var textNode = document.createTextNode("");
    el.insertBefore(textNode, cursor);
    var wi = 0, ci = 0, deleting = false;

    var loop = function () {
      var word = words[wi];
      if (deleting) {
        ci--; textNode.textContent = word.slice(0, ci);
        if (ci <= 0) { deleting = false; wi = (wi + 1) % words.length; setTimeout(loop, 380); return; }
        setTimeout(loop, 28);
      } else {
        ci++; textNode.textContent = word.slice(0, ci);
        if (ci >= word.length) { deleting = true; setTimeout(loop, 1900); return; }
        setTimeout(loop, 55);
      }
    };
    setTimeout(loop, 500);
  }

  /* ---- marquee ---- */
  function initMarquee() {
    var track = document.getElementById("marquee");
    if (!track) return;
    var events = [
      "Wynalezienie pisma · 3400 p.n.e.", "Okiełznanie ognia · 1 500 000 p.n.e.", "Wynalezienie koła · 3500 p.n.e.",
      "Chrzest Polski · 966", "Bitwa pod Grunwaldem · 1410", "Druk Gutenberga · 1440", "Odkrycie Ameryki · 1492",
      "Odsiecz Wiedeńska · 1683", "Maszyna parowa · 1769", "Rewolucja Francuska · 1789", "Konstytucja 3 Maja · 1791",
      "Upadek Rzymu · 476", "Lądowanie na Księżycu · 1969", "Solidarność · 1980", "Internet · 1983", "Upadek Muru Berlińskiego · 1989"
    ];
    var html = events.map(function (text) {
      return '<span class="marquee-item">' + text + "</span>";
    }).join("");
    // Duplicate for a seamless -50% loop.
    track.innerHTML = html + html;
  }

  /* ---- editorial quote word reveal ---- */
  function initEditorial() {
    var quote = document.getElementById("editorialQuote");
    if (!quote) return;
    var text = quote.textContent.trim();
    quote.textContent = "";
    text.split(/\s+/).forEach(function (word, i) {
      var span = document.createElement("span");
      span.className = "word";
      span.textContent = (i ? " " : "") + word;
      quote.appendChild(span);
    });
    if (reduceMotion || !("IntersectionObserver" in window)) { quote.classList.add("lit"); return; }
    var spans = quote.querySelectorAll(".word");
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        observer.disconnect();
        spans.forEach(function (span, i) {
          setTimeout(function () { span.style.opacity = "1"; }, i * 45);
        });
      });
    }, { threshold: 0.3 });
    observer.observe(quote);
  }

  /* ---- articles feed ---- */
  function formatDate(value) {
    if (!value) return "Nowy wpis";
    var date = new Date(value);
    if (isNaN(date.getTime())) return "Nowy wpis";
    return new Intl.DateTimeFormat("pl-PL", { year: "numeric", month: "long", day: "numeric" }).format(date);
  }
  function renderArticles(items) {
    var grid = document.getElementById("articlesGrid");
    if (!grid) return;
    grid.textContent = "";
    if (!items.length) {
      var empty = document.createElement("div");
      empty.className = "articles-empty";
      empty.textContent = "Nie ma jeszcze opublikowanych artykułów. Zajrzyj wkrótce.";
      grid.appendChild(empty);
      return;
    }
    items.slice(0, 3).forEach(function (item) {
      var card = document.createElement("a");
      card.className = "article-card";
      // Build a relative URL from the slug so links work on any host
      // (local dev, staging, production) instead of the absolute URL from the feed.
      card.href = item.slug
        ? "/artykuly-historyczne/" + encodeURIComponent(item.slug)
        : item.url || "/artykuly-historyczne";

      var date = document.createElement("div");
      date.className = "a-date";
      date.textContent = formatDate(item.published_at);

      var title = document.createElement("h3");
      title.textContent = item.title || "Artykuł historyczny";

      var excerpt = document.createElement("p");
      excerpt.textContent = item.excerpt || "Przeczytaj najnowszy tekst Świadka Dziejów.";

      var go = document.createElement("span");
      go.className = "a-go";
      go.setAttribute("aria-hidden", "true");
      go.textContent = "→";

      card.append(date, title, excerpt, go);
      grid.appendChild(card);
    });
  }
  function initArticles() {
    if (!document.getElementById("articlesGrid")) return;
    fetch("/artykuly-historyczne/feed.json", { headers: { Accept: "application/json" } })
      .then(function (r) { return r.ok ? r.json() : { items: [] }; })
      .then(function (data) { renderArticles(Array.isArray(data.items) ? data.items : []); })
      .catch(function () { renderArticles([]); });
  }

  function initYear() {
    var el = document.getElementById("year");
    if (el) el.textContent = String(new Date().getFullYear());
  }

  ready(function () {
    document.documentElement.classList.add("js");
    initProgress();
    initHeader();
    initNav();
    initMarquee();
    initEditorial();
    initReveal();
    initCounters();
    initTyped();
    initArticles();
    initYear();
  });
})();
