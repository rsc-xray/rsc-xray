import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

import type {
  NextAppBuildManifest,
  NextBuildManifest,
  ParsedManifests,
} from '../types/next-manifest';

interface ReadManifestsOptions {
  projectRoot: string;
  distDir?: string;
}

interface NamedAssetSize {
  name: string;
  size: number;
}

const DEFAULT_DIST_DIR = '.next';

async function readJsonFile<T>(filePath: string): Promise<T> {
  const raw = await readFile(filePath, 'utf8');
  return JSON.parse(raw) as T;
}

async function readRequiredManifest<T>(paths: string[]): Promise<T> {
  for (const filePath of paths) {
    try {
      return await readJsonFile<T>(filePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
  }

  throw new Error(
    `Required Next.js build artifact missing (looked in: ${paths.join(
      ', '
    )}). Run "next build" for your project (e.g. "pnpm -C examples/next-app build") before executing the analyzer CLI.`
  );
}

function sumBytes(assets: NamedAssetSize[] | undefined): number | undefined {
  if (!assets || assets.length === 0) {
    return undefined;
  }
  return assets.reduce((acc, asset) => acc + asset.size, 0);
}

function decodeChunkPath(chunk: string): string {
  try {
    return decodeURIComponent(chunk);
  } catch {
    return chunk;
  }
}

async function resolveChunkSize(
  chunk: string,
  assetSizes: Record<string, number> | undefined,
  projectRoot: string,
  distDir: string,
  cache: Map<string, number>
): Promise<number> {
  if (assetSizes && typeof assetSizes[chunk] === 'number') {
    return assetSizes[chunk];
  }

  if (cache.has(chunk)) {
    return cache.get(chunk)!;
  }

  const decoded = decodeChunkPath(chunk);
  const chunkPath = join(projectRoot, distDir, decoded);

  try {
    const stats = await stat(chunkPath);
    cache.set(chunk, stats.size);
    return stats.size;
  } catch {
    if (decoded !== chunk) {
      try {
        const stats = await stat(join(projectRoot, distDir, chunk));
        cache.set(chunk, stats.size);
        return stats.size;
      } catch {
        // Ignore fallback failure below.
      }
    }
    cache.set(chunk, 0);
    return 0;
  }
}

async function sumChunkBytes(
  chunks: string[],
  assetSizes: Record<string, number> | undefined,
  projectRoot: string,
  distDir: string,
  cache: Map<string, number>
): Promise<number | undefined> {
  if (chunks.length === 0) {
    return undefined;
  }

  const sizes = await Promise.all(
    chunks.map((chunk) => resolveChunkSize(chunk, assetSizes, projectRoot, distDir, cache))
  );

  const total = sizes.reduce((acc, value) => acc + value, 0);
  return total > 0 ? total : undefined;
}

export async function readManifests({
  projectRoot,
  distDir = DEFAULT_DIST_DIR,
}: ReadManifestsOptions): Promise<ParsedManifests> {
  const manifestPath = join(projectRoot, distDir, 'build-manifest.json');
  const appManifestPaths = [
    join(projectRoot, distDir, 'server', 'app-build-manifest.json'),
    join(projectRoot, distDir, 'app-build-manifest.json'),
  ];
  const sizeManifestPath = join(projectRoot, distDir, 'build-manifest.json.__scx_sizes__');

  const [buildManifest, appBuildManifest] = await Promise.all([
    readRequiredManifest<NextBuildManifest>([manifestPath]),
    readRequiredManifest<NextAppBuildManifest>(appManifestPaths),
  ]);

  let assetSizes: Record<string, number> | undefined;
  try {
    const parsed = await readJsonFile<Record<string, NamedAssetSize[]>>(sizeManifestPath);
    assetSizes = Object.fromEntries(
      Object.entries(parsed).map(([chunk, assets]) => [chunk, sumBytes(assets) ?? 0])
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }

  const seenRoutes = new Map<string, Set<string>>();
  const normalizeRoute = (route: string): string => {
    if (route === '/') {
      return route;
    }

    const withoutPage = route.replace(/\/page$/, '');
    const withoutGroups = withoutPage.replace(/\/\([^/]+\)/g, '');
    const cleaned = withoutGroups.replace(/\/{2,}/g, '/');
    const trimmed = cleaned.length > 1 ? cleaned.replace(/\/$/, '') : cleaned;

    if (!trimmed) {
      return '/';
    }

    return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  };

  const appendRoute = (route: string, chunks: string[]) => {
    const key = normalizeRoute(route);
    if (!seenRoutes.has(key)) {
      seenRoutes.set(key, new Set());
    }
    const set = seenRoutes.get(key)!;
    chunks.forEach((chunk) => set.add(decodeChunkPath(chunk)));
  };

  Object.entries(buildManifest.pages).forEach(([route, chunks]) => appendRoute(route, chunks));
  if (buildManifest.app) {
    Object.entries(buildManifest.app).forEach(([route, chunks]) => appendRoute(route, chunks));
  }
  Object.entries(appBuildManifest.pages ?? {}).forEach(([route, chunks]) =>
    appendRoute(route, chunks)
  );

  const chunkSizeCache = new Map<string, number>();

  const routes = await Promise.all(
    Array.from(seenRoutes.entries()).map(async ([route, chunks]) => {
      const chunkArray = Array.from(chunks);
      const totalBytes = await sumChunkBytes(
        chunkArray,
        assetSizes,
        projectRoot,
        distDir,
        chunkSizeCache
      );

      return {
        route,
        chunks: chunkArray,
        totalBytes,
      };
    })
  );

  return { routes };
}
