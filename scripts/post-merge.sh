#!/bin/bash
# Post-merge setup. Runs after a task agent's branch is merged into main.
# Must be idempotent and non-interactive.
set -e

echo "[post-merge] installing root npm deps…"
npm install --no-audit --no-fund --silent

# Worker package installs are best-effort: a Worker may not have a package.json yet.
for w in workers/api-worker workers/site-worker workers/web3-worker; do
  if [ -f "$w/package.json" ]; then
    echo "[post-merge] installing deps for $w…"
    (cd "$w" && npm install --no-audit --no-fund --silent) || \
      echo "[post-merge] WARN: $w install failed (non-fatal)"
  fi
done

# Bundler gems for Jekyll (only if Gemfile + bundle are present).
if [ -f Gemfile ] && command -v bundle >/dev/null 2>&1; then
  echo "[post-merge] installing Ruby gems…"
  bundle install --quiet || echo "[post-merge] WARN: bundle install failed (non-fatal)"
fi

# Rebuild islands so the static site picks up any new island code.
if [ -f scripts/build-islands.mjs ]; then
  echo "[post-merge] rebuilding island bundles…"
  npm run build:islands --silent 2>/dev/null || \
    node scripts/build-islands.mjs || \
    echo "[post-merge] WARN: island build failed (non-fatal)"
fi

# Rebuild the Jekyll site so /_site reflects the merged source.
if [ -f Gemfile ] && command -v bundle >/dev/null 2>&1; then
  echo "[post-merge] running jekyll build…"
  bundle exec jekyll build --quiet || echo "[post-merge] WARN: jekyll build failed (non-fatal)"
fi

if [ -f scripts/rebuild-dashboard-site.js ]; then
  echo "[post-merge] regenerating dashboard mirrors…"
  node scripts/rebuild-dashboard-site.js || \
    echo "[post-merge] WARN: dashboard mirror rebuild failed (non-fatal)"
fi

echo "[post-merge] done."
