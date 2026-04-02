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

## Key Directories
- `_site/` — Pre-built static output (served directly in Replit, rebuilt by GitHub Pages)
- `_layouts/` — `default`, `page`, `post`, `category`, `tag_page`, `dashboard`
- `_includes/`, `_data/` — Jekyll source templates and data
- `_site/dashboard*/` — Dashboard pages (11 pages)
- `_site/learn/*/` — Article detail pages (13 articles, statically generated + 3 slug aliases)
- `shared/assets/js/` — Shared JS (wallet, Supabase client, site-search)
- `assets/` — CSS, images, fonts, JS libraries
- `assets/images/learn/` — Article images pulled from learn.tokenomic.org (cover images + inline content images)
- `scripts/` — Build scripts (scrape-articles.js, generate-article-pages.js)

## Branding
- Primary: `#F7931A` (gold-orange), Dark: `#0A0F1A` (navy-black), Muted: `#8899A6`
- Dashboard palette: Sidebar `#0A0F1A`, accent `#F7931A`, bg `#F0F2F5`, cards `#fff`, success `#00C853`, blue `#2196F3`
- Font: Inter (dashboard), Default Bootstrap stack (main site)
- Logo: `/assets/images/logo.png`
- Dashboard CSS: `assets/css/dashboard.css` (design system with Inter font, card shadows, nav items, badges, tables)

## Pages
- **Homepage** (`/`) — Hero, platform preview, audience targeting, trust, services, training, wallet-gated community CTA
- **Learn** (`/learn/`) — Category-based article hub (Strategy, Technical, Market) with "Meet our authors" section and inline search; articles from Supabase `articles` table with local images; links to `/learn/[slug]` article pages
- **Article Pages** (`/learn/[slug]/`) — Full article content pages with featured image, author, date, category, share buttons, back-to-learn navigation; generated from learn.tokenomic.org content using `scripts/generate-article-pages.js`; images served from `/assets/images/learn/`
- **Educators** (`/educators/`) — Auto-populated cards of community-approved educators from Supabase profiles (role=educator, approved=true)
- **Consultants** (`/consultants/`) — Auto-populated cards of community-approved consultants with ratings, pricing, and booking links
- **Dashboard** (`/dashboard/`) — Main analytics with stats, recent activity, progress
- **Courses** (`/dashboard-courses/`) — Three views: Manage (CRUD), My Learning (progression), Certifications
- **Revenue** (`/dashboard-revenue/`) — Charts with time filters (1W/1M/3M/YTD/ALL), CSV export, 0xSplits visualization, transaction history with status pills
- **Communities** (`/dashboard-communities/`) — Community cards, token-gated access
- **Events** (`/dashboard-events/`) — Live Luma calendar sync (Calendar ID: `cal-on7sN7ID2LgtAB9`), auto-fetches events via `/api/luma-events` proxy, shows cover images, dates, locations, guest counts, and registration links
- **Bookings** (`/dashboard-bookings/`) — Consultant booking, wallet & Helio payments
- **Chat** (`/dashboard-chat/`) — Channel-based messaging
- **Leaderboard** (`/dashboard-leaderboard/`) — XP rankings, progress tracking, module tracker
- **Articles** (`/dashboard-articles/`) — Content management
- **Social** (`/dashboard-social/`) — Social feed
- **Profile** (`/dashboard-profile/`) — User profile management
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
- Site search (site-search.js) links to local `/learn/[slug]` paths
- 13 articles across Strategy, Technical, and Market categories
- Slug aliases (symlinks) for alternate URL patterns: `arbitrage-practical-guide`, `advanced-options-defi`, `smart-contract-security-basics`

## Important Notes
- Ruby/Jekyll is NOT installed locally — cannot run `jekyll build`
- All visible changes in Replit must be made in `_site/` files directly
- Source files (`_includes/`, `_layouts/`, etc.) are for Jekyll builds (GitHub Pages)
- Dashboard layout exists at `_layouts/dashboard.html` for dashboard source pages
- When editing dashboard pages, update BOTH the `_site/` version (for Replit) and the source `.html` file (for GitHub Pages)
- Footer is included in default layout (`_layouts/default.html`) and dashboard layout
