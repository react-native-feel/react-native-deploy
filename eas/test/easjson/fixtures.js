/**
 * The corpus both implementations get run against.
 *
 * These are not invented shapes — each one is either a profile layout EAS's own
 * docs recommend, one `eas build:configure` generates, or an edge case the
 * resolver source explicitly handles (cycles, platform overrides, JSON5).
 */

export const VALID_FIXTURES = [
  {
    name: 'empty object',
    easJson: {},
  },
  {
    name: 'eas build:configure default output',
    easJson: {
      cli: { version: '>= 5.2.0' },
      build: {
        development: {
          developmentClient: true,
          distribution: 'internal',
        },
        preview: {
          distribution: 'internal',
        },
        production: {},
      },
      submit: {
        production: {},
      },
    },
  },
  {
    name: 'development / preview / production with platform blocks',
    easJson: {
      cli: { version: '>= 12.0.0', appVersionSource: 'remote', requireCommit: true },
      build: {
        base: {
          node: '20.18.0',
          env: { SHARED: 'yes', OVERRIDE_ME: 'base' },
          ios: { resourceClass: 'm-medium' },
          android: { image: 'latest' },
        },
        development: {
          extends: 'base',
          developmentClient: true,
          distribution: 'internal',
          channel: 'development',
          env: { OVERRIDE_ME: 'development', APP_VARIANT: 'development' },
          ios: { simulator: true, buildConfiguration: 'Debug' },
          android: { buildType: 'apk', gradleCommand: ':app:assembleDebug' },
        },
        preview: {
          extends: 'development',
          developmentClient: false,
          channel: 'preview',
          env: { APP_VARIANT: 'preview' },
          ios: { simulator: false },
        },
        production: {
          extends: 'base',
          channel: 'production',
          autoIncrement: true,
          env: { APP_VARIANT: 'production' },
          ios: { autoIncrement: 'buildNumber', scheme: 'MyApp' },
          android: { buildType: 'app-bundle', autoIncrement: 'versionCode' },
        },
      },
      submit: {
        production: {
          ios: {
            appleId: 'dev@example.com',
            ascAppId: '1234567891',
            appleTeamId: 'AB32CZE81F',
            groups: ['Internal Testers', 'QA'],
          },
          android: {
            serviceAccountKeyPath: './google-service-account.json',
            track: 'internal',
            releaseStatus: 'draft',
          },
        },
        preview: {
          extends: 'production',
          ios: { groups: ['Preview'] },
          android: { track: 'alpha' },
        },
      },
    },
  },
  {
    name: 'platform block overrides a top-level key',
    easJson: {
      build: {
        production: {
          distribution: 'store',
          credentialsSource: 'remote',
          ios: { distribution: 'internal', credentialsSource: 'local' },
        },
      },
    },
  },
  {
    name: 'three-deep extends chain',
    easJson: {
      build: {
        a: { env: { A: '1' }, node: '18.0.0' },
        b: { extends: 'a', env: { B: '2' } },
        c: { extends: 'b', env: { C: '3' } },
        d: { extends: 'c', env: { A: 'overridden' } },
      },
    },
  },
  {
    name: 'cache with paths and a key',
    easJson: {
      build: {
        production: {
          cache: { key: 'v1', paths: ['node_modules', 'ios/Pods'] },
        },
      },
    },
  },
  {
    name: 'cache.customPaths is renamed to cache.paths',
    easJson: {
      build: {
        production: {
          cache: { customPaths: ['node_modules'] },
        },
      },
    },
  },
  {
    name: 'withoutCredentials and simulator build',
    easJson: {
      build: {
        simulator: {
          distribution: 'internal',
          ios: { simulator: true, withoutCredentials: true },
        },
      },
    },
  },
  {
    name: 'android rollout with inProgress release status',
    easJson: {
      submit: {
        production: {
          android: {
            track: 'production',
            releaseStatus: 'inProgress',
            rollout: 0.25,
          },
        },
      },
    },
  },
  {
    name: 'buildArtifactPaths and applicationArchivePath',
    easJson: {
      build: {
        production: {
          buildArtifactPaths: ['ios/build/**/*.xcresult'],
          ios: { applicationArchivePath: 'ios/build/MyApp.ipa' },
          android: { applicationArchivePath: 'android/app/build/outputs/**/*.aab' },
        },
      },
    },
  },
  {
    name: 'environment and resourceClass',
    easJson: {
      build: {
        production: {
          environment: 'production',
          resourceClass: 'large',
          ios: { resourceClass: 'm-large' },
        },
      },
    },
  },
  {
    name: 'package manager version pins',
    easJson: {
      build: {
        production: {
          node: '20.18.0',
          yarn: '1.22.22',
          pnpm: '9.12.0',
          bun: '1.1.29',
          corepack: true,
          ios: { cocoapods: '1.15.2', fastlane: '2.222.0', bundler: '2.5.0' },
          android: { ndk: '26.1.0' },
        },
      },
    },
  },
  {
    name: 'enterprise provisioning',
    easJson: {
      build: {
        adhoc: {
          distribution: 'internal',
          ios: { enterpriseProvisioning: 'adhoc' },
        },
        universal: {
          distribution: 'internal',
          ios: { enterpriseProvisioning: 'universal' },
        },
      },
    },
  },
  {
    name: 'prebuildCommand, config and uploadSourceMaps',
    easJson: {
      build: {
        production: {
          prebuildCommand: 'expo prebuild --clean',
          config: 'production.yml',
          uploadSourceMaps: true,
        },
      },
    },
  },
  {
    // Joi resolves the `when('credentialsSource')` reference against the object
    // it sits in, so `keystoreName` only validates when credentialsSource is set
    // alongside it inside the `android` block — inheriting it from the profile
    // root is not enough. Both rejections are covered in INVALID_FIXTURES.
    name: 'keystoreName with credentialsSource in the same android block',
    easJson: {
      build: {
        production: {
          android: { credentialsSource: 'remote', keystoreName: 'upload-keystore' },
        },
      },
    },
  },
  {
    name: 'releaseChannel (classic updates)',
    easJson: {
      build: {
        production: { releaseChannel: 'prod-1.0' },
      },
    },
  },
  {
    name: 'submit profile with $VAR indirection',
    easJson: {
      submit: {
        production: {
          ios: {
            ascApiKeyPath: '$ASC_API_KEY_PATH',
            ascApiKeyId: '$ASC_API_KEY_ID',
            ascApiKeyIssuerId: '$ASC_API_KEY_ISSUER_ID',
          },
          android: {
            serviceAccountKeyPath: '$GOOGLE_SERVICE_ACCOUNT_KEY_PATH',
          },
        },
      },
    },
  },
  {
    name: 'submit profile with metadata and full App Store details',
    easJson: {
      submit: {
        production: {
          ios: {
            appleId: 'dev@example.com',
            ascAppId: '1234567891',
            appleTeamId: 'AB32CZE81F',
            sku: 'my-app-sku',
            language: 'en-GB',
            companyName: 'Example Inc',
            appName: 'My App',
            bundleIdentifier: 'com.example.myapp',
            metadataPath: './store.config.json',
          },
        },
      },
    },
  },
];

/**
 * Inputs that must be rejected. We assert both implementations reject — matching
 * the exact Joi message text is checked separately, since a version skew between
 * our pinned Joi and theirs could legitimately reword it.
 */
export const INVALID_FIXTURES = [
  {
    name: 'unknown top-level key',
    easJson: { buidl: {} },
  },
  {
    name: 'unknown key inside a build profile',
    easJson: { build: { production: { distribtuion: 'store' } } },
  },
  {
    name: 'invalid distribution value',
    easJson: { build: { production: { distribution: 'testflight' } } },
  },
  {
    name: 'invalid credentialsSource',
    easJson: { build: { production: { credentialsSource: 'cloud' } } },
  },
  {
    name: 'ios resourceClass used on android',
    easJson: { build: { production: { android: { resourceClass: 'm-medium' } } } },
  },
  {
    name: 'non-semver node version',
    easJson: { build: { production: { node: 'lts' } } },
  },
  {
    name: 'both artifactPath and applicationArchivePath',
    easJson: {
      build: { production: { ios: { artifactPath: 'a', applicationArchivePath: 'b' } } },
    },
  },
  {
    name: 'both cache.paths and cache.customPaths',
    easJson: {
      build: { production: { cache: { paths: ['a'], customPaths: ['b'] } } },
    },
  },
  {
    name: 'channel with an illegal character',
    easJson: { build: { production: { channel: 'Production!' } } },
  },
  {
    name: 'environment name with uppercase',
    easJson: { build: { production: { environment: 'Production' } } },
  },
  {
    name: 'environment name too short',
    easJson: { build: { production: { environment: 'p' } } },
  },
  {
    name: 'android buildType given an ios value',
    easJson: { build: { production: { android: { buildType: 'ipa' } } } },
  },
  {
    name: 'ios autoIncrement given the android value',
    easJson: { build: { production: { ios: { autoIncrement: 'versionCode' } } } },
  },
  {
    name: 'android autoIncrement given the ios value',
    easJson: { build: { production: { android: { autoIncrement: 'buildNumber' } } } },
  },
  {
    name: 'keystoreName with local credentials',
    easJson: {
      build: {
        production: { android: { credentialsSource: 'local', keystoreName: 'upload' } },
      },
    },
  },
  {
    // credentialsSource at the profile root does not reach into the android block
    name: 'keystoreName relying on an inherited credentialsSource',
    easJson: {
      build: {
        production: { credentialsSource: 'remote', android: { keystoreName: 'upload' } },
      },
    },
  },
  {
    // ...nor does the schema default satisfy it
    name: 'keystoreName relying on the credentialsSource default',
    easJson: {
      build: { production: { android: { keystoreName: 'upload' } } },
    },
  },
  {
    name: 'rollout without inProgress release status',
    easJson: {
      submit: { production: { android: { track: 'production', rollout: 0.5 } } },
    },
  },
  {
    name: 'rollout above 1',
    easJson: {
      submit: {
        production: {
          android: { releaseStatus: 'inProgress', rollout: 5 },
        },
      },
    },
  },
  {
    name: 'invalid android releaseStatus',
    easJson: {
      submit: { production: { android: { releaseStatus: 'published' } } },
    },
  },
  {
    name: 'unknown key inside a submit profile',
    easJson: { submit: { production: { ios: { appleID: 'dev@example.com' } } } },
  },
  {
    name: 'invalid appVersionSource',
    easJson: { cli: { appVersionSource: 'git' } },
  },
  {
    name: 'cache key over 128 characters',
    easJson: { build: { production: { cache: { key: 'x'.repeat(129) } } } },
  },
  {
    name: 'env value that is not a string',
    easJson: { build: { production: { env: { PORT: 8081 } } } },
  },
];

/** Raw-text fixtures — these exercise the JSON5 path and the parse errors. */
export const RAW_FIXTURES = [
  {
    name: 'plain JSON',
    raw: '{"build":{"production":{"distribution":"store"}}}',
    valid: true,
  },
  {
    name: 'JSON5 with line comments',
    raw: `{
      // the profile CI uses
      "build": {
        "production": {
          "distribution": "store", // ships to the App Store
        },
      },
    }`,
    valid: true,
  },
  {
    name: 'JSON5 with block comments and trailing commas',
    raw: `{
      /* generated by eas build:configure */
      "cli": { "version": ">= 5.2.0", },
      "build": {
        "development": { "developmentClient": true, "distribution": "internal", },
      },
    }`,
    valid: true,
  },
  {
    name: 'empty file',
    raw: '   \n  ',
    valid: false,
  },
  {
    name: 'truncated object',
    raw: '{"build": {',
    valid: false,
  },
];
