# Site-worker CSP rollout — drop `unsafe-inline` + `unsafe-eval`

## Current state (after this task)

`workers/site-worker/index.js` ships **two** CSP headers on every static asset
response:

1. `Content-Security-Policy` — `STRICT_CSP` (enforced).
2. `Content-Security-Policy-Report-Only` — `REPORT_ONLY_CSP` (when
   `CSP_REPORT_URL` is set in the worker env).

`STRICT_CSP` was already free of `'unsafe-eval'` and free of `'unsafe-inline'`
in `script-src`. The only remaining inline executable script (the pre-paint
dark-mode IIFE in `_includes/island-bootstrap.html`) has been moved to
`/shared/assets/js/island-theme-prepaint.js` and is loaded synchronously in
`<head>`. The corresponding `'sha256-…'` allowance has been **removed** from
`script-src`.

`style-src` still permits `'unsafe-inline'` because dozens of legacy
Bootstrap-4 templates carry inline `style="…"` attributes. The Report-Only
header omits `'unsafe-inline'` from `style-src` so we collect violation reports
*before* tightening the enforced header.

## Rollout phases

| Phase | Header(s) on response | Trigger |
| ----- | --------------------- | ------- |
| 0 — current | enforced `STRICT_CSP` (script-src tight, style-src `unsafe-inline`) **+** Report-Only `REPORT_ONLY_CSP` (no `unsafe-inline` anywhere) | now |
| 1 — observe | unchanged for ≥ 7 days; review reports collected at `CSP_REPORT_URL` | manual |
| 2 — fix templates | replace each reported `style="…"` with a class in `assets/css/style.css` (or a Tailwind utility for island pages) | per-PR |
| 3 — promote | swap enforced `STRICT_CSP` for `REPORT_ONLY_CSP` body; delete the Report-Only header | one-line code change in `workers/site-worker/index.js` |

## What `'unsafe-eval'` would re-introduce, and how to avoid it

Some legacy plugins (Owl Carousel via `new Function(…)`, Lottie animation JSON
parsed with `eval`) might tempt a developer to add `'unsafe-eval'` back. Don't.
Use `'wasm-unsafe-eval'` (already in the api-worker CSP) for the viem BigInt
polyfill, and replace any `new Function(…)` call site with a static dispatch
table.

## Re-generating the inline-script hash

There is no inline script left, so the `'sha256-…'` allowance has been deleted
from `STRICT_CSP`. If a future page needs an inline `<script>` again:

```bash
# write the *exact* script body (no wrapping <script> tag, no extra whitespace)
# to a temp file, then:
shasum -a 256 < snippet.js | xxd -r -p | base64
```

Add the resulting hash to `script-src` in `workers/site-worker/index.js`, and
write a comment block above it explaining what the snippet does and why it
cannot be moved to an external file.
