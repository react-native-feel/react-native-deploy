import readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import chalk from 'chalk';

async function ask(question) {
  const rl = readline.createInterface({ input: stdin, output: stdout });
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}

export async function input(message, defaultValue = '') {
  const suffix = defaultValue ? chalk.gray(` (${defaultValue})`) : '';
  const answer = await ask(`${chalk.cyan('?')} ${message}${suffix} `);
  return answer || defaultValue;
}

export async function secret(message) {
  // Node's readline has no portable echo suppression that survives Ctrl-C
  // cleanly, so we warn instead of silently echoing a password.
  console.log(chalk.gray('  (input is visible — paste carefully)'));
  return ask(`${chalk.cyan('?')} ${message} `);
}

export async function confirm(message, defaultYes = true) {
  const hint = defaultYes ? 'Y/n' : 'y/N';
  const answer = (await ask(`${chalk.cyan('?')} ${message} ${chalk.gray(`(${hint})`)} `)).toLowerCase();
  if (!answer) return defaultYes;
  return answer === 'y' || answer === 'yes';
}

export async function select(message, choices) {
  console.log(`${chalk.cyan('?')} ${message}`);
  choices.forEach((c, i) => console.log(chalk.gray(`  ${i + 1}) ${c}`)));
  const answer = await ask(`${chalk.cyan('›')} `);
  const idx = parseInt(answer, 10) - 1;
  if (Number.isNaN(idx) || idx < 0 || idx >= choices.length) return choices[0];
  return choices[idx];
}
