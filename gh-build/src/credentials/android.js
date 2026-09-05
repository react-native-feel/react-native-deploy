import { readFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { run } from '../utils/exec.js';
import { logger } from '../utils/logger.js';

const VALIDITY_DAYS = 10000; // Play Store requires a key valid past 2033

/**
 * Creates an upload/release keystore with keytool. No Mac and no Android Studio
 * needed — any JDK will do.
 */
export async function createAndroidKeystore({
  appName,
  alias = 'upload',
  organization = appName,
  country = 'US',
}) {
  const work = mkdtempSync(join(tmpdir(), 'rn-build-keystore-'));
  try {
    const keystorePath = join(work, 'release.jks');
    const storePassword = randomBytes(18).toString('base64url');
    const keyPassword = storePassword;

    logger.info(`Generating release keystore (alias "${alias}", valid ${VALIDITY_DAYS} days)...`);
    await run('keytool', [
      '-genkeypair',
      '-v',
      '-keystore', keystorePath,
      '-alias', alias,
      '-keyalg', 'RSA',
      '-keysize', '2048',
      '-validity', String(VALIDITY_DAYS),
      '-storetype', 'PKCS12',
      '-storepass', storePassword,
      '-keypass', keyPassword,
      '-dname', `CN=${appName}, O=${organization}, C=${country}`,
    ]);

    const result = {
      keystoreBase64: readFileSync(keystorePath).toString('base64'),
      storePassword,
      keyPassword,
      keyAlias: alias,
    };

    logger.success(`Android keystore ready (alias "${alias}")`);
    logger.warn(
      'This keystore is the only thing that can sign updates to your Play listing. ' +
      'Back up the secret values printed by "rn-build credentials export" somewhere safe.'
    );
    return result;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/** Imports a keystore the user already has, so existing Play apps keep signing. */
export async function importAndroidKeystore({ path, storePassword, keyPassword, keyAlias }) {
  if (!existsSync(path)) {
    throw new Error(`Keystore not found at ${path}`);
  }

  // Fail here rather than three minutes into a Gradle run on the runner.
  try {
    await run('keytool', ['-list', '-keystore', path, '-storepass', storePassword, '-alias', keyAlias]);
  } catch {
    throw new Error(
      `Could not read alias "${keyAlias}" from ${path} with the given store password. ` +
      `List what's in it with:\n  keytool -list -v -keystore ${path}`
    );
  }

  return {
    keystoreBase64: readFileSync(path).toString('base64'),
    storePassword,
    keyPassword: keyPassword || storePassword,
    keyAlias,
  };
}
