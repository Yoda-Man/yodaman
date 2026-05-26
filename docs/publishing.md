# Publishing YodaMan Clients

## Core npm Package

The root package publishes the local runtime, backend, web build, CLI entrypoint, public assets, and docs needed by `yodaman`.

Prepare and verify:

```bash
npm test -- --runInBand
npm run build
npm run release:smoke
npm pack --dry-run
```

Publish:

```bash
npm publish
```

The root `.gitignore` excludes desktop, mobile, VS Code, dependency, and generated release artifacts so packaging and commits stay focused on source and release metadata.

## VS Code Extension

The extension lives in `extensions/vscode-yodaman`.

Package:

```bash
cd extensions/vscode-yodaman
npm run package
```

The generated `vscode-yodaman-0.2.1.vsix` file is ignored by git and should be uploaded or attached to releases outside the source tree.

Publish:

```bash
VSCE_PAT=<token> npm run publish
```

Requirements:

- Visual Studio Marketplace publisher matching `publisher` in `package.json`.
- Marketplace personal access token.

Reference: VS Code's official publishing docs describe `vsce` as the packaging and publishing CLI for extensions, and `vsce publish` requires a Marketplace token if you are not already logged in.

## Google Play Android App

The mobile app lives in `apps/mobile`.

Build production Android App Bundle:

```bash
cd apps/mobile
npm run build:android
```

Submit:

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

## Desktop Clients

Desktop builds are produced from the root package with Electron Builder:

```bash
npm run release:smoke
npm run desktop:pack
npm run desktop:dist
```

Generated installers, unpacked apps, and platform packages are ignored by git. Sign and notarize platform artifacts before publishing public downloads.

## Knights Signing Reference

The Knights app is Flutter-native. Its release flow:

- `android/key.properties` stores release signing config.
- `android/app/build.gradle.kts` loads `keyAlias`, `keyPassword`, `storeFile`, and `storePassword`.
- `publish/build_bundle.sh` builds a signed app bundle and debug symbols.

YodaMan Mobile is Expo-managed. The equivalent signing layer is EAS credentials:

- EAS can manage Android credentials remotely.
- Existing keystores can be supplied through EAS local credentials if needed.
- `eas.json` sets Android production output to `app-bundle`.
