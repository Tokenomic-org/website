/* Tiny external redirect bootstrap so the legacy /admin/observability/
 * spec path doesn't need an inline <script>. The <meta refresh> in the
 * HTML is the primary redirect; this just makes it instant for users
 * with JS enabled. */
window.location.replace('/dashboard/admin/observability/');
