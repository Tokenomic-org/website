/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: [
    './apps/web/src/**/*.{js,jsx,ts,tsx}',
    './packages/ui/src/**/*.{js,jsx,ts,tsx}',
  ],
  theme: {
    container: { center: true, padding: '1rem' },
    extend: {
      colors: {
        bg: 'rgb(var(--tk-bg) / <alpha-value>)',
        surface: 'rgb(var(--tk-surface) / <alpha-value>)',
        surface2: 'rgb(var(--tk-surface-2) / <alpha-value>)',
        fg: 'rgb(var(--tk-fg) / <alpha-value>)',
        muted: 'rgb(var(--tk-muted) / <alpha-value>)',
        border: 'rgb(var(--tk-border) / <alpha-value>)',
        brand: {
          DEFAULT: 'rgb(var(--tk-brand) / <alpha-value>)',
          fg: 'rgb(var(--tk-brand-fg) / <alpha-value>)',
        },
        accent: 'rgb(var(--tk-accent) / <alpha-value>)',
        success: 'rgb(var(--tk-success) / <alpha-value>)',
        danger: 'rgb(var(--tk-danger) / <alpha-value>)',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        display: ['Inter', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        lg: '12px',
        xl: '16px',
        '2xl': '20px',
      },
      boxShadow: {
        card: '0 1px 2px rgba(0,0,0,0.06), 0 8px 24px rgba(0,0,0,0.06)',
        glow: '0 0 0 4px rgb(var(--tk-brand) / 0.18)',
      },
      keyframes: {
        shimmer: {
          '0%': { backgroundPosition: '-400px 0' },
          '100%': { backgroundPosition: '400px 0' },
        },
        'fade-in': { from: { opacity: 0 }, to: { opacity: 1 } },
      },
      animation: {
        shimmer: 'shimmer 1.4s ease-in-out infinite',
        'fade-in': 'fade-in 240ms ease-out',
      },
    },
  },
  plugins: [],
};
