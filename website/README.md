# YodaMan Website

This is a static product website for the YodaMan ecosystem.

The site tracks the `0.4.8` release and highlights the shared runtime, mandatory Ollama-only Graphify graph layer, desktop, VS Code, and mobile publishing paths.

Open locally:

```bash
open website/index.html
```

Deploy by serving the `website/` directory with the repository root available so links to `../public` and `../docs` resolve.

`npm run desktop:dist` automatically syncs the latest macOS desktop downloads into the static site bundle. To build macOS, Windows, and Linux downloads before uploading the website, run:

```bash
npm run desktop:dist:all
```

To refresh the website downloads without rebuilding the desktop app, run:

```bash
npm run website:downloads
```

The downloads section links to files in `website/downloads/` plus publishing checklists. Replace those links with public release URLs after signed packages are uploaded. Generated desktop installers, mobile bundles, and VSIX files are ignored by git.
