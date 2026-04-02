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
- `shared/assets/js/` — Shared JS (wallet, Supabase client, site-search)
- `assets/` — CSS, images, fonts, JS libraries

## Branding
- Primary: `#ff6000` (orange), Dark: `#001f29` (navy), Muted: `#5a8299`
- Font: Default Bootstrap stack
- Logo: `/assets/images/logo.png`

## Pages
- **Homepage** (`/`) — Hero, platform preview, audience targeting, trust, services, training, wallet-gated community CTA
- **Learn** (`/learn/`) — Category-based article hub (Strategy, Technical, DeFi, Governance) with "Meet our authors" section and inline search bar; search filters articles by title, category, excerpt, slug, and author name; articles from Supabase `articles` table, authors link to Educators page; CTA for educators/consultants to write from dashboard
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
Defined in `_data/navigation.yml`: Home, About (Contact), Educators, Consultants, Services, Training, Learn, Pricing
- Learn is a direct link (no dropdown) — the page dynamically loads category-based article sections from Supabase

## Dashboard Source Files
- 11 Jekyll source files at project root: `dashboard.html`, `dashboard-courses.html`, etc.
- Each uses `layout: dashboard` with `permalink` front matter
- Dashboard layout (`_layouts/dashboard.html`) uses `header_5.html` (includes wallet Login/Dashboard buttons)
- Dashboard layout has NO page banner — goes straight from header to content
- Dashboard header has solid dark navy background (`#001f29`) with tighter nav spacing
- Content extracted from pre-built `_site/` pages for GitHub Pages compatibility

## Important Notes
- Ruby/Jekyll is NOT installed locally — cannot run `jekyll build`
- All visible changes in Replit must be made in `_site/` files directly
- Source files (`_includes/`, `_layouts/`, etc.) are for Jekyll builds (GitHub Pages)
- Dashboard layout exists at `_layouts/dashboard.html` for dashboard source pages
- When editing dashboard pages, update BOTH the `_site/` version (for Replit) and the source `.html` file (for GitHub Pages)
