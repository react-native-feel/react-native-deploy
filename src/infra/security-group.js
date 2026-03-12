import { execSync } from 'node:child_process';
import { logger } from '../utils/logger.js';

export function buildCreateSgCommand(name, region) {
  return `aws ec2 create-security-group --group-name ${name} --description "rn-deploy SSH access" --region ${region} --output json`;
}

export function buildAuthorizeSshCommand(sgId, ip, region) {
  return `aws ec2 authorize-security-group-ingress --group-id ${sgId} --protocol tcp --port 22 --cidr ${ip}/32 --region ${region} --output json`;
}

export async function getCurrentIp() {
  try {
    const ip = execSync('curl -s https://checkip.amazonaws.com', { encoding: 'utf-8', timeout: 10000 }).trim();
    return ip;
  } catch {
    throw new Error('Failed to determine your public IP address');
  }
}

export async function ensureSecurityGroup(name, region) {
  try {
    const output = execSync(`aws ec2 describe-security-groups --group-names ${name} --region ${region} --output json`, { encoding: 'utf-8', stdio: 'pipe' });
    const data = JSON.parse(output);
    const sgId = data.SecurityGroups[0].GroupId;
    logger.debug(`Security group "${name}" exists: ${sgId}`);
    return sgId;
  } catch { /* Doesn't exist */ }
  logger.info(`Creating security group "${name}"...`);
  const output = execSync(buildCreateSgCommand(name, region), { encoding: 'utf-8' });
  const data = JSON.parse(output);
  const sgId = data.GroupId;
  const ip = await getCurrentIp();
  logger.info(`Authorizing SSH access from ${ip}...`);
  execSync(buildAuthorizeSshCommand(sgId, ip, region), { stdio: 'pipe' });
  logger.success(`Security group created: ${sgId}`);
  return sgId;
}

export async function updateSecurityGroupIp(sgId, region) {
  const ip = await getCurrentIp();
  try {
    const output = execSync(`aws ec2 describe-security-groups --group-ids ${sgId} --region ${region} --output json`, { encoding: 'utf-8', stdio: 'pipe' });
    const data = JSON.parse(output);
    const sshRules = data.SecurityGroups[0].IpPermissions.filter(p => p.FromPort === 22 && p.ToPort === 22);
    for (const rule of sshRules) {
      for (const range of rule.IpRanges) {
        execSync(`aws ec2 revoke-security-group-ingress --group-id ${sgId} --protocol tcp --port 22 --cidr ${range.CidrIp} --region ${region}`, { stdio: 'pipe' });
      }
    }
  } catch { /* No existing rules */ }
  execSync(buildAuthorizeSshCommand(sgId, ip, region), { stdio: 'pipe' });
  logger.success(`Updated SSH access to ${ip}`);
  return ip;
}

export async function deleteSecurityGroup(name, region) {
  try {
    execSync(`aws ec2 delete-security-group --group-name ${name} --region ${region}`, { stdio: 'pipe' });
    logger.info(`Deleted security group "${name}"`);
  } catch {
    logger.debug(`Security group "${name}" not found or already deleted`);
  }
}
