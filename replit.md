# Tokenomic

Institutional DeFi education and intelligence platform built on Jekyll.

## Architecture
- **Static site generator**: Jekyll (Ruby/Jekyll not installed — site is pre-built to `_site/`)
- **Serving**: Express server (`server.js`) on port 5000, serves `_site/` static files + `/api/luma-events` proxy
- **Frontend**: Bootstrap 4, jQuery, custom CSS (`style.css`, `responsive.css`)
- **Dashboard**: Alpine.js for reactivity, Chart.js for analytics
- **Web3**: Ethers.js v5 (Base L2 network), wallet-native auth (MetaMask/Rabby)
- **Backend**: Supabase (client in `/shared/assets/js/supabase-client.js`)
- **Payments**: USDC on Base L2 via Helio, 0xSplits revenue distribution (90/5/5)

## GitHub Pages Deployment
- **Gemfile**: Uses `github-pages` gem for compatibility with GitHub Pages built-in builder
- **Plugins**: `jekyll-feed`, `jekyll-paginate`, `jekyll-seo-tag` (all supported by github-pages)
- **Excludes**: `website/`, `vendor/`, `node_modules/`, `attached_assets/`, `.local/` excluded in `_config.yml`
- **Important**: `_site/` is in `.gitignore` — GitHub Pages rebuilds it. Run `git rm --cached -r _site/` once to untrack the previously committed `_site/` directory.

## SEO & Feeds
- **RSS Feed** (`/feed.xml`) — RSS 2.0 feed with all 16 learn articles, auto-discoverable via `<link rel="alternate">` in every page `<head>`
- **Sitemap** (`/sitemap.xml`) — XML sitemap with 28 URLs (12 main pages + 16 articles), priorities and change frequencies set per page type
- **Robots.txt** (`/robots.txt`) — Allows all crawlers, points to sitemap
- All three files live in `_site/` and are served as static files by Express with proper `application/xml` content type

## Key Directories
- `_site/` — Pre-built static output (served directly in Replit, rebuilt by GitHub Pages)
- `_layouts/` — `default`, `page`, `post`, `category`, `tag_page`, `dashboard`
- `_includes/` — Jekyll partials (only actively-used includes kept; unused theme includes removed)
- `_data/` — Jekyll data files (navigation.yml)
- `_site/dashboard*/` — Dashboard pages (11 pages)
- `_site/learn/*/` — Article detail pages (13 articles, statically generated + 3 slug aliases)
- `shared/assets/js/` — Shared JS (wallet, Supabase client, site-search, profile-photo)
- `assets/` — CSS, images, fonts, JS libraries
- `assets/images/learn/` — Article images pulled from learn.tokenomic.org (cover images + inline content images)
- `scripts/` — Build scripts (scrape-articles.js, generate-article-pages.js, sync-assets.sh)
- `global-community/` — File-based community storage (each subfolder = one community with `community.json` + `comments.json`)

## Removed (unused)
- `website/` — Legacy/backup directory (was excluded in _config.yml)
- `.sass-cache/`, `.agents/` — Cache/empty directories
- 8 unused root HTML source files (portfolio-2, services-2, blog, artists, team, join, events, services)
- 45 unused `_includes/` partials (theme variants not referenced by any layout or page)
- 19 orphaned `_site/` HTML files (old slug redirects with zero references)
- `_site/2025/`, `_site/2026/`, `_site/tag/`, `_site/category/` — Empty Jekyll archive stubs
- `search.json` — Not referenced by any JS (site-search uses Supabase data)

## Branding
- Primary: `#F7931A` (gold-orange), Dark: `#0A0F1A` (navy-black), Muted: `#8899A6`
- Dashboard palette: Sidebar `#0A0F1A`, accent `#F7931A`, bg `#F0F2F5`, cards `#fff`, success `#00C853`, blue `#2196F3`
- Font: Inter (dashboard), Default Bootstrap stack (main site)
- Logo: `/assets/images/logo.png`
- Dashboard CSS: `assets/css/dashboard.css` (design system with Inter font, card shadows, nav items, badges, tables, 32px container spacing)

## Pages
- **Homepage** (`/`) — Hero, platform preview, audience targeting, trust, services, training, wallet-gated community CTA
- **Learn** (`/learn/`) — Category-based article hub (Strategy, Technical, Market) with "Meet our authors" section and inline search; articles from Supabase `articles` table with local images; links to `/learn/[slug]` article pages
- **Article Pages** (`/learn/[slug]/`) — Full article content pages with featured image, author, date, category, share buttons, back-to-learn navigation; generated from learn.tokenomic.org content using `scripts/generate-article-pages.js`; images served from `/assets/images/learn/`
- **Educators** (`/educators/`) — Auto-populated cards of community-approved educators from Supabase profiles (role=educator, approved=true)
- **Consultants** (`/consultants/`) — Auto-populated cards of community-approved consultants with ratings, pricing, and booking links
- **Dashboard** (`/dashboard/`) — Main analytics with stats, recent activity, progress
- **Courses** (`/dashboard-courses/`) — Three views: Manage (CRUD), My Learning (progression), Certifications
- **Revenue** (`/dashboard-revenue/`) — Charts with time filters (1W/1M/3M/YTD/ALL), CSV export, 0xSplits visualization, transaction history with status pills
- **Communities** (`/dashboard-communities/`) — Community cards loaded from `global-community/` folder via API, with comment threads; create new communities, post comments
- **Events** (`/dashboard-events/`) — Live Luma calendar sync (Calendar ID: `cal-on7sN7ID2LgtAB9`), auto-fetches events via `/api/luma-events` proxy, shows cover images, dates, locations, guest counts, and registration links
- **Bookings** (`/dashboard-bookings/`) — Consultant booking, wallet & Helio payments
- **Chat** (`/dashboard-chat/`) — Channel-based messaging
- **Leaderboard** (`/dashboard-leaderboard/`) — XP rankings, progress tracking, module tracker
- **Articles** (`/dashboard-articles/`) — Content management with full analytics: two-tab layout (Analytics/Editor), traffic overview (views, visitors, avg read time, bounce rate with period selectors 7d/30d/90d/All), daily traffic bar chart, traffic sources breakdown, revenue breakdown (sponsorship/ad CPM/your share), per-article performance table (sortable by views/visitors/revenue), click-to-expand article detail with referral sources and GitHub/live links; full-screen modal editor with title, auto-slug, tags, excerpt (with char count), markdown toolbar (bold/italic/H2/H3/list/link/code/quote/image), publish settings sidebar (author, date, target repo, sponsorship, revenue share), featured image upload, preview info panel (URL, GitHub path, word count); publishes to `Tokenomic-org/website` repo via `/api/github/publish` endpoint (creates Jekyll `_posts/` files with frontmatter); falls back to demo mode when `GITHUB_PERSONAL_ACCESS_TOKEN` secret not set; all article URLs at `tokenomic.org/learn/[slug]`
- **Social** (`/dashboard-social/`) — Social Media Manager for @tknmic official channels; dark explanatory banner, 6 platform cards (Facebook/Twitter/LinkedIn/Instagram/YouTube/TikTok) linking to profiles, per-post analytics (views/likes/shares/comments/engagement), post filter (All/Published/Scheduled), non-destructive edit via `editingPostId`, delete for scheduled posts
- **Profile** (`/dashboard-profile/`) — User profile management with drag & drop photo upload (camera icon overlay + dashed outline on drag), social links (X/LinkedIn/GitHub/Website), "Apply as Educator" modal (name/bio/expertise/motivation/GitHub/LinkedIn), "Apply as Consultant" button (scrolls to registration), "View Public Profile" link, role badges, expanded consultant registration with stats preview (upcoming/completed/earned/rating), 60-min rate & expertise fields, localStorage persistence (`tkn_profile_data` JSON + `tkn_profile_photo`)
- **Public Profile** (`/profile/[slug]/`) — Public expert profile page with gradient hero, cover photo area, avatar (initials fallback), verified badge, role badges (Educator/Consultant), headline, social links (sanitized URLs), wallet address (click-to-copy), 6-column stats bar (students/courses/XP/rating/sessions/articles), about section, tabbed content (Courses & Communities / Published Articles / Reviews / Consulting with rates & booking), floating action buttons (Join Community / Book Session / Share); loads from demo expert data or localStorage (for own profile); demo profiles for Dr. Sarah Chen, Marcus Webb, Aisha Patel, James Liu, Elena Rossi, David Okonkwo
- **Pricing** (`/pricing/`) — Three tiers (Explorer/Professional/Institution), individual course pricing, FAQ
- **Privacy** (`/privacy/`) — Privacy policy
- **Terms** (`/terms/`) — Terms of service

## Navigation
Defined in `_data/navigation.yml`: Home, About, Educators, Consultants, Learn
- Learn is a direct link (no dropdown) — the page dynamically loads category-based article sections from Supabase

## Dashboard Source Files
- 11 Jekyll source files at project root: `dashboard.html`, `dashboard-courses.html`, etc.
- Each uses `layout: dashboard` with `permalink` front matter
- Dashboard layout (`_layouts/dashboard.html`) uses `header_5.html` (includes wallet Login/Dashboard buttons)
- Dashboard layout has NO page banner — goes straight from header to content
- Dashboard header has solid dark navy background (`#0A0F1A`) with tighter nav spacing
- Content extracted from pre-built `_site/` pages for GitHub Pages compatibility
- Dashboard sidebar: Dark (#0A0F1A) with Tokenomic branding, section labels (Main/Finance/Content/Progress), gold-orange active indicator
- Sidebar is hidden when no wallet is connected (wallet gate logic in web3-wallet.js showGate/hideGate)
- Banner sections removed from _site/ dashboard pages for cleaner layout
- Old inline `<style>` blocks removed from _site/ files — all dashboard styling now from dashboard.css

## Learn/Articles System
- Articles originally from learn.tokenomic.org, now pulled to main site
- Article content scraped and stored in `scripts/articles-data.json`
- Article images downloaded to `assets/images/learn/` (cover images + inline content images)
- Static pages generated at `_site/learn/[slug]/index.html` via `scripts/generate-article-pages.js`
- To regenerate: run `node scripts/scrape-articles.js` then `node scripts/generate-article-pages.js`
- Demo data in supabase-client.js uses local image paths (`/assets/images/learn/`)
- Site search (site-search.js) searches across articles, educators, and consultants — matches on names, descriptions/bios, specialties, categories, and keywords; results shown with color-coded type badges (orange=Article, green=Educator, blue=Consultant); popup HTML is dynamically injected if missing from the page
- 13 articles across Strategy, Technical, and Market categories
- Slug aliases (symlinks) for alternate URL patterns: `arbitrage-practical-guide`, `advanced-options-defi`, `smart-contract-security-basics`

## Important Notes
- Ruby/Jekyll is NOT installed locally — cannot run `jekyll build`
- All visible changes in Replit must be made in `_site/` files directly
- Source files (`_includes/`, `_layouts/`, etc.) are for Jekyll builds (GitHub Pages)
- Dashboard layout exists at `_layouts/dashboard.html` for dashboard source pages
- When editing dashboard pages, update BOTH the `_site/` version (for Replit) and the source `.html` file (for GitHub Pages)
- Footer is included in default layout (`_layouts/default.html`) and dashboard layout

## Dual-File Architecture (CRITICAL)
This project has a **dual-file architecture** that must be maintained:
- **`_site/`** = What users see in Replit (served by Express). Edit these for immediate changes.
- **Source files** (`assets/`, `shared/`, `_includes/`, `_layouts/`) = For Jekyll/GitHub Pages builds.
- **ALWAYS edit BOTH** when changing CSS, JS, HTML includes, or templates.

### Files that must stay in sync:
| Source File | _site/ Copy |
|---|---|
| `assets/css/style.css` | `_site/assets/css/style.css` |
| `assets/css/dashboard.css` | `_site/assets/css/dashboard.css` |
| `shared/assets/js/site-search.js` | `_site/shared/assets/js/site-search.js` |
| `shared/assets/js/supabase-client.js` | `_site/shared/assets/js/supabase-client.js` |
| `shared/assets/js/web3-wallet.js` | `_site/shared/assets/js/web3-wallet.js` |
| `_includes/header.html` | Inline in each `_site/` page (manual sync) |
| `_includes/footer.html` | Inline in each `_site/` page (manual sync) |

### Sync script: `bash scripts/sync-assets.sh`
Run after editing any source CSS/JS file to sync to `_site/`.

### Common pitfalls to avoid:
- **Never use `.html` extensions in links** — use root-relative paths like `/contact/`, `/services/`, `/training/`
- **CSS top offsets** — headers use `position: fixed; top: 0;` — never add top offsets
- **Search popup** — dynamically injected by `site-search.js` on all pages; no manual HTML needed
- **Copyright year** — auto-generated by JavaScript, not hardcoded
- **Header inline styles** — search button & wallet button alignment defined in `<style>` block in header includes; must be present on every page
- **When editing _site/ HTML pages in bulk** — use `find _site -name "*.html" -exec sed ...` for consistency
