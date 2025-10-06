#!/usr/bin/env node
import { cwd } from 'node:process';

import { printManifest } from '../commands/printManifest';

type ParseResult = { help: true } | { projectRoot?: string; distDir?: string };

function parseArgs(argv: string[]): ParseResult {
  let projectRoot: string | undefined;
  let distDir: string | undefined;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--project') {
      const value = argv[i + 1];
      if (value) {
        projectRoot = value;
        i += 1;
      }
    } else if (arg === '--dist') {
      const value = argv[i + 1];
      if (value) {
        distDir = value;
        i += 1;
      }
    } else if (arg === '--help' || arg === '-h') {
      return { help: true };
    }
  }

  const result: { projectRoot?: string; distDir?: string } = {};
  if (projectRoot) {
    result.projectRoot = projectRoot;
  }
  if (distDir) {
    result.distDir = distDir;
  }
  return result;
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2));

  if ('help' in parsed) {
    console.log('Usage: print-manifest --project <path> [--dist <.next>]');
    process.exit(0);
  }

  const projectRoot = parsed.projectRoot ?? cwd();

  try {
    const options = { projectRoot } as Parameters<typeof printManifest>[0];
    if (parsed.distDir) {
      options.distDir = parsed.distDir;
    }
    await printManifest(options);
  } catch (error) {
    console.error('Failed to read manifests:', (error as Error).message);
    process.exitCode = 1;
  }
}

main();
