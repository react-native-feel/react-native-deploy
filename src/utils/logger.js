import chalk from 'chalk';
import ora from 'ora';

export class Logger {
  constructor(verbose = false) {
    this.verbose = verbose;
    this._spinner = null;
  }

  info(msg) {
    process.stdout.write(chalk.blue('ℹ') + ` ${msg}\n`);
  }

  success(msg) {
    process.stdout.write(chalk.green('✔') + ` ${msg}\n`);
  }

  warn(msg) {
    process.stdout.write(chalk.yellow('⚠') + ` ${msg}\n`);
  }

  error(msg) {
    process.stderr.write(chalk.red('✖') + ` ${msg}\n`);
  }

  step(current, total, msg) {
    process.stdout.write(chalk.cyan(`[${current}/${total}]`) + ` ${msg}\n`);
  }

  debug(msg) {
    if (this.verbose) {
      process.stdout.write(chalk.gray(`  ${msg}\n`));
    }
  }

  spinner(msg) {
    this._spinner = ora(msg).start();
    return this._spinner;
  }

  stopSpinner(success = true, msg) {
    if (this._spinner) {
      if (success) {
        this._spinner.succeed(msg);
      } else {
        this._spinner.fail(msg);
      }
      this._spinner = null;
    }
  }
}

export const logger = new Logger();
