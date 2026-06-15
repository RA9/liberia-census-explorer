// Shared site chrome: the navbar and footer used on every page, plus the
// theme toggle, the "copy shareable link" button, and the URL-state helper
// (exported so the Explorer page can read/write its view state too).

const DARK_THEME_URL =
  "https://cdn.jsdelivr.net/gh/RA9/tan-compose@kit-v1.12.0/kit/dist/themes/dark.min.js";

/** Accurate Flag of Liberia (11 stripes, blue canton, white star). */
export const FLAG_SVG = `
  <svg class="flag" viewBox="0 0 190 100" preserveAspectRatio="none"
    role="img" aria-label="Flag of Liberia" xmlns="http://www.w3.org/2000/svg">
    <title>Flag of Liberia</title>
    <rect width="190" height="100" fill="#BF0A30"/>
    <g fill="#ffffff">
      <rect y="9.0909" width="190" height="9.0909"/>
      <rect y="27.2727" width="190" height="9.0909"/>
      <rect y="45.4545" width="190" height="9.0909"/>
      <rect y="63.6364" width="190" height="9.0909"/>
      <rect y="81.8182" width="190" height="9.0909"/>
    </g>
    <rect width="45.4545" height="45.4545" fill="#002868"/>
    <polygon fill="#ffffff" points="22.7,7.7 26.227,17.846 36.966,18.065 28.406,24.554 31.517,34.835 22.7,28.7 13.883,34.835 16.994,24.554 8.434,18.065 19.173,17.846"/>
  </svg>`;

// ── Shareable view state, encoded in the URL hash ──────────────────────
export const urlState = {
  read: () => new URLSearchParams(location.hash.replace(/^#/, "")),
  write(patch) {
    const p = this.read();
    for (const [k, v] of Object.entries(patch)) {
      if (v == null || v === "") p.delete(k);
      else p.set(k, String(v));
    }
    const s = p.toString();
    history.replaceState(null, "", s ? `#${s}` : location.pathname + location.search);
  },
};

const NAV = [
  { id: "explorer", label: "Explorer", href: "./index.html" },
  { id: "about", label: "About", href: "./about.html" },
  { id: "contact", label: "Contact", href: "./contact.html" },
];

function buildNavbar(active) {
  const nav = document.createElement("nav");
  nav.className = "navbar";
  nav.innerHTML = `
    <div class="nav-inner">
      <a class="nav-brand" href="./index.html" aria-label="Liberia Census Explorer — home">
        <span class="nav-flag">${FLAG_SVG}</span>
        <span class="nav-name">Liberia Census<span class="nav-name-2"> Explorer</span></span>
      </a>
      <button class="nav-burger" id="navBurger" aria-label="Toggle navigation" aria-expanded="false">
        <tc-icon name="menu" size="22"></tc-icon>
      </button>
      <div class="nav-links" id="navLinks">
        ${NAV.map((n) =>
          `<a href="${n.href}" data-nav="${n.id}" class="${n.id === active ? "is-active" : ""}"${
            n.id === active ? ' aria-current="page"' : ""
          }>${n.label}</a>`
        ).join("")}
        <span class="nav-actions">
          ${active === "explorer"
            ? `<tc-button id="copyLink" variant="secondary" size="sm" aria-label="Copy shareable link">
                 <tc-icon id="copyIcon" name="link" size="16"></tc-icon>
                 <span id="copyLabel">Copy link</span>
               </tc-button>`
            : ""}
          <tc-button id="themeToggle" variant="ghost" size="sm" aria-label="Toggle dark mode">
            <tc-icon id="themeIcon" name="moon" size="18"></tc-icon>
            <span id="themeLabel">Dark</span>
          </tc-button>
        </span>
      </div>
    </div>`;
  return nav;
}

function buildFooter() {
  const year = new Date().getFullYear();
  const foot = document.createElement("footer");
  foot.className = "site-footer";
  foot.innerHTML = `
    <div class="footer-inner">
      <div class="f-col f-brand">
        <div class="f-brandline">
          <span class="f-flag">${FLAG_SVG}</span>
          <strong>Liberia Census Explorer</strong>
        </div>
        <p>Query Liberia's national census data (1962–2022) and project future
           population with transparent, in-browser models.</p>
        <p class="f-disclaimer">An independent educational project — not an
           official government website.</p>
      </div>
      <div class="f-col">
        <h4>Explore</h4>
        <a href="./index.html">Explorer</a>
        <a href="./about.html">About</a>
        <a href="./contact.html">Contact</a>
      </div>
      <div class="f-col">
        <h4>Data sources</h4>
        <a href="https://www.lisgis.gov.lr/" target="_blank" rel="noopener">LISGIS — Liberia statistics</a>
        <a href="https://www.paris21.org/sites/default/files/LIBERIA_census.pdf" target="_blank" rel="noopener">2008 Census highlights</a>
        <a href="https://www.populationpyramid.net/liberia/2022/" target="_blank" rel="noopener">UN WPP (pyramid, estimate)</a>
        <a href="https://en.wikipedia.org/wiki/Demographics_of_Liberia" target="_blank" rel="noopener">Demographics of Liberia</a>
      </div>
      <div class="f-col">
        <h4>Built with</h4>
        <a href="https://github.com/ra9/tan-compose" target="_blank" rel="noopener">tan-compose</a>
        <a href="https://github.com/ra9/tan-compose/tree/main/kit" target="_blank" rel="noopener">tan-compose-kit</a>
        <a href="https://github.com/ra9/tan-compose/tree/main/icons" target="_blank" rel="noopener">tan-compose-icons</a>
      </div>
    </div>
    <div class="footer-bottom">
      <span>© ${year} Liberia Census Explorer</span>
      <span class="dot">·</span>
      <span>Census data © LISGIS · pyramid figures are UN estimates</span>
    </div>`;
  return foot;
}

/**
 * Dark-mode toggle. The kit ships a `dark` theme module that injects a
 * <style data-tc-theme="dark"> with :root overrides. We load it lazily,
 * then flip it on/off via that style's `media` attribute. Persists to
 * localStorage and to the URL so a shared link keeps the chosen look.
 */
function setupTheme() {
  const KEY = "census-theme";
  const btn = document.getElementById("themeToggle");
  const icon = document.getElementById("themeIcon");
  const label = document.getElementById("themeLabel");
  let darkLoaded = false;
  let current = "light";
  const darkStyle = () => document.querySelector('style[data-tc-theme="dark"]');

  async function apply(mode) {
    if (mode === "dark" && !darkLoaded) {
      await import(/* @vite-ignore */ DARK_THEME_URL);
      darkLoaded = true;
    }
    const s = darkStyle();
    if (s) s.media = mode === "dark" ? "all" : "not all";
    document.documentElement.dataset.theme = mode;
    current = mode;
    if (icon) icon.setAttribute("name", mode === "dark" ? "sun" : "moon");
    if (label) label.textContent = mode === "dark" ? "Light" : "Dark";
    try { localStorage.setItem(KEY, mode); } catch { /* ignore */ }
    urlState.write({ theme: mode === "dark" ? "dark" : "" });
  }

  btn?.addEventListener("click", () => apply(current === "dark" ? "light" : "dark"));

  let saved = "light";
  try { saved = localStorage.getItem(KEY) || "light"; } catch { /* ignore */ }
  const fromUrl = urlState.read().get("theme");
  apply(fromUrl === "dark" ? "dark" : fromUrl === "light" ? "light" : saved);
}

function setupCopyLink() {
  const btn = document.getElementById("copyLink");
  if (!btn) return;
  const icon = document.getElementById("copyIcon");
  const label = document.getElementById("copyLabel");
  let timer = null;
  btn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(location.href);
    } catch {
      // Fallback for blocked clipboard: select-less prompt is overkill; ignore.
    }
    if (icon) icon.setAttribute("name", "check");
    if (label) label.textContent = "Copied!";
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (icon) icon.setAttribute("name", "link");
      if (label) label.textContent = "Copy link";
    }, 1600);
  });
}

function setupBurger() {
  const burger = document.getElementById("navBurger");
  const links = document.getElementById("navLinks");
  if (!burger || !links) return;
  burger.addEventListener("click", () => {
    const open = links.classList.toggle("open");
    burger.setAttribute("aria-expanded", open ? "true" : "false");
  });
}

/** Build + mount the navbar and footer, then wire shared behaviour. */
export async function setupChrome(opts = {}) {
  const active = opts.active || document.body.dataset.page || "explorer";
  await Promise.all(
    ["tc-button", "tc-icon", "tc-badge"].map((t) => customElements.whenDefined(t)),
  );
  const navRoot = document.getElementById("nav-root");
  const footRoot = document.getElementById("footer-root");
  if (navRoot) navRoot.replaceChildren(buildNavbar(active));
  if (footRoot) footRoot.replaceChildren(buildFooter());
  setupTheme();
  setupCopyLink();
  setupBurger();
}
