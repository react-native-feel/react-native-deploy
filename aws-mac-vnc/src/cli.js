import { Command } from 'commander';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf-8'));

export function createCli() {
  const program = new Command();

  program
    .name('mac-vnc')
    .version(pkg.version)
    .description('Stream iOS Simulator from a remote Mac to browser via VNC');

  program
    .command('stream')
    .description('Connect to a Mac instance and stream iOS Simulator to browser')
    .requiredOption('--host <ip>', 'Mac instance IP or hostname')
    .option('--user <name>', 'SSH username', 'admin')
    .option('--key <path>', 'Path to SSH private key')
    .option('--password <pass>', 'SSH password (if not using key)')
    .option('--device <name>', 'Simulator device name', 'iPhone 16 Pro')
    .option('--runtime <version>', 'iOS runtime version (default: latest available)')
    .option('--port <number>', 'websockify port', '6080')
    .action(async (options) => {
      const { streamCommand } = await import('./commands/stream.js');
      await streamCommand(options);
    });

  program
    .command('status')
    .description('Show current connection info')
    .action(async () => {
      const { statusCommand } = await import('./commands/stream.js');
      await statusCommand();
    });

  return program;
}
