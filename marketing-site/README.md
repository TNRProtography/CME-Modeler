# Spot The Aurora — marketing site

A standalone static marketing site that explains and sells the Spot The Aurora app.
It does **not** touch the app in `basic---to-go-live-nasa-cme-modeler/` — it only
describes it.

Plain HTML + one CSS file. No build step, no dependencies, no JavaScript framework.
Edit the HTML directly.

## Pages

| File | Purpose |
|---|---|
| `index.html` | Home — hero, proof, the problem with Kp, the three world-firsts, the Sun→ground chain, alerts, audiences, devices, support |
| `features.html` | Every feature, page by page, plus the full alert table |
| `how-it-works.html` | The science — score inputs, location adjustment, substorms, moon gating, alert geometry, and honest limitations |
| `data.html` | Every data source with refresh rates |
| `faq.html` | Frequently asked questions |
| `about.html` | The story, the numbers, and the tip jar |
| `404.html` | Not-found page |
| `assets/site.css` | The entire stylesheet |

## Deploying to Cloudflare Pages

1. Cloudflare dashboard → Workers & Pages → Create → Pages → Connect to Git.
2. Pick this repository.
3. **Build command:** leave empty. **Build output directory:** `marketing-site`
4. Add your custom domain.

`_headers` sets caching and basic security headers; Pages picks it up automatically.

## Before it goes live

### 1. Set the domain

The site currently assumes `https://about.spottheaurora.co.nz`. If you use a different
domain, find-and-replace it across all files:

```bash
cd marketing-site
grep -rl 'about.spottheaurora.co.nz' . | xargs sed -i 's|about\.spottheaurora\.co\.nz|YOUR-DOMAIN.co.nz|g'
```

This affects canonical tags, Open Graph URLs, `robots.txt` and `sitemap.xml`.

### 2. Add the screenshots

Every image slot is a placeholder box showing the filename it wants and what should be
in it. Drop the real file into `assets/screenshots/` and replace the placeholder block:

```html
<!-- from -->
<div class="shot"><div class="shot-ph">
  <span class="k">hero-forecast-dashboard.png</span>
  <span class="d">...</span>
</div></div>

<!-- to -->
<div class="shot">
  <img src="/assets/screenshots/hero-forecast-dashboard.png" alt="Spot The Aurora forecast dashboard" width="1600" height="1000">
</div>
```

Screenshots wanted, in priority order:

| Filename | Page | What it should show |
|---|---|---|
| `hero-forecast-dashboard.png` | index | Forecast page, Simple View — big score, status sentence, Now/15/30/60 slots. Landscape. Best on a night with a decent score. |
| `cme-3d-heliosphere.png` | index | The 3D CME scene — Sun, Earth, a CME in flight, timeline visible |
| `coronal-hole-detection.png` | index | SUVI disk with a detected coronal hole outlined, and/or the Parker spiral arms |
| `magnetotail-visualisation.png` | index | The Magnetotail scene mid-substorm. A short screen recording would be even better. |
| `phone-notification.png` | index | Phone screenshot of a real visibility alert on the lock screen. Portrait. |
| `devices-responsive.png` | index | Phone + tablet + desktop side by side |
| `forecast-simple-view.png` | features | Simple View close-up |
| `forecast-advanced-view.png` | features | Advanced View — gauge row plus a chart |
| `solar-activity-page.png` | features | X-ray flux with a flare marked, or the sunspot tracker |
| `cme-3d-wide.png` | features | Full-width 3D scene with the controls panel visible |
| `substorm-panel.png` | how-it-works | Substorm panel showing status and P30/P60 |
| `moon-arc-chart.png` | how-it-works | Moon arc chart with illumination and rise/set |
| `tnr-aurora-photo.jpg` | about | Your best aurora photograph. This is the emotional anchor of the page. |

Keep images under ~400 KB each (WebP is ideal) so the pages stay fast.

### 3. Check the professional-praise wording

`index.html` and `about.html` say the visualisations have drawn praise from NOAA SWPC
directors, MetService and space weather researchers, with a disclaimer that the project
is not affiliated with or endorsed by them. If you'd rather name people, quote them
directly, or soften it, that text is in the "Who's using it" section of `index.html`
and the stats note in `about.html`.

### 4. Analytics (optional)

If you want GA on this site too, paste the same gtag snippet used in the app's
`index.html` into the `<head>` of each page.

## Design system

Taken directly from tnrprotography.co.nz so the two sites read as one brand.
The values below were lifted from the aurora page's own stylesheet, not invented.

**Colour**

| Token | Value | Use |
|---|---|---|
| `--gold` | `#c8963e` | The accent. Labels, rules, buttons, links, numbers. |
| `--gold-light` / `--gold-dark` | `#d9ac5a` / `#a07428` | Hover and recessed states |
| `--black` | `#07090d` | Page background |
| `--dark` | `#0b1520` | Alternate bands |
| `--card` / `--mid` | `#101e2a` / `#1a2d3d` | Raised surfaces |
| `--border` | `#22384a` | Every hairline rule |
| `--gray` / `--light-gray` | `#5a7080` / `#92aab8` | Muted and secondary text |
| `--white` / `--cream` | `#f0ede8` / `#e4dfd6` | Headings and body. Warm off-white, never pure white. |

**Type**

- Display: **Bebas Neue**, uppercase, `clamp(3.2rem, 8vw, 6.5rem)` for h1 at
  line-height 0.95, `clamp(2.2rem, 5vw, 3.5rem)` for h2
- Labels and buttons: **Montserrat** 700, around 0.6rem, `letter-spacing: 0.25em`,
  uppercase, in gold
- Body: **Open Sans**, `clamp(0.9rem, 1.5vw, 1.05rem)`, line-height 1.7

**Layout rules**

- **Square corners everywhere.** No border radius on anything.
- **No card boxes.** Blocks are separated by hairline top rules in `--border`,
  content sits directly on the page background.
- Headings take **hard line breaks** (`<br>`) so they stack as deliberate blocks,
  the way the aurora page does it.
- Imagery is unframed and full width with a deep shadow, never a bordered panel.
- Gold is the only accent. Red and green appear once, in the visibility score
  scale, where the colour carries meaning.

## Voice rules

The copy follows Dean's voice guide. If you edit or add anything, keep to these:

- **No em dashes.** Use commas, full stops, or restructure the sentence.
- **No emojis.** Card accents are CSS gradient bars (`.card .icon`), not glyphs.
- **One exclamation mark per page, maximum.** Currently zero.
- Story first, photo second. Lead with what happened, not what the screenshot shows.
- Understate. State the achievement plainly, then undercut it.
- Name places specifically: Greymouth, the Coast, Oban, Twizel, Rapahoe.
- Avoid: blessed, grateful, humbled, epic, content, check out, don't forget to follow,
  and marketing speak generally.

A checker for the mechanical rules:

```bash
cd marketing-site
grep -l 'mdash\|—' *.html          # should return nothing
grep -o '!' *.html | sort | uniq -c  # one per page at most
```

## Figures used on the site

These are stated as fact and should be refreshed periodically:

- 80,000+ users and 466,000 views — Google Analytics, Feb–Sep 2026
- 4m 07s average engagement time per active user — same period
- ~14,000 unique visitors / 347,000 requests in 30 days — Cloudflare, Aug 19 – Sep 18 2026
- 60-second refresh, 10 alert categories, 7 live cameras — verified against the app source

Everything else on the site was written from the app's own source code and in-app
technical documentation.
