# YodaMan Mobile — Privacy Policy

_Last updated: 18 August 2026_

YodaMan Mobile is a companion app for the YodaMan runtime, which you run on your
own computer. This policy describes what the app does with your data.

## The short version

**We do not operate a server, and we do not collect anything.** The app talks
only to the YodaMan runtime at the address you type in yourself. Your code,
questions, and search results travel between your phone and your own computer.
They do not pass through us.

## What the app stores

Held in memory on your device for the duration of a session:

- The runtime URL you enter.
- The pairing token you enter or receive from a `yodaman://pair` link.
- Responses from your runtime — projects, tasks, answers, search results,
  specs, and pending approvals — for as long as they are on screen.

The app has no account system, no analytics, no advertising identifiers, no
crash reporting SDK, and no third-party trackers.

## What the app sends, and where

Every request goes to the runtime URL you configured, and nowhere else. That is
normally a private address on your own local network, such as
`http://192.168.1.20:3090`. Content sent there can include the questions you
type, your search terms, and the identifier of the project you selected —
because answering them requires your runtime to read your indexed code.

If you point the app at a remote address you control, traffic goes to that
address instead. The app never chooses a destination for you.

## Local network access

On iOS, the app asks for Local Network permission. It needs this to reach the
runtime on your own computer. Declining it means the app cannot connect. The
permission is not used for discovery, scanning, or profiling of other devices.

## Data you can delete

Uninstalling the app removes everything it holds. Anything your runtime stored —
sessions, task history, audit logs — lives on your own computer and is managed
there, not by this app.

## Children

The app is a developer tool and is not directed at children under 13.

## Changes

Material changes will be published here and reflected in the "last updated"
date above.

## Contact

Open an issue at https://github.com/Yoda-Man/yodaman/issues
