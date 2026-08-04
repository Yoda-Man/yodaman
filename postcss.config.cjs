/**
 * LOAD-BEARING — the exported object IS the contract.
 * Keys here are read by the tool at build time, never imported by JS. An
 * "unused export" report will flag them; removing one silently changes the build.
 * See docs/dead-code.md.
 */
module.exports = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
}
