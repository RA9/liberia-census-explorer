# Liberia Census Explorer

Query Liberia's national census data (1962–2022) and project future population —
by county, sex and age. A static, dependency-free site built entirely with
[tan-compose](https://github.com/ra9/tan-compose) Web Components (the `kit` and
`icons` packages, loaded from a CDN). No framework, no build step, no backend.

## Features

- **Trend & forecast** — historical population plus three projection models
  (compound growth / linear / exponential) compared side by side, with an
  adjustable target year.
- **Counties** — 2008 vs 2022 by county, a per-county forecast, and a sortable
  detail table.
- **Demographics** — sex split, age structure, and a population pyramid that
  switches between 2008 and 2022.
- **Raw data** — browse/download the underlying dataset.
- Dark mode, a population pyramid, shareable view state in the URL, About and
  Contact pages, social/OG cards, a PWA manifest, and a custom 404.

## Run locally

It's plain static files, so any static server works from the repo root:

```bash
npx serve .
# or
python3 -m http.server 8000
```

Then open the printed URL.

## Deploy (GitHub Pages)

Pushing to `main` auto-deploys via `.github/workflows/deploy.yml`.

1. Create a GitHub repo and push this project to it.
2. In the repo: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. Every push to `main` publishes the site.

### Before going live

`sitemap.xml` and `robots.txt` contain a placeholder host
(`https://your-domain.example`). Replace it with your real Pages URL. If you want
absolute social-card URLs, also swap the relative `og:image` paths for absolute
ones in `index.html`, `about.html` and `contact.html`.

> Note: the `404.html` uses root-absolute links (`/index.html`, …), which is
> correct for a user/org site or a custom domain. If you deploy as a **project
> site** (`username.github.io/repo/`), adjust those links to include the repo
> prefix.

## Data & sources

- **LISGIS** — 2008 and 2022 Population & Housing Census reports (national,
  county, sex, age).
- **UN World Population Prospects** (via PopulationPyramid.net) — the population
  pyramid's age-by-sex figures, which are **estimates**, clearly labelled as
  distinct from the enumerated census counts.
- Wikipedia (Demographics of Liberia) — 2008 broad age brackets.

This is an independent educational project and not an official government source.

## Project layout

```
index.html · about.html · contact.html · 404.html
robots.txt · sitemap.xml · site.webmanifest · styles.css
assets/   favicon, icons, OG cards (+ og.html template)
data/     census.json
js/       app.js · chrome.js · contact.js · data.js · predict.js
vendor/   tc-icons.js (vendored from @ra9/tan-compose-icons)
```
