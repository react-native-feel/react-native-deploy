import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { sshExec, sshDownload } from '../remote/ssh.js';
import { logger } from '../utils/logger.js';

export function getIpaFindCommand(exportPath) {
  return `find ${exportPath} -name "*.ipa" -type f | head -1`;
}

export function getLocalArtifactPath(projectDir, scheme) {
  return join(projectDir, 'build', `${scheme}.ipa`);
}

export async function findAndDownloadIpa(ssh, exportPath, localDir, scheme) {
  // Find the .ipa on remote
  const findCmd = getIpaFindCommand(exportPath);
  const result = await sshExec(ssh, findCmd);
  const remoteIpaPath = result.stdout.trim();

  if (!remoteIpaPath) {
    throw new Error(`No .ipa file found in ${exportPath}. Build may have failed.`);
  }

  logger.info(`Found .ipa: ${remoteIpaPath}`);

  // Download to local build directory
  const localBuildDir = join(localDir, 'build');
  mkdirSync(localBuildDir, { recursive: true });
  const localPath = getLocalArtifactPath(localDir, scheme);

  await sshDownload(ssh, remoteIpaPath, localPath);
  logger.success(`Downloaded .ipa to ${localPath}`);

  return { remotePath: remoteIpaPath, localPath };
}

export async function downloadSimulatorTarball(ssh, remoteTarballPath, localDir, scheme) {
  // Resolve ~ and other shell expansions to an absolute path: SFTP (getFile)
  // does NOT expand ~, so a workDir like "~/rn-deploy-work" would fail.
  const resolved = (await sshExec(ssh, `ls -d ${remoteTarballPath} 2>/dev/null || true`)).stdout.trim();
  const remoteAbs = resolved || remoteTarballPath;
  if (!resolved) {
    throw new Error(`No simulator tarball found at ${remoteTarballPath}. Build may have failed.`);
  }

  const localBuildDir = join(localDir, 'build');
  mkdirSync(localBuildDir, { recursive: true });
  const localPath = join(localBuildDir, `${scheme}.app.tgz`);

  await sshDownload(ssh, remoteAbs, localPath);
  logger.success(`Downloaded simulator app to ${localPath}`);

  return { remotePath: remoteAbs, localPath };
}
