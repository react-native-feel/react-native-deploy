import { execSync } from 'node:child_process';
import { logger } from './logger.js';

export function checkCommandExists(cmd) {
  try {
    execSync(`which ${cmd}`, { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

export function checkAwsCredentials() {
  try {
    const output = execSync('aws sts get-caller-identity --output json', {
      encoding: 'utf-8',
      stdio: 'pipe',
    });
    return JSON.parse(output);
  } catch {
    return null;
  }
}

// Local prerequisites depend on the build host and distribution:
//   - AWS CLI + creds: only for the AWS host (provisions EC2 locally).
//   - asc: only for signed builds (simulator builds are unsigned, so the
//     App Store Connect key is never needed).
//   - git/ssh: always (clone + connect).
// hostKind defaults to 'aws' so the original behavior is preserved.
export async function verifyPrerequisites({ hostKind = 'aws', distribution } = {}) {
  const errors = [];

  if (hostKind === 'aws') {
    if (!checkCommandExists('aws')) {
      errors.push('AWS CLI is not installed. Install it: https://docs.aws.amazon.com/cli/latest/userguide/install-cliv2.html');
    } else {
      const identity = checkAwsCredentials();
      if (!identity) {
        errors.push('AWS credentials not configured. Run: aws configure');
      } else {
        logger.debug(`AWS account: ${identity.Account} (${identity.Arn})`);
      }
    }
  }

  if (!checkCommandExists('git')) {
    errors.push('Git is not installed. Install it: https://git-scm.com/downloads');
  }

  if (!checkCommandExists('ssh')) {
    errors.push('SSH client not found. It should be available by default on macOS/Linux.');
  }

  // Signed builds need the asc key locally; simulator builds are unsigned.
  if (distribution !== 'simulator' && !checkCommandExists('asc')) {
    errors.push('asc CLI not installed. Install it: brew install asc');
  }

  if (errors.length > 0) {
    throw new Error(`Prerequisites check failed:\n${errors.map(e => `  ✖ ${e}`).join('\n')}`);
  }

  logger.success('All prerequisites verified');
}
