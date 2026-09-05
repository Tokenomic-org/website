module.exports = {
  plugins: {
    // Inlines the `@import '.../assets/css/tokens.css'` at the top of
    // apps/web/src/styles/tailwind.css. Listed explicitly rather than
    // relying on the Tailwind CLI's implicit copy: once a
    // postcss.config.js exists the CLI uses it verbatim, so an unlisted
    // postcss-import would leave a bare @import in the built CSS
    // pointing at a path that does not exist under assets/islands/dist/.
    'postcss-import': {},
    tailwindcss: {},
    autoprefixer: {},
  },
};
