import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import path from 'node:path';

import { waitForPort } from '../tests/utils/waitForPort';
import treeKill from 'tree-kill';
import { getAvailablePort } from '../tests/utils/getAvailablePort';

const HOST = process.env['SCX_LH_HOST'] ?? '127.0.0.1';
const REQUEST_TIMEOUT_MS = 45_000;
const PERFORMANCE_THRESHOLD = Number.parseFloat(process.env['SCX_LH_MIN_SCORE'] ?? '0.5');
const exampleRoot = path.resolve(__dirname, '..');
const require = createRequire(import.meta.url);
const nextCli = require.resolve('next/dist/bin/next');

async function runLighthouseCli(targetUrl: string): Promise<{ score: number; tbt?: number }> {
  const args = [
    'exec',
    'lighthouse',
    targetUrl,
    '--quiet',
    '--only-categories=performance',
    '--output=json',
    '--output-path=stdout',
    '--chrome-flags=--headless --no-sandbox --disable-gpu --disable-dev-shm-usage',
  ];

  const child = spawn('pnpm', args, {
    cwd: exampleRoot,
    env: process.env,
    stdio: ['ignore', 'pipe', 'inherit'],
  });

  let stdout = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    stdout += chunk;
  });

  const [code] = (await once(child, 'exit')) as [number | null];
  if (code !== 0) {
    throw new Error(`Lighthouse CLI exited with code ${code ?? -1}`);
  }

  let reportRaw = stdout.trim();
  const start = reportRaw.indexOf('{');
  if (start > 0) {
    reportRaw = reportRaw.slice(start);
  }

  const report = JSON.parse(reportRaw) as {
    categories?: { performance?: { score?: number } };
    audits?: { 'total-blocking-time'?: { numericValue?: number } };
  };

  const score = report.categories?.performance?.score;
  if (typeof score !== 'number') {
    throw new Error('Lighthouse report did not include a performance score');
  }

  const tbt = report.audits?.['total-blocking-time']?.numericValue;
  return typeof tbt === 'number' ? { score, tbt } : { score };
}

async function run(): Promise<void> {
  const portEnv = process.env['SCX_LH_PORT'];
  const preferredPortEnv = portEnv ? Number.parseInt(portEnv, 10) : undefined;
  const port = await getAvailablePort(
    preferredPortEnv && Number.isFinite(preferredPortEnv) ? [preferredPortEnv, 3100] : undefined
  );
  const targetUrl = process.env['SCX_LH_URL'] ?? `http://${HOST}:${port}/products/1`;

  const server = spawn(
    process.execPath,
    [nextCli, 'dev', '--hostname', HOST, '--port', String(port)],
    {
      cwd: exampleRoot,
      env: { ...process.env, PORT: String(port) },
      stdio: 'inherit',
    }
  );

  server.on('error', (error) => {
    console.error('[scx] Failed to start example Next server', error);
  });

  try {
    await waitForPort({ port, host: HOST, timeoutMs: REQUEST_TIMEOUT_MS });
    const { score, tbt } = await runLighthouseCli(targetUrl);

    const numericScore = Math.round(score * 100);
    console.log(`[scx] Lighthouse performance score: ${numericScore}`);

    if (score < PERFORMANCE_THRESHOLD) {
      throw new Error(
        `Performance score ${numericScore} below required ${PERFORMANCE_THRESHOLD * 100}`
      );
    }

    if (typeof tbt === 'number') {
      console.log(`[scx] Total blocking time: ${Math.round(tbt)}ms`);
    }
  } finally {
    if (typeof server.pid === 'number') {
      try {
        await new Promise<void>((resolve, reject) => {
          treeKill(server.pid as number, 'SIGTERM', (error) => {
            if (error && (error as NodeJS.ErrnoException).code !== 'ESRCH') {
              reject(error);
              return;
            }
            resolve();
          });
        });
      } catch (error) {
        console.warn('[scx] Failed to terminate Next dev server cleanly', error);
      }
    }
    try {
      await once(server, 'exit');
    } catch {
      // ignore
    }
  }
}

run().catch((error) => {
  console.error('[scx] Lighthouse sanity check failed:', error);
  process.exitCode = 1;
});
