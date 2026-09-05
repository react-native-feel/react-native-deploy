import { writeFileSync, readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { run, runJson } from '../utils/exec.js';
import { logger } from '../utils/logger.js';

const CERT_TYPE = 'IOS_DISTRIBUTION';

const PROFILE_TYPE_BY_DISTRIBUTION = {
  'app-store': 'IOS_APP_STORE',
  'ad-hoc': 'IOS_APP_ADHOC',
  development: 'IOS_APP_DEVELOPMENT',
};

/** asc echoes raw App Store Connect JSON; `data` is an object or an array. */
function first(payload) {
  const data = payload?.data;
  return Array.isArray(data) ? data[0] : data;
}

/**
 * Generates the private key locally and only ever sends Apple a CSR, so the
 * key material never leaves this machine except as the .p12 we push to GitHub.
 * This is what makes the whole flow work without a Mac.
 */
export async function createIosCredentials({
  bundleId,
  appName,
  distribution = 'app-store',
  commonName,
  email,
  profileName,
}) {
  const profileType = PROFILE_TYPE_BY_DISTRIBUTION[distribution];
  if (!profileType) {
    throw new Error(
      `Unknown distribution "${distribution}". Expected one of: ${Object.keys(PROFILE_TYPE_BY_DISTRIBUTION).join(', ')}`
    );
  }

  const work = mkdtempSync(join(tmpdir(), 'rn-build-signing-'));
  try {
    const keyPath = join(work, 'key.pem');
    const csrPath = join(work, 'cert.csr');
    const cerPath = join(work, 'cert.cer');
    const pemPath = join(work, 'cert.pem');
    const p12Path = join(work, 'dist.p12');
    const profilePath = join(work, 'profile.mobileprovision');

    logger.info('Generating a 2048-bit signing key and CSR locally...');
    await run('openssl', ['genrsa', '-out', keyPath, '2048']);
    const subject = `/emailAddress=${email}/CN=${commonName}/C=US`;
    await run('openssl', ['req', '-new', '-key', keyPath, '-out', csrPath, '-subj', subject]);

    logger.info('Asking App Store Connect for a distribution certificate...');
    const certPayload = await createCertificate(csrPath);
    const cert = first(certPayload);
    if (!cert?.attributes?.certificateContent) {
      throw new Error('App Store Connect returned a certificate with no content.');
    }
    writeFileSync(cerPath, Buffer.from(cert.attributes.certificateContent, 'base64'));

    await run('openssl', ['x509', '-inform', 'DER', '-in', cerPath, '-out', pemPath]);
    const teamId = await readTeamIdFromCert(pemPath);

    const p12Password = randomBytes(18).toString('base64url');
    logger.info('Bundling key + certificate into a .p12...');
    await run('openssl', [
      'pkcs12', '-export',
      '-inkey', keyPath,
      '-in', pemPath,
      '-out', p12Path,
      '-name', `${appName} distribution`,
      '-macalg', 'sha256',
      '-passout', `pass:${p12Password}`,
    ]);

    logger.info(`Ensuring bundle ID ${bundleId} exists...`);
    const bundleIdRecordId = await ensureBundleId(bundleId, appName);

    const resolvedProfileName = profileName || `${appName} ${distribution} (rn-build)`;
    logger.info(`Creating provisioning profile "${resolvedProfileName}"...`);
    const profile = first(
      await createProfile({
        name: resolvedProfileName,
        profileType,
        bundleId: bundleIdRecordId,
        certificateId: cert.id,
      })
    );

    await run('asc', ['profiles', 'download', '--id', profile.id, '--output', profilePath]);

    const result = {
      teamId,
      bundleId,
      certificateId: cert.id,
      profileId: profile.id,
      profileName: profile.attributes?.name || resolvedProfileName,
      p12Base64: readFileSync(p12Path).toString('base64'),
      p12Password,
      profileBase64: readFileSync(profilePath).toString('base64'),
    };

    logger.success(
      `iOS signing ready — team ${teamId}, cert ${cert.id}, profile ${result.profileName}`
    );
    return result;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

async function createCertificate(csrPath) {
  try {
    return await runJson('asc', [
      'certificates', 'create',
      '--certificate-type', CERT_TYPE,
      '--csr', csrPath,
    ]);
  } catch (err) {
    if (/maximum number of certificates|MAXIMUM_/i.test(err.message)) {
      throw new Error(
        `Apple allows only two active distribution certificates per team, and both slots ` +
        `are taken.\nRevoke one you no longer have the private key for:\n` +
        `  asc certificates list --certificate-type ${CERT_TYPE}\n` +
        `  asc certificates revoke --id CERT_ID --confirm\n` +
        `then re-run this command.`
      );
    }
    throw err;
  }
}

/**
 * The Team ID lives in the certificate subject's OU field — the only place we
 * can read it without an extra API round-trip.
 */
async function readTeamIdFromCert(pemPath) {
  const { stdout } = await run('openssl', ['x509', '-in', pemPath, '-noout', '-subject']);
  const match = stdout.match(/OU\s*=\s*([A-Z0-9]+)/);
  if (!match) {
    throw new Error(`Could not read the Team ID from the certificate subject: ${stdout.trim()}`);
  }
  return match[1];
}

async function ensureBundleId(identifier, appName) {
  const existing = await runJson('asc', ['bundle-ids', 'list', '--paginate']);
  const match = (existing.data || []).find((b) => b.attributes?.identifier === identifier);
  if (match) {
    logger.debug(`bundle id ${identifier} already registered (${match.id})`);
    return match.id;
  }

  const created = first(
    await runJson('asc', [
      'bundle-ids', 'create',
      '--identifier', identifier,
      '--name', appName,
      '--platform', 'IOS',
    ])
  );
  logger.debug(`bundle id ${identifier} created (${created.id})`);
  return created.id;
}

async function createProfile({ name, profileType, bundleId, certificateId }) {
  try {
    return await runJson('asc', [
      'profiles', 'create',
      '--name', name,
      '--profile-type', profileType,
      '--bundle', bundleId,
      '--certificate', certificateId,
    ]);
  } catch (err) {
    if (/already exists|ENTITY_ERROR.*name/i.test(err.message)) {
      throw new Error(
        `A provisioning profile named "${name}" already exists. Delete it or pass a ` +
        `different --profile-name:\n  asc profiles list --paginate\n  asc profiles delete --id ID --confirm`
      );
    }
    throw err;
  }
}

export async function verifyAscAuth() {
  try {
    await runJson('asc', ['bundle-ids', 'list', '--limit', '1']);
    return true;
  } catch (err) {
    throw new Error(
      `asc is not authenticated with App Store Connect.\n` +
      `Run:\n  asc auth login --name rn-build --key-id KEY_ID --issuer-id ISSUER_ID --private-key ./AuthKey.p8\n\n` +
      `Underlying error: ${err.message.split('\n').slice(-1)[0]}`
    );
  }
}
