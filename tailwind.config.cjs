/**
 * LOAD-BEARING — the exported object IS the contract.
 * Keys here are read by the tool at build time, never imported by JS. An
 * "unused export" report will flag them; removing one silently changes the build.
 * See docs/dead-code.md.
 */
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      // Fonts are self-hosted via Fontsource and bundled into dist/, so these
      // resolve offline and inside the packaged desktop app.
      //
      // The variable builds register as "Inter Variable" / "Outfit Variable" —
      // naming only the static family would silently fall back to a system
      // sans, which is the failure this change exists to remove. The static
      // names are kept next in line for anyone who has them installed, then a
      // deliberate system face rather than a generic default.
      fontFamily: {
        inter: ['Inter Variable', 'Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        outfit: ['Outfit Variable', 'Outfit', 'Avenir Next', 'Futura', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
    },
  },
  plugins: [],
}
