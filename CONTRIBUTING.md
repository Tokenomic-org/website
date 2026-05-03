# Contributing to Tokenomic

Thanks for your interest. This repo powers [tokenomic.org](https://tokenomic.org)
and the on-chain primitives behind it. Read this once before opening a PR.

## Local setup

```bash
# Ruby gems (Jekyll)
bundle install
# Node deps (root + each Worker)
npm install
(cd workers/api-worker  && npm install)
(cd workers/site-worker && npm install)
(cd workers/web3-worker && npm install)
# Build islands + Jekyll
npm run build:islands
bundle exec jekyll build
# Run the local Express dev shim
node server.js
```

The Express shim (`server.js`) only exists for the Replit preview pane.
Production traffic is served by `workers/site-worker` (Jekyll output) and
`workers/api-worker` (Hono API). Always check both paths when changing
runtime code.

## Dual-file architecture

**Visible changes in the Replit preview must land in `_site/` AND in the
matching source file.** Source files live in `assets/`, `shared/`,
`_includes/`, `_layouts/`, `dashboard/`, and the page roots. After
editing source, run:

```bash
node scripts/rebuild-dashboard-site.js   # regenerates _site/ mirrors
bundle exec jekyll build                  # full Jekyll rebuild
```

Forgetting one of the two will produce a working dev preview but a
broken production deploy (or vice versa). Reviewers will catch it, but
it's faster to do both up front.

## Branch and commit conventions

- Branch off `main`. Use `feature/`, `fix/`, `chore/`, or `phaseN/` prefixes.
- One logical change per commit; squash before merge.
- Commit subject ≤ 72 chars, imperative mood (`add`, `fix`, `refactor`).
- Body wraps at 80 cols and explains *why*, not *what*.

## Worker code

- All routes that mutate state require `requireAuth()` or
  `requireRole('admin' | 'educator' | 'consultant')` from `auth.js`.
- Read from `c.env.X` — never `process.env`. Workers don't have one.
- Document every new env var or secret in `workers/api-worker/SECRETS.md`.
- Add `wrangler secret put NAME` instructions for both production and
  staging environments.
- Per-IP rate-limit any new POST endpoint via the existing `rateLimit()`
  helper in `workers/api-worker/index.js`.

## Frontend / islands

- New islands live under `apps/web/src/islands/`. Register the name in
  `scripts/build-islands.mjs`.
- Use `cn()` from `packages/ui` for class composition; never concatenate
  Tailwind classes by hand.
- All user-supplied HTML must go through `window.TKNSanitize.html()` —
  never call `el.innerHTML = userString` directly.
- All user-facing strings must go through `window.TKNI18n.t('key',
  fallback)` and have an entry in `shared/assets/i18n/en.json` (the
  source of truth) plus the `tr.json` and `es.json` catalogs.

## Accessibility

- Every interactive element needs a visible focus ring (`:focus-visible`).
- Images: `alt=""` for decorative, descriptive `alt` otherwise.
- Dialogs (wallet modal, booking widget): `role="dialog"`,
  `aria-modal="true"`, focus trap on open, ESC closes, focus restored on
  close.
- Run axe-core (`npx @axe-core/cli http://localhost:5000/<page>`) before
  shipping any new island. Zero serious / critical violations is the bar.

## Smart contracts

- All Phase 1 contracts live under `contracts/` with Hardhat tests in
  `test/`. Run `npx hardhat test` and `npx hardhat coverage`. We hold
  100 % line coverage on the Phase 1 suite — don't ship a contract
  change that drops it.
- Mainnet deploys are gated by `CONFIRM_MAINNET=1`. Don't bypass.
- New ABIs land in `packages/abi/`; deploy records in `deployments/`.

## Security

- Never commit secrets. The audit script (`workers/api-worker/SECRETS.md`)
  lists every required name and the matching `wrangler secret put`
  command. If you need a new secret, add it there first.
- Disclose vulnerabilities privately — see [SECURITY.md](./SECURITY.md).

## Testing checklist before opening a PR

- [ ] `bundle exec jekyll build` succeeds with no warnings.
- [ ] `npm run build:islands` succeeds.
- [ ] `npx hardhat test` passes (if contracts changed).
- [ ] Manual smoke test on `/courses/`, `/communities/`, `/experts/`,
      `/articles/`, and any page you touched.
- [ ] `replit.md` updated if you changed architecture.
