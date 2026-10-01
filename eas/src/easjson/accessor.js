import { codeFrameColumns } from '@babel/code-frame';
import chalk from 'chalk';
import * as fleece from 'golden-fleece';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import { InvalidEasJsonError, MissingEasJsonError } from './errors.js';
import { EasJsonSchema } from './schema.js';

/**
 * Reads, validates and rewrites eas.json.
 *
 * Two details are easy to miss and both are real compatibility requirements:
 *
 *   - eas.json is *JSON5*. Plenty of committed eas.json files carry comments or
 *     trailing commas, and `JSON.parse` rejects them. We try strict JSON first
 *     and fall back to golden-fleece, exactly as EAS does.
 *   - writes go through `fleece.patch`, which edits the existing text in place
 *     rather than reserialising. That is what preserves a user's comments and
 *     formatting when `eas build:configure` adds a profile.
 */

const customErrorMessageHandlers = [
  // An unrecognised build image is nearly always a stale CLI rather than a typo,
  // so EAS replaces Joi's "must be one of…" with an upgrade hint. Matched on the
  // exact path shape: build.<profile>.<platform>.image
  (err) => {
    for (const detail of err.details) {
      if (
        detail.path.length === 4 &&
        detail.path[0] === 'build' &&
        ['ios', 'android'].includes(String(detail.path[2])) &&
        detail.path[3] === 'image'
      ) {
        throw new InvalidEasJsonError(
          chalk.red(
            `Specified build image '${detail?.context}' is not recognized. Please update your EAS CLI and see https://docs.expo.dev/build-reference/infrastructure/ for supported build images.`
          )
        );
      }
    }
  },
];

export class EasJsonAccessor {
  #easJsonPath;
  #isJson5 = false;
  #easJson;
  #easJsonRawContents;
  #easJsonRawObject;
  #easJsonPatched = false;

  constructor({ projectDir, easJsonRawContents }) {
    this.#easJsonPath = projectDir && EasJsonAccessor.formatEasJsonPath(projectDir);
    this.#easJsonRawContents = easJsonRawContents;
  }

  static fromProjectPath(projectDir) {
    return new EasJsonAccessor({ projectDir });
  }

  static fromRawString(easJsonRawContents) {
    return new EasJsonAccessor({ easJsonRawContents });
  }

  static formatEasJsonPath(projectDir) {
    return join(projectDir, 'eas.json');
  }

  // `@expo/eas-json` exposes these as async. Nothing here actually awaits, but
  // keeping the names means code written against the real package — including
  // our own differential tests — runs unmodified against this one.
  async readAsync() {
    return this.read();
  }

  async writeAsync() {
    return this.write();
  }

  async readRawJsonAsync() {
    return this.readRawJson();
  }

  read() {
    if (this.#easJson) {
      return this.#easJson;
    }

    const rawJSON = this.readRawJson();
    const { value, error } = EasJsonSchema.validate(rawJSON, {
      allowUnknown: false,
      abortEarly: false,
      convert: true,
      noDefaults: true,
    });
    if (error) {
      for (const handler of customErrorMessageHandlers) {
        handler(error);
      }
      const errorMessages = error.message.split('. ');
      throw new InvalidEasJsonError(
        `${chalk.bold('eas.json')} is not valid.\n- ${errorMessages.join('\n- ')}`
      );
    }
    this.#easJson = value;
    return value;
  }

  write() {
    if (!this.#easJsonPath) {
      throw new Error('Updates are not supported for EasJsonAccessor created from string.');
    }
    if (!this.#easJsonPatched || !this.#easJsonRawContents) {
      return;
    }
    writeFileSync(this.#easJsonPath, this.#easJsonRawContents);
    this.#resetState();
  }

  patch(fn) {
    if (!this.#easJsonPath) {
      throw new Error('Updates are not supported for EasJsonAccessor created from string.');
    }
    if (!this.#easJsonRawContents || !this.#easJsonRawObject) {
      throw new Error('call read/readRawJson first');
    }

    this.#easJsonRawObject = fn(this.#easJsonRawObject);
    if (this.#isJson5) {
      this.#easJsonRawContents = fleece.patch(this.#easJsonRawContents, this.#easJsonRawObject);
    } else {
      this.#easJsonRawContents = `${JSON.stringify(this.#easJsonRawObject, null, 2)}\n`;
    }
    this.#easJsonPatched = true;
  }

  readRawJson() {
    if (this.#easJsonPath) {
      if (!existsSync(this.#easJsonPath)) {
        throw new MissingEasJsonError(
          `${chalk.bold('eas.json')} could not be found at ${this.#easJsonPath}. Learn more at https://expo.fyi/eas-json`
        );
      }
      this.#easJsonRawContents = readFileSync(this.#easJsonPath, 'utf-8');
    }
    return this.#parseRawJson();
  }

  #parseRawJson() {
    if (this.#easJsonRawContents === undefined) {
      throw new Error('easJsonRawContents needs to be set before calling parseRawJson');
    }
    if (this.#easJsonRawContents.trim().length === 0) {
      throw new InvalidEasJsonError(`${chalk.bold('eas.json')} is empty.`);
    }

    try {
      const rawJSON = JSON.parse(this.#easJsonRawContents);
      this.#easJsonRawObject = rawJSON;
      return rawJSON;
    } catch {
      // not strict JSON — fall through to JSON5
    }

    try {
      const rawJSON = fleece.evaluate(this.#easJsonRawContents);
      this.#easJsonRawObject = rawJSON;
      this.#isJson5 = true;
      return rawJSON;
    } catch (originalError) {
      if (originalError.loc) {
        const err = new InvalidEasJsonError(
          `Found invalid character in ${chalk.bold('eas.json')}.`
        );
        err.message += `\n${codeFrameColumns(this.#easJsonRawContents, {
          start: originalError.loc,
        })}`;
        throw err;
      }
      throw new InvalidEasJsonError(`Found invalid JSON in ${chalk.bold('eas.json')}.`);
    }
  }

  #resetState() {
    this.#isJson5 = false;
    this.#easJson = undefined;
    this.#easJsonRawContents = undefined;
    this.#easJsonRawObject = undefined;
    this.#easJsonPatched = false;
  }
}
