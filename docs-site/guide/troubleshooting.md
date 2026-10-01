# Troubleshooting

## The first build on a new repository fails with `(404): Not Found` {#first-build-404}

```
GitHub API POST /repos/<owner>/<repo>/actions/workflows/eas-build.yml/dispatches failed (404): Not Found
```

GitHub doesn't register a workflow that only has `workflow_dispatch` when it arrives in the push
that **creates** the repository. Change any line of `.github/workflows/eas-build.yml` (a comment
is enough), commit and push. `gh workflow list` should then show **EAS Build**.

## "The build was dispatched but no matching run appeared"

The workflow on that branch is older than the CLI and doesn't stamp the dispatch id into its run
name. Copy the current `eas/templates/eas-build.yml` over `.github/workflows/eas-build.yml` and
push.

## iOS: "integrity could not be verified" when installing

The device isn't in the build's provisioning profile. iOS gives no other hint. Check that the
ad-hoc profile in `EAS_IOS_PROFILE_INTERNAL` contains **this** device's UDID (`eas device:list`
shows the model next to each name), then rebuild. A profile change never reaches a build that
was already signed. See [Internal distribution](/guide/internal-distribution#adding-a-device).

## iOS: "… requires a provisioning profile"

The workflow imported no profile, or one for a different bundle id. Run `eas credentials -p ios`.
The runner log shows which profile and bundle id it signs with:

```
Signing com.example.myapp (team ABCDE12345) with profile 291e87c0-…
```

If the bundle id there differs from `ios.bundleIdentifier`, the profile was issued for another
app.

## iOS: `unknown attribute 'MainActor'` or other Swift errors

The project needs a newer Xcode than the runner selected. iOS builds run on `macos-26` (Xcode 26).
A workflow copied from an older template may still say `macos-15`.

## iOS: `'ios/.xcworkspace' does not exist`

Your workflow predates scheme detection. Update it from the template, or set `ios.scheme` on the
profile.

## Android: "Set up Android SDK" fails with `Failed to find package 'tools'`

The workflow uses `android-actions/setup-android@v3`. Update it from the template, which uses `@v4`.

## A build is green but there's no install link

Install publishing only runs for `distribution: "internal"` device builds, and only when the
repository has the `EAS_INSTALL_URL` variable. If the variable is set but the
`EAS_INSTALL_TOKEN` secret isn't, the step logs a warning and skips.

## The development build can't find Metro

- The phone and computer must be on the same network, and the app needs **Local Network**
  permission (Settings → the app).
- Start Metro with `--lan` and check `http://<computer-ip>:8081/status` from the phone's browser.
  It should say `packager-status:running`.
- Across networks, use `npx expo start --dev-client --tunnel`.

## App Store Connect rejects the upload: build number already used

`autoIncrement` isn't applied yet. Bump `ios.buildNumber` in `app.json`, rebuild and resubmit.

## The dashboard says the anonymous limit is used up

GitHub allows 60 unauthenticated API requests an hour per IP. Reconnect with a read-only token.
