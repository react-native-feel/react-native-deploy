import chalk from 'chalk';

const DEBUG = !!process.env.RN_BUILD_DEBUG;

export const logger = {
  info: (msg) => console.log(chalk.blue('›'), msg),
  success: (msg) => console.log(chalk.green('✓'), msg),
  warn: (msg) => console.log(chalk.yellow('!'), msg),
  error: (msg) => console.error(chalk.red('✗'), msg),
  debug: (msg) => DEBUG && console.log(chalk.gray('  ' + msg)),
  step: (n, total, msg) => console.log(chalk.cyan(`\n[${n}/${total}]`), chalk.bold(msg)),
  plain: (msg = '') => console.log(msg),
  dim: (msg) => console.log(chalk.gray(msg)),
};
