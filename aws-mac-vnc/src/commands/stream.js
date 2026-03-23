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
      logger.info('Frontend config written to frontend/.env.local');
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
    logger.info('  Open http://localhost:5173');

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
