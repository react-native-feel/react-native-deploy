import {
  createSshConnection,
  sshOptsFromHost,
  detectShellEnvPrefix,
  withCommandPrefix,
} from './ssh.js';
import { createCuaConnection } from './cua.js';

// Connect to an external/managed build host (one rn-deploy doesn't provision)
// and return an ssh-like object with the Homebrew shellenv + UTF-8 locale
// prefix already applied. Covers both transports:
//   - macincloud (and any BYO SSH Mac): node-ssh over SSH
//   - cua: a cloud macOS sandbox over the @trycua/computer WebSocket
//
// Both expose the same execCommand/putFile/getFile/dispose surface, so every
// downstream step (provision checks, build, baguette) is transport-agnostic.
export async function connectManagedHost(host, opts = {}) {
  let ssh;
  if (host.kind === 'cua') {
    ssh = await createCuaConnection(host, opts.cua);
  } else if (host.kind === 'macincloud') {
    ssh = await createSshConnection(sshOptsFromHost(host));
  } else {
    throw new Error(`connectManagedHost: unsupported host.kind "${host.kind}"`);
  }

  // Non-login shells (SSH `host cmd`, and cua's command runner) don't add
  // /opt/homebrew/bin to PATH; load it so node/pod/aws resolve. LANG keeps
  // CocoaPods happy on a fresh shell.
  const prefix = 'export LANG=en_US.UTF-8; ' + await detectShellEnvPrefix(ssh);
  return withCommandPrefix(ssh, prefix);
}
