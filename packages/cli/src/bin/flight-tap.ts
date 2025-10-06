#!/usr/bin/env node
import { writeFile } from 'node:fs/promises';
import process from 'node:process';

import { flightTap } from '../commands/flightTap';

interface ParsedArgs {
  url: string;
  route?: string;
  out?: string;
  timeoutMs?: number;
  help?: boolean;
}

function parseArgs(argv: string[]): ParsedArgs {
  let url = 'http://localhost:3000/products';
  let out: string | undefined;
  let route: string | undefined;
  let timeoutMs: number | undefined;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--url' || arg === '-u') {
      const value = argv[i + 1];
      if (value) {
        url = value;
        i += 1;
      }
    } else if (arg === '--route' || arg === '-r') {
      const value = argv[i + 1];
      if (value) {
        route = value;
        i += 1;
      }
    } else if (arg === '--out' || arg === '-o') {
      const value = argv[i + 1];
      if (value) {
        out = value;
        i += 1;
      }
    } else if (arg === '--timeout' || arg === '--timeout-ms') {
      const raw = argv[i + 1];
      if (raw) {
        const value = Number(raw);
        if (Number.isFinite(value) && value >= 0) {
          timeoutMs = Math.floor(value);
        }
        i += 1;
      }
    } else if (arg === '--help' || arg === '-h') {
      return { help: true, url };
    }
  }

  const result: ParsedArgs = { url };
  if (route) {
    result.route = route;
  }
  if (out) {
    result.out = out;
  }
  if (typeof timeoutMs === 'number') {
    result.timeoutMs = timeoutMs;
  }
  return result;
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed.help) {
    console.log(
      'Usage: flight-tap [--url http://localhost:3000/products] [--route /products/[id]] [--out .scx/flight.json] [--timeout 30000]'
    );
    process.exit(0);
  }

  try {
    const tapOptions = {
      url: parsed.url,
    } as Parameters<typeof flightTap>[0];

    if (parsed.route) {
      tapOptions.route = parsed.route;
    }
    if (typeof parsed.timeoutMs === 'number') {
      tapOptions.timeoutMs = parsed.timeoutMs;
    }

    const result = await flightTap(tapOptions);
    const outputPath = parsed.out;
    if (outputPath) {
      const payload = { samples: result.samples };
      await writeFile(outputPath, JSON.stringify(payload, null, 2), 'utf8');
      console.log(
        `[scx-flight] wrote ${result.samples.length} samples (${result.chunks} chunks) to ${outputPath}`
      );
    }
  } catch (error) {
    console.error('[scx-flight] failed:', (error as Error).message);
    process.exitCode = 1;
  }
}

main();
