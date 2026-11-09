# YodaMan Website

This is a static product website for the YodaMan ecosystem.

The site tracks the `0.6.4` release and highlights the three-tool pillar (Context Expert, Graphify, OpenSpec), the local runtime, and the desktop, VS Code, mobile, and Holocron VR downloads.

Open locally:

```bash
open website/index.html
```

Deploy by serving the `website/` directory on its own: its pages, stylesheet, and assets are all inside it.

`npm run desktop:dist` builds the desktop app for the current platform and then syncs the release artifacts into `website/downloads/`. To build macOS (arm64), Windows, and Linux (x64) downloads before uploading the website, run:

```bash
npm run desktop:dist:all
```

To refresh the website downloads without rebuilding the desktop app, run:

```bash
npm run website:downloads
```

`website:downloads` copies the desktop builds from `release/`, the VSIX from `extensions/vscode-yodaman/`, and the Holocron VR zip from the sibling `Holocron VR` repository when it exists, then points the download buttons at them. Windows artifacts are copied only on a Windows host, because a cross-built installer is not publishable.

The downloads section links to files in `website/downloads/`, plus the npm, VS Code Marketplace, and GitHub Actions pages. Replace those links with public release URLs after signed packages are uploaded. `website/downloads/`, generated VSIX files, and mobile `.aab`/`.ipa` bundles are ignored by git.
