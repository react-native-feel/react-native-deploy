# Telemetry

`rnd` sends anonymous usage stats, so we know which commands and flags people
rely on and which missing EAS commands they reach for. It never sends anything
you typed as a value.

## What is sent

One event per command, to [PostHog](https://posthog.com):

| Field | Example |
| --- | --- |
| Command | `build`, `submit`, `build:list` |
| Flags you passed | `platform: "ios"`, `wait: false`, `profile: true` |
| Whether it failed, and after how long | `command_failed`, `duration_ms: 59` |
| Unsupported commands you tried | `update` |
| Environment | `rnd` version, OS, CPU architecture, Node version, whether it ran in CI |
| A random ID | created on first run in `~/.config/rnd/telemetry.json` |

Flags with a fixed set of values (`--platform ios`) and on/off flags
(`--no-wait`) are sent as they are. Free-text flags are sent only as `true`:
profile names, messages, paths, build IDs, app versions and group names never
leave your machine. Neither does anything from your project, `eas.json`, your
GitHub repository or your credentials.

The ID is random. It isn't derived from your machine, your account or your
email, and it is not linked to a person.

## Opting out

Set either variable, in your shell profile or in CI:

```bash
export DO_NOT_TRACK=1
# or
export RND_TELEMETRY_DISABLED=1
```

With either set, `rnd` makes no telemetry requests at all. Requests that do go
out are capped at 1.5 seconds and never change a command's output or exit code.
