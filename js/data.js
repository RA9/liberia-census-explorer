// Loads the census dataset and exposes typed accessors, formatters, and
// table row/column builders. Pure data — no DOM, no tan-compose.

let DB = null;

export async function loadCensus() {
  if (DB) return DB;
  const res = await fetch(new URL("../data/census.json", import.meta.url));
  if (!res.ok) throw new Error(`census.json ${res.status} ${res.statusText}`);
  DB = await res.json();
  return DB;
}

export const fmt = {
  /** 5,250,187 */
  int: (n) => Math.round(Number(n)).toLocaleString("en-US"),
  /** 5.25M */
  compact: (n) => {
    const x = Number(n);
    if (Math.abs(x) >= 1e6) return (x / 1e6).toFixed(2).replace(/\.?0+$/, "") + "M";
    if (Math.abs(x) >= 1e3) return (x / 1e3).toFixed(1).replace(/\.?0+$/, "") + "K";
    return String(Math.round(x));
  },
  /** +2.34% */
  pct: (n, dp = 2) => `${n >= 0 ? "+" : ""}${(n * 100).toFixed(dp)}%`,
  signed: (n) => `${n >= 0 ? "+" : ""}${Math.round(n).toLocaleString("en-US")}`,
};

/** National series as { "1962": 1016443, ... }. */
export function national(db) {
  return db.national;
}

/** Census years as numbers, ascending. */
export function years(db) {
  return db.meta.censusYears.slice().sort((a, b) => a - b);
}

/** County series {2008,2022} for one county. */
export function county(db, name) {
  return db.byCounty[name];
}

/** Year-over-year growth between two census points. */
export function growth(v0, v1) {
  return v1 / v0 - 1;
}

// ── Table builders: each returns { columns, rows } for <tc-table> ──

export function nationalRows(db) {
  const ys = years(db);
  const columns = [
    { key: "year", label: "Census year", sortable: true },
    { key: "population", label: "Population", sortable: true },
    { key: "change", label: "Change vs prior", sortable: false },
    { key: "growth", label: "Total growth", sortable: false },
  ];
  const rows = ys.map((y, i) => {
    const pop = db.national[y];
    const prev = i > 0 ? db.national[ys[i - 1]] : null;
    return {
      id: `nat-${y}`,
      year: y,
      population: fmt.int(pop),
      change: prev == null ? "—" : fmt.signed(pop - prev),
      growth: prev == null ? "—" : fmt.pct(growth(prev, pop)),
    };
  });
  return { columns, rows };
}

/** Auto-generated headline facts for the "Key insights" strip. */
export function insights(db) {
  const ys = years(db);
  const first = ys[0], last = ys[ys.length - 1];
  const p0 = db.national[first], p1 = db.national[last];
  const multiple = p1 / p0;

  const counties = db.meta.counties;
  let biggest = counties[0], fastest = counties[0];
  let biggestPop = -1, fastestG = -Infinity;
  for (const c of counties) {
    const cc = db.byCounty[c];
    if (cc["2022"] > biggestPop) { biggestPop = cc["2022"]; biggest = c; }
    const g = growth(cc["2008"], cc["2022"]);
    if (g > fastestG) { fastestG = g; fastest = c; }
  }
  const montShare = (db.byCounty["Montserrado"]["2022"] / p1) * 100;

  return [
    { icon: "trending-up", value: `${multiple.toFixed(1)}×`,
      label: `Population growth since ${first}`,
      detail: `${fmt.int(p0)} → ${fmt.int(p1)}` },
    { icon: "users", value: fmt.compact(p1 - p0),
      label: `People added since ${first}`,
      detail: `${fmt.signed(p1 - p0)} over ${last - first} years` },
    { icon: "map-pin", value: `${montShare.toFixed(0)}%`,
      label: "Live in Montserrado",
      detail: `${fmt.int(biggestPop)} in ${biggest} (2022)` },
    { icon: "spark", value: fastest,
      label: "Fastest-growing county",
      detail: `${fmt.pct(fastestG)} from 2008 to 2022` },
  ];
}

export function countyRows(db) {
  const columns = [
    { key: "county", label: "County", sortable: true },
    { key: "pop2008", label: "2008", sortable: true },
    { key: "pop2022", label: "2022", sortable: true },
    { key: "delta", label: "Change", sortable: true },
    { key: "growthPct", label: "Growth", sortable: true },
    { key: "share", label: "Share 2022", sortable: true },
  ];
  const total2022 = db.national["2022"];
  const rows = db.meta.counties.map((name) => {
    const c = db.byCounty[name];
    const g = growth(c["2008"], c["2022"]);
    return {
      id: `cty-${name}`,
      county: name,
      pop2008: fmt.int(c["2008"]),
      pop2022: fmt.int(c["2022"]),
      // Sort keys need raw numbers — keep a numeric mirror for sortable cols.
      delta: fmt.signed(c["2022"] - c["2008"]),
      growthPct: fmt.pct(g),
      share: `${((c["2022"] / total2022) * 100).toFixed(1)}%`,
    };
  });
  return { columns, rows };
}
