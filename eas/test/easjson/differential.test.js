import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import * as real from '@expo/eas-json';

import { EasJsonAccessor } from '../../src/easjson/accessor.js';
import { EasJsonUtils } from '../../src/easjson/utils.js';
import { INVALID_FIXTURES, RAW_FIXTURES, VALID_FIXTURES } from './fixtures.js';

/**
 * The compatibility test that actually earns the claim.
 *
 * Rather than asserting our resolver produces some shape we decided was right,
 * every fixture is fed to *both* our implementation and the real
 * `@expo/eas-json` off npm, and the two results are compared. If Expo changes
 * the semantics in a future release, `npm update` turns this suite red — which
 * is the only way to keep "drop-in" true over time rather than on the day it
 * was written.
 */

const PLATFORMS = ['ios', 'android'];

function ours(easJson) {
  return EasJsonAccessor.fromRawString(JSON.stringify(easJson));
}

function theirs(easJson) {
  return real.EasJsonAccessor.fromRawString(JSON.stringify(easJson));
}

async function settled(fn) {
  try {
    return { ok: true, value: await fn() };
  } catch (err) {
    return { ok: false, error: err };
  }
}

describe('eas.json — build profile resolution matches @expo/eas-json', () => {
  for (const fixture of VALID_FIXTURES) {
    const profileNames = Object.keys(fixture.easJson.build ?? {});
    // A fixture with no build profiles still exercises the "missing profile"
    // path, which has its own expected error, so ask for one either way.
    const namesToCheck = profileNames.length ? profileNames : [undefined];

    for (const platform of PLATFORMS) {
      for (const profileName of namesToCheck) {
        const label = `${fixture.name} › ${platform} › ${profileName ?? '(default)'}`;
        it(label, async () => {
          const mine = await settled(() =>
            EasJsonUtils.getBuildProfileAsync(ours(fixture.easJson), platform, profileName)
          );
          const expo = await settled(() =>
            real.EasJsonUtils.getBuildProfileAsync(theirs(fixture.easJson), platform, profileName)
          );

          assert.equal(
            mine.ok,
            expo.ok,
            `outcome differs — ours ${mine.ok ? 'resolved' : `threw ${mine.error?.message}`}, ` +
              `expo ${expo.ok ? 'resolved' : `threw ${expo.error?.message}`}`
          );
          if (expo.ok) {
            assert.deepEqual(mine.value, expo.value);
          } else {
            assert.equal(mine.error.constructor.name, expo.error.constructor.name);
          }
        });
      }
    }
  }
});

describe('eas.json — submit profile resolution matches @expo/eas-json', () => {
  for (const fixture of VALID_FIXTURES) {
    const profileNames = Object.keys(fixture.easJson.submit ?? {});
    const namesToCheck = profileNames.length ? profileNames : [undefined];

    for (const platform of PLATFORMS) {
      for (const profileName of namesToCheck) {
        const label = `${fixture.name} › ${platform} › ${profileName ?? '(default)'}`;
        it(label, async () => {
          const mine = await settled(() =>
            EasJsonUtils.getSubmitProfileAsync(ours(fixture.easJson), platform, profileName)
          );
          const expo = await settled(() =>
            real.EasJsonUtils.getSubmitProfileAsync(theirs(fixture.easJson), platform, profileName)
          );

          assert.equal(
            mine.ok,
            expo.ok,
            `outcome differs — ours ${mine.ok ? 'resolved' : `threw ${mine.error?.message}`}, ` +
              `expo ${expo.ok ? 'resolved' : `threw ${expo.error?.message}`}`
          );
          if (expo.ok) {
            assert.deepEqual(mine.value, expo.value);
          }
        });
      }
    }
  }
});

describe('eas.json — invalid documents are rejected the same way', () => {
  for (const fixture of INVALID_FIXTURES) {
    it(fixture.name, async () => {
      const mine = await settled(() => ours(fixture.easJson).readAsync());
      const expo = await settled(() => theirs(fixture.easJson).readAsync());

      assert.equal(expo.ok, false, 'fixture is meant to be invalid but expo accepted it');
      assert.equal(mine.ok, false, `we accepted an eas.json expo rejects: ${fixture.name}`);
      assert.equal(mine.error.constructor.name, expo.error.constructor.name);
    });
  }
});

describe('eas.json — raw text handling matches (JSON5, comments, parse errors)', () => {
  for (const fixture of RAW_FIXTURES) {
    it(fixture.name, async () => {
      const mine = await settled(() => EasJsonAccessor.fromRawString(fixture.raw).readAsync());
      const expo = await settled(() => real.EasJsonAccessor.fromRawString(fixture.raw).readAsync());

      assert.equal(mine.ok, expo.ok);
      assert.equal(expo.ok, fixture.valid);
      if (expo.ok) {
        assert.deepEqual(mine.value, expo.value);
      } else {
        assert.equal(mine.error.constructor.name, expo.error.constructor.name);
      }
    });
  }
});

describe('eas.json — profile listings and cli config match', () => {
  for (const fixture of VALID_FIXTURES) {
    it(fixture.name, async () => {
      for (const [mineFn, expoFn] of [
        [EasJsonUtils.getBuildProfileNamesAsync, real.EasJsonUtils.getBuildProfileNamesAsync],
        [EasJsonUtils.getSubmitProfileNamesAsync, real.EasJsonUtils.getSubmitProfileNamesAsync],
        [EasJsonUtils.getCliConfigAsync, real.EasJsonUtils.getCliConfigAsync],
      ]) {
        const mine = await settled(() => mineFn(ours(fixture.easJson)));
        const expo = await settled(() => expoFn(theirs(fixture.easJson)));
        assert.equal(mine.ok, expo.ok);
        if (expo.ok) {
          assert.deepEqual(mine.value, expo.value);
        }
      }
    });
  }
});

describe('eas.json — deprecation warnings match', () => {
  for (const fixture of VALID_FIXTURES) {
    for (const profileName of Object.keys(fixture.easJson.build ?? {})) {
      it(`${fixture.name} › ${profileName}`, async () => {
        const mine = await settled(() =>
          EasJsonUtils.getBuildProfileDeprecationWarningsAsync(
            ours(fixture.easJson),
            'ios',
            profileName
          )
        );
        const expo = await settled(() =>
          real.EasJsonUtils.getBuildProfileDeprecationWarningsAsync(
            theirs(fixture.easJson),
            'ios',
            profileName
          )
        );
        assert.equal(mine.ok, expo.ok);
        if (expo.ok) {
          assert.deepEqual(mine.value, expo.value);
        }
      });
    }
  }
});

describe('eas.json — default submit profile matches', () => {
  for (const platform of PLATFORMS) {
    it(platform, async () => {
      const { getDefaultProfile } = await import('../../src/easjson/submit-resolver.js');
      assert.deepEqual(getDefaultProfile(platform), real.getDefaultSubmitProfile(platform));
    });
  }
});
