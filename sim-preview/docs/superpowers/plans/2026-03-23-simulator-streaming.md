# iOS Simulator Streaming Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stream an iOS Simulator from an AWS EC2 Mac instance to a browser via VNC + websockify + noVNC.

**Architecture:** Node.js CLI provisions an EC2 Mac Dedicated Host, launches an instance, SSHs in to enable VNC + websockify + boot Simulator fullscreen, then a Vite+React frontend connects via noVNC's RFB class over WebSocket to display the Simulator in the browser.

**Tech Stack:** Node.js (ESM), Commander.js, node-ssh, chalk, ora, Vite, React, TypeScript, Tailwind CSS, @novnc/novnc

**Spec:** `docs/superpowers/specs/2026-03-23-simulator-streaming-design.md`

---

## File Structure

```
aws-mac-vnc/
├── package.json                    # CLI package (ESM, bin entry)
├── bin/
│   └── mac-vnc.js                  # CLI entry point (shebang + createCli)
├── src/
│   ├── cli.js                      # Commander.js program definition
│   ├── commands/
│   │   └── stream.js               # stream command orchestration
│   ├── infra/
│   │   ├── dedicated-host.js       # Dedicated Host allocate/release
│   │   ├── instance.js             # EC2 instance launch/terminate/describe
│   │   ├── key-pair.js             # SSH key pair ensure/delete
│   │   ├── security-group.js       # SG create/authorize (ports 22 + 6080)
│   │   └── state.js                # .mac-vnc-state.json read/write/clear
│   ├── remote/
│   │   ├── ssh.js                  # node-ssh wrapper with retry
│   │   └── vnc-setup.js            # Enable VNC, websockify, simulator
│   └── utils/
│       └── logger.js               # chalk + ora logger singleton
├── frontend/
│   ├── package.json                # Vite + React + TS + Tailwind
│   ├── index.html
│   ├── vite.config.ts
│   ├── tsconfig.json
│   ├── src/
│   │   ├── main.tsx
│   │   ├── App.tsx
│   │   ├── components/
│   │   │   ├── VncViewer.tsx       # noVNC RFB wrapper
│   │   │   └── ConnectionStatus.tsx
│   │   └── index.css               # Tailwind imports
│   └── public/
└── docs/
```

---

### Task 1: Initialize CLI Package

**Files:**
- Create: `package.json`
- Create: `bin/mac-vnc.js`
- Create: `src/cli.js`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "mac-vnc",
  "version": "0.1.0",
  "type": "module",
  "bin": {
    "mac-vnc": "./bin/mac-vnc.js"
  },
  "scripts": {},
  "dependencies": {
    "chalk": "^5.6.2",
    "commander": "^14.0.3",
    "node-ssh": "^13.2.1",
    "ora": "^9.3.0"
  }
}
```

- [ ] **Step 2: Create bin/mac-vnc.js**

```javascript
#!/usr/bin/env node
import { createCli } from '../src/cli.js';
const program = createCli();
program.parse();
```

- [ ] **Step 3: Create src/cli.js**

```javascript
import { Command } from 'commander';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf-8'));

export function createCli() {
  const program = new Command();

  program
    .name('mac-vnc')
    .version(pkg.version)
    .description('Stream iOS Simulator from AWS EC2 Mac to browser via VNC');

  program
    .command('stream')
    .description('Launch EC2 Mac instance and stream iOS Simulator to browser')
    .option('--device <name>', 'Simulator device name', 'iPhone 16 Pro')
    .option('--runtime <version>', 'iOS runtime version (default: latest available)')
    .option('--port <number>', 'websockify port', '6080')
    .option('--no-teardown', 'Keep instance alive after disconnect')
    .option('--region <region>', 'AWS region', 'us-east-1')
    .action(async (options) => {
      const { streamCommand } = await import('./commands/stream.js');
      await streamCommand(options);
    });

  program
    .command('down')
    .description('Terminate instance and release Dedicated Host')
    .action(async () => {
      const { downCommand } = await import('./commands/stream.js');
      await downCommand();
    });

  program
    .command('status')
    .description('Show instance status and cost')
    .action(async () => {
      const { statusCommand } = await import('./commands/stream.js');
      await statusCommand();
    });

  return program;
}
```

- [ ] **Step 4: Install dependencies and make bin executable**

Run: `npm install && chmod +x bin/mac-vnc.js`

- [ ] **Step 5: Verify CLI boots**

Run: `node bin/mac-vnc.js --help`
Expected: Shows help with `stream`, `down`, `status` commands.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json bin/ src/cli.js
git commit -m "feat: initialize CLI package with Commander setup"
```

---

### Task 2: Logger Utility

**Files:**
- Create: `src/utils/logger.js`

- [ ] **Step 1: Create src/utils/logger.js**

```javascript
import chalk from 'chalk';
import ora from 'ora';

class Logger {
  #spinner = null;
  #verbose = false;

  setVerbose(v) { this.#verbose = v; }

  info(msg) { console.log(chalk.blue('ℹ'), msg); }
  success(msg) { console.log(chalk.green('✔'), msg); }
  warn(msg) { console.log(chalk.yellow('⚠'), msg); }
  error(msg) { console.error(chalk.red('✖'), msg); }

  step(current, total, msg) {
    console.log(chalk.cyan(`[${current}/${total}]`), msg);
  }

  debug(msg) {
    if (this.#verbose) console.log(chalk.gray(msg));
  }

  startSpinner(msg) {
    this.#spinner = ora(msg).start();
    return this.#spinner;
  }

  stopSpinner(success = true, msg) {
    if (!this.#spinner) return;
    if (success) this.#spinner.succeed(msg);
    else this.#spinner.fail(msg);
    this.#spinner = null;
  }
}

export const logger = new Logger();
```

- [ ] **Step 2: Commit**

```bash
git add src/utils/logger.js
git commit -m "feat: add logger utility with chalk and ora"
```

---

### Task 3: State Management

**Files:**
- Create: `src/infra/state.js`

- [ ] **Step 1: Create src/infra/state.js**

```javascript
import { readFileSync, writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const STATE_FILE = '.mac-vnc-state.json';

export function loadState(dir = process.cwd()) {
  const path = join(dir, STATE_FILE);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf-8'));
}

export function saveState(state, dir = process.cwd()) {
  const path = join(dir, STATE_FILE);
  writeFileSync(path, JSON.stringify(state, null, 2) + '\n');
}

export function clearState(dir = process.cwd()) {
  const path = join(dir, STATE_FILE);
  if (existsSync(path)) unlinkSync(path);
}

export function getRunningCost(allocatedAt, ratePerHour = 6.5) {
  const hours = (Date.now() - new Date(allocatedAt).getTime()) / (1000 * 60 * 60);
  return (Math.max(hours, 24) * ratePerHour).toFixed(2);
}

export function getTimeRemaining(allocatedAt) {
  const elapsed = (Date.now() - new Date(allocatedAt).getTime()) / (1000 * 60 * 60);
  const remaining = Math.max(24 - elapsed, 0);
  const h = Math.floor(remaining);
  const m = Math.floor((remaining - h) * 60);
  return `${h}h ${m}m`;
}
```

- [ ] **Step 2: Add `.mac-vnc-state.json` to .gitignore**

Append to `.gitignore`:
```
.mac-vnc-state.json
```

- [ ] **Step 3: Commit**

```bash
git add src/infra/state.js .gitignore
git commit -m "feat: add state file management with cost tracking"
```

---

### Task 4: SSH Module

**Files:**
- Create: `src/remote/ssh.js`

- [ ] **Step 1: Create src/remote/ssh.js**

```javascript
import { NodeSSH } from 'node-ssh';
import { logger } from '../utils/logger.js';

export function buildSshConfig(host, privateKeyPath) {
  return {
    host,
    username: 'ec2-user',
    privateKeyPath,
    readyTimeout: 30000,
    keepaliveInterval: 10000,
  };
}

export async function connectWithRetry(host, privateKeyPath, retries = 5) {
  const config = buildSshConfig(host, privateKeyPath);
  const ssh = new NodeSSH();

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      logger.debug(`SSH attempt ${attempt}/${retries} to ${host}`);
      await ssh.connect(config);
      logger.success(`SSH connected to ${host}`);
      return ssh;
    } catch (err) {
      if (attempt === retries) throw err;
      const delay = Math.pow(2, attempt) * 1000;
      logger.debug(`SSH failed, retrying in ${delay / 1000}s: ${err.message}`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}

export async function sshExec(ssh, command, { stream = false, cwd } = {}) {
  logger.debug(`> ${command}`);
  if (stream) {
    const result = await ssh.execCommand(command, {
      cwd,
      onStdout: (chunk) => process.stdout.write(chunk),
      onStderr: (chunk) => process.stderr.write(chunk),
    });
    if (result.code !== 0) throw new Error(`Command failed (exit ${result.code}): ${command}`);
    return result;
  }

  const result = await ssh.execCommand(command, { cwd });
  if (result.code !== 0) {
    throw new Error(`Command failed (exit ${result.code}): ${result.stderr || result.stdout}`);
  }
  return result;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/remote/ssh.js
git commit -m "feat: add SSH connection module with retry logic"
```

---

### Task 5: Infrastructure — Key Pair

**Files:**
- Create: `src/infra/key-pair.js`

- [ ] **Step 1: Create src/infra/key-pair.js**

```javascript
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, chmodSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { logger } from '../utils/logger.js';

const KEY_DIR = join(homedir(), '.mac-vnc', 'keys');
const KEY_NAME = 'mac-vnc-key';

export function getPrivateKeyPath() {
  return join(KEY_DIR, `${KEY_NAME}.pem`);
}

export function ensureKeyPair(region) {
  const keyPath = getPrivateKeyPath();

  // Check if key already exists locally and in AWS
  if (existsSync(keyPath)) {
    try {
      execSync(
        `aws ec2 describe-key-pairs --key-names ${KEY_NAME} --region ${region} --output json`,
        { encoding: 'utf-8', stdio: 'pipe' }
      );
      logger.debug(`Key pair "${KEY_NAME}" already exists`);
      return keyPath;
    } catch {
      // Key exists locally but not in AWS — delete local and recreate
      unlinkSync(keyPath);
    }
  }

  logger.info(`Creating key pair "${KEY_NAME}"...`);
  mkdirSync(KEY_DIR, { recursive: true });

  const result = execSync(
    `aws ec2 create-key-pair --key-name ${KEY_NAME} --region ${region} --output json`,
    { encoding: 'utf-8', stdio: 'pipe' }
  );
  const { KeyMaterial } = JSON.parse(result);

  writeFileSync(keyPath, KeyMaterial);
  chmodSync(keyPath, 0o600);
  logger.success(`Key pair saved to ${keyPath}`);
  return keyPath;
}

export function deleteKeyPair(region) {
  try {
    execSync(
      `aws ec2 delete-key-pair --key-name ${KEY_NAME} --region ${region}`,
      { stdio: 'pipe' }
    );
  } catch { /* ignore if not found */ }

  const keyPath = getPrivateKeyPath();
  if (existsSync(keyPath)) unlinkSync(keyPath);
}
```

- [ ] **Step 2: Commit**

```bash
git add src/infra/key-pair.js
git commit -m "feat: add SSH key pair management"
```

---

### Task 6: Infrastructure — Security Group

**Files:**
- Create: `src/infra/security-group.js`

- [ ] **Step 1: Create src/infra/security-group.js**

```javascript
import { execSync } from 'node:child_process';
import { logger } from '../utils/logger.js';

const SG_NAME = 'mac-vnc-sg';

export function getCurrentIp() {
  return execSync('curl -s https://checkip.amazonaws.com', { encoding: 'utf-8' }).trim();
}

export function ensureSecurityGroup(region) {
  // Check if SG exists
  try {
    const result = execSync(
      `aws ec2 describe-security-groups --group-names ${SG_NAME} --region ${region} --output json`,
      { encoding: 'utf-8', stdio: 'pipe' }
    );
    const { SecurityGroups } = JSON.parse(result);
    const sgId = SecurityGroups[0].GroupId;
    logger.debug(`Security group "${SG_NAME}" exists: ${sgId}`);
    return sgId;
  } catch {
    // Create new SG
  }

  logger.info(`Creating security group "${SG_NAME}"...`);
  const result = execSync(
    `aws ec2 create-security-group --group-name ${SG_NAME} --description "mac-vnc SSH + websockify access" --region ${region} --output json`,
    { encoding: 'utf-8', stdio: 'pipe' }
  );
  const { GroupId } = JSON.parse(result);
  logger.success(`Security group created: ${GroupId}`);
  return GroupId;
}

export function authorizeAccess(sgId, region) {
  const ip = getCurrentIp();
  logger.info(`Authorizing access from ${ip}...`);

  // Revoke all existing ingress rules for ports 22 and 6080
  for (const port of [22, 6080]) {
    try {
      const descResult = execSync(
        `aws ec2 describe-security-groups --group-ids ${sgId} --region ${region} --output json`,
        { encoding: 'utf-8', stdio: 'pipe' }
      );
      const rules = JSON.parse(descResult).SecurityGroups[0].IpPermissions
        .filter((r) => r.FromPort === port && r.ToPort === port);
      for (const rule of rules) {
        for (const range of rule.IpRanges || []) {
          execSync(
            `aws ec2 revoke-security-group-ingress --group-id ${sgId} --protocol tcp --port ${port} --cidr ${range.CidrIp} --region ${region}`,
            { stdio: 'pipe' }
          );
        }
      }
    } catch { /* no existing rules */ }
  }

  // Authorize SSH (22) and websockify (6080) from current IP
  const cidr = `${ip}/32`;
  for (const port of [22, 6080]) {
    execSync(
      `aws ec2 authorize-security-group-ingress --group-id ${sgId} --protocol tcp --port ${port} --cidr ${cidr} --region ${region}`,
      { encoding: 'utf-8', stdio: 'pipe' }
    );
  }
  logger.success(`Ports 22, 6080 authorized for ${cidr}`);
}
```

- [ ] **Step 2: Commit**

```bash
git add src/infra/security-group.js
git commit -m "feat: add security group with SSH and websockify access"
```

---

### Task 7: Infrastructure — Dedicated Host

**Files:**
- Create: `src/infra/dedicated-host.js`

- [ ] **Step 1: Create src/infra/dedicated-host.js**

```javascript
import { execSync } from 'node:child_process';
import { logger } from '../utils/logger.js';

export function allocateDedicatedHost(region, az) {
  logger.info('Allocating Dedicated Host (mac2.metal)...');

  // Use first AZ in region if not specified
  if (!az) {
    const azResult = execSync(
      `aws ec2 describe-availability-zones --region ${region} --output json`,
      { encoding: 'utf-8', stdio: 'pipe' }
    );
    az = JSON.parse(azResult).AvailabilityZones[0].ZoneName;
  }

  const result = execSync(
    `aws ec2 allocate-hosts --instance-type mac2.metal --quantity 1 --availability-zone ${az} --region ${region} --output json`,
    { encoding: 'utf-8', stdio: 'pipe' }
  );
  const hostId = JSON.parse(result).HostIds[0];
  logger.success(`Dedicated Host allocated: ${hostId}`);
  return hostId;
}

export async function waitForHost(hostId, region, maxAttempts = 60) {
  const spinner = logger.startSpinner('Waiting for Dedicated Host to become available...');

  for (let i = 0; i < maxAttempts; i++) {
    const result = execSync(
      `aws ec2 describe-hosts --host-ids ${hostId} --region ${region} --output json`,
      { encoding: 'utf-8', stdio: 'pipe' }
    );
    const state = JSON.parse(result).Hosts[0].State;

    if (state === 'available') {
      logger.stopSpinner(true, 'Dedicated Host available');
      return;
    }
    if (state === 'released' || state === 'released-permanent-failure') {
      logger.stopSpinner(false, `Host entered state: ${state}`);
      throw new Error(`Dedicated Host failed: ${state}`);
    }

    await new Promise((r) => setTimeout(r, 5000));
  }

  logger.stopSpinner(false, 'Timeout waiting for host');
  throw new Error('Timeout waiting for Dedicated Host');
}

export function releaseDedicatedHost(hostId, region) {
  logger.info(`Releasing Dedicated Host ${hostId}...`);
  try {
    execSync(
      `aws ec2 release-hosts --host-ids ${hostId} --region ${region}`,
      { stdio: 'pipe' }
    );
    logger.success('Dedicated Host released');
  } catch (err) {
    logger.warn(`Failed to release host: ${err.message}`);
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/infra/dedicated-host.js
git commit -m "feat: add Dedicated Host allocation and lifecycle"
```

---

### Task 8: Infrastructure — EC2 Instance

**Files:**
- Create: `src/infra/instance.js`

- [ ] **Step 1: Create src/infra/instance.js**

```javascript
import { execSync } from 'node:child_process';
import { logger } from '../utils/logger.js';

const DEFAULT_AMI_FILTERS = [
  { Name: 'name', Values: ['amzn-ec2-macos-14*'] },
  { Name: 'architecture', Values: ['arm64_mac'] },
  { Name: 'state', Values: ['available'] },
];

export function findLatestMacAmi(region) {
  const filters = DEFAULT_AMI_FILTERS
    .map((f) => `Name=${f.Name},Values=${f.Values.join(',')}`)
    .join(' ');

  const result = execSync(
    `aws ec2 describe-images --owners amazon --filters ${filters} --query "sort_by(Images, &CreationDate)[-1].ImageId" --region ${region} --output text`,
    { encoding: 'utf-8', stdio: 'pipe' }
  );
  const amiId = result.trim();
  if (!amiId || amiId === 'None') throw new Error('No macOS AMI found');
  logger.debug(`Latest macOS AMI: ${amiId}`);
  return amiId;
}

export function launchInstance({ hostId, amiId, sgId, keyName, region }) {
  logger.info('Launching EC2 Mac instance...');

  const result = execSync(
    `aws ec2 run-instances --image-id ${amiId} --instance-type mac2.metal --key-name ${keyName} --security-group-ids ${sgId} --placement "HostId=${hostId}" --count 1 --region ${region} --output json`,
    { encoding: 'utf-8', stdio: 'pipe' }
  );
  const instance = JSON.parse(result).Instances[0];
  const instanceId = instance.InstanceId;
  logger.success(`Instance launched: ${instanceId}`);
  return instanceId;
}

export function waitForInstance(instanceId, region) {
  const spinner = logger.startSpinner('Waiting for instance to be running...');

  execSync(
    `aws ec2 wait instance-running --instance-ids ${instanceId} --region ${region}`,
    { stdio: 'pipe', timeout: 600000 }
  );
  logger.stopSpinner(true, 'Instance running');

  const spinner2 = logger.startSpinner('Waiting for status checks...');
  execSync(
    `aws ec2 wait instance-status-ok --instance-ids ${instanceId} --region ${region}`,
    { stdio: 'pipe', timeout: 600000 }
  );
  logger.stopSpinner(true, 'Status checks passed');
}

export function getInstancePublicIp(instanceId, region) {
  const result = execSync(
    `aws ec2 describe-instances --instance-ids ${instanceId} --query "Reservations[0].Instances[0].PublicIpAddress" --region ${region} --output text`,
    { encoding: 'utf-8', stdio: 'pipe' }
  );
  return result.trim();
}

export function terminateInstance(instanceId, region) {
  logger.info(`Terminating instance ${instanceId}...`);
  execSync(
    `aws ec2 terminate-instances --instance-ids ${instanceId} --region ${region}`,
    { stdio: 'pipe' }
  );
  logger.success('Instance terminated');
}
```

- [ ] **Step 2: Commit**

```bash
git add src/infra/instance.js
git commit -m "feat: add EC2 Mac instance launch and lifecycle"
```

---

### Task 9: VNC Remote Setup

**Files:**
- Create: `src/remote/vnc-setup.js`

- [ ] **Step 1: Create src/remote/vnc-setup.js**

```javascript
import { randomBytes } from 'node:crypto';
import { sshExec } from './ssh.js';
import { logger } from '../utils/logger.js';

export function generateVncPassword() {
  return randomBytes(4).toString('hex'); // 8-char alphanumeric
}

export async function setupVnc(ssh, password) {
  logger.step(1, 4, 'Enabling macOS Screen Sharing (VNC)...');

  await sshExec(ssh, [
    'sudo /System/Library/CoreServices/RemoteManagement/ARDAgent.app/Contents/Resources/kickstart',
    '-activate -configure -access -on -privs -all',
    '-restart -agent -menu',
  ].join(' '));

  await sshExec(ssh, [
    'sudo /System/Library/CoreServices/RemoteManagement/ARDAgent.app/Contents/Resources/kickstart',
    `-configure -clientopts -setvnclegacy -vnclegacy yes -setvncpw -vncpw ${password}`,
  ].join(' '));

  await sshExec(ssh, 'sudo launchctl load -w /System/Library/LaunchDaemons/com.apple.screensharing.plist').catch(() => {
    logger.debug('screensharing plist may already be loaded');
  });

  logger.success('VNC enabled');
}

export async function setupWebsockify(ssh, port = 6080) {
  logger.step(2, 4, 'Installing and starting websockify...');

  await sshExec(ssh, 'pip3 install websockify');

  // Create launchd plist for persistence
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.websockify</string>
  <key>ProgramArguments</key><array>
    <string>/usr/local/bin/websockify</string>
    <string>${port}</string>
    <string>localhost:5900</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>/tmp/websockify.log</string>
  <key>StandardErrorPath</key><string>/tmp/websockify.err</string>
</dict></plist>`;

  await sshExec(ssh, `mkdir -p ~/Library/LaunchAgents`);
  await sshExec(ssh, `cat > ~/Library/LaunchAgents/com.websockify.plist << 'PLIST'\n${plist}\nPLIST`);
  await sshExec(ssh, 'launchctl load ~/Library/LaunchAgents/com.websockify.plist');

  logger.success(`websockify started on port ${port}`);
}

export async function bootSimulator(ssh, device = 'iPhone 16 Pro', runtime) {
  logger.step(3, 4, `Booting Simulator: ${device}...`);

  // List available runtimes if none specified
  if (!runtime) {
    const { stdout } = await sshExec(ssh, 'xcrun simctl list runtimes --json');
    const runtimes = JSON.parse(stdout).runtimes.filter((r) => r.platform === 'iOS' && r.isAvailable);
    if (runtimes.length === 0) throw new Error('No iOS runtimes available');
    runtime = runtimes[runtimes.length - 1].identifier;
    logger.debug(`Using runtime: ${runtime}`);
  }

  // Create device if needed, or boot existing
  try {
    await sshExec(ssh, `xcrun simctl boot "${device}"`);
  } catch {
    logger.debug('Device may not exist, creating...');
    await sshExec(ssh, `xcrun simctl create "${device}" "${device}" ${runtime}`);
    await sshExec(ssh, `xcrun simctl boot "${device}"`);
  }

  await sshExec(ssh, 'open -a Simulator');

  // Fullscreen + hide chrome
  await sshExec(ssh, [
    'osascript',
    '-e \'tell application "Simulator" to activate\'',
    '-e \'delay 3\'',
    '-e \'tell application "System Events" to keystroke "f" using {command down, control down}\'',
  ].join(' '));

  logger.success(`Simulator "${device}" booted and fullscreened`);
}

export async function hideDesktopChrome(ssh) {
  logger.step(4, 4, 'Hiding desktop chrome...');

  await sshExec(ssh, 'defaults write com.apple.dock autohide -bool true');
  await sshExec(ssh, 'defaults write com.apple.dock autohide-delay -float 999');
  await sshExec(ssh, 'killall Dock').catch(() => {});
  await sshExec(ssh, 'defaults write NSGlobalDomain _HIHideMenuBar -bool true');

  logger.success('Desktop chrome hidden');
}

export async function waitForWebsockify(ssh, port = 6080, maxAttempts = 30) {
  const spinner = logger.startSpinner('Waiting for websockify to be ready...');

  for (let i = 0; i < maxAttempts; i++) {
    try {
      await sshExec(ssh, `nc -z localhost ${port}`);
      logger.stopSpinner(true, `websockify ready on port ${port}`);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  logger.stopSpinner(false, 'websockify not responding');
  throw new Error(`websockify did not start on port ${port}`);
}
```

- [ ] **Step 2: Commit**

```bash
git add src/remote/vnc-setup.js
git commit -m "feat: add VNC, websockify, and simulator remote setup"
```

---

### Task 10: Stream Command (Orchestration)

**Files:**
- Create: `src/commands/stream.js`

- [ ] **Step 1: Create src/commands/stream.js**

```javascript
import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { logger } from '../utils/logger.js';
import { loadState, saveState, clearState, getRunningCost, getTimeRemaining } from '../infra/state.js';
import { ensureKeyPair, deleteKeyPair } from '../infra/key-pair.js';
import { ensureSecurityGroup, authorizeAccess } from '../infra/security-group.js';
import { allocateDedicatedHost, waitForHost, releaseDedicatedHost } from '../infra/dedicated-host.js';
import { findLatestMacAmi, launchInstance, waitForInstance, getInstancePublicIp, terminateInstance } from '../infra/instance.js';
import { connectWithRetry } from '../remote/ssh.js';
import { generateVncPassword, setupVnc, setupWebsockify, bootSimulator, hideDesktopChrome, waitForWebsockify } from '../remote/vnc-setup.js';

const KEY_NAME = 'mac-vnc-key';

function checkPrerequisites() {
  try {
    execSync('aws --version', { stdio: 'pipe' });
  } catch {
    throw new Error('AWS CLI is required but not installed. Install it from https://aws.amazon.com/cli/');
  }
  try {
    execSync('aws sts get-caller-identity', { stdio: 'pipe' });
  } catch {
    throw new Error('AWS CLI is not configured. Run: aws configure');
  }
}

export async function streamCommand(options) {
  const { region, device, runtime, port } = options;

  try {
    checkPrerequisites();

    // Step 1: Infrastructure
    let state = loadState();
    let ssh;

    if (state?.instanceId) {
      logger.info(`Reusing existing instance: ${state.instanceId}`);
      try {
        ssh = await connectWithRetry(state.publicIp, state.keyPath);
      } catch {
        logger.warn('Cannot connect to existing instance, provisioning new one...');
        state = null;
      }
    }

    if (!state) {
      logger.step(1, 6, 'Provisioning infrastructure...');

      const keyPath = ensureKeyPair(region);
      const sgId = ensureSecurityGroup(region);
      authorizeAccess(sgId, region);

      const hostId = allocateDedicatedHost(region);
      await waitForHost(hostId, region);

      const amiId = findLatestMacAmi(region);
      const instanceId = launchInstance({ hostId, amiId, sgId, keyName: KEY_NAME, region });
      waitForInstance(instanceId, region);

      const publicIp = getInstancePublicIp(instanceId, region);

      state = {
        hostId,
        instanceId,
        publicIp,
        amiId,
        keyPath,
        sgId,
        region,
        allocatedAt: new Date().toISOString(),
      };
      saveState(state);

      logger.step(2, 6, 'Connecting via SSH...');
      ssh = await connectWithRetry(publicIp, keyPath);
    } else {
      // Refresh security group access for current IP
      authorizeAccess(state.sgId, region);
    }

    // Step 3: VNC Setup
    logger.step(3, 6, 'Setting up VNC...');
    const vncPassword = generateVncPassword();
    await setupVnc(ssh, vncPassword);

    // Step 4: websockify
    logger.step(4, 6, 'Starting websockify...');
    await setupWebsockify(ssh, parseInt(port));
    await waitForWebsockify(ssh, parseInt(port));

    // Step 5: Simulator
    logger.step(5, 6, 'Booting Simulator...');
    await bootSimulator(ssh, device, runtime);
    await hideDesktopChrome(ssh);

    // Step 6: Write frontend .env and report
    logger.step(6, 6, 'Ready!');

    const envContent = [
      `VITE_VNC_HOST=${state.publicIp}`,
      `VITE_VNC_PORT=${port}`,
      `VITE_VNC_PASSWORD=${vncPassword}`,
      `VITE_VNC_DEVICE=${device}`,
    ].join('\n') + '\n';

    const envPath = join(process.cwd(), 'frontend', '.env.local');
    try {
      writeFileSync(envPath, envContent);
      logger.info(`Frontend config written to frontend/.env.local`);
    } catch {
      logger.warn('Could not write frontend/.env.local — print config instead:');
    }

    // Save VNC password in state
    saveState({ ...state, vncPassword, websockifyPort: parseInt(port) });

    console.log('');
    logger.success('iOS Simulator streaming is ready!');
    logger.info(`WebSocket URL: ws://${state.publicIp}:${port}`);
    logger.info(`VNC Password:  ${vncPassword}`);
    logger.info('');
    logger.info('Start the frontend:');
    logger.info('  cd frontend && npm run dev');
    logger.info(`  Open http://localhost:5173`);

    ssh.dispose();
  } catch (err) {
    logger.error(err.message);
    process.exit(1);
  }
}

export async function downCommand() {
  const state = loadState();
  if (!state) {
    logger.info('No active instance found');
    return;
  }

  const { instanceId, hostId, region } = state;

  if (instanceId) terminateInstance(instanceId, region);

  // Wait for instance to terminate before releasing host
  if (hostId) {
    logger.info('Waiting 60s for instance to terminate before releasing host...');
    await new Promise((r) => setTimeout(r, 60000));
    releaseDedicatedHost(hostId, region);
  }

  deleteKeyPair(region);
  clearState();
  logger.success('All resources cleaned up');
}

export async function statusCommand() {
  const state = loadState();
  if (!state) {
    logger.info('No active instance');
    return;
  }

  console.log('');
  logger.info(`Instance:    ${state.instanceId}`);
  logger.info(`Public IP:   ${state.publicIp}`);
  logger.info(`Region:      ${state.region}`);
  logger.info(`Allocated:   ${state.allocatedAt}`);
  logger.info(`Min billing: ${getTimeRemaining(state.allocatedAt)} remaining`);
  logger.info(`Running cost: $${getRunningCost(state.allocatedAt)}`);

  if (state.websockifyPort) {
    logger.info(`Stream URL:  ws://${state.publicIp}:${state.websockifyPort}`);
  }
  console.log('');
}
```

- [ ] **Step 2: Verify CLI stream --help works**

Run: `node bin/mac-vnc.js stream --help`
Expected: Shows options for device, runtime, port, region, no-teardown.

- [ ] **Step 3: Commit**

```bash
git add src/commands/stream.js
git commit -m "feat: add stream command orchestrating VNC setup pipeline"
```

---

### Task 11: Initialize Vite + React Frontend

**Files:**
- Create: `frontend/package.json`
- Create: `frontend/index.html`
- Create: `frontend/vite.config.ts`
- Create: `frontend/tsconfig.json`
- Create: `frontend/src/main.tsx`
- Create: `frontend/src/index.css`

- [ ] **Step 1: Scaffold frontend with Vite**

Run:
```bash
cd frontend
npm create vite@latest . -- --template react-ts
```

If the directory already exists, run from project root:
```bash
npm create vite@latest frontend -- --template react-ts
```

- [ ] **Step 2: Install dependencies**

Run:
```bash
cd frontend && npm install @novnc/novnc && npm install -D tailwindcss @tailwindcss/vite
```

- [ ] **Step 3: Configure Tailwind in vite.config.ts**

Replace `frontend/vite.config.ts`:
```typescript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
})
```

- [ ] **Step 4: Replace frontend/src/index.css with Tailwind imports**

```css
@import "tailwindcss";
```

- [ ] **Step 5: Clean up default Vite scaffold**

Delete `frontend/src/App.css` and `frontend/src/assets/` (Vite scaffold defaults). Replace `frontend/src/App.tsx` with a placeholder:

```tsx
function App() {
  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center">
      <p className="text-gray-400">VNC Viewer loading...</p>
    </div>
  )
}

export default App
```

- [ ] **Step 6: Verify frontend boots**

Run: `cd frontend && npm run dev`
Expected: Vite dev server starts, shows "VNC Viewer loading..." at localhost:5173.

- [ ] **Step 7: Commit**

```bash
git add frontend/
git commit -m "feat: scaffold Vite + React + TypeScript + Tailwind frontend"
```

---

### Task 12: VncViewer Component

**Files:**
- Create: `frontend/src/components/VncViewer.tsx`

- [ ] **Step 1: Create frontend/src/components/VncViewer.tsx**

```tsx
import { useEffect, useRef, useCallback } from 'react'
import RFB from '@novnc/novnc/lib/rfb'

interface VncViewerProps {
  url: string
  password?: string
  onConnect?: () => void
  onDisconnect?: (clean: boolean) => void
}

export default function VncViewer({ url, password, onConnect, onDisconnect }: VncViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const rfbRef = useRef<RFB | null>(null)

  const connect = useCallback(() => {
    if (!containerRef.current || rfbRef.current) return

    const rfb = new RFB(containerRef.current, url, {
      credentials: password ? { username: '', password, target: '' } : undefined,
    })

    rfb.scaleViewport = true
    rfb.resizeSession = true

    rfb.addEventListener('connect', () => onConnect?.())

    rfb.addEventListener('disconnect', (e: CustomEvent) => {
      rfbRef.current = null
      onDisconnect?.(e.detail.clean)
    })

    rfb.addEventListener('credentialsrequired', () => {
      if (password) {
        rfb.sendCredentials({ username: '', password, target: '' })
      }
    })

    rfbRef.current = rfb
  }, [url, password, onConnect, onDisconnect])

  useEffect(() => {
    connect()
    return () => {
      rfbRef.current?.disconnect()
      rfbRef.current = null
    }
  }, [connect])

  return <div ref={containerRef} className="w-full h-full" />
}

// Reconnect wrapper with configurable delay
export function useVncReconnect(
  onDisconnect: (clean: boolean) => void,
  setStatus: (s: 'disconnected' | 'connecting' | 'connected') => void,
  reconnectDelayMs = 3000
) {
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleDisconnect = useCallback((clean: boolean) => {
    onDisconnect(clean)
    if (!clean) {
      setStatus('connecting')
      timeoutRef.current = setTimeout(() => {
        // Force re-render by toggling a key (handled in App.tsx)
        setStatus('connecting')
      }, reconnectDelayMs)
    }
  }, [onDisconnect, setStatus, reconnectDelayMs])

  useEffect(() => {
    return () => { if (timeoutRef.current) clearTimeout(timeoutRef.current) }
  }, [])

  return handleDisconnect
}
```

- [ ] **Step 2: Create noVNC type declaration**

Create `frontend/src/novnc.d.ts`:
```typescript
declare module '@novnc/novnc/lib/rfb' {
  interface RFBCredentials {
    username: string
    password: string
    target: string
  }

  interface RFBOptions {
    shared?: boolean
    credentials?: RFBCredentials
    repeaterID?: string
    wsProtocols?: string[]
  }

  export default class RFB {
    constructor(target: HTMLElement, url: string | WebSocket, options?: RFBOptions)
    scaleViewport: boolean
    resizeSession: boolean
    viewOnly: boolean
    disconnect(): void
    sendCredentials(credentials: RFBCredentials): void
    addEventListener(type: string, listener: (e: any) => void): void
    removeEventListener(type: string, listener: (e: any) => void): void
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/VncViewer.tsx frontend/src/novnc.d.ts
git commit -m "feat: add VncViewer component wrapping noVNC RFB"
```

---

### Task 13: ConnectionStatus Component

**Files:**
- Create: `frontend/src/components/ConnectionStatus.tsx`

- [ ] **Step 1: Create frontend/src/components/ConnectionStatus.tsx**

```tsx
type Status = 'disconnected' | 'connecting' | 'connected'

const statusConfig: Record<Status, { label: string; color: string; dot: string }> = {
  disconnected: { label: 'Disconnected', color: 'text-red-400', dot: 'bg-red-400' },
  connecting: { label: 'Connecting...', color: 'text-yellow-400', dot: 'bg-yellow-400 animate-pulse' },
  connected: { label: 'Connected', color: 'text-green-400', dot: 'bg-green-400' },
}

export default function ConnectionStatus({ status }: { status: Status }) {
  const { label, color, dot } = statusConfig[status]

  return (
    <div className={`flex items-center gap-2 ${color}`}>
      <span className={`w-2 h-2 rounded-full ${dot}`} />
      <span className="text-sm font-mono">{label}</span>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/ConnectionStatus.tsx
git commit -m "feat: add ConnectionStatus indicator component"
```

---

### Task 14: InstanceInfo Component

**Files:**
- Create: `frontend/src/components/InstanceInfo.tsx`

- [ ] **Step 1: Create frontend/src/components/InstanceInfo.tsx**

```tsx
import { useState, useEffect } from 'react'

interface InstanceInfoProps {
  host: string
  port: string
  device: string
}

function formatUptime(startTime: number): string {
  const seconds = Math.floor((Date.now() - startTime) / 1000)
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
}

export default function InstanceInfo({ host, port, device }: InstanceInfoProps) {
  const [startTime] = useState(Date.now())
  const [uptime, setUptime] = useState('00:00:00')

  useEffect(() => {
    const interval = setInterval(() => setUptime(formatUptime(startTime)), 1000)
    return () => clearInterval(interval)
  }, [startTime])

  return (
    <div className="flex items-center gap-4 text-xs font-mono text-gray-500">
      <span>{host}:{port}</span>
      <span>{device}</span>
      <span>{uptime}</span>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/InstanceInfo.tsx
git commit -m "feat: add InstanceInfo component with uptime display"
```

---

### Task 15: Wire Up App.tsx

**Files:**
- Modify: `frontend/src/App.tsx`

- [ ] **Step 1: Replace frontend/src/App.tsx**

```tsx
import { useState, useCallback } from 'react'
import VncViewer from './components/VncViewer'
import ConnectionStatus from './components/ConnectionStatus'
import InstanceInfo from './components/InstanceInfo'

type Status = 'disconnected' | 'connecting' | 'connected'

function getConfig() {
  const params = new URLSearchParams(window.location.search)
  return {
    host: params.get('host') || import.meta.env.VITE_VNC_HOST || '',
    port: params.get('port') || import.meta.env.VITE_VNC_PORT || '6080',
    password: params.get('password') || import.meta.env.VITE_VNC_PASSWORD || '',
    device: params.get('device') || import.meta.env.VITE_VNC_DEVICE || 'iPhone 16 Pro',
  }
}

export default function App() {
  const config = getConfig()
  const [status, setStatus] = useState<Status>(config.host ? 'connecting' : 'disconnected')
  const [host, setHost] = useState(config.host)
  const [port, setPort] = useState(config.port)
  const [password, setPassword] = useState(config.password)
  const [reconnectKey, setReconnectKey] = useState(0)

  const wsUrl = host ? `ws://${host}:${port}` : ''

  const handleConnect = useCallback(() => setStatus('connected'), [])
  const handleDisconnect = useCallback((clean: boolean) => {
    setStatus('disconnected')
    // Auto-reconnect on unclean disconnect after 3s
    if (!clean) {
      setTimeout(() => {
        setStatus('connecting')
        setReconnectKey((k) => k + 1)
      }, 3000)
    }
  }, [])

  // If no host configured, show a simple connect form
  if (!wsUrl || status === 'disconnected') {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="bg-gray-900 p-6 rounded-lg border border-gray-800 w-80">
          <h1 className="text-white text-lg font-bold mb-4">iOS Simulator</h1>
          <label className="block text-gray-400 text-sm mb-1">Host</label>
          <input
            className="w-full bg-gray-800 text-white px-3 py-2 rounded mb-3 border border-gray-700 focus:border-blue-500 outline-none"
            placeholder="54.123.45.67"
            value={host}
            onChange={(e) => setHost(e.target.value)}
          />
          <label className="block text-gray-400 text-sm mb-1">Port</label>
          <input
            className="w-full bg-gray-800 text-white px-3 py-2 rounded mb-3 border border-gray-700 focus:border-blue-500 outline-none"
            value={port}
            onChange={(e) => setPort(e.target.value)}
          />
          <label className="block text-gray-400 text-sm mb-1">VNC Password</label>
          <input
            className="w-full bg-gray-800 text-white px-3 py-2 rounded mb-3 border border-gray-700 focus:border-blue-500 outline-none"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <button
            className="w-full bg-blue-600 text-white py-2 rounded hover:bg-blue-500 transition-colors disabled:opacity-50"
            disabled={!host}
            onClick={() => {
              setStatus('connecting')
              setReconnectKey((k) => k + 1)
            }}
          >
            Connect
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="h-screen bg-gray-950 flex flex-col">
      <header className="flex items-center justify-between px-4 py-2 bg-gray-900 border-b border-gray-800">
        <h1 className="text-white text-sm font-bold">iOS Simulator</h1>
        <div className="flex items-center gap-4">
          <InstanceInfo host={host} port={port} device={config.device} />
          <ConnectionStatus status={status} />
        </div>
      </header>
      <main className="flex-1 overflow-hidden">
        <VncViewer
          key={reconnectKey}
          url={wsUrl}
          password={password}
          onConnect={handleConnect}
          onDisconnect={handleDisconnect}
        />
      </main>
    </div>
  )
}
```

- [ ] **Step 2: Verify frontend compiles**

Run: `cd frontend && npm run build`
Expected: Build completes with no TypeScript errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/App.tsx
git commit -m "feat: wire up App with VNC viewer, connection form, and status bar"
```

---

### Task 16: Add .gitignore entries and final cleanup

**Files:**
- Modify: `.gitignore`

- [ ] **Step 1: Update .gitignore**

```
node_modules/
.mac-vnc-state.json
frontend/node_modules/
frontend/dist/
frontend/.env.local
*.pem
```

- [ ] **Step 2: Verify full CLI help**

Run: `node bin/mac-vnc.js --help`
Expected: Shows version, description, and all 3 commands (stream, down, status).

- [ ] **Step 3: Verify frontend builds clean**

Run: `cd frontend && npm run build`
Expected: No errors, output in `frontend/dist/`.

- [ ] **Step 4: Commit**

```bash
git add .gitignore
git commit -m "chore: update gitignore for mac-vnc project"
```
