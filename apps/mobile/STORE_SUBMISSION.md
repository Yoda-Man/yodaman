# Store Submission — YodaMan Mobile

One Expo codebase ships to both stores. `npm run build:all` builds them together.

## What is ready

- App icon, Android adaptive icon, and splash — generated from the desktop app
  icon into `assets/`. The store icon has no alpha channel, which Apple rejects.
- iOS bundle identifier `africa.criticalpath.yodaman.mobile` and Android package
  `com.yodaman.mobile`.
- `NSLocalNetworkUsageDescription` — without it, iOS 14+ silently blocks the LAN
  connection the whole app depends on.
- App Transport Security scoped to `NSAllowsLocalNetworking` instead of Expo's
  default `NSAllowsArbitraryLoads`, which invites an App Review challenge.
- EAS build and submit profiles for both platforms.
- `PRIVACY.md` — both stores require a reachable privacy policy URL.

## What still needs a human

These need account access and cannot be scripted from here.

1. **Link the EAS project.** `app.json` has no `extra.eas.projectId` and no
   `owner`, because both are issued by Expo. Run `eas init` while logged in.
2. **Host the privacy policy.** Publish `PRIVACY.md` at a public URL and paste
   that URL into both consoles. A page under the existing website works.
3. **Create the store listings.** Apple App Store Connect for the bundle ID,
   Google Play Console for the package name. Both need screenshots, a
   description, and a category.
4. **Confirm the export-compliance answer.** `ITSAppUsesNonExemptEncryption` is
   set to `false` in `app.json`, which is the usual answer for an app that only
   uses standard networking. Confirm it matches your legal position before the
   first submission.
5. **Complete Google Play Data safety.** Declare that the app transmits the
   user's questions and search terms to a server the user nominates, and that
   nothing is collected by the developer.

## Apple review will fail without a reachable runtime

This is the one likely rejection, and it is not a configuration problem.

App Review runs the app on a device in Cupertino. There is no YodaMan runtime on
their network, so every button returns a connection error and the reviewer sees
an app that appears broken. That draws a Guideline 2.1 rejection, and an app
that does nothing on its own is also exposed to Guideline 4.2.

Pick one before submitting to Apple:

- **Expose a demo runtime** on a public HTTPS address, seeded with a sample
  workspace, and put the URL and pairing token in App Review notes.
- **Ship a demo mode** that renders representative data with no runtime, so the
  reviewer can see the app work.

Either way, the review notes should explain that this is a companion app for
software the user runs on their own computer.

Google Play is far more tolerant of a companion app that needs a server, and
`eas.json` already submits to the `internal` track first, so the same problem is
much smaller there.

## Build and submit

```bash
npm run build:android    # Play-ready .aab
npm run build:ios        # App Store-ready .ipa
npm run build:all        # both

npm run submit:android   # to the internal track
npm run submit:ios       # to App Store Connect
```

`production` sets `autoIncrement`, so build numbers rise without editing
`app.json`. The marketing version is `expo.version`; bump it there.

## Known gap: typefaces

The desktop self-hosts Inter, Outfit, and JetBrains Mono through Fontsource,
which ships `woff2` only — a format React Native cannot load. The app therefore
uses the system UI face for body text and the platform monospace for the
readout labels. To close this, vendor the TTFs and load them with `expo-font`,
which is already an installed dependency.
