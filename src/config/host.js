import { homedir } from 'node:os';

export const HOST_KINDS = ['aws', 'macincloud', 'github-actions'];

const DEFAULT_MACINCLOUD = {
  port: 22,
  workDir: '~/rn-deploy-work',
};

const DEFAULT_GITHUB_ACTIONS = {
  workflow: 'rn-deploy.yml',
  ref: 'main',
};

// Replace ${VAR} references with process.env values so secrets (passwords,
// key paths) can live in the environment instead of a committed config file.
function interpolateEnv(value) {
  if (typeof value !== 'string') return value;
  return value.replace(/\$\{([A-Z0-9_]+)\}/gi, (match, name) => {
    const v = process.env[name];
    if (v === undefined) {
      throw new Error(`host config references ${match} but env var ${name} is not set`);
    }
    return v;
  });
}

export function normalizeHost(config) {
  if (!config.host) {
    config.host = config.aws ? { kind: 'aws' } : null;
  }
  if (!config.host) return config;

  if (config.host.kind === 'macincloud') {
    config.host = { ...DEFAULT_MACINCLOUD, ...config.host };
    for (const field of ['host', 'user', 'password', 'privateKey', 'workDir']) {
      if (config.host[field] !== undefined) {
        config.host[field] = interpolateEnv(config.host[field]);
      }
    }
    if (config.host.privateKey?.startsWith('~')) {
      config.host.privateKey = config.host.privateKey.replace('~', homedir());
    }
  }

  if (config.host.kind === 'github-actions') {
    config.host = { ...DEFAULT_GITHUB_ACTIONS, ...config.host };
    for (const field of ['repo', 'workflow', 'ref']) {
      if (config.host[field] !== undefined) {
        config.host[field] = interpolateEnv(config.host[field]);
      }
    }
  }

  return config;
}

export function validateHost(host) {
  const errors = [];
  if (!host) return ['Missing required block: host (or legacy aws block)'];
  if (!host.kind) return ['host.kind is required'];
  if (!HOST_KINDS.includes(host.kind)) {
    return [`host.kind must be one of: ${HOST_KINDS.join(', ')} (got "${host.kind}")`];
  }
  if (host.kind === 'macincloud') {
    if (!host.host) errors.push('host.host is required for kind=macincloud');
    if (!host.user) errors.push('host.user is required for kind=macincloud');
    if (!host.password && !host.privateKey) {
      errors.push('host.password or host.privateKey is required for kind=macincloud');
    }
    if (host.port !== undefined && typeof host.port !== 'number') {
      errors.push('host.port must be a number');
    }
  }
  if (host.kind === 'github-actions') {
    if (!host.repo) {
      errors.push('host.repo is required for kind=github-actions (e.g. "owner/name")');
    } else if (!/^[^/\s]+\/[^/\s]+$/.test(host.repo)) {
      errors.push('host.repo must be in "owner/name" form');
    }
    if (!host.workflow) errors.push('host.workflow is required for kind=github-actions');
  }
  return errors;
}
