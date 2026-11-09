import { execFile } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { promisify } from 'node:util';

import chalk from 'chalk';

import {
  DeviceRegistry,
  parseDevicectlDevices,
  parseMacHardware,
  readInstallToken,
  resolveInstallUrl,
  saveInstallToken,
} from '../devices/registry.js';
import { runAsc } from '../submit/asc.js';
import { Log, die, link, printJson, setJsonMode } from '../utils/logger.js';
import { loadProjectContext } from '../utils/project.js';

const run = promisify(execFile);

/**
 * `eas device:*` — the devices ad-hoc builds are provisioned for.
 *
 * EAS keeps them on Expo's servers and regenerates the ad-hoc profile from them
 * at build time. Here they live in the install service's D1 database, and the
 * build workflow does the regenerating: it registers pending devices with Apple
 * and signs with a profile that lists every registered one.
 */

async function prompt(question, fallback = '') {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await rl.question(fallback ? `${question} ${chalk.dim(`(${fallback})`)} ` : `${question} `)).trim();
    return answer || fallback;
  } finally {
    rl.close();
  }
}

async function choose(question, choices) {
  Log.log(chalk.bold(question));
  choices.forEach((choice, i) => Log.log(`  ${chalk.cyan(String(i + 1))}. ${choice.title}`));
  for (;;) {
    const answer = await prompt('›', '1');
    const index = Number(answer) - 1;
    if (Number.isInteger(index) && choices[index]) return choices[index].value;
    Log.warn(`Pick a number from 1 to ${choices.length}.`);
  }
}

// --json implies --non-interactive, as in EAS.
const interactive = (options = {}) => Boolean(process.stdin.isTTY) && !options.nonInteractive && !options.json;

/** The registry, or null when no install service is configured for this project. */
async function openRegistry(options = {}) {
  const project = loadProjectContext();
  const url = await resolveInstallUrl(project);
  if (!url) return null;
  let token = readInstallToken(url);
  if (!token) {
    if (!interactive(options)) {
      die(`No token for the install service at ${url}. Set EAS_INSTALL_TOKEN (the service's UPLOAD_TOKEN).`);
    }
    Log.log(`The device registry at ${link(url)} needs its upload token (the same value as the EAS_INSTALL_TOKEN secret).`);
    token = await prompt('Install token:');
    if (!token) die('No token provided.');
    saveInstallToken(url, token);
    Log.log(chalk.dim('  stored in ~/.eas-gh/install.json (mode 0600)'));
  }
  return new DeviceRegistry({ url, token });
}

function notConfigured() {
  Log.log('');
  Log.warn('No device registry: this project has no install service (EAS_INSTALL_URL).');
  Log.log('  Deploy one and set the variable, as in the internal distribution guide:');
  Log.log(`  ${link('https://reactnativefeel.com/deploy/docs/guide/internal-distribution')}`);
  Log.log('');
}

const STATUS = {
  pending: chalk.yellow('pending'),
  registered: chalk.green('registered'),
  disabled: chalk.dim('removed'),
};

function printDevices(devices) {
  Log.log('');
  if (devices.length === 0) {
    Log.log('  No devices yet. Run "rnd device:create".');
  }
  for (const d of devices) {
    // The model matters: two devices can share a name, and a build provisioned
    // for the wrong one fails on the phone with only "integrity could not be verified".
    Log.log(
      `  ${chalk.cyan(d.name.padEnd(28))} ${(d.product ?? '').padEnd(14)} ${chalk.dim(d.udid.padEnd(40))} ${STATUS[d.status] ?? d.status}`
    );
  }
  Log.log('');
}

export async function deviceList({ options }) {
  setJsonMode(options.json);
  const registry = await openRegistry(options);
  if (!registry) {
    return listAppleDevices(options);
  }
  let devices = await registry.list();
  const offset = Number(options.offset ?? 0);
  if (options.limit) devices = devices.slice(offset, offset + Number(options.limit));
  else if (offset) devices = devices.slice(offset);
  if (options.json) {
    printJson(devices);
    return;
  }
  printDevices(devices);
  if (devices.some((d) => d.status === 'pending')) {
    Log.log(chalk.dim('  Pending devices are registered with Apple, and added to the ad-hoc profile, by the next internal build.'));
    Log.log('');
  }
}

/** Without a registry, show what Apple has: the pre-registry behaviour. */
async function listAppleDevices(options) {
  const args = ['devices', 'list', '--output', 'json'];
  if (options.limit) args.push('--limit', String(options.limit));
  const { stdout } = await runAsc(args);
  if (options.json) {
    process.stdout.write(stdout);
    return;
  }
  const parsed = JSON.parse(stdout);
  const devices = Array.isArray(parsed) ? parsed : (parsed.data ?? []);
  Log.log(chalk.dim('\n  From App Store Connect (no device registry configured):'));
  for (const device of devices) {
    const attrs = device.attributes ?? device;
    Log.log(
      `  ${chalk.cyan((attrs.name ?? '—').padEnd(28))} ${(attrs.model ?? '').padEnd(20)} ${chalk.dim(attrs.udid ?? '')} ${chalk.dim(attrs.status ?? '')}`
    );
  }
  Log.log('');
}

export async function deviceView({ args }) {
  const registry = (await openRegistry()) ?? die('No device registry is configured for this project.');
  const udid = args[0] ?? die('Pass the UDID: rnd device:view <UDID>');
  const device = (await registry.get(udid)) ?? die(`No device with UDID ${udid}.`);
  Log.log('');
  for (const [key, value] of Object.entries(device)) {
    Log.log(`  ${chalk.dim(key.padEnd(15))} ${value ?? chalk.dim('—')}`);
  }
  Log.log('');
}

async function pickUdid(registry, options, verb) {
  if (options.udid) return options.udid;
  if (!interactive(options)) die(`Pass --udid to choose the device to ${verb}.`);
  const devices = (await registry.list()).filter((d) => d.status !== 'disabled');
  if (devices.length === 0) die('There are no devices.');
  return choose(`Which device do you want to ${verb}?`, devices.map((d) => ({ title: `${d.name} ${chalk.dim(`${d.product ?? ''} ${d.udid}`)}`, value: d.udid })));
}

export async function deviceRename({ options }) {
  setJsonMode(options.json);
  const registry = (await openRegistry(options)) ?? die('No device registry is configured for this project.');
  const udid = await pickUdid(registry, options, 'rename');
  const name = options.name ?? (interactive(options) ? await prompt('New name:') : die('Pass --name.'));
  const device = await registry.update(udid, { name });
  if (options.json) return printJson(device);
  Log.succeed(`Renamed ${device.udid} to "${device.name}".`);
  Log.log(chalk.dim('  The name on Apple\'s side is left as it is.'));
}

export async function deviceDelete({ options }) {
  setJsonMode(options.json);
  const registry = (await openRegistry(options)) ?? die('No device registry is configured for this project.');
  const udid = await pickUdid(registry, options, 'remove');
  const device = await registry.remove(udid);
  if (options.json) return printJson(device);
  Log.succeed(`Removed "${device.name}". The next internal build leaves it out of the ad-hoc profile.`);
  Log.log(chalk.dim('  It stays registered with Apple, and keeps counting toward the yearly device limit until the membership renews.'));
}

/**
 * `eas device:create` offers the same ways in as EAS: a link/QR the tester opens
 * on the device, a device on USB, this Mac, a typed UDID, or an import of what
 * Apple already has.
 */
export async function deviceCreate() {
  const registry = await openRegistry();
  if (!registry) {
    notConfigured();
    Log.log('Or register directly with Apple, then regenerate the ad-hoc profile and rebuild:');
    Log.log(`  ${chalk.cyan('asc devices create --name "My iPhone" --udid <UDID> --platform IOS')}`);
    Log.log('');
    return;
  }
  const method = interactive()
    ? await choose('How would you like to register your devices?', [
        { title: 'Website: a link or QR code to open on the device (recommended)', value: 'url' },
        { title: 'An iPhone or iPad connected to this Mac', value: 'usb' },
        { title: 'This Mac (Apple silicon)', value: 'mac' },
        { title: 'Enter a UDID', value: 'manual' },
        { title: 'Import the devices already on your Apple Developer account', value: 'import' },
      ])
    : 'url';
  await METHODS[method](registry);
}

const METHODS = {
  async url(registry) {
    const { url, expiresAt } = await registry.createRegistrationRequest();
    const { default: qrcode } = await import('qrcode-terminal');
    Log.log('');
    await new Promise((resolve) =>
      qrcode.generate(url, { small: true }, (code) => {
        Log.log(code.replace(/^/gm, '  '));
        resolve();
      })
    );
    Log.log('Open this link on each iPhone or iPad (or scan the QR code) and install the profile it offers:');
    Log.log(`  ${link(url)}`);
    Log.log(chalk.dim(`  Works for any number of devices until ${new Date(expiresAt).toLocaleDateString()}.`));
    Log.log(chalk.dim('  Watch them arrive with "rnd device:list". The next internal build includes them.'));
    Log.log('');
  },

  async usb(registry) {
    const dir = mkdtempSync(join(tmpdir(), 'rnd-devicectl-'));
    let devices;
    try {
      await run('xcrun', ['devicectl', 'list', 'devices', '--json-output', join(dir, 'devices.json')]);
      devices = parseDevicectlDevices(JSON.parse(readFileSync(join(dir, 'devices.json'), 'utf-8')));
    } catch (err) {
      die(`Could not list devices with "xcrun devicectl" (Xcode 15 or later): ${err.message}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    if (devices.length === 0) {
      die('No iPhone or iPad found. Connect one with a cable, unlock it, and trust this Mac.');
    }
    const device =
      devices.length === 1
        ? devices[0]
        : await choose('Which device?', devices.map((d) => ({ title: `${d.name} ${chalk.dim(`${d.model ?? d.product} ${d.udid}`)}`, value: d })));
    const name = await prompt('Name for this device:', device.model ? `${device.name} (${device.model})` : device.name);
    await save(registry, { udid: device.udid, name, product: device.product, source: 'usb' });
  },

  async mac(registry) {
    let mac;
    try {
      const { stdout } = await run('system_profiler', ['-json', 'SPHardwareDataType']);
      mac = parseMacHardware(JSON.parse(stdout));
    } catch {
      mac = null;
    }
    if (!mac) die('This Mac reports no provisioning UDID. Only Apple silicon Macs can run iOS apps signed ad-hoc.');
    const name = await prompt('Name for this Mac:', mac.name);
    await save(registry, { udid: mac.udid, name, product: mac.product, deviceClass: 'MAC', source: 'mac' });
  },

  async manual(registry) {
    Log.log(chalk.dim('  The UDID is in Finder: select the device, then click the line under its name until it shows.'));
    const udid = await prompt('UDID:');
    const name = await prompt('Name (include the model, e.g. "Ana\'s iPhone 16"):');
    await save(registry, { udid, name, source: 'manual' });
  },

  async import(registry) {
    const { stdout } = await runAsc(['devices', 'list', '--output', 'json']);
    const parsed = JSON.parse(stdout);
    const apple = (Array.isArray(parsed) ? parsed : (parsed.data ?? []))
      .map((d) => ({ id: d.id, ...(d.attributes ?? d) }))
      .filter((d) => d.status !== 'DISABLED' && ['IOS', 'MAC_OS', 'UNIVERSAL'].includes(d.platform ?? 'IOS'));
    const known = new Set((await registry.list()).map((d) => d.udid.toUpperCase()));
    const fresh = apple.filter((d) => !known.has(String(d.udid).toUpperCase()));
    if (fresh.length === 0) {
      Log.succeed('Every device on your Apple Developer account is already in the registry.');
      return;
    }
    Log.log('');
    fresh.forEach((d) => Log.log(`  ${chalk.cyan((d.name ?? '—').padEnd(28))} ${(d.model ?? '').padEnd(20)} ${chalk.dim(d.udid)}`));
    const answer = await prompt(`Import these ${fresh.length} device(s)? [Y/n]`, 'y');
    if (!/^y/i.test(answer)) return;
    for (const d of fresh) {
      await registry.add({
        udid: d.udid,
        name: d.model && !String(d.name).includes(d.model) ? `${d.name} (${d.model})` : d.name,
        deviceClass: d.deviceClass === 'MAC' ? 'MAC' : undefined,
        source: 'import',
        appleDeviceId: d.id,
      });
    }
    Log.succeed(`Imported ${fresh.length} device(s).`);
  },
};

async function save(registry, input) {
  const device = await registry.add(input);
  Log.succeed(`Added "${device.name}" (${device.udid}).`);
  Log.log(chalk.dim('  The next internal build registers it with Apple and includes it in the ad-hoc profile.'));
}
