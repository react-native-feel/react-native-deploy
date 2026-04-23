import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { logger } from '../utils/logger.js';
import { loadState, saveState } from '../infra/state.js';
import { connectWithRetry } from '../remote/ssh.js';
import { generateVncPassword, setupVnc, setupWebsockify, bootSimulator, hideDesktopChrome, waitForWebsockify } from '../remote/vnc-setup.js';

export async function streamCommand(options) {
  const { host, user, key, password: sshPassword, sshPort, device, runtime, port, vncPassword: providedVncPassword, tunnel } = options;

  if (!key && !sshPassword) {
    logger.error('Either --key or --password is required for SSH authentication');
    process.exit(1);
  }

  try {
    // Step 1: Connect via SSH
    logger.step(1, 5, `Connecting to ${host}:${sshPort || 22} via SSH...`);
    const ssh = await connectWithRetry(host, key, { username: user, password: sshPassword, port: sshPort });

    // Step 2: VNC Setup
    logger.step(2, 5, 'Setting up VNC...');
    const vncPassword = providedVncPassword || generateVncPassword();
    await setupVnc(ssh, vncPassword, { skipSudo: !!providedVncPassword });

    // Step 3: websockify
    logger.step(3, 5, 'Starting websockify...');
    await setupWebsockify(ssh, parseInt(port));
    await waitForWebsockify(ssh, parseInt(port));

    // Step 4: Simulator
    logger.step(4, 5, 'Booting Simulator...');
    await bootSimulator(ssh, device, runtime);
    await hideDesktopChrome(ssh);

    // Step 5: Write frontend .env and report
    logger.step(5, 5, 'Ready!');

    const frontendHost = tunnel ? 'localhost' : host;
    const envContent = [
      `VITE_VNC_HOST=${frontendHost}`,
      `VITE_VNC_PORT=${port}`,
      `VITE_VNC_PASSWORD=${vncPassword}`,
      `VITE_VNC_DEVICE=${device}`,
    ].join('\n') + '\n';

    const envPath = join(process.cwd(), 'frontend', '.env.local');
    try {
      writeFileSync(envPath, envContent);
      logger.info('Frontend config written to frontend/.env.local');
    } catch {
      logger.warn('Could not write frontend/.env.local');
    }

    // Save connection state
    saveState({
      host,
      user,
      keyPath: key || null,
      vncPassword,
      websockifyPort: parseInt(port),
      device,
      connectedAt: new Date().toISOString(),
    });

    console.log('');
    logger.success('iOS Simulator streaming is ready!');
    logger.info(`WebSocket URL: ws://${frontendHost}:${port}`);
    logger.info(`VNC Password:  ${vncPassword}`);
    logger.info('');
    if (tunnel) {
      const authFlag = key ? `-i ${key}` : '';
      const portFlag = sshPort && String(sshPort) !== '22' ? `-p ${sshPort}` : '';
      logger.info('Tunnel mode — open port-forward in another terminal:');
      logger.info(`  ssh ${authFlag} ${portFlag} -L ${port}:localhost:${port} ${user}@${host}`.replace(/\s+/g, ' ').trim());
      logger.info('');
    }
    logger.info('Start the frontend:');
    logger.info('  cd frontend && npm run dev');
    logger.info('  Open http://localhost:5173');

    ssh.dispose();
  } catch (err) {
    logger.error(err.message);
    process.exit(1);
  }
}

export async function statusCommand() {
  const state = loadState();
  if (!state) {
    logger.info('No active connection');
    return;
  }

  console.log('');
  logger.info(`Host:        ${state.host}`);
  logger.info(`User:        ${state.user}`);
  logger.info(`Device:      ${state.device}`);
  logger.info(`Connected:   ${state.connectedAt}`);

  if (state.websockifyPort) {
    logger.info(`Stream URL:  ws://${state.host}:${state.websockifyPort}`);
  }
  console.log('');
}
