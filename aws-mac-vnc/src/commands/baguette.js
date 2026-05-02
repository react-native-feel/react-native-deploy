import { logger } from '../utils/logger.js';
import { saveState } from '../infra/state.js';
import { connectWithRetry } from '../remote/ssh.js';
import {
  preflightBaguette,
  installBaguette,
  resolveDeviceUdid,
  bootViaBaguette,
  startBaguetteServer,
  waitForBaguette,
} from '../remote/baguette-setup.js';

export async function baguetteCommand(options) {
  const { host, user, key, password: sshPassword, sshPort, device, runtime, port } = options;

  if (!key && !sshPassword) {
    logger.error('Either --key or --password is required for SSH authentication');
    process.exit(1);
  }

  const baguettePort = parseInt(port, 10);

  try {
    logger.info(`Connecting to ${host}:${sshPort || 22} via SSH...`);
    const ssh = await connectWithRetry(host, key, { username: user, password: sshPassword, port: sshPort });

    await preflightBaguette(ssh);
    await installBaguette(ssh);
    const udid = await resolveDeviceUdid(ssh, device, runtime);
    await bootViaBaguette(ssh, udid);
    await startBaguetteServer(ssh, baguettePort);
    await waitForBaguette(ssh, baguettePort);

    saveState({
      mode: 'baguette',
      host,
      user,
      keyPath: key || null,
      baguettePort,
      device,
      udid,
      connectedAt: new Date().toISOString(),
    });

    const authFlag = key ? `-i ${key}` : '';
    const portFlag = sshPort && String(sshPort) !== '22' ? `-p ${sshPort}` : '';
    const tunnelCmd = `ssh ${authFlag} ${portFlag} -L ${baguettePort}:localhost:${baguettePort} ${user}@${host}`
      .replace(/\s+/g, ' ')
      .trim();

    console.log('');
    logger.success('baguette is ready!');
    logger.info(`Device:  ${device} (${udid})`);
    logger.info('');
    logger.info('baguette only binds to 127.0.0.1 — open an SSH tunnel in another terminal:');
    logger.info(`  ${tunnelCmd}`);
    logger.info('');
    logger.info('Then open in your browser:');
    logger.info(`  http://localhost:${baguettePort}/simulators`);
    logger.info(`  http://localhost:${baguettePort}/farm`);

    ssh.dispose();
  } catch (err) {
    logger.error(err.message);
    process.exit(1);
  }
}
