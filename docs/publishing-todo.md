# YodaMan Publishing Todo

This checklist covers everything needed to publish YodaMan across desktop platforms, mobile app stores, and the VS Code Marketplace.

## Global Release Readiness

- [ ] Choose final product name, publisher name, and support email.
- [ ] Confirm license and third-party notices.
- [ ] Create a public website URL.
- [ ] Create a privacy policy URL.
- [ ] Create terms of use if needed.
- [ ] Prepare screenshots for desktop, VS Code, and mobile.
- [ ] Prepare app icons for all platforms.
- [ ] Decide release versioning across runtime, desktop, extension, and mobile.
- [ ] Create release notes and changelog.
- [ ] Confirm no secrets are committed.
- [ ] Run full checks:

```bash
npm test
npm run build
npm audit
cd extensions/vscode-yodaman && npm run package
cd ../../apps/mobile && EXPO_NO_TELEMETRY=1 npx expo config --type public
```

## Desktop App: macOS

- [ ] Add production app icon in `.icns` format.
- [ ] Decide distribution path:
  - direct download outside App Store
  - Mac App Store
  - both
- [ ] Enroll or confirm Apple Developer Program membership.
- [ ] Create Developer ID Application certificate for direct distribution.
- [ ] Create Mac App Distribution certificate for Mac App Store distribution.
- [ ] Configure `electron-builder` signing identity.
- [ ] Enable hardened runtime for direct distribution.
- [ ] Configure entitlements.
- [ ] Configure notarization credentials.
- [ ] Build signed macOS app:

```bash
npm run desktop:dist
```

- [ ] Notarize and staple the app.
- [ ] Test on a clean macOS machine.
- [ ] Create `.dmg` or `.zip` release artifact.
- [ ] Upload direct-download artifact to website/GitHub Releases.

## Mac App Store

- [ ] Create app record in App Store Connect.
- [ ] Confirm bundle ID.
- [ ] Configure Mac App Store entitlements and sandboxing.
- [ ] Ensure the app satisfies Mac App Store sandbox rules.
- [ ] Configure `electron-builder` `mas` target.
- [ ] Build MAS package.
- [ ] Upload with Transporter or `xcrun altool`/notary tooling.
- [ ] Complete privacy nutrition labels.
- [ ] Submit for review.

## Desktop App: Windows

- [ ] Create Windows app icon in `.ico` format.
- [ ] Decide distribution path:
  - direct `.exe`/installer download
  - Microsoft Store
  - both
- [ ] Obtain code signing certificate.
- [ ] Configure `electron-builder` Windows signing.
- [ ] Add Windows targets in `electron-builder.json`, such as `nsis` and/or `appx`.
- [ ] Build Windows package on Windows or CI:

```bash
npm run desktop:dist
```

- [ ] Test installer on a clean Windows machine.
- [ ] Upload direct-download installer to website/GitHub Releases.

## Microsoft Store

- [ ] Create Partner Center account.
- [ ] Reserve app name.
- [ ] Create Microsoft Store listing.
- [ ] Configure `appx`/MSIX packaging.
- [ ] Provide Store images, screenshots, privacy URL, support URL, and age rating.
- [ ] Build signed Store package.
- [ ] Submit package for certification.

## Desktop App: Linux

- [ ] Decide Linux formats:
  - AppImage
  - `.deb`
  - `.rpm`
  - Snap
  - Flatpak
- [ ] Add Linux icons in required sizes.
- [ ] Configure `electron-builder` Linux targets.
- [ ] Build Linux packages on Linux or CI:

```bash
npm run desktop:dist
```

- [ ] Test on Ubuntu and at least one non-Ubuntu distribution.
- [ ] Publish direct-download artifacts to website/GitHub Releases.

## Snap Store

- [ ] Create Snapcraft account.
- [ ] Configure Snap target.
- [ ] Confirm confinement model.
- [ ] Build and test Snap locally.
- [ ] Publish to Snap Store.

## Flathub

- [ ] Create Flatpak manifest.
- [ ] Validate permissions.
- [ ] Test local Flatpak build.
- [ ] Submit to Flathub repository.

## Mobile App: Android / Google Play

- [ ] Create Google Play Developer account.
- [ ] Create Play Console app for package:

```text
com.yodaman.mobile
```

- [ ] Create privacy policy URL.
- [ ] Complete Data Safety form.
- [ ] Complete content rating.
- [ ] Prepare screenshots, icon, feature graphic, and short/full descriptions.
- [ ] Configure Play App Signing.
- [ ] Configure EAS credentials.
- [ ] Create Google Play service account JSON.
- [ ] Grant service account access in Play Console.
- [ ] Configure EAS Submit with service account.
- [ ] Build Android App Bundle:

```bash
cd apps/mobile
npm run build:android
```

- [ ] Submit to internal testing:

```bash
npm run submit:android
```

- [ ] Test internal release.
- [ ] Promote to closed/open testing.
- [ ] Promote to production.

## Mobile App: iOS / Apple App Store

- [ ] Enroll or confirm Apple Developer Program membership.
- [ ] Create bundle identifier.
- [ ] Configure app record in App Store Connect.
- [ ] Add iOS config to Expo app.
- [ ] Configure EAS iOS credentials.
- [ ] Prepare screenshots, privacy policy, app privacy labels, and support URL.
- [ ] Build iOS app:

```bash
cd apps/mobile
npx eas-cli@latest build --platform ios --profile production
```

- [ ] Submit to TestFlight:

```bash
npx eas-cli@latest submit --platform ios --profile production
```

- [ ] Test with TestFlight.
- [ ] Submit for App Store review.

## VS Code Marketplace

- [ ] Create or confirm Visual Studio Marketplace publisher.
- [ ] Confirm publisher matches `extensions/vscode-yodaman/package.json`.
- [ ] Create Marketplace Personal Access Token.
- [ ] Set `VSCE_PAT`.
- [ ] Confirm extension README, icon, changelog, license, and categories.
- [ ] Package extension:

```bash
cd extensions/vscode-yodaman
npm run package
```

- [ ] Install and test VSIX locally:

```bash
code --install-extension vscode-yodaman-0.1.6.vsix --force
```

- [ ] Publish:

```bash
VSCE_PAT=<token> npm run publish
```

- [ ] Verify Marketplace page and install flow.

## Website Downloads

- [ ] Decide hosting location for release files.
- [ ] Upload desktop installers/packages.
- [ ] Upload VSIX or link to Marketplace.
- [ ] Link Google Play and App Store listings when live.
- [ ] Add checksums for direct downloads.
- [ ] Add version number and release date to downloads section.

## CI/CD

- [ ] Add GitHub Actions or equivalent CI for tests and builds.
- [ ] Add macOS runner for signed/notarized macOS build.
- [ ] Add Windows runner for signed Windows installer.
- [ ] Add Linux runner for AppImage/deb/rpm.
- [ ] Add VS Code extension package job.
- [ ] Add EAS build/submit workflow if using CI tokens.
- [ ] Store credentials only in CI secrets.
