import type { Writable } from 'node:stream';

import { readManifests } from '@rsc-xray/analyzer';
import type { RouteCacheMetadata } from '@rsc-xray/schemas';

interface PrintManifestOptions {
  projectRoot: string;
  distDir?: string;
  output?: Writable;
}

const DEFAULT_OUTPUT: Writable = process.stdout;

function formatBytes(bytes: number | undefined): string {
  if (!bytes || bytes <= 0) {
    return '';
  }
  const kb = bytes / 1024;
  if (kb < 1) {
    return `${bytes} B`;
  }
  return `${kb.toFixed(1)} kB`;
}

function formatCache(cache: RouteCacheMetadata | undefined): string {
  if (!cache) {
    return '';
  }

  const parts: string[] = [];

  if (typeof cache.revalidateSeconds !== 'undefined') {
    if (cache.revalidateSeconds === false) {
      parts.push('Manual revalidate');
    } else {
      parts.push(`ISR ${cache.revalidateSeconds}s`);
    }
  }

  if (cache.dynamic) {
    const label =
      cache.dynamic === 'force-dynamic'
        ? 'Force dynamic'
        : cache.dynamic === 'force-static'
          ? 'Force static'
          : cache.dynamic === 'error'
            ? 'Dynamic error'
            : 'Dynamic auto';
    parts.push(label);
  }

  if (cache.experimentalPpr) {
    parts.push('PPR');
  }

  if (cache.tags?.length) {
    parts.push(`Tags: ${cache.tags.join(', ')}`);
  }

  return parts.length ? `[cache: ${parts.join('; ')}]` : '';
}

export async function printManifest({
  projectRoot,
  distDir,
  output = DEFAULT_OUTPUT,
}: PrintManifestOptions): Promise<void> {
  const manifestOptions = { projectRoot } as Parameters<typeof readManifests>[0];
  if (distDir) {
    manifestOptions.distDir = distDir;
  }

  const { routes } = await readManifests(manifestOptions);

  const lines = routes
    .sort((a, b) => a.route.localeCompare(b.route))
    .map((route) => {
      const chunkList = route.chunks.join(', ');
      const bytesLabel = formatBytes(route.totalBytes);
      const cacheLabel = formatCache(route.cache);
      const base = bytesLabel
        ? `${route.route} -> ${chunkList} (${bytesLabel})`
        : `${route.route} -> ${chunkList}`;
      return cacheLabel ? `${base} ${cacheLabel}` : base;
    });

  if (lines.length === 0) {
    output.write('No routes found in manifests\n');
    return;
  }

  output.write(lines.join('\n'));
  output.write('\n');
}
