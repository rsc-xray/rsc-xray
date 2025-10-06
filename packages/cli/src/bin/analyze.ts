#!/usr/bin/env node
import { cwd } from 'node:process';
import { resolve } from 'node:path';

import { analyze } from '../commands/analyze';

interface CliOptions {
  projectRoot?: string;
  distDir?: string;
  appDir?: string;
  outputPath?: string;
  pretty?: boolean;
  help?: boolean;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {};

  for (let index = 0; index < argv.length; index += 1) {
    const rawArg = argv[index];
    if (!rawArg) {
      continue;
    }
    const arg = rawArg;
    switch (arg) {
      case '--project': {
        const value = argv[index + 1];
        if (value) {
          options.projectRoot = value;
          index += 1;
        } else {
          console.warn('--project requires a path argument');
        }
        break;
      }
      case '--dist': {
        const value = argv[index + 1];
        if (value) {
          options.distDir = value;
          index += 1;
        } else {
          console.warn('--dist requires a directory argument');
        }
        break;
      }
      case '--app': {
        const value = argv[index + 1];
        if (value) {
          options.appDir = value;
          index += 1;
        } else {
          console.warn('--app requires a directory argument');
        }
        break;
      }
      case '--out': {
        const value = argv[index + 1];
        if (value) {
          options.outputPath = value;
          index += 1;
        } else {
          console.warn('--out requires a file path argument');
        }
        break;
      }
      case '--pretty': {
        options.pretty = true;
        break;
      }
      case '--no-pretty': {
        options.pretty = false;
        break;
      }
      case '--help':
      case '-h': {
        options.help = true;
        break;
      }
      default: {
        if (options.help) {
          break;
        }
        if (arg.startsWith('-')) {
          console.warn(`Unknown flag: ${arg}`);
        }
      }
    }
  }

  return options;
}

function printUsage() {
  console.log(
    'Usage: analyze [--project <path>] --out <file> [--dist <.next>] [--app <appDir>] [--no-pretty]'
  );
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2));

  if (parsed.help) {
    printUsage();
    process.exit(0);
  }

  const baseDir = process.env['INIT_CWD'] ?? cwd();
  const projectRoot = resolve(baseDir, parsed.projectRoot ?? '.');
  const rawOutputPath = parsed.outputPath;

  if (!rawOutputPath) {
    console.error('Missing required --out <file> argument');
    printUsage();
    process.exit(1);
    return;
  }

  try {
    const options = {
      projectRoot,
      outputPath: resolve(baseDir, rawOutputPath),
    } as Parameters<typeof analyze>[0];

    if (parsed.distDir) {
      options.distDir = parsed.distDir;
    }
    if (parsed.appDir) {
      options.appDir = parsed.appDir;
    }
    if (typeof parsed.pretty === 'boolean') {
      options.pretty = parsed.pretty;
    }

    await analyze(options);
  } catch (error) {
    console.error('Failed to analyze project:', (error as Error).message);
    process.exitCode = 1;
  }
}

main();
