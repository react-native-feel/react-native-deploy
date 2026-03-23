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
    .description('Stream iOS Simulator from AWS EC2 Mac to browser via VNC');

  program
    .command('stream')
    .description('Launch EC2 Mac instance and stream iOS Simulator to browser')
    .option('--device <name>', 'Simulator device name', 'iPhone 16 Pro')
    .option('--runtime <version>', 'iOS runtime version (default: latest available)')
    .option('--port <number>', 'websockify port', '6080')
    .option('--no-teardown', 'Keep instance alive after disconnect')
    .option('--region <region>', 'AWS region', 'us-east-1')
    .action(async (options) => {
      const { streamCommand } = await import('./commands/stream.js');
      await streamCommand(options);
    });

  program
    .command('down')
    .description('Terminate instance and release Dedicated Host')
    .action(async () => {
      const { downCommand } = await import('./commands/stream.js');
      await downCommand();
    });

  program
    .command('status')
    .description('Show instance status and cost')
    .action(async () => {
      const { statusCommand } = await import('./commands/stream.js');
      await statusCommand();
    });

  return program;
}
