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

export async function cloneRepo(ssh, repoUrl, branch = 'main') {
  logger.info(`Cloning ${repoUrl} (branch: ${branch})...`);

  // Clean previous builds
  await sshExec(ssh, 'rm -rf ~/build-workspace');

  await sshExec(ssh, `git clone --branch ${branch} --single-branch --depth 1 ${repoUrl} ~/build-workspace`, {
    stream: true,
  });

  logger.success('Repository cloned');
  return '~/build-workspace';
}
