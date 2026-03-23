import { execSync } from 'node:child_process';
import { logger } from '../utils/logger.js';

const SG_NAME = 'mac-vnc-sg';

export function getCurrentIp() {
  return execSync('curl -s https://checkip.amazonaws.com', { encoding: 'utf-8' }).trim();
}

export function ensureSecurityGroup(region) {
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
