import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execSync } from 'node:child_process';

const DISTRIBUTION_TO_PROFILE_TYPE = {
  'app-store': 'IOS_APP_STORE',
  'store': 'IOS_APP_STORE',
  'production': 'IOS_APP_STORE',
  'ad-hoc': 'IOS_AD_HOC',
  'adhoc': 'IOS_AD_HOC',
  'internal': 'IOS_AD_HOC',
  'enterprise': 'IOS_IN_HOUSE',
  'development': 'IOS_APP_DEVELOPMENT',
  'simulator': 'IOS_APP_DEVELOPMENT',
};

export function findExpoProject(dir = process.cwd()) {
  const root = resolve(dir);
  const easPath = join(root, 'eas.json');
  const appJsonPath = join(root, 'app.json');
  const appConfigJs = join(root, 'app.config.js');
  const appConfigTs = join(root, 'app.config.ts');

  const hasEas = existsSync(easPath);
  const hasAppJson = existsSync(appJsonPath);
  const hasAppConfig = existsSync(appConfigJs) || existsSync(appConfigTs);

  if (!hasEas && !hasAppJson && !hasAppConfig) return null;

  return {
    root,
    easPath: hasEas ? easPath : null,
    appJsonPath: hasAppJson ? appJsonPath : null,
    appConfigPath: existsSync(appConfigTs) ? appConfigTs : existsSync(appConfigJs) ? appConfigJs : null,
  };
}

export function readAppConfig(project) {
  if (project.appConfigPath) {
    try {
      const out = execSync('npx --no-install expo config --type public --json', {
        cwd: project.root,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      const parsed = JSON.parse(out);
      return parsed.expo || parsed;
    } catch (err) {
      throw new Error(
        `Failed to evaluate ${project.appConfigPath}. Make sure "expo" is installed in the project. Original: ${err.message}`
      );
    }
  }

  if (project.appJsonPath) {
    const raw = readFileSync(project.appJsonPath, 'utf-8');
    const parsed = JSON.parse(raw);
    return parsed.expo || parsed;
  }

  return null;
}

export function readEasConfig(project) {
  if (!project.easPath) return null;
  const raw = readFileSync(project.easPath, 'utf-8');
  return JSON.parse(raw);
}

function sanitizeScheme(name) {
  if (!name) return null;
  return String(name).replace(/[^a-zA-Z0-9_-]/g, '');
}

function mapEasBuildProfile(easProfile, fallbackScheme) {
  if (!easProfile) return null;

  const ios = easProfile.ios || {};
  const distribution = easProfile.distribution || ios.distribution;

  const profile = {};
  if (easProfile.extends) profile.extends = easProfile.extends;
  if (ios.scheme || fallbackScheme) profile.scheme = ios.scheme || fallbackScheme;
  if (ios.buildConfiguration) profile.buildConfiguration = ios.buildConfiguration;
  if (distribution) {
    profile.distribution = distribution;
    profile.profileType = DISTRIBUTION_TO_PROFILE_TYPE[distribution] || 'IOS_APP_STORE';
  }
  if (easProfile.developmentClient || easProfile.simulator) {
    profile.buildConfiguration = profile.buildConfiguration || 'Debug';
  }
  if (easProfile.env) profile.env = { ...easProfile.env };

  profile.buildType = 'expo';
  return profile;
}

function mapEasSubmitProfile(easProfile) {
  if (!easProfile) return null;
  const ios = easProfile.ios || {};
  const submit = {};
  if (ios.ascAppId) submit.ascAppId = ios.ascAppId;
  if (ios.appleId) submit.appleId = ios.appleId;
  if (ios.groups) submit.testFlightGroups = ios.groups;
  if (ios.ascApiKeyPath || ios.ascApiKeyId || ios.ascApiIssuerId) {
    submit._ascHints = {
      keyId: ios.ascApiKeyId,
      issuerId: ios.ascApiIssuerId,
      privateKeyPath: ios.ascApiKeyPath,
    };
  }
  return submit;
}

export function loadFromExpoProject(dir = process.cwd(), overlay = null) {
  const project = findExpoProject(dir);
  if (!project) return null;

  const appConfig = readAppConfig(project);
  const eas = readEasConfig(project);

  const bundleId =
    appConfig?.ios?.bundleIdentifier ||
    appConfig?.bundleIdentifier ||
    overlay?.signing?.bundleId ||
    null;

  const appName = appConfig?.name || appConfig?.slug || 'App';
  const defaultScheme = sanitizeScheme(appName);

  const config = {
    cli: { version: '1.0.0' },
    aws: overlay?.aws || {
      region: 'us-east-1',
      instanceType: 'mac2.metal',
      keyPairName: 'rn-deploy-key',
      securityGroupName: 'rn-deploy-sg',
      customAmiId: null,
      nodeVersion: '20',
      xcodeVersion: '16',
    },
    asc: overlay?.asc || { source: 'keychain' },
    signing: {
      bundleId,
      profileType: 'IOS_APP_STORE',
      ...(overlay?.signing || {}),
    },
    repo: overlay?.repo || { url: '', branch: 'main' },
    build: {},
    submit: {},
    storage: overlay?.storage || null,
    app: {
      title: appName,
      slug: appConfig?.slug || sanitizeScheme(appName),
      version: appConfig?.version || null,
      buildNumber: appConfig?.ios?.buildNumber || null,
      icon: appConfig?.icon || appConfig?.ios?.icon || null,
    },
    _source: { eas: project.easPath, app: project.appJsonPath || project.appConfigPath },
  };

  // Map EAS build profiles
  const easBuild = eas?.build || {};
  for (const [name, profile] of Object.entries(easBuild)) {
    config.build[name] = mapEasBuildProfile(profile, defaultScheme);
  }

  // Ensure at least a production profile exists
  if (!config.build.production) {
    config.build.production = {
      buildType: 'expo',
      scheme: defaultScheme,
      buildConfiguration: 'Release',
      distribution: 'app-store',
      profileType: 'IOS_APP_STORE',
      env: {},
    };
  }

  // Map EAS submit profiles
  const easSubmit = eas?.submit || {};
  for (const [name, profile] of Object.entries(easSubmit)) {
    config.submit[name] = mapEasSubmitProfile(profile);
  }

  // Deep-merge overlay build/submit profiles (deploy.config.json wins)
  if (overlay?.build) {
    for (const [name, prof] of Object.entries(overlay.build)) {
      config.build[name] = { ...(config.build[name] || {}), ...prof };
    }
  }
  if (overlay?.submit) {
    for (const [name, prof] of Object.entries(overlay.submit)) {
      config.submit[name] = { ...(config.submit[name] || {}), ...prof };
    }
  }

  return config;
}
