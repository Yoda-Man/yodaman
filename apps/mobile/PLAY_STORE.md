# Google Play Release

YodaMan Mobile uses Expo and EAS for Android builds and Google Play submission.

## How This Maps To Knights

The Knights app is Flutter-native:

- `android/key.properties` points to a release keystore.
- Gradle reads `keyAlias`, `keyPassword`, `storeFile`, and `storePassword`.
- `publish/build_bundle.sh` runs tests, builds a signed `.aab`, archives symbols, and prints upload instructions.

YodaMan Mobile is Expo/React Native:

- EAS manages Android credentials and upload signing.
- `eas.json` defines the production Android App Bundle profile.
- `npm run build:android` creates a Play-ready `.aab`.
- `npm run submit:android` submits to Google Play once Play service account credentials are configured.

## Build

```bash
npm install
npm run build:android
```

EAS will prompt to create or reuse Android credentials. For first release, choose managed credentials unless you already have a YodaMan upload keystore.

## Submit

```bash
npm run submit:android
```

Required before submission:

- Google Play Console app created for package `com.yodaman.mobile`.
- Google Play service account JSON configured in EAS or provided during `eas submit`.
- App content, privacy policy, data safety, and testing track setup completed in Play Console.

The current `eas.json` submits to the `internal` track first. Promote to closed/open/production after testing.

## Machine Linking

The phone cannot connect to `127.0.0.1` on your Mac. Use one of these:

- Same Wi-Fi LAN: create a pairing payload from the desktop runtime, then set the app runtime URL to `http://<mac-lan-ip>:3090`.
- Deep link: use the `yodaman://pair?url=...&token=...` payload from `POST /api/pairing`.
- Remote access: add a secure relay or tunnel in a later release.

