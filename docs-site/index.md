---
layout: home

hero:
  name: React Native Deploy
  text: EAS Build and Submit, on your own GitHub Actions
  tagline: The same rnd commands and the same eas.json. Builds run on GitHub-hosted runners, store delivery goes through asc, and there is no Expo account or per-build fee.
  actions:
    - theme: brand
      text: Get started
      link: /guide/getting-started
    - theme: alt
      text: Command reference
      link: /reference/commands
    - theme: alt
      text: How it works
      link: /guide/how-it-works

features:
  - title: Your eas.json, unchanged
    details: Every eas.json is resolved by a port of @expo/eas-json and checked against the real package in a differential test suite — extends chains, platform overrides, $VAR indirection and schema defaults included.
  - title: A build is a workflow run
    details: rnd build dispatches a GitHub Actions workflow in your repo. Status, logs, timings and artifacts are the run's own; nothing sits in between.
  - title: Install on a phone from a QR code
    details: Internal builds are published to a small Cloudflare Worker that serves an install page — itms-services on iOS, a direct APK on Android — so testers scan and install.
  - title: Ship to TestFlight
    details: rnd submit uploads with the asc CLI using your App Store Connect API key, waits for processing and adds the build to your TestFlight groups.
  - title: Development builds with hot reload
    details: Dev-client builds for the simulator or for registered devices, loading JavaScript live from Metro on your machine.
  - title: A dashboard that agrees with the CLI
    details: The web dashboard and rnd build:list --json use the same mapper from workflow runs to EAS build records, so they can never disagree about a build.
---
