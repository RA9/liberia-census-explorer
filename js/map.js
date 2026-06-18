// SVG choropleth of Liberia's 15 counties. Projects the GeoJSON to an SVG
// viewBox, shades each county by the selected metric, and offers several
// hover-free ways to read the data (tap-to-select, a synced ranked list,
// on-map value labels, and a detail card that becomes a bottom sheet on
// mobile). No mapping library — just geometry + DOM.

import { fmt, growth } from "./data.js";

const GEO_URL = new URL("../assets/liberia-counties.geojson", import.meta.url);

const MODES = {
  pop: {
    label: "Population (2022)",
    ramp: ["#efe3cd", "#7a4a22"],
    scale: "sqrt",
    value: (db, name) => db.byCounty[name]["2022"],
    fmt: (v) => fmt.int(v),
    short: (v) => fmt.compact(v),
  },
  density: {
    label: "Density (people / km²)",
    ramp: ["#e4e1f0", "#473a78"],
    scale: "sqrt",
    value: (db, name) => db.byCounty[name]["2022"] / (db.countyAreaKm2?.[name] || 1),
    fmt: (v) => `${fmt.int(v)}/km²`,
    short: (v) => fmt.int(Math.round(v)),
  },
  growth: {
    label: "Growth 2008 → 2022",
    ramp: ["#dcebe0", "#1f6b3a"],
    scale: "linear",
    value: (db, name) => growth(db.byCounty[name]["2008"], db.byCounty[name]["2022"]),
    fmt: (v) => fmt.pct(v),
    short: (v) => fmt.pct(v, 0),
  },
};
const MODE_KEYS = ["pop", "density", "growth"];

function eachCoord(geom, fn) {
  const { type, coordinates: c } = geom;
  if (type === "Polygon") c.forEach((r) => r.forEach(fn));
  else if (type === "MultiPolygon") c.forEach((p) => p.forEach((r) => r.forEach(fn)));
}

function makeProjector(features) {
  let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity;
  for (const f of features) {
    eachCoord(f.geometry, ([lon, lat]) => {
      if (lon < minLon) minLon = lon; if (lon > maxLon) maxLon = lon;
      if (lat < minLat) minLat = lat; if (lat > maxLat) maxLat = lat;
    });
  }
  const k = Math.cos(((minLat + maxLat) / 2) * Math.PI / 180);
  const pad = 12, W = 1000;
  const s = (W - 2 * pad) / ((maxLon - minLon) * k);
  const H = (maxLat - minLat) * s + 2 * pad;
  const project = ([lon, lat]) => [pad + (lon - minLon) * k * s, pad + (maxLat - lat) * s];
  return { project, W, H };
}

function ringArea(ring) {
  let a = 0;
  for (let i = 0, n = ring.length - 1; i < n; i++) {
    a += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  }
  return a / 2;
}
function ringCentroid(ring) {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0, n = ring.length - 1; i < n; i++) {
    const [x0, y0] = ring[i], [x1, y1] = ring[i + 1];
    const f = x0 * y1 - x1 * y0;
    a += f; cx += (x0 + x1) * f; cy += (y0 + y1) * f;
  }
  a *= 0.5;
  if (Math.abs(a) < 1e-12) {
    const s = ring.reduce((p, c) => [p[0] + c[0], p[1] + c[1]], [0, 0]);
    return [s[0] / ring.length, s[1] / ring.length];
  }
  return [cx / (6 * a), cy / (6 * a)];
}
function featureCentroid(geom) {
  const polys = geom.type === "Polygon" ? [geom.coordinates] : geom.coordinates;
  let best = polys[0][0], bestArea = -1;
  for (const poly of polys) {
    const area = Math.abs(ringArea(poly[0]));
    if (area > bestArea) { bestArea = area; best = poly[0]; }
  }
  return ringCentroid(best);
}

function ringPath(ring, project) {
  return ring.map((pt, i) => (i ? "L" : "M") + project(pt).map((n) => n.toFixed(1)).join(" ")).join(" ") + "Z";
}
function geomPath(geom, project) {
  const { type, coordinates: c } = geom;
  if (type === "Polygon") return c.map((r) => ringPath(r, project)).join(" ");
  if (type === "MultiPolygon") return c.map((p) => p.map((r) => ringPath(r, project)).join(" ")).join(" ");
  return "";
}

function hexToRgb(h) { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function lerpColor(a, b, t) {
  const A = hexToRgb(a), B = hexToRgb(b);
  const c = A.map((x, i) => Math.round(x + (B[i] - x) * t));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}
function esc(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

export async function setupMap(db, { onFocus, onNavigate } = {}) {
  const host = document.getElementById("countyMap");
  if (!host) return;
  let geo;
  try {
    geo = await (await fetch(GEO_URL)).json();
  } catch {
    host.innerHTML = `<p class="map-error">Couldn't load the county map.</p>`;
    return;
  }

  const { project, W, H } = makeProjector(geo.features);
  const shapes = geo.features.map((f) => ({
    name: f.properties.name,
    d: geomPath(f.geometry, project),
    c: project(featureCentroid(f.geometry)),
  }));

  const tip = document.getElementById("mapTip");
  const legend = document.getElementById("mapLegend");
  const list = document.getElementById("mapList");
  const detail = document.getElementById("mapDetail");
  let mode = "pop";
  let selected = null;
  let showValues = false;

  function scale(modeKey) {
    const m = MODES[modeKey];
    const vals = db.meta.counties.map((c) => m.value(db, c));
    const lo = Math.min(...vals), hi = Math.max(...vals);
    const tx = (v) => {
      if (m.scale === "sqrt") {
        return Math.sqrt(Math.max(0, v - lo)) / (Math.sqrt(Math.max(1e-9, hi - lo)) || 1);
      }
      return hi === lo ? 0.5 : (v - lo) / (hi - lo);
    };
    return { m, lo, hi, tx, fill: (name) => lerpColor(m.ramp[0], m.ramp[1], tx(m.value(db, name))) };
  }

  function paint() {
    const sc = scale(mode);
    host.querySelectorAll("path[data-name]").forEach((p) => p.setAttribute("fill", sc.fill(p.dataset.name)));
    host.querySelectorAll("text[data-name]").forEach((t) => {
      t.textContent = showValues ? sc.m.short(sc.m.value(db, t.dataset.name)) : "";
    });
    if (legend) {
      legend.innerHTML = `
        <span class="lg-title">${esc(sc.m.label)}</span>
        <span class="lg-min">${esc(sc.m.fmt(sc.lo))}</span>
        <span class="lg-bar" style="background:linear-gradient(90deg, ${sc.m.ramp[0]}, ${sc.m.ramp[1]})"></span>
        <span class="lg-max">${esc(sc.m.fmt(sc.hi))}</span>`;
    }
    renderList(sc);
  }

  function renderList(sc) {
    if (!list) return;
    const ranked = db.meta.counties
      .map((name) => ({ name, v: sc.m.value(db, name) }))
      .sort((a, b) => b.v - a.v);
    list.innerHTML = ranked.map((r) => `
      <button type="button" class="ml-row${r.name === selected ? " is-active" : ""}"
        data-name="${esc(r.name)}" role="option" aria-selected="${r.name === selected}">
        <span class="ml-name">${esc(r.name)}</span>
        <span class="ml-bar"><span style="width:${(sc.tx(r.v) * 100).toFixed(0)}%;background:${sc.fill(r.name)}"></span></span>
        <span class="ml-val">${esc(sc.m.short(r.v))}</span>
      </button>`).join("");
  }

  function renderDetail(name, persistent) {
    if (!detail) return;
    if (!name) { detail.hidden = true; detail.classList.remove("is-open"); return; }
    const cc = db.byCounty[name];
    const g = growth(cc["2008"], cc["2022"]);
    const share = (cc["2022"] / db.national["2022"]) * 100;
    const dens = cc["2022"] / (db.countyAreaKm2?.[name] || 1);
    const sc = scale(mode);
    detail.hidden = false;
    detail.classList.toggle("is-open", !!persistent);
    detail.innerHTML = `
      <button class="md-close" type="button" aria-label="Close">&times;</button>
      <div class="md-head"><strong>${esc(name)}</strong>
        <span class="md-metric-now">${esc(sc.m.label)}: <b>${esc(sc.m.fmt(sc.m.value(db, name)))}</b></span>
      </div>
      <div class="md-rows">
        <span>Population 2022 · <b>${fmt.int(cc["2022"])}</b></span>
        <span>Growth 2008–22 · <b>${fmt.pct(g)}</b></span>
        <span>Share of Liberia · <b>${share.toFixed(1)}%</b></span>
        <span>Density · <b>${fmt.int(dens)}/km²</b></span>
      </div>
      <tc-button class="md-view" variant="primary" size="sm">
        View ${esc(name)} on the Counties tab →
      </tc-button>`;
  }

  function select(name) {
    selected = name;
    host.querySelectorAll("path[data-name]").forEach((p) => p.classList.toggle("is-selected", p.dataset.name === name));
    list?.querySelectorAll(".ml-row").forEach((r) => {
      const on = r.dataset.name === name;
      r.classList.toggle("is-active", on);
      r.setAttribute("aria-selected", String(on));
    });
    renderDetail(name, true);
    if (name && typeof onFocus === "function") onFocus(name);
    // On phones the detail acts as a bottom sheet; surface it.
    if (name && window.matchMedia("(max-width: 720px)").matches) {
      detail?.scrollIntoView({ block: "nearest" });
    }
  }

  // ── Build the SVG (paths + value-label text nodes) ──
  host.innerHTML = `
    <svg viewBox="0 0 ${W} ${H.toFixed(1)}" class="map-svg" role="group" aria-label="Map of Liberia's counties">
      <g class="map-shapes">${shapes.map((s) =>
        `<path data-name="${esc(s.name)}" d="${s.d}" tabindex="0" role="button"
           aria-label="${esc(s.name)}"><title>${esc(s.name)}</title></path>`).join("")}</g>
      <g class="map-labels" aria-hidden="true">${shapes.map((s) =>
        `<text data-name="${esc(s.name)}" x="${s.c[0].toFixed(1)}" y="${s.c[1].toFixed(1)}"
           text-anchor="middle" dominant-baseline="middle"></text>`).join("")}</g>
    </svg>`;

  // ── Interactions ──
  // Hover (desktop): preview in the tooltip + detail card without selecting.
  host.addEventListener("pointermove", (e) => {
    const path = e.target.closest?.("path[data-name]");
    if (!path) { tip?.removeAttribute("data-open"); renderDetail(selected, true); return; }
    const name = path.dataset.name;
    const sc = scale(mode);
    if (tip) {
      tip.innerHTML = `<b>${esc(name)}</b> · ${esc(sc.m.fmt(sc.m.value(db, name)))}`;
      const rect = host.getBoundingClientRect();
      let x = e.clientX - rect.left + 12, y = e.clientY - rect.top - 8;
      if (x + 160 > rect.width) x = e.clientX - rect.left - 150;
      tip.style.transform = `translate(${x}px, ${y}px)`;
      tip.setAttribute("data-open", "1");
    }
    renderDetail(name, false);
  });
  host.addEventListener("pointerleave", () => { tip?.removeAttribute("data-open"); renderDetail(selected, true); });
  host.addEventListener("click", (e) => {
    const path = e.target.closest?.("path[data-name]");
    if (path) select(path.dataset.name);
  });
  host.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const path = e.target.closest?.("path[data-name]");
    if (path) { e.preventDefault(); select(path.dataset.name); }
  });

  // Ranked list ↔ map sync.
  list?.addEventListener("click", (e) => {
    const row = e.target.closest?.(".ml-row");
    if (row) select(row.dataset.name);
  });

  // Detail card: navigate / close.
  detail?.addEventListener("click", (e) => {
    if (e.target.closest(".md-close")) { detail.hidden = true; detail.classList.remove("is-open"); return; }
    if (e.target.closest(".md-view") && selected && typeof onNavigate === "function") onNavigate(selected);
  });

  // Controls.
  const modeSel = document.getElementById("mapMode");
  if (modeSel) {
    modeSel.options = MODE_KEYS.map((k) => ({ value: k, label: MODES[k].label }));
    modeSel.value = mode;
    modeSel.addEventListener("tc-change", (e) => {
      mode = MODE_KEYS.includes(e.detail?.value) ? e.detail.value : "pop";
      paint();
      if (selected) renderDetail(selected, true);
    });
  }
  const labelsSw = document.getElementById("mapLabels");
  labelsSw?.addEventListener("tc-change", (e) => { showValues = !!e.detail?.checked; paint(); });

  paint();
  renderDetail(null);

  return {
    focus: (name) => select(name),
  };
}
