// Prediction models for Liberia census data.
// Each model takes historical {year:number -> population:number} points and
// returns a function projecting population for an arbitrary year, plus a
// short, honest description. All math runs in-browser — no backend.

/** Sort {year,value} pairs ascending by year. */
function points(series) {
  return Object.entries(series)
    .map(([y, v]) => ({ year: Number(y), value: Number(v) }))
    .filter((p) => Number.isFinite(p.year) && Number.isFinite(p.value))
    .sort((a, b) => a.year - b.year);
}

/**
 * Geometric / compound-annual-growth-rate model.
 * Anchors on the first and last observed census and assumes a constant
 * annual growth rate between them. This is the standard demographic
 * projection method used by national statistics offices.
 */
export function cagrModel(series) {
  const pts = points(series);
  const first = pts[0];
  const last = pts[pts.length - 1];
  const span = last.year - first.year;
  const rate = span > 0 ? Math.pow(last.value / first.value, 1 / span) - 1 : 0;
  return {
    id: "cagr",
    name: "Growth-rate (CAGR)",
    rate,
    anchorYear: last.year,
    anchorValue: last.value,
    predict: (year) => last.value * Math.pow(1 + rate, year - last.year),
    describe: `Compound annual growth of ${(rate * 100).toFixed(2)}% ` +
      `(${first.year}–${last.year}), projected forward from ${last.year}.`,
  };
}

/** Ordinary least-squares linear fit: value = a + b*year. */
function linfit(pairs) {
  const n = pairs.length;
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (const [x, y] of pairs) {
    sx += x; sy += y; sxx += x * x; sxy += x * y;
  }
  const denom = n * sxx - sx * sx;
  const b = denom === 0 ? 0 : (n * sxy - sx * sy) / denom;
  const a = (sy - b * sx) / n;
  // Coefficient of determination (R^2).
  const mean = sy / n;
  let ssTot = 0, ssRes = 0;
  for (const [x, y] of pairs) {
    const yhat = a + b * x;
    ssTot += (y - mean) ** 2;
    ssRes += (y - yhat) ** 2;
  }
  const r2 = ssTot === 0 ? 1 : 1 - ssRes / ssTot;
  return { a, b, r2 };
}

/**
 * Linear-regression model — straight-line trend through every census.
 * Simple and transparent, but underestimates compounding growth.
 */
export function linearModel(series) {
  const pts = points(series);
  const { a, b, r2 } = linfit(pts.map((p) => [p.year, p.value]));
  return {
    id: "linear",
    name: "Linear trend",
    r2,
    predict: (year) => a + b * year,
    describe: `Least-squares straight line through all ${pts.length} ` +
      `censuses (R² = ${r2.toFixed(3)}). Adds a fixed number of people per year.`,
  };
}

/**
 * Exponential-regression model — least-squares fit of ln(value) vs year.
 * Captures compounding like CAGR but is informed by every census, not
 * just the two endpoints.
 */
export function exponentialModel(series) {
  const pts = points(series);
  const { a, b, r2 } = linfit(pts.map((p) => [p.year, Math.log(p.value)]));
  const annualRate = Math.exp(b) - 1;
  return {
    id: "exponential",
    name: "Exponential fit",
    r2,
    rate: annualRate,
    predict: (year) => Math.exp(a + b * year),
    describe: `Least-squares exponential through all ${pts.length} censuses ` +
      `(≈${(annualRate * 100).toFixed(2)}%/yr, R² = ${r2.toFixed(3)}).`,
  };
}

/** Build all three models for a year->value series. */
export function allModels(series) {
  return [cagrModel(series), linearModel(series), exponentialModel(series)];
}

/**
 * Project a series across a list of target years using every model.
 * Returns { years, models:[{id,name,values:[],describe,...}] }.
 */
export function projectAll(series, years) {
  return {
    years,
    models: allModels(series).map((m) => ({
      id: m.id,
      name: m.name,
      describe: m.describe,
      rate: m.rate,
      r2: m.r2,
      values: years.map((y) => Math.max(0, Math.round(m.predict(y)))),
    })),
  };
}

/**
 * Single-rate CAGR projection for a two-point county series
 * ({2008, 2022}) — returns the rate and a predict() closure.
 */
export function cagrBetween(v0, y0, v1, y1) {
  const span = y1 - y0;
  const rate = span > 0 ? Math.pow(v1 / v0, 1 / span) - 1 : 0;
  return {
    rate,
    predict: (year) => Math.max(0, Math.round(v1 * Math.pow(1 + rate, year - y1))),
  };
}

/**
 * Back-test: fit every model on the censuses BEFORE `holdoutYear`, predict
 * `holdoutYear`, and compare to the actual count. Returns per-model accuracy.
 */
export function backtest(series, holdoutYear) {
  const actual = Number(series[holdoutYear] ?? series[String(holdoutYear)]);
  const train = {};
  for (const [y, v] of Object.entries(series)) {
    if (Number(y) < holdoutYear) train[y] = v;
  }
  const rows = allModels(train).map((m) => {
    const predicted = Math.max(0, Math.round(m.predict(holdoutYear)));
    const errAbs = predicted - actual;
    const errPct = actual ? errAbs / actual : 0;
    return {
      id: m.id, name: m.name, predicted, actual,
      errAbs, errPct, absErrPct: Math.abs(errPct),
    };
  });
  const best = rows.reduce((a, b) => (b.absErrPct < a.absErrPct ? b : a), rows[0]);
  return { holdoutYear, actual, trainYears: Object.keys(train).map(Number), rows, bestId: best?.id };
}

/** Doubling time in years for a constant annual rate (Rule-of-70 style). */
export function doublingTime(rate) {
  return rate > 0 ? Math.log(2) / Math.log(1 + rate) : Infinity;
}

/**
 * First year at/after `fromYear` where a constant-rate projection from
 * (baseValue @ baseYear) reaches each threshold. Returns [{threshold, year}].
 */
export function milestones(baseValue, baseYear, rate, thresholds, maxYear = 2200) {
  return thresholds.map((threshold) => {
    if (baseValue >= threshold) return { threshold, year: baseYear, reached: true };
    if (rate <= 0) return { threshold, year: null, reached: false };
    // baseValue * (1+rate)^(y-baseYear) >= threshold
    const y = baseYear + Math.log(threshold / baseValue) / Math.log(1 + rate);
    const year = Math.ceil(y);
    return { threshold, year: year <= maxYear ? year : null, reached: false };
  });
}

/** Constant-rate projection closure from a base anchor. */
export function rateProjection(baseValue, baseYear, rate) {
  return (year) => Math.max(0, Math.round(baseValue * Math.pow(1 + rate, year - baseYear)));
}

/**
 * Straight-line projection through two points ({2008, 2022}) — constant
 * people-per-year. Companion to cagrBetween for the county comparison chart.
 */
export function linearBetween(v0, y0, v1, y1) {
  const span = y1 - y0;
  const slope = span !== 0 ? (v1 - v0) / span : 0;
  return {
    slope,
    predict: (year) => Math.max(0, Math.round(v0 + slope * (year - y0))),
  };
}
