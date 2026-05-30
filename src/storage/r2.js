import { execFileSync } from 'node:child_process';
import { logger } from '../utils/logger.js';

// R2 is S3-compatible. We shell out to the `aws` CLI with a custom endpoint
// so we don't pull in a heavy SDK. Same pattern used in src/utils/aws.js.
export function createR2Adapter(config) {
  const endpoint = config._flavor === 's3'
    ? undefined
    : `https://${config.accountId}.r2.cloudflarestorage.com`;
  const credsEnv = resolveCreds(config);

  const env = {
    ...process.env,
    ...credsEnv,
  };

  function s3(args, { input, stream = false } = {}) {
    const fullArgs = ['s3', ...args];
    if (endpoint) fullArgs.push('--endpoint-url', endpoint);
    if (config.region) {
      // R2 ignores region but the CLI requires one; "auto" works.
    }
    try {
      return execFileSync('aws', fullArgs, {
        encoding: 'utf-8',
        input,
        stdio: stream ? 'inherit' : ['pipe', 'pipe', 'pipe'],
        env: { AWS_REGION: config.region || 'auto', ...env },
        timeout: 10 * 60 * 1000,
      });
    } catch (err) {
      const msg = err.stderr?.toString?.() || err.message;
      throw new Error(`aws s3 ${args[0]} failed: ${msg}`);
    }
  }

  return {
    kind: config.kind,
    bucket: config.bucket,
    publicBaseUrl: trimSlash(config.publicBaseUrl),

    publicUrlFor(key) {
      return `${trimSlash(config.publicBaseUrl)}/${stripLeadingSlash(key)}`;
    },

    async putFile(localPath, key, { contentType } = {}) {
      const args = ['cp', localPath, `s3://${config.bucket}/${stripLeadingSlash(key)}`];
      if (contentType) args.push('--content-type', contentType);
      logger.debug(`storage put ${localPath} -> s3://${config.bucket}/${key}`);
      s3(args);
      return this.publicUrlFor(key);
    },

    async putString(content, key, { contentType = 'text/plain' } = {}) {
      const args = [
        'cp', '-',
        `s3://${config.bucket}/${stripLeadingSlash(key)}`,
        '--content-type', contentType,
      ];
      logger.debug(`storage put-string ${key} (${content.length} bytes)`);
      s3(args, { input: content });
      return this.publicUrlFor(key);
    },

    // Read an object as a string. Returns null when the key does not exist
    // (so callers can treat a missing index as an empty one).
    async getString(key) {
      try {
        return s3(['cp', `s3://${config.bucket}/${stripLeadingSlash(key)}`, '-']);
      } catch (err) {
        if (/NoSuchKey|Not Found|404|does not exist/i.test(err.message)) return null;
        throw err;
      }
    },

    // List immediate "subdirectory" names under a prefix (CommonPrefixes).
    // Used to enumerate app slugs under builds/.
    async listPrefixes(prefix) {
      const p = stripLeadingSlash(prefix).replace(/\/?$/, '/');
      let out;
      try {
        out = s3(['ls', `s3://${config.bucket}/${p}`]);
      } catch (err) {
        if (/NoSuchKey|Not Found|404|does not exist/i.test(err.message)) return [];
        throw err;
      }
      return out
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.startsWith('PRE '))
        .map(line => line.slice(4).replace(/\/$/, ''));
    },

    // Build a remote upload command to run on the Mac instance — avoids
    // round-tripping the IPA through the local machine.
    remoteUploadCommand(remoteIpaPath, key, { contentType = 'application/octet-stream' } = {}) {
      const target = `s3://${config.bucket}/${stripLeadingSlash(key)}`;
      const envExports = [
        `AWS_ACCESS_KEY_ID="${credsEnv.AWS_ACCESS_KEY_ID}"`,
        `AWS_SECRET_ACCESS_KEY="${credsEnv.AWS_SECRET_ACCESS_KEY}"`,
        `AWS_REGION="${config.region || 'auto'}"`,
      ].join(' ');
      const endpointFlag = endpoint ? `--endpoint-url "${endpoint}"` : '';
      return `${envExports} aws s3 cp "${remoteIpaPath}" "${target}" ${endpointFlag} --content-type "${contentType}"`;
    },
  };
}

function resolveCreds(config) {
  const accessKeyId = config.accessKeyId || process.env.RN_DEPLOY_STORAGE_ACCESS_KEY_ID || process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = config.secretAccessKey || process.env.RN_DEPLOY_STORAGE_SECRET_ACCESS_KEY || process.env.R2_SECRET_ACCESS_KEY;
  if (!accessKeyId || !secretAccessKey) {
    throw new Error(
      'Storage credentials missing. Set storage.accessKeyId/secretAccessKey in deploy.config.json ' +
      'or RN_DEPLOY_STORAGE_ACCESS_KEY_ID / RN_DEPLOY_STORAGE_SECRET_ACCESS_KEY env vars.'
    );
  }
  return {
    AWS_ACCESS_KEY_ID: accessKeyId,
    AWS_SECRET_ACCESS_KEY: secretAccessKey,
  };
}

function trimSlash(s) { return s.replace(/\/+$/, ''); }
function stripLeadingSlash(s) { return s.replace(/^\/+/, ''); }
