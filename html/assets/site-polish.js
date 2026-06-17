(function () {
  function ready(callback) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", callback, { once: true });
    } else {
      callback();
    }
  }

  function setStorageValue(key, value) {
    try {
      window.sessionStorage.setItem(key, value);
    } catch (error) {
      // Session storage can be disabled; the enhancement should still run.
    }
  }

  function getStorageValue(key) {
    try {
      return window.sessionStorage.getItem(key);
    } catch (error) {
      return null;
    }
  }

  function makeLink(href, label, className) {
    var link = document.createElement("a");
    link.href = href;
    link.className = className;
    link.textContent = label;
    return link;
  }

  function enhanceHome() {
    var hero = document.getElementById("hero");
    if (!hero) return;

    var nav = document.querySelector(".site-nav");
    if (nav && !nav.getAttribute("aria-label")) {
      nav.setAttribute("aria-label", "Główna nawigacja");
    }

    var title = hero.querySelector(".text-gradient-animated");
    function applyTitleFallback() {
      if (title && !title.textContent.trim()) {
        title.textContent = "Świadek Dziejów";
        title.setAttribute("data-fallback-title", "true");
      }
    }
    applyTitleFallback();
    window.setTimeout(applyTitleFallback, 900);

    var subtitle = hero.querySelector(".hero-sub");
    if (subtitle && !hero.querySelector(".hero-actions")) {
      var actions = document.createElement("div");
      actions.className = "hero-actions";
      actions.appendChild(makeLink("/historia-polski", "Zwiedzaj historię Polski", "hero-action hero-action-primary"));
      actions.appendChild(makeLink("/artykuly-historyczne", "Czytaj artykuły", "hero-action hero-action-secondary"));
      subtitle.insertAdjacentElement("afterend", actions);
    }

    var heroCanvas = hero.querySelector("canvas");
    if (heroCanvas) {
      heroCanvas.setAttribute("aria-hidden", "true");
    }
  }

  function findIntroButton() {
    var buttons = Array.prototype.slice.call(document.querySelectorAll("button"));
    return buttons.find(function (button) {
      return button.textContent.trim() === "Wejdź";
    });
  }

  function hasIntroOverlay() {
    return Boolean(document.querySelector("main > .fixed.inset-0.z-50"));
  }

  function clickIntroButton() {
    var button = findIntroButton();
    if (button) {
      button.click();
      return true;
    }
    return false;
  }

  function labelHistoryControls() {
    var timelineButtons = document.querySelectorAll(".timeline-nav-dot-wrap");
    Array.prototype.forEach.call(timelineButtons, function (button, index) {
      if (button.getAttribute("aria-label")) return;
      var year = button.querySelector(".timeline-nav-year");
      var tooltip = button.querySelector(".timeline-nav-tooltip");
      var parts = [];
      if (tooltip && tooltip.textContent.trim()) parts.push(tooltip.textContent.trim());
      if (year && year.textContent.trim()) parts.push(year.textContent.trim());
      button.setAttribute("aria-label", parts.join(" - ") || "Rozdział historii " + (index + 1));
    });

    var frames = document.querySelectorAll("iframe");
    Array.prototype.forEach.call(frames, function (frame) {
      var src = frame.getAttribute("src") || "";
      if (!frame.getAttribute("loading")) frame.setAttribute("loading", "lazy");
      if (!frame.getAttribute("title")) {
        if (src.indexOf("youtube.com") !== -1 || src.indexOf("youtu.be") !== -1) {
          frame.setAttribute("title", "Film historyczny");
        } else if (src.indexOf("instagram.com") !== -1) {
          frame.setAttribute("title", "Film z Instagrama");
        } else {
          frame.setAttribute("title", "Osadzona treść");
        }
      }
    });
  }

  function enhanceHistoryPage() {
    if (window.location.pathname.indexOf("/historia-polski") !== 0) return;

    document.body.classList.add("sd-history-page");

    if (!document.querySelector(".sd-history-tools")) {
      var tools = document.createElement("div");
      tools.className = "sd-history-tools";
      tools.innerHTML = '<a href="/" aria-label="Wróć na stronę główną">Świadek Dziejów</a><button type="button">Czytaj</button>';
      document.body.appendChild(tools);

      tools.querySelector("button").addEventListener("click", function () {
        var attempts = 0;
        var timer = window.setInterval(function () {
          attempts += 1;
          clickIntroButton();
          if (!hasIntroOverlay() || attempts > 12) {
            window.clearInterval(timer);
          }
        }, 250);
      });
    }

    var userHeldIntro = false;
    function markUserHeldIntro() {
      userHeldIntro = true;
      setStorageValue("sd-history-intro-held", "1");
    }

    window.addEventListener("pointerdown", markUserHeldIntro, { once: true });
    window.addEventListener("keydown", markUserHeldIntro, { once: true });

    window.setTimeout(function () {
      if (userHeldIntro || getStorageValue("sd-history-intro-held")) return;
      var attempts = 0;
      var timer = window.setInterval(function () {
        attempts += 1;
        if (!hasIntroOverlay()) {
          window.clearInterval(timer);
          return;
        }
        clickIntroButton();
        if (attempts > 14) {
          window.clearInterval(timer);
        }
      }, 400);
    }, 2200);

    labelHistoryControls();
    var observer = new MutationObserver(labelHistoryControls);
    observer.observe(document.body, { childList: true, subtree: true });
    window.setTimeout(function () {
      observer.disconnect();
    }, 18000);
  }

  ready(function () {
    document.documentElement.classList.add("sd-polished");
    enhanceHome();
    enhanceHistoryPage();
  });
})();
