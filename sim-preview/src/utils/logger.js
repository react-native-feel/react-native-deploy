import chalk from 'chalk';
import ora from 'ora';

class Logger {
  #spinner = null;
  #verbose = false;

  setVerbose(v) { this.#verbose = v; }

  info(msg) { console.log(chalk.blue('ℹ'), msg); }
  success(msg) { console.log(chalk.green('✔'), msg); }
  warn(msg) { console.log(chalk.yellow('⚠'), msg); }
  error(msg) { console.error(chalk.red('✖'), msg); }

  step(current, total, msg) {
    console.log(chalk.cyan(`[${current}/${total}]`), msg);
  }

  debug(msg) {
    if (this.#verbose) console.log(chalk.gray(msg));
  }

  startSpinner(msg) {
    this.#spinner = ora(msg).start();
    return this.#spinner;
  }

  stopSpinner(success = true, msg) {
    if (!this.#spinner) return;
    if (success) this.#spinner.succeed(msg);
    else this.#spinner.fail(msg);
    this.#spinner = null;
  }
}

export const logger = new Logger();
