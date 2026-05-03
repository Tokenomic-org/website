/* Google Analytics bootstrap (Phase 7 / strict CSP).
 * Extracted from _includes/google_analytics.html so the inline body
 * disappears from script-src. The async <script src=…> loader stays
 * inline (it's just a <script src> tag, not inline code). */
window.dataLayer = window.dataLayer || [];
function gtag(){ dataLayer.push(arguments); }
window.gtag = gtag;
gtag('js', new Date());
gtag('config', 'G-1MD9B5BB1P');
