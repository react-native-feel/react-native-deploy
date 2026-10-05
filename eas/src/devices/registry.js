import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

import { GitHubClient, GitHubError, readAuth } from '../github/api.js';

/**
 * Client for the device registry on the install service (`web/worker`, D1).
 *
 * The registry is where EAS keeps devices on Expo's servers: the list the next
 * ad-hoc profile is generated from. The build workflow reads it with the same
 * URL and token it publishes builds with, so the CLI needs those two values too:
 *
 *   URL    EAS_INSTALL_URL in the environment, else the repo's EAS_INSTALL_URL variable
 *   token  EAS_INSTALL_TOKEN in the environment, else ~/.eas-gh/install.json
 */

const TOKENS_PATH = join(homedir(), '.eas-gh', 'install.json');

export class RegistryError extends Error {
  constructor(message, { status } = {}) {
    super(message);
    this.status = status;
  }
}

/** The install service URL, from the environment or the GitHub repo variable. */
export async function resolveInstallUrl(project) {
  if (process.env.EAS_INSTALL_URL) {
    return process.env.EAS_INSTALL_URL.replace(/\/+$/, '');
  }
  const auth = readAuth();
  if (!auth?.token || !project?.repo) {
    return null;
  }
  try {
    const variable = await new GitHubClient({ token: auth.token, repo: project.repo }).request(
      `/repos/${project.repo}/actions/variables/EAS_INSTALL_URL`
    );
    return variable?.value ? variable.value.replace(/\/+$/, '') : null;
  } catch (err) {
    if (err instanceof GitHubError && err.status === 404) {
      return null;
    }
    throw err;
  }
}

function readTokens() {
  try {
    return existsSync(TOKENS_PATH) ? JSON.parse(readFileSync(TOKENS_PATH, 'utf-8')) : {};
  } catch {
    return {};
  }
}

export function readInstallToken(url) {
  return process.env.EAS_INSTALL_TOKEN ?? readTokens()[url] ?? null;
}

/** Stored per URL, mode 0600, next to the GitHub token and for the same reason. */
export function saveInstallToken(url, token) {
  mkdirSync(dirname(TOKENS_PATH), { recursive: true, mode: 0o700 });
  writeFileSync(TOKENS_PATH, JSON.stringify({ ...readTokens(), [url]: token }, null, 2));
  chmodSync(TOKENS_PATH, 0o600);
}

export class DeviceRegistry {
  constructor({ url, token, fetchImpl = fetch }) {
    this.url = url;
    this.token = token;
    this.fetch = fetchImpl;
  }

  async request(path, { method = 'GET', body } = {}) {
    const response = await this.fetch(`${this.url}/api/devices${path}`, {
      method,
      headers: {
        authorization: `Bearer ${this.token}`,
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await response.text();
    let payload;
    try {
      payload = text ? JSON.parse(text) : {};
    } catch {
      payload = { error: text };
    }
    if (!response.ok) {
      const hint =
        response.status === 401
          ? ' The install token was rejected: it must match the UPLOAD_TOKEN secret of the install service.'
          : response.status === 503
            ? ' Deploy the install service with its D1 database bound (see the internal distribution guide).'
            : '';
      throw new RegistryError(`Device registry ${method} ${path || '/'} failed (${response.status}): ${payload.error ?? text}.${hint}`, {
        status: response.status,
      });
    }
    return payload;
  }

  async list({ status } = {}) {
    const { devices } = await this.request(status ? `?status=${encodeURIComponent(status)}` : '');
    return devices;
  }

  async get(udid) {
    try {
      return (await this.request(`/${encodeURIComponent(udid)}`)).device;
    } catch (err) {
      if (err instanceof RegistryError && err.status === 404) return null;
      throw err;
    }
  }

  async add(device) {
    return (await this.request('', { method: 'POST', body: device })).device;
  }

  async update(udid, patch) {
    return (await this.request(`/${encodeURIComponent(udid)}`, { method: 'PATCH', body: patch })).device;
  }

  async remove(udid) {
    return (await this.request(`/${encodeURIComponent(udid)}`, { method: 'DELETE' })).device;
  }

  /** A registration link: { token, url, expiresAt }. */
  async createRegistrationRequest() {
    return this.request('/requests', { method: 'POST' });
  }
}

/**
 * Parses `xcrun devicectl list devices --json-output` into devices that can be
 * registered: physical iPhones, iPads and Vision Pros, with the model name
 * ("iPhone 16") that tells two devices called "Iphone roro" apart.
 */
export function parseDevicectlDevices(json) {
  const devices = json?.result?.devices ?? [];
  return devices
    .map((d) => {
      const hw = d.hardwareProperties ?? {};
      return {
        udid: hw.udid,
        name: d.deviceProperties?.name ?? hw.marketingName ?? 'iOS device',
        product: hw.productType ?? null,
        model: hw.marketingName ?? null,
        platform: hw.platform,
        physical: hw.reality === 'physical',
      };
    })
    .filter((d) => d.udid && d.physical && ['iOS', 'iPadOS', 'visionOS'].includes(d.platform));
}

/** The provisioning UDID of this Mac, from `system_profiler -json SPHardwareDataType`. */
export function parseMacHardware(json) {
  const hw = json?.SPHardwareDataType?.[0] ?? {};
  if (!hw.provisioning_UDID) return null;
  return { udid: hw.provisioning_UDID, name: hw.machine_name ?? 'Mac', product: hw.machine_model ?? null };
}
