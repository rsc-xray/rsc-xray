import { readdir, readFile, stat } from 'node:fs/promises';
import { extname, join, relative } from 'node:path';

import {
  ROUTE_WATERFALL_SUGGESTION_RULE,
  SERVER_PARALLEL_SUGGESTION_RULE,
  type Diagnostic,
  type Model,
  type NodeCacheMetadata,
  type RouteCacheMetadata,
  type RouteEntry,
  type Suggestion,
  type XNode,
} from '@rsc-xray/schemas';

import { collectClientComponentBundles } from './clientBundles.js';
import { buildGraph } from './graph.js';
import { classifyFiles } from './classifyFiles.js';
import { readManifests } from './readManifests.js';
import { collectSuggestionsForSource } from './suggestions.js';
import { collectCacheMetadata, type FileCacheMetadata } from './cacheMetadata.js';
import { analyzeClientFileForForbiddenImports } from '../rules/clientForbiddenImports.js';
import { detectClientSizeIssues } from '../rules/clientSizeThreshold.js';
import { analyzeSerializationBoundary } from '../rules/serializationBoundary.js';
import { readFlightSnapshot, readHydrationSnapshot } from './snapshots.js';

interface AnalyzeProjectOptions {
  projectRoot: string;
  distDir?: string;
  appDir?: string;
}

interface SourceEntry {
  filePath: string;
  kind: 'server' | 'client';
  sourceText: string;
  cacheMetadata: FileCacheMetadata;
}

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx']);
const IGNORED_DIRECTORIES = new Set(['node_modules', '.git', '.next', '.turbo']);

function mergeRouteCacheMetadata(
  ...sources: Array<RouteCacheMetadata | undefined>
): RouteCacheMetadata | undefined {
  let resolvedRevalidate: number | false | undefined;
  const tagSet = new Set<string>();
  let hasTags = false;
  let dynamic: RouteCacheMetadata['dynamic'];
  let experimentalPpr = false;

  for (const source of sources) {
    if (!source) {
      continue;
    }

    if (typeof source.revalidateSeconds !== 'undefined') {
      if (source.revalidateSeconds === false) {
        resolvedRevalidate = false;
      } else if (resolvedRevalidate !== false) {
        resolvedRevalidate =
          typeof resolvedRevalidate === 'number'
            ? Math.min(resolvedRevalidate, source.revalidateSeconds)
            : source.revalidateSeconds;
      }
    }

    if (source.tags?.length) {
      hasTags = true;
      for (const tag of source.tags) {
        tagSet.add(tag);
      }
    }

    if (source.dynamic) {
      dynamic = source.dynamic;
    }

    if (source.experimentalPpr) {
      experimentalPpr = true;
    }
  }

  const result: RouteCacheMetadata = {};

  if (resolvedRevalidate === false) {
    result.revalidateSeconds = false;
  } else if (typeof resolvedRevalidate === 'number') {
    result.revalidateSeconds = resolvedRevalidate;
  }

  if (hasTags) {
    result.tags = Array.from(tagSet).sort();
  }

  if (dynamic) {
    result.dynamic = dynamic;
  }

  if (experimentalPpr) {
    result.experimentalPpr = true;
  }

  return Object.keys(result).length ? result : undefined;
}

function mergeNodeCacheWithRoute(
  base: NodeCacheMetadata | undefined,
  routeCache: RouteCacheMetadata | undefined
): NodeCacheMetadata | undefined {
  if (!base && !routeCache) {
    return undefined;
  }

  const result: NodeCacheMetadata = { ...(base ?? {}) };

  if (routeCache) {
    if (typeof routeCache.revalidateSeconds !== 'undefined') {
      if (routeCache.revalidateSeconds === false) {
        result.hasRevalidateFalse = true;
        delete result.revalidateSeconds;
      } else {
        const values = new Set(result.revalidateSeconds ?? []);
        values.add(routeCache.revalidateSeconds);
        result.revalidateSeconds = Array.from(values).sort((a, b) => a - b);
      }
    }

    if (routeCache.dynamic) {
      result.dynamic = routeCache.dynamic;
    }

    if (routeCache.experimentalPpr) {
      result.experimentalPpr = true;
    }
  }

  if (result.revalidateSeconds && result.revalidateSeconds.length === 0) {
    delete result.revalidateSeconds;
  }

  return Object.keys(result).length ? result : undefined;
}

const toPosix = (value: string) => value.replace(/\\/g, '/');

function sumHydrationDuration(
  nodeId: string,
  nodes: Record<string, XNode>,
  visiting: Set<string>
): number {
  if (visiting.has(nodeId)) {
    return 0;
  }
  const node = nodes[nodeId];
  if (!node) {
    return 0;
  }
  visiting.add(nodeId);

  const shouldCountSelf = node.kind === 'client' || node.kind === 'suspense';
  let total =
    shouldCountSelf && typeof node.hydrationMs === 'number' && Number.isFinite(node.hydrationMs)
      ? node.hydrationMs
      : 0;

  for (const childId of node.children ?? []) {
    total += sumHydrationDuration(childId, nodes, visiting);
  }

  visiting.delete(nodeId);
  return total;
}

function applyHydrationDurations(
  nodes: Record<string, XNode>,
  routes: RouteEntry[],
  durations: Record<string, number>
): void {
  const entries = Object.entries(durations);
  if (!entries.length) {
    return;
  }

  for (const [nodeId, duration] of entries) {
    const node = nodes[nodeId];
    if (!node) {
      continue;
    }
    nodes[nodeId] = {
      ...node,
      hydrationMs: duration,
    };
  }

  for (const route of routes) {
    const total = sumHydrationDuration(route.rootNodeId, nodes, new Set());
    if (total <= 0) {
      continue;
    }
    const existing = nodes[route.rootNodeId];
    if (!existing) {
      continue;
    }
    nodes[route.rootNodeId] = {
      ...existing,
      hydrationMs: total,
    };
  }
}

interface WaterfallOccurrence {
  node: XNode;
  suggestion: Suggestion;
}

function collectWaterfallOccurrences(
  nodeId: string,
  nodes: Record<string, XNode>,
  visiting: Set<string>,
  out: WaterfallOccurrence[]
): void {
  if (visiting.has(nodeId)) {
    return;
  }
  const node = nodes[nodeId];
  if (!node) {
    return;
  }

  visiting.add(nodeId);

  for (const suggestion of node.suggestions ?? []) {
    if (suggestion.rule === SERVER_PARALLEL_SUGGESTION_RULE) {
      out.push({ node, suggestion });
    }
  }

  for (const childId of node.children ?? []) {
    collectWaterfallOccurrences(childId, nodes, visiting, out);
  }

  visiting.delete(nodeId);
}

function formatFileList(files: string[]): string {
  if (files.length === 0) {
    return '';
  }
  if (files.length === 1) {
    const [only] = files;
    return only ? only.replace(/\\/g, '/') : '';
  }
  if (files.length === 2) {
    const first = files[0];
    const second = files[1];
    if (!first || !second) {
      return files
        .filter((file): file is string => Boolean(file))
        .map((file) => file.replace(/\\/g, '/'))
        .join(' and ');
    }
    return `${first.replace(/\\/g, '/')} and ${second.replace(/\\/g, '/')}`;
  }
  const last = files[files.length - 1]!.replace(/\\/g, '/');
  const head = files
    .slice(0, -1)
    .map((file) => file.replace(/\\/g, '/'))
    .join(', ');
  return `${head}, and ${last}`;
}

/**
 * Collect React 19 cache() opportunities from nodes in the subtree
 */
function collectCacheOpportunities(
  nodeId: string,
  nodes: Record<string, XNode>,
  visiting: Set<string>,
  out: Set<string>
): void {
  if (visiting.has(nodeId)) {
    return;
  }
  const node = nodes[nodeId];
  if (!node) {
    return;
  }

  visiting.add(nodeId);

  for (const suggestion of node.suggestions ?? []) {
    if (suggestion.rule === 'react19-cache-opportunity' && suggestion.loc?.file) {
      out.add(suggestion.loc.file);
    }
  }

  for (const childId of node.children ?? []) {
    collectCacheOpportunities(childId, nodes, visiting, out);
  }

  visiting.delete(nodeId);
}

function applyRouteWaterfallSuggestions(nodes: Record<string, XNode>, routes: RouteEntry[]): void {
  for (const route of routes) {
    const rootId = route.rootNodeId;
    const root = nodes[rootId];
    if (!root) {
      continue;
    }

    const occurrences: WaterfallOccurrence[] = [];
    collectWaterfallOccurrences(rootId, nodes, new Set(), occurrences);
    if (occurrences.length === 0) {
      continue;
    }

    const existingSuggestions = root.suggestions ?? [];
    if (existingSuggestions.some((item) => item.rule === ROUTE_WATERFALL_SUGGESTION_RULE)) {
      continue;
    }

    const files = new Set<string>();
    for (const occurrence of occurrences) {
      const locFile = occurrence.suggestion.loc?.file;
      if (locFile) {
        files.add(locFile);
        continue;
      }
      if (occurrence.node.file) {
        files.add(occurrence.node.file);
      }
    }

    // Check for React 19 cache() opportunities in the same subtree
    const cacheOpportunityFiles = new Set<string>();
    collectCacheOpportunities(rootId, nodes, new Set(), cacheOpportunityFiles);

    // Find files that have both waterfall issues and cache opportunities
    const filesWithCacheOpportunities = Array.from(files).filter((file) =>
      cacheOpportunityFiles.has(file)
    );

    const fileList = formatFileList(Array.from(files));
    const wherePart = fileList ? ` in ${fileList}` : '';

    // Enhanced guidance based on cache() opportunities
    let guidance: string;
    if (filesWithCacheOpportunities.length > 0) {
      const cacheFileList = formatFileList(filesWithCacheOpportunities);
      guidance = `Wrap independent awaits in Promise.all, or use Next.js preload. React 19 cache() opportunities detected in ${cacheFileList} — wrapping duplicate fetch calls in cache() can help deduplicate requests and reduce waterfall impact.`;
    } else {
      guidance =
        'Wrap independent awaits in Promise.all, or use Next.js preload / React 19 cache() to start work earlier.';
    }

    const message = `Waterfall suspected${wherePart}. ${guidance}`;

    const aggregated: Suggestion = {
      rule: ROUTE_WATERFALL_SUGGESTION_RULE,
      level: 'warn',
      message,
      ...(occurrences[0]?.suggestion.loc ? { loc: occurrences[0]!.suggestion.loc } : {}),
    };

    nodes[rootId] = {
      ...root,
      suggestions: [aggregated, ...existingSuggestions],
    };
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

async function discoverSourceFiles(baseDir: string, projectRoot: string): Promise<string[]> {
  const results: string[] = [];

  async function walk(currentDir: string) {
    const entries = await readdir(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      if (IGNORED_DIRECTORIES.has(entry.name)) {
        continue;
      }
      const fullPath = join(currentDir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
        continue;
      }
      if (!SOURCE_EXTENSIONS.has(extname(entry.name))) {
        continue;
      }
      const rel = toPosix(relative(projectRoot, fullPath));
      results.push(rel);
    }
  }

  if (await pathExists(baseDir)) {
    await walk(baseDir);
  }

  results.sort();
  return results;
}

async function readNextVersion(projectRoot: string): Promise<string> {
  try {
    const pkgRaw = await readFile(join(projectRoot, 'package.json'), 'utf8');
    const pkg = JSON.parse(pkgRaw) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    return pkg.dependencies?.['next'] ?? pkg.devDependencies?.['next'] ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

export async function analyzeProject({
  projectRoot,
  distDir = '.next',
  appDir = 'app',
}: AnalyzeProjectOptions): Promise<Model> {
  const appRoot = join(projectRoot, appDir);
  const sourcePaths = await discoverSourceFiles(appRoot, projectRoot);
  const absolutePaths = sourcePaths.map((relativePath) => join(projectRoot, relativePath));

  const classified = await classifyFiles({ projectRoot, filePaths: absolutePaths });

  const sources: SourceEntry[] = await Promise.all(
    classified.map(async (entry) => {
      const absPath = join(projectRoot, entry.filePath);
      const sourceText = await readFile(absPath, 'utf8');
      return {
        filePath: toPosix(entry.filePath),
        kind: entry.kind,
        sourceText,
        cacheMetadata: collectCacheMetadata({ sourceText }),
      } as SourceEntry;
    })
  );

  const diagnosticsByFile: Record<string, Diagnostic[]> = {};

  // Analyze client components for forbidden imports
  for (const entry of sources) {
    if (entry.kind !== 'client') {
      continue;
    }
    const diagnostics = analyzeClientFileForForbiddenImports({
      fileName: entry.filePath,
      sourceText: entry.sourceText,
    });
    if (diagnostics.length > 0) {
      diagnosticsByFile[entry.filePath] = diagnostics;
    }
  }

  // Build set of known client component names for serialization boundary analysis
  const clientComponentNames = new Set<string>();
  for (const entry of sources) {
    if (entry.kind === 'client') {
      // Extract component name from file path (e.g., Button from Button.tsx)
      const fileName = entry.filePath.split('/').pop() || '';
      const componentName = fileName.replace(/\.(tsx?|jsx?)$/, '');
      clientComponentNames.add(componentName);
    }
  }

  // Analyze server components for serialization boundary violations
  for (const entry of sources) {
    if (entry.kind !== 'server') {
      continue;
    }
    const diagnostics = analyzeSerializationBoundary({
      fileName: entry.filePath,
      sourceText: entry.sourceText,
      clientComponents: clientComponentNames,
    });
    if (diagnostics.length > 0) {
      const existing = diagnosticsByFile[entry.filePath] ?? [];
      existing.push(...diagnostics);
      diagnosticsByFile[entry.filePath] = existing;
    }
  }

  const nextVersion = await readNextVersion(projectRoot);

  const suggestionsByFile: Record<string, Suggestion[]> = {};
  for (const entry of sources) {
    const suggestions = collectSuggestionsForSource({
      filePath: entry.filePath,
      sourceText: entry.sourceText,
      kind: entry.kind,
      reactVersion: nextVersion, // Pass React/Next version for React 19 cache detection
    });
    if (suggestions.length > 0) {
      suggestionsByFile[entry.filePath] = suggestions;
    }
  }

  const clientBundles = await collectClientComponentBundles({ projectRoot, distDir });
  const manifest = await readManifests({ projectRoot, distDir });

  // Check for client component size issues
  const sizeIssues = detectClientSizeIssues(clientBundles);
  for (const diagnostic of sizeIssues) {
    if (!diagnostic.loc) continue;
    const existing = diagnosticsByFile[diagnostic.loc.file] ?? [];
    existing.push(diagnostic);
    diagnosticsByFile[diagnostic.loc.file] = existing;
  }

  const cacheMetadataByFile: Record<string, FileCacheMetadata> = {};
  for (const entry of sources) {
    cacheMetadataByFile[entry.filePath] = entry.cacheMetadata;
  }

  const graph = await buildGraph({
    projectRoot,
    classifiedFiles: classified,
    diagnosticsByFile,
    clientBundles,
    suggestionsByFile,
    appDir,
    cacheMetadataByFile,
  });

  const hydrationDurations = await readHydrationSnapshot(projectRoot);

  const manifestLookup = new Map(manifest.routes.map((route) => [route.route, route]));

  const nodes = { ...graph.nodes };

  const routes = graph.routes.map((route) => {
    const info = manifestLookup.get(route.route);
    const mergedCache = mergeRouteCacheMetadata(route.cache, info?.cache);
    const result: RouteEntry = {
      ...route,
      ...(info ? { chunks: info.chunks, totalBytes: info.totalBytes } : {}),
      ...(mergedCache ? { cache: mergedCache } : {}),
    };

    const cacheForNode = mergedCache ?? route.cache ?? info?.cache;
    const currentNode = nodes[route.rootNodeId];

    if (currentNode && cacheForNode) {
      let updatedNode = currentNode;

      if (cacheForNode.tags?.length) {
        const combined = new Set<string>(currentNode.tags ?? []);
        for (const tag of cacheForNode.tags) {
          combined.add(tag);
        }
        if (combined.size) {
          updatedNode = {
            ...updatedNode,
            tags: Array.from(combined).sort(),
          };
        }
      }

      const mergedNodeCache = mergeNodeCacheWithRoute(updatedNode.cache, cacheForNode);
      if (mergedNodeCache) {
        updatedNode = {
          ...updatedNode,
          cache: mergedNodeCache,
        };
      }

      nodes[route.rootNodeId] = updatedNode;
    }

    return result;
  });

  const buildInfo = {
    nextVersion,
    timestamp: new Date().toISOString(),
  };

  applyHydrationDurations(nodes, routes, hydrationDurations);
  applyRouteWaterfallSuggestions(nodes, routes);
  const flightSamples = await readFlightSnapshot(projectRoot);

  return {
    version: '0.1',
    routes,
    nodes,
    build: buildInfo,
    ...(flightSamples.length > 0 ? { flight: { samples: flightSamples } } : {}),
  };
}
