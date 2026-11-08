# Publishing YodaMan Clients

## Core npm Package

The root package publishes the local runtime and CLI: `bin`, `dist` (the web build), `backend`, `shared`, `plugins` (minus its local `config.json`), `server.js`, `start.js`, `public`, `README.md`, `user_manual.md`, and `config.example.json` (the `files` list in `package.json`). Node.js 24 or newer is required (`engines`).

Release work happens on the `dev` branch; the maintainer merges into `main` after a stable release.

Move every version reference in one step, then add the new `CHANGELOG.md` entry by hand (the script deliberately leaves the changelog and the Homebrew formula alone):

```bash
npm run version:bump -- <new-version>
```

Verify. `release:verify` is the gate: ship only when it exits 0. It chains `version:check`, `build`, `lint`, `test`, `test:coverage`, `audit:prod`, `audit:vendored`, `release:smoke`, `test:journeys`, `test:plugins`, `test:approval`, and `test:packaged`.

```bash
npm run release:verify
npm pack --dry-run
```

Publish:

```bash
npm publish
```

### Homebrew

The formula lives in `packaging/homebrew/yodaman.rb`. Its `url` and `sha256` are derived from the tarball actually published to npm, so regenerate it only after `npm publish`:

```bash
node scripts/brew-formula.js            # rewrite url and sha256
node scripts/brew-formula.js --check    # verify without writing
```

Then copy the updated formula into the separate `homebrew-yodaman` tap repository.

The root `.gitignore` excludes desktop, mobile, VS Code, dependency, and generated release artifacts so packaging and commits stay focused on source and release metadata.

## VS Code Extension

The extension lives in `extensions/vscode-yodaman`.

Package:

```bash
cd extensions/vscode-yodaman
npm run package
```

`npm run package` runs `vsce package --no-dependencies`. The generated `vscode-yodaman-<version>.vsix` file is ignored by git; `npm run website:downloads` (from the repository root) copies it into `website/downloads/` alongside the desktop artifacts.

Publish:

```bash
VSCE_PAT=<token> npm run publish
```

Requirements:

- Visual Studio Marketplace publisher matching `publisher` in `extensions/vscode-yodaman/package.json` (`yodaman`).
- Marketplace personal access token.

Reference: VS Code's official publishing docs describe `vsce` as the packaging and publishing CLI for extensions, and `vsce publish` requires a Marketplace token if you are not already logged in.

## Google Play Android App

The mobile app lives in `apps/mobile`.

Build production Android App Bundle:

```bash
cd apps/mobile
npm run build:android
```

Submit (the EAS `production` submit profile uploads to the Play `internal` track):

```bash
npm run submit:android
```

Requirements:

- Google Play Developer account.
- Play Console app created for package `com.yodaman.mobile`.
- First upload completed manually if required by Google Play API limitations.
- Google service account key configured in EAS.
- EAS/Expo login.
- Privacy policy, Data Safety, content rating, store listing, and release track configured.

Reference: Expo's official EAS Submit docs require a Google service account key for Android submissions. Google Play's official App Signing docs describe upload keys as the keys used to sign app bundles before upload, while Google manages app signing keys through Play App Signing.

## Apple App Store iOS App

The same Expo codebase ships to iOS as bundle identifier `com.yodaman.mobile`:

```bash
cd apps/mobile
npm run build:ios
npm run submit:ios
```

`npm run build:all` builds both platforms together. The account-side steps (EAS project link, store listings, hosted privacy policy) are listed in `apps/mobile/STORE_SUBMISSION.md`.

## Desktop Clients

Desktop builds are produced from the root package with Electron Builder (`electron-builder.json`), into `release/`:

```bash
npm run desktop:pack       # unpacked app directory only
npm run desktop:dist       # host platform: dmg/zip (macOS), nsis/zip (Windows), AppImage/zip (Linux)
npm run desktop:dist:all   # macOS arm64, then Windows and Linux x64
```

Both `dist` scripts build the web app, run `test:render` before packaging and `test:packaged` against the packaged app, and finish with `npm run website:downloads`, which copies the current version's artifacts into `website/downloads/`. A Windows installer cross-built on macOS or Linux is not publishable (electron-builder needs Wine for NSIS), so `website:downloads` skips Windows artifacts off a Windows host; build them on a native runner with `.github/workflows/release.yml` (manual dispatch or a `v*` tag).

Generated installers, unpacked apps, and platform packages are ignored by git. Sign and notarize platform artifacts before publishing public downloads.

## Android Signing

YodaMan Mobile is Expo-managed, so the signing layer is EAS credentials:

- EAS can manage Android credentials remotely.
- Existing keystores can be supplied through EAS local credentials if needed.
- `eas.json` sets Android production output to `app-bundle`.
