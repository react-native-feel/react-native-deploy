-- Devices for ad-hoc (internal) iOS builds.
--
-- This table, not the Apple Developer Portal, is the list of devices a build
-- should be provisioned for — the same split EAS makes. A device lands here as
-- `pending` (from the registration QR, `rnd device:create`, or an import), the
-- build workflow registers it with Apple and marks it `registered`, and the
-- ad-hoc profile is regenerated from every `registered` row. `disabled` rows are
-- kept so a removed device keeps its history but drops out of the next profile.
CREATE TABLE devices (
  udid               TEXT PRIMARY KEY,
  name               TEXT NOT NULL,
  product            TEXT,              -- e.g. "iPhone17,3", as the device reports it
  os_version         TEXT,
  device_class       TEXT NOT NULL DEFAULT 'IPHONE',
  status             TEXT NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending', 'registered', 'disabled')),
  source             TEXT NOT NULL
                       CHECK (source IN ('url', 'usb', 'mac', 'manual', 'import')),
  apple_device_id    TEXT,              -- App Store Connect id, once registered
  apple_team_id      TEXT,
  registration_token TEXT,              -- the QR link it came through, if any
  created_at         INTEGER NOT NULL,
  updated_at         INTEGER NOT NULL,
  registered_at      INTEGER
);

-- One row per registration QR. A link stays usable until it expires, so one QR
-- can be shared with a whole team of testers, as with EAS.
CREATE TABLE registration_requests (
  token      TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
