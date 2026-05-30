import { sshExec } from './ssh.js';
import { logger } from '../utils/logger.js';

export async function provisionInstance(ssh, { nodeVersion = '20', xcodeVersion = '16' } = {}) {
  const steps = [
    { name: 'Verify Homebrew', cmd: 'which brew || /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"' },
    { name: 'Install asc (App Store Connect CLI)', cmd: 'which asc || brew install asc' },
    { name: `Install Node.js ${nodeVersion}`, cmd: `which node && node -v || brew install node@${nodeVersion}` },
    { name: 'Install CocoaPods', cmd: 'which pod || sudo gem install cocoapods' },
    { name: 'Install tmux', cmd: 'which tmux || brew install tmux' },
    { name: 'Verify Xcode', cmd: `xcode-select -p && xcodebuild -version` },
  ];

  const total = steps.length;
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    logger.step(i + 1, total, step.name);
    try {
      await sshExec(ssh, step.cmd, { stream: true });
    } catch (err) {
      throw new Error(`Provisioning failed at "${step.name}": ${err.message}`);
    }
  }

  logger.success('Instance provisioning complete');
}

// Managed plans (e.g. MacinCloud Pay-As-You-Go) ship Xcode + Homebrew + Node
// pre-installed but give no sudo. We can't install anything system-wide, so we
// VERIFY the toolchain is present and fail loudly with guidance if it isn't,
// rather than attempting installs that would hang on a sudo prompt.
export async function provisionManagedHost(ssh) {
  const checks = [
    { name: 'Xcode', cmd: 'xcode-select -p && xcodebuild -version', hint: 'Install Xcode from the App Store on the Mac.' },
    { name: 'git', cmd: 'git --version', hint: 'Install the Xcode Command Line Tools (xcode-select --install).' },
    { name: 'Node.js', cmd: 'node -v', hint: 'Install Node via the provider dashboard or `brew install node` if Homebrew is available.' },
    { name: 'CocoaPods', cmd: 'pod --version', hint: 'Install with `gem install --user-install cocoapods` (no sudo needed).' },
  ];

  // tmux is nice-to-have for build resilience but not fatal; we degrade if absent.
  const optional = [
    { name: 'tmux', cmd: 'tmux -V' },
  ];

  const total = checks.length;
  const missing = [];
  for (let i = 0; i < checks.length; i++) {
    const check = checks[i];
    logger.step(i + 1, total, `Verify ${check.name}`);
    try {
      await sshExec(ssh, check.cmd, { stream: true });
    } catch {
      missing.push(check);
    }
  }

  if (missing.length > 0) {
    const detail = missing.map(m => `  - ${m.name}: ${m.hint}`).join('\n');
    throw new Error(
      `Managed host is missing required tools (no sudo available to install them):\n${detail}`
    );
  }

  const caps = { tmux: true };
  for (const opt of optional) {
    try {
      await sshExec(ssh, opt.cmd);
    } catch {
      caps[opt.name] = false;
      logger.warn(`${opt.name} not found on managed host — builds will run without it.`);
    }
  }

  logger.success('Managed host verified');
  return caps;
}

export async function cloneRepo(ssh, repoUrl, branch = 'main', workDir = '~/build-workspace') {
  logger.info(`Cloning ${repoUrl} (branch: ${branch}) into ${workDir}...`);

  // Clean previous builds
  await sshExec(ssh, `rm -rf ${workDir}`);

  await sshExec(ssh, `git clone --branch ${branch} --single-branch --depth 1 ${repoUrl} ${workDir}`, {
    stream: true,
  });

  logger.success('Repository cloned');
  return workDir;
}
