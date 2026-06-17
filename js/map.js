// SVG choropleth of Liberia's 15 counties. Projects the GeoJSON to an SVG
// viewBox, shades each county by the selected metric, and supports hover
// tooltips + click-to-select. No mapping library — just geometry + DOM.

import { fmt, growth } from "./data.js";

const GEO_URL = new URL("../assets/liberia-counties.geojson", import.meta.url);

const MODES = {
  pop: {
    label: "Population (2022)",
    ramp: ["#efe3cd", "#7a4a22"],
    scale: "sqrt", // Montserrado dwarfs the rest → spread with sqrt
    value: (db, name) => db.byCounty[name]["2022"],
    fmt: (v) => fmt.int(v),
  },
  growth: {
    label: "Growth 2008 → 2022",
    ramp: ["#dcebe0", "#1f6b3a"],
    scale: "linear",
    value: (db, name) => growth(db.byCounty[name]["2008"], db.byCounty[name]["2022"]),
    fmt: (v) => fmt.pct(v),
  },
  density: {
    label: "Density (people / km²)",
    ramp: ["#e4e1f0", "#473a78"],
    scale: "sqrt",
    value: (db, name) => db.byCounty[name]["2022"] / (db.countyAreaKm2?.[name] || 1),
    fmt: (v) => `${fmt.int(v)}/km²`,
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
  const k = Math.cos(((minLat + maxLat) / 2) * Math.PI / 180); // longitude squeeze
  const pad = 12, W = 1000;
  const s = (W - 2 * pad) / ((maxLon - minLon) * k);
  const H = (maxLat - minLat) * s + 2 * pad;
  const project = ([lon, lat]) => [
    (pad + (lon - minLon) * k * s).toFixed(1),
    (pad + (maxLat - lat) * s).toFixed(1),
  ];
  return { project, W, H };
}

function ringPath(ring, project) {
  return ring.map((pt, i) => (i ? "L" : "M") + project(pt).join(" ")).join(" ") + "Z";
}
function geomPath(geom, project) {
  const { type, coordinates: c } = geom;
  if (type === "Polygon") return c.map((r) => ringPath(r, project)).join(" ");
  if (type === "MultiPolygon") return c.map((p) => p.map((r) => ringPath(r, project)).join(" ")).join(" ");
  return "";
}

function hexToRgb(h) {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function lerpColor(a, b, t) {
  const A = hexToRgb(a), B = hexToRgb(b);
  const c = A.map((x, i) => Math.round(x + (B[i] - x) * t));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}
function esc(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

export async function setupMap(db, { onSelect } = {}) {
  const host = document.getElementById("countyMap");
  if (!host) return;
  let geo;
  try {
    const r = await fetch(GEO_URL);
    geo = await r.json();
  } catch (e) {
    host.innerHTML = `<p class="map-error">Couldn't load the county map.</p>`;
    return;
  }

  const { project, W, H } = makeProjector(geo.features);
  const paths = geo.features.map((f) => ({
    name: f.properties.name,
    d: geomPath(f.geometry, project),
  }));

  const tip = document.getElementById("mapTip");
  const legend = document.getElementById("mapLegend");
  const readout = document.getElementById("mapReadout");
  let mode = "pop";
  let selected = null;

  function colorFor(modeKey) {
    const m = MODES[modeKey];
    const vals = db.meta.counties.map((c) => m.value(db, c));
    let lo = Math.min(...vals), hi = Math.max(...vals);
    const tx = (v) => {
      if (m.scale === "sqrt") {
        const a = Math.sqrt(Math.max(0, v - lo));
        const b = Math.sqrt(Math.max(1e-9, hi - lo));
        return a / b;
      }
      return hi === lo ? 0.5 : (v - lo) / (hi - lo);
    };
    return { m, lo, hi, fill: (name) => lerpColor(m.ramp[0], m.ramp[1], tx(m.value(db, name))) };
  }

  function renderLegend(c) {
    if (!legend) return;
    legend.innerHTML = `
      <span class="lg-title">${esc(c.m.label)}</span>
      <span class="lg-min">${esc(c.m.fmt(c.lo))}</span>
      <span class="lg-bar" style="background:linear-gradient(90deg, ${c.m.ramp[0]}, ${c.m.ramp[1]})"></span>
      <span class="lg-max">${esc(c.m.fmt(c.hi))}</span>`;
  }

  function paint() {
    const c = colorFor(mode);
    host.querySelectorAll("path[data-name]").forEach((p) => {
      p.setAttribute("fill", c.fill(p.dataset.name));
    });
    renderLegend(c);
  }

  function renderReadout(name) {
    if (!readout) return;
    if (!name) { readout.innerHTML = `<span class="muted">Hover or tap a county to see its figures.</span>`; return; }
    const cc = db.byCounty[name];
    const g = growth(cc["2008"], cc["2022"]);
    const share = (cc["2022"] / db.national["2022"]) * 100;
    readout.innerHTML = `
      <strong>${esc(name)}</strong>
      <span><b>${fmt.int(cc["2022"])}</b> in 2022</span>
      <span>${fmt.pct(g)} since 2008</span>
      <span>${share.toFixed(1)}% of Liberia</span>`;
  }

  host.innerHTML = `
    <svg viewBox="0 0 ${W} ${H.toFixed(1)}" class="map-svg" role="group" aria-label="Map of Liberia's counties">
      ${paths.map((p) =>
        `<path data-name="${esc(p.name)}" d="${p.d}" tabindex="0" role="button"
           aria-label="${esc(p.name)}"><title>${esc(p.name)}</title></path>`).join("")}
    </svg>`;

  function select(name) {
    selected = name;
    host.querySelectorAll("path[data-name]").forEach((p) =>
      p.classList.toggle("is-selected", p.dataset.name === name));
    renderReadout(name);
    if (name && typeof onSelect === "function") onSelect(name);
  }

  // Hover tooltip + pointer move. Hovering also updates the readout so the
  // map can be explored without committing (click commits + jumps).
  host.addEventListener("pointermove", (e) => {
    const path = e.target.closest?.("path[data-name]");
    if (!path) { tip?.removeAttribute("data-open"); renderReadout(selected); return; }
    const name = path.dataset.name;
    const c = colorFor(mode);
    if (tip) {
      tip.innerHTML = `<b>${esc(name)}</b> · ${esc(c.m.fmt(c.m.value(db, name)))}`;
      const rect = host.getBoundingClientRect();
      let x = e.clientX - rect.left + 12, y = e.clientY - rect.top - 8;
      if (x + 160 > rect.width) x = e.clientX - rect.left - 150;
      tip.style.transform = `translate(${x}px, ${y}px)`;
      tip.setAttribute("data-open", "1");
    }
    renderReadout(name);
  });
  host.addEventListener("pointerleave", () => {
    tip?.removeAttribute("data-open");
    renderReadout(selected);
  });
  host.addEventListener("click", (e) => {
    const path = e.target.closest?.("path[data-name]");
    if (path) select(path.dataset.name);
  });
  host.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const path = e.target.closest?.("path[data-name]");
    if (path) { e.preventDefault(); select(path.dataset.name); }
  });

  const modeSel = document.getElementById("mapMode");
  if (modeSel) {
    modeSel.options = MODE_KEYS.map((k) => ({ value: k, label: MODES[k].label }));
    modeSel.value = mode;
    modeSel.addEventListener("tc-change", (e) => {
      const v = e.detail?.value;
      mode = MODE_KEYS.includes(v) ? v : "pop";
      paint();
    });
  }

  paint();
  renderReadout(null);

  // Lets the app focus a county on the map from elsewhere (e.g. the selector).
  return { focus: (name) => select(name) };
}
