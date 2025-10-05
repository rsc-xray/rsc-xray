#!/usr/bin/env node
import { cwd } from 'node:process';
import { resolve } from 'node:path';

import { generateReport } from '../commands/report';

interface CliOptions {
  modelPath?: string;
  outputPath?: string;
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
      case '--model': {
        const value = argv[index + 1];
        if (value) {
          options.modelPath = value;
          index += 1;
        } else {
          console.warn('--model requires a file path argument');
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
  console.log('Usage: report --model <model.json> --out <report.html>');
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2));

  if (parsed.help) {
    printUsage();
    process.exit(0);
  }

  const baseDir = process.env['INIT_CWD'] ?? cwd();
  const modelPath = parsed.modelPath ? resolve(baseDir, parsed.modelPath) : undefined;
  const outputPath = parsed.outputPath ? resolve(baseDir, parsed.outputPath) : undefined;

  if (!modelPath || !outputPath) {
    console.error('Missing required arguments.');
    printUsage();
    process.exit(1);
    return;
  }

  try {
    await generateReport({ modelPath, outputPath });
  } catch (error) {
    console.error('Failed to render report:', (error as Error).message);
    process.exitCode = 1;
  }
}

main();
