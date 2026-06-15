// Wires the census data + prediction models into the tan-compose-kit UI.
// No charting/table/select code here — those are kit components; this file
// only feeds them data and reacts to their events.

import {
  loadCensus, fmt, years, nationalRows, countyRows, growth,
} from "./data.js";
import { projectAll, cagrBetween, linearBetween } from "./predict.js";
import { setupChrome, urlState } from "./chrome.js";

const $ = (id) => document.getElementById(id);

/** Build a <tc-stat> metric card. */
function statCard({ label, value, delta, trend = "neutral", prefix, suffix }) {
  const el = document.createElement("tc-stat");
  el.setAttribute("label", label);
  el.setAttribute("value", String(value));
  el.setAttribute("trend", trend);
  if (delta != null) el.setAttribute("delta", String(delta));
  if (prefix) el.setAttribute("prefix", prefix);
  if (suffix) el.setAttribute("suffix", suffix);
  return el;
}

function fill(host, cards) {
  host.replaceChildren(...cards);
}

const TAGS = [
  "tc-chart", "tc-table", "tc-select", "tc-slider", "tc-stat",
  "tc-tabs", "tc-icon", "tc-callout", "tc-button", "tc-badge",
];

async function main() {
  // Ensure every component is upgraded before we set object properties on it
  // (setting a reactive prop on a not-yet-upgraded element would be lost).
  await Promise.all(TAGS.map((t) => customElements.whenDefined(t)));

  const db = await loadCensus();
  const ys = years(db);                       // [1962 … 2022]
  const nat = db.national;
  const lastYear = ys[ys.length - 1];         // 2022
  const lastPop = nat[lastYear];
  const counties = db.meta.counties;

  await setupChrome({ active: "explorer" });

  // ── Static, one-time wiring ─────────────────────────────────────────
  const tabsEl = $("tabs");
  tabsEl.tabs = [
    { id: "trend", label: "Trend & Forecast" },
    { id: "counties", label: "Counties" },
    { id: "demographics", label: "Demographics" },
    { id: "data", label: "Raw Data" },
  ];
  // Let the tab strip scroll horizontally on narrow screens. adoptedStyleSheets
  // survives the component's re-renders (unlike injected <style> children).
  if (tabsEl.shadowRoot && "adoptedStyleSheets" in tabsEl.shadowRoot) {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(
      ".strip{overflow-x:auto;flex-wrap:nowrap;scrollbar-width:thin;-webkit-overflow-scrolling:touch}" +
      ".tab{white-space:nowrap}",
    );
    tabsEl.shadowRoot.adoptedStyleSheets = [
      ...tabsEl.shadowRoot.adoptedStyleSheets, sheet,
    ];
  }

  // Historical population (actual census counts).
  $("historyChart").data = {
    labels: ys.map(String),
    series: [{ name: "Population", values: ys.map((y) => nat[y]) }],
  };

  // County bar: 2008 vs 2022.
  $("countyChart").data = {
    labels: counties,
    series: [
      { name: "2008", values: counties.map((c) => db.byCounty[c]["2008"]) },
      { name: "2022", values: counties.map((c) => db.byCounty[c]["2022"]) },
    ],
  };
  const ctyTbl = countyRows(db);
  $("countyTable").columns = ctyTbl.columns;
  $("countyTable").rows = ctyTbl.rows;

  // Age structure: broad brackets, both census years.
  const brackets = [["0_14", "0–14"], ["15_64", "15–64"], ["65plus", "65+"]];
  $("ageChart").data = {
    labels: brackets.map((b) => b[1]),
    series: [
      { name: "2008", values: brackets.map((b) => db.byAge["2008"][b[0]]) },
      { name: "2022", values: brackets.map((b) => db.byAge["2022"][b[0]]) },
    ],
  };

  // Selects.
  $("focusCounty").options = counties.map((c) => ({ value: c, label: c }));
  $("focusCounty").value = counties[0];
  $("demoYear").options = [
    { value: "2022", label: "2022 census" },
    { value: "2008", label: "2008 census" },
  ];
  $("demoYear").value = "2022";
  $("dataset").options = [
    { value: "national", label: "National totals by year" },
    { value: "counties", label: "County breakdown (2008 / 2022)" },
  ];
  $("dataset").value = "national";

  // Sources & method notes.
  $("sources").innerHTML = db.meta.sources.map((s) => `
    <div class="src">
      <tc-icon name="external-link" size="16"></tc-icon>
      <div>
        <a href="${s.url}" target="_blank" rel="noopener">${s.label}</a>
        <div class="src-supplies">${s.supplies}</div>
      </div>
    </div>`).join("") +
    `<ul class="note-list">${db.meta.notes.map((n) => `<li>${n}</li>`).join("")}</ul>`;

  // ── Restore shared view state from the URL ──────────────────────────
  const p0 = urlState.read();
  const pTarget = Number(p0.get("target"));
  let target = Number.isFinite(pTarget) && pTarget >= 2022 && pTarget <= 2050
    ? pTarget
    : (Number($("targetYear").getAttribute("value")) || 2030);
  $("targetYear").value = target;

  const pCounty = p0.get("county");
  if (pCounty && counties.includes(pCounty)) $("focusCounty").value = pCounty;

  const pDemo = p0.get("demo");
  if (pDemo && db.bySex[pDemo]) $("demoYear").value = pDemo;

  const pData = p0.get("data");
  if (pData === "national" || pData === "counties") $("dataset").value = pData;

  const pTab = p0.get("tab");
  if (["trend", "counties", "demographics", "data"].includes(pTab)) {
    tabsEl.active = pTab;
  }

  // ── Dynamic renders ─────────────────────────────────────────────────

  function renderTrend() {
    const fy = [];
    for (let y = lastYear; y <= target; y++) fy.push(y);
    const proj = projectAll(nat, fy);

    $("forecastChart").data = {
      labels: fy.map(String),
      series: proj.models.map((m) => ({ name: m.name, values: m.values })),
    };
    $("forecastSub").textContent = `Projected 2022 → ${target}`;

    const cagr = proj.models.find((m) => m.id === "cagr");
    const cards = [
      statCard({ label: `Population · ${lastYear}`, value: fmt.int(lastPop) }),
      statCard({
        label: "Annual growth (CAGR)",
        value: (cagr.rate * 100).toFixed(2), suffix: "%", trend: "up",
      }),
    ];
    for (const m of proj.models) {
      const v = m.values[m.values.length - 1];
      const d = v - lastPop;
      cards.push(statCard({
        label: `${m.name} · ${target}`,
        value: fmt.compact(v),
        delta: `${fmt.signed(d)} vs 2022`,
        trend: d >= 0 ? "up" : "down",
      }));
    }
    fill($("trendStats"), cards);

    $("modelNotes").innerHTML =
      `<strong>How each projection works</strong><ul class="note-list">` +
      proj.models.map((m) => `<li><b>${m.name}:</b> ${m.describe}</li>`).join("") +
      `</ul>`;
  }

  function renderCounty() {
    const name = $("focusCounty").value || counties[0];
    const c = db.byCounty[name];
    const model = cagrBetween(c["2008"], 2008, c["2022"], 2022);
    const linModel = linearBetween(c["2008"], 2008, c["2022"], 2022);
    const projected = model.predict(target);
    const g = growth(c["2008"], c["2022"]);

    // Per-county forecast chart: both curves pass through the 2008 & 2022
    // census anchors, then diverge as they project toward the target year.
    const cyrs = [];
    for (let y = 2008; y <= Math.max(2022, target); y++) cyrs.push(y);
    $("countyForecastChart").data = {
      labels: cyrs.map(String),
      series: [
        { name: "Growth-rate (CAGR)", values: cyrs.map((y) => model.predict(y)) },
        { name: "Linear trend", values: cyrs.map((y) => linModel.predict(y)) },
      ],
    };
    $("countyForecastTitle").textContent = `${name} — forecast`;
    $("countyForecastSub").textContent =
      `Anchored on the 2008 & 2022 census, projected to ${target}`;

    fill($("countyStats"), [
      statCard({ label: `${name} · 2022`, value: fmt.int(c["2022"]) }),
      statCard({ label: `${name} · growth 2008–22`, value: `${(g * 100).toFixed(1)}%`, trend: "up" }),
      statCard({ label: `${name} · annual rate`, value: (model.rate * 100).toFixed(2), suffix: "%", trend: "up" }),
      statCard({
        label: `${name} · projected ${target}`,
        value: fmt.compact(projected),
        delta: `${fmt.signed(projected - c["2022"])} vs 2022`,
        trend: projected >= c["2022"] ? "up" : "down",
      }),
    ]);
  }

  function renderDemo() {
    const year = $("demoYear").value || "2022";
    const sex = db.bySex[year];
    const age = db.byAge[year];
    $("sexChart").data = {
      series: [
        { name: "Male", value: sex.male },
        { name: "Female", value: sex.female },
      ],
    };
    // Match the pyramid's colour coding: Male = blue, Female = accent.
    $("sexChart").colors = [
      "var(--tc-color-info, #3a5b8c)",
      "var(--tc-color-accent, #a16939)",
    ];
    $("sexSub").textContent = `${year} census`;

    const total = sex.male + sex.female;
    const ratio = ((sex.male / sex.female) * 100).toFixed(1);
    const popAge = age["0_14"] + age["15_64"] + age["65plus"];
    const dep = (((age["0_14"] + age["65plus"]) / age["15_64"]) * 100).toFixed(1);
    const workShare = ((age["15_64"] / popAge) * 100).toFixed(1);
    fill($("demoStats"), [
      statCard({ label: `Total · ${year}`, value: fmt.int(total) }),
      statCard({ label: `Sex ratio · ${year}`, value: ratio, suffix: " M/100F" }),
      statCard({ label: `Dependency ratio · ${year}`, value: dep, suffix: "%" }),
      statCard({ label: `Working-age share · ${year}`, value: workShare, suffix: "%", trend: "up" }),
    ]);

    // The pyramid follows the same year selector as the rest of this tab.
    renderPyramid(year);
  }

  function renderPyramid(year) {
    const groups = db.byAgeSex?.years?.[year];
    if (!Array.isArray(groups)) return;
    const title = $("pyramidTitle");
    if (title) title.textContent = `Population pyramid · ${year}`;
    const max = Math.max(...groups.map((r) => Math.max(r.male, r.female)));
    const host = $("pyramid");
    // Oldest band at the top, youngest (the base) at the bottom.
    host.innerHTML = groups.slice().reverse().map((r) => {
      const mw = ((r.male / max) * 100).toFixed(1);
      const fw = ((r.female / max) * 100).toFixed(1);
      return `<div class="pyr-row">
        <div class="pyr-side left">
          <div class="pyr-bar male" style="width:${mw}%"
            title="Male ${r.age}: ${fmt.int(r.male)}"></div>
          <span class="pyr-val">${fmt.compact(r.male)}</span>
        </div>
        <div class="pyr-age">${r.age}</div>
        <div class="pyr-side right">
          <div class="pyr-bar female" style="width:${fw}%"
            title="Female ${r.age}: ${fmt.int(r.female)}"></div>
          <span class="pyr-val">${fmt.compact(r.female)}</span>
        </div>
      </div>`;
    }).join("");
  }

  function renderDataTable() {
    const kind = $("dataset").value || "national";
    const t = $("dataTable");
    const src = kind === "counties" ? countyRows(db) : nationalRows(db);
    t.columns = src.columns;
    t.rows = src.rows;
  }

  // ── Events ──────────────────────────────────────────────────────────
  const onTarget = (e) => {
    const v = Number(e.detail?.value);
    if (!Number.isFinite(v)) return;
    target = v;
    renderTrend();
    renderCounty();
    urlState.write({ target: v });
  };
  $("targetYear").addEventListener("tc-input", onTarget);
  $("targetYear").addEventListener("tc-change", onTarget);

  $("focusCounty").addEventListener("tc-change", () => {
    renderCounty();
    urlState.write({ county: $("focusCounty").value });
  });
  $("demoYear").addEventListener("tc-change", () => {
    renderDemo();
    urlState.write({ demo: $("demoYear").value });
  });
  $("dataset").addEventListener("tc-change", () => {
    renderDataTable();
    urlState.write({ data: $("dataset").value });
  });
  tabsEl.addEventListener("tc-tab-change", (e) => {
    urlState.write({ tab: e.detail?.active || "trend" });
  });

  $("downloadBtn").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(db, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "liberia-census.json";
    a.click();
    URL.revokeObjectURL(url);
  });

  // ── First paint ─────────────────────────────────────────────────────
  renderTrend();
  renderCounty();
  renderDemo();
  renderDataTable();
}

main().catch((err) => {
  console.error(err);
  const p = document.querySelector(".page");
  if (p) {
    const e = document.createElement("tc-callout");
    e.setAttribute("variant", "danger");
    e.textContent = `Failed to load: ${err.message}`;
    p.prepend(e);
  }
});
