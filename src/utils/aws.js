import { execFileSync, execFile } from 'node:child_process';

// Builds an argument array for execFileSync('aws', args) — avoids shell injection
export function buildAwsArgs(service, action, options = {}) {
  const args = [service, action];
  for (const [key, value] of Object.entries(options)) {
    if (value === true) {
      args.push(`--${key}`);
    } else if (value !== false && value !== null && value !== undefined) {
      args.push(`--${key}`, String(value));
    }
  }
  args.push('--output', 'json');
  return args;
}

// For tests: reconstructs the command string for assertions
export function buildAwsCommand(service, action, options = {}) {
  return ['aws', ...buildAwsArgs(service, action, options)].join(' ');
}

export function parseAwsJson(output) {
  try {
    return JSON.parse(output.trim());
  } catch {
    throw new Error(`Failed to parse AWS CLI output: ${output.substring(0, 200)}`);
  }
}

export function awsExec(service, action, options = {}) {
  const args = buildAwsArgs(service, action, options);
  try {
    const output = execFileSync('aws', args, { encoding: 'utf-8', timeout: 30000 });
    return parseAwsJson(output);
  } catch (err) {
    throw new Error(`AWS CLI error: ${err.message}`);
  }
}

export function awsExecAsync(service, action, options = {}) {
  const args = buildAwsArgs(service, action, options);
  return new Promise((resolve, reject) => {
    execFile('aws', args, { encoding: 'utf-8', timeout: 60000 }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(`AWS CLI error: ${stderr || err.message}`));
        return;
      }
      try {
        resolve(parseAwsJson(stdout));
      } catch (parseErr) {
        reject(parseErr);
      }
    });
  });
}
