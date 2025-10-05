import { readFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';

import * as ts from 'typescript';

import type {
  Diagnostic,
  NodeCacheMetadata,
  NodeMutationMetadata,
  RouteCacheMetadata,
  RouteEntry,
  RouteSegmentConfig,
  Suggestion,
  XNode,
} from '@rsc-xray/schemas';

import type { ClassifiedFile } from './classifyFiles.js';
import type { ClientComponentBundle } from './clientBundles.js';
import { attributeBytes } from './attributeBytes.js';
import type { FileCacheMetadata } from './cacheMetadata.js';
import {
  parseRouteSegmentConfig,
  detectConfigConflicts,
  isRouteFile,
} from '../rules/routeSegmentConfig.js';

export interface BuildGraphOptions {
  projectRoot: string;
  classifiedFiles: ClassifiedFile[];
  appDir?: string;
  diagnosticsByFile?: Record<string, Diagnostic[]>;
  clientBundles?: ClientComponentBundle[];
  suggestionsByFile?: Record<string, Suggestion[]>;
  cacheMetadataByFile?: Record<string, FileCacheMetadata>;
}

export interface BuildGraphResult {
  routes: RouteEntry[];
  nodes: Record<string, XNode>;
}

type NodeKind = XNode['kind'];

interface ModuleMeta {
  id: string;
  filePath: string; // posix relative path from project root
  absPath: string;
  kind: NodeKind;
  imports: string[]; // module ids
}

const SUPPORTED_EXTENSIONS = ['.tsx', '.ts', '.jsx', '.js'];

function toPosixPath(value: string): string {
  return value.replace(/\\/g, '/');
}

function normalizeRelativePath(projectRoot: string, absPath: string): string {
  const rel = relative(projectRoot, absPath) || absPath;
  return toPosixPath(rel);
}

function deriveRouteFromAppFile(appDir: string, filePath: string): string | undefined {
  const segments = filePath.split('/');

  if (segments[0] !== appDir) {
    return undefined;
  }

  const fileName = segments[segments.length - 1];
  if (!fileName) {
    return undefined;
  }
  const baseName = fileName.split('.')[0];

  if (baseName !== 'page') {
    return undefined;
  }

  const withoutFile = segments.slice(1, -1); // drop app dir + filename

  const routeSegments = withoutFile
    .map((segment) => segment.replace(/^\(([^)]+)\)$/, ''))
    .filter((segment) => segment.length > 0);

  if (routeSegments.length === 0) {
    return '/';
  }

  return `/${routeSegments.join('/')}`;
}

function createNodeId(kind: NodeKind, key: string): string {
  return `${kind}:${key}`;
}

function createRouteCacheMetadata(
  meta: FileCacheMetadata | undefined
): RouteCacheMetadata | undefined {
  if (!meta) {
    return undefined;
  }

  const cache: RouteCacheMetadata = {};

  if (meta.hasRevalidateFalse) {
    cache.revalidateSeconds = false;
  } else if (meta.revalidateSeconds.size > 0) {
    const values = Array.from(meta.revalidateSeconds).filter((value) => Number.isFinite(value));
    if (values.length) {
      cache.revalidateSeconds = Math.min(...values);
    }
  }

  if (meta.tags.size) {
    cache.tags = Array.from(meta.tags).sort();
  }

  if (meta.exportedDynamic) {
    cache.dynamic = meta.exportedDynamic;
  } else if (meta.usesDynamicApis) {
    cache.dynamic = 'force-dynamic';
  }

  if (meta.experimentalPpr) {
    cache.experimentalPpr = true;
  }

  return Object.keys(cache).length ? cache : undefined;
}

async function extractRelativeImports(absPath: string): Promise<string[]> {
  const sourceText = await readFile(absPath, 'utf8');
  const sourceFile = ts.createSourceFile(
    absPath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    absPath.endsWith('.tsx') || absPath.endsWith('.jsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );

  const imports: string[] = [];

  sourceFile.forEachChild((node) => {
    if (
      ts.isImportDeclaration(node) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      imports.push(node.moduleSpecifier.text);
    }
  });

  return imports;
}

function resolveImport(
  projectRoot: string,
  fromFile: string,
  importPath: string,
  availableFiles: Set<string>
): string | undefined {
  if (!importPath.startsWith('.') && !importPath.startsWith('/')) {
    return undefined;
  }

  const fromDir = dirname(fromFile);
  const basePath = resolve(fromDir, importPath);

  const candidates: string[] = [];

  if (SUPPORTED_EXTENSIONS.some((ext) => importPath.endsWith(ext))) {
    candidates.push(basePath);
  } else {
    for (const ext of SUPPORTED_EXTENSIONS) {
      candidates.push(`${basePath}${ext}`);
    }
    for (const ext of SUPPORTED_EXTENSIONS) {
      candidates.push(join(basePath, `index${ext}`));
    }
  }

  for (const candidate of candidates) {
    const relCandidate = normalizeRelativePath(projectRoot, candidate);
    if (availableFiles.has(relCandidate)) {
      return relCandidate;
    }
  }

  return undefined;
}

function buildModuleId(filePath: string): string {
  return `module:${filePath}`;
}

export async function buildGraph({
  projectRoot,
  classifiedFiles,
  appDir = 'app',
  diagnosticsByFile,
  clientBundles,
  suggestionsByFile,
  cacheMetadataByFile,
}: BuildGraphOptions): Promise<BuildGraphResult> {
  const availableFiles = new Set(classifiedFiles.map((file) => toPosixPath(file.filePath)));

  const diagnosticsLookup = new Map<string, Diagnostic[]>();
  if (diagnosticsByFile) {
    for (const [filePath, diagnosticList] of Object.entries(diagnosticsByFile)) {
      if (!diagnosticList?.length) {
        continue;
      }
      const normalized = toPosixPath(filePath);
      diagnosticsLookup.set(
        normalized,
        diagnosticList.map((diagnostic) => ({ ...diagnostic }))
      );
    }
  }

  const bundleLookup = attributeBytes(clientBundles);
  const suggestionLookup = new Map<string, Suggestion[]>();
  if (suggestionsByFile) {
    for (const [filePath, suggestionList] of Object.entries(suggestionsByFile)) {
      if (!suggestionList?.length) {
        continue;
      }
      suggestionLookup.set(
        toPosixPath(filePath),
        suggestionList.map((entry) => ({ ...entry }))
      );
    }
  }

  const cacheMetadataLookup = new Map<string, FileCacheMetadata>();
  if (cacheMetadataByFile) {
    for (const [filePath, meta] of Object.entries(cacheMetadataByFile)) {
      cacheMetadataLookup.set(toPosixPath(filePath), meta);
    }
  }

  const moduleMetas = new Map<string, ModuleMeta>();

  for (const file of classifiedFiles) {
    const relPath = toPosixPath(file.filePath);
    const absPath = join(projectRoot, relPath);
    const moduleId = buildModuleId(relPath);

    const importSpecifiers = await extractRelativeImports(absPath);
    const resolvedImports: string[] = [];

    for (const specifier of importSpecifiers) {
      const resolved = resolveImport(projectRoot, absPath, specifier, availableFiles);
      if (resolved) {
        resolvedImports.push(buildModuleId(resolved));
      }
    }

    const meta: ModuleMeta = {
      id: moduleId,
      filePath: relPath,
      absPath,
      kind: file.kind,
      imports: Array.from(new Set(resolvedImports)).sort(),
    };

    moduleMetas.set(moduleId, meta);
  }

  const nodes: Record<string, XNode> = {};

  for (const meta of moduleMetas.values()) {
    const diagnostics = diagnosticsLookup.get(meta.filePath);
    const bundle = bundleLookup[meta.filePath];
    const suggestions = suggestionLookup.get(meta.filePath);

    const cacheMetadata = cacheMetadataLookup.get(meta.filePath);
    const tagSet = new Set<string>();
    if (cacheMetadata) {
      for (const tag of cacheMetadata.tags) {
        if (tag) {
          tagSet.add(tag);
        }
      }
    }

    const nodeCache: NodeCacheMetadata | undefined = cacheMetadata
      ? (() => {
          const modes = Array.from(cacheMetadata.cacheModes);
          const revalidateSeconds = Array.from(cacheMetadata.revalidateSeconds).sort(
            (a, b) => a - b
          );
          const hasRevalidateFalse = cacheMetadata.hasRevalidateFalse;
          const dynamic =
            cacheMetadata.exportedDynamic ??
            (cacheMetadata.usesDynamicApis ? 'force-dynamic' : undefined);
          const experimentalPpr = cacheMetadata.experimentalPpr;

          if (
            !modes.length &&
            !revalidateSeconds.length &&
            !hasRevalidateFalse &&
            !dynamic &&
            !experimentalPpr
          ) {
            return undefined;
          }
          const result: NodeCacheMetadata = {};
          if (modes.length) {
            result.modes = modes;
          }
          if (revalidateSeconds.length) {
            result.revalidateSeconds = revalidateSeconds;
          }
          if (hasRevalidateFalse) {
            result.hasRevalidateFalse = true;
          }
          if (dynamic) {
            result.dynamic = dynamic;
          }
          if (experimentalPpr) {
            result.experimentalPpr = true;
          }
          return result;
        })()
      : undefined;

    const nodeMutations: NodeMutationMetadata | undefined = cacheMetadata
      ? (() => {
          const mutationTags = Array.from(cacheMetadata.revalidateTagCalls).sort();
          const mutationPaths = Array.from(cacheMetadata.revalidatePathCalls).sort();
          if (!mutationTags.length && !mutationPaths.length) {
            return undefined;
          }
          const result: NodeMutationMetadata = {};
          if (mutationTags.length) {
            result.tags = mutationTags;
          }
          if (mutationPaths.length) {
            result.paths = mutationPaths;
          }
          return result;
        })()
      : undefined;

    const nodeName = meta.filePath.split('/').pop();

    nodes[meta.id] = {
      id: meta.id,
      kind: meta.kind,
      file: meta.filePath,
      ...(nodeName ? { name: nodeName } : {}),
      children: meta.imports,
      ...(diagnostics ? { diagnostics } : {}),
      ...(bundle && bundle.totalBytes > 0 ? { bytes: bundle.totalBytes } : {}),
      ...(suggestions ? { suggestions } : {}),
      ...(tagSet.size ? { tags: Array.from(tagSet).sort() } : {}),
      ...(nodeCache ? { cache: nodeCache } : {}),
      ...(nodeMutations ? { mutations: nodeMutations } : {}),
    };
  }

  const routes: RouteEntry[] = [];

  const sortedModules = Array.from(moduleMetas.values()).sort((a, b) =>
    a.filePath.localeCompare(b.filePath)
  );

  for (const meta of sortedModules) {
    const route = deriveRouteFromAppFile(appDir, meta.filePath);
    if (!route) {
      continue;
    }

    const routeId = createNodeId('route', route);
    const routeCache = createRouteCacheMetadata(cacheMetadataLookup.get(meta.filePath));

    // Parse route segment config if this is a route file
    let segmentConfig: RouteSegmentConfig | undefined;
    const conflictDiagnostics: Diagnostic[] = [];

    if (isRouteFile(meta.filePath)) {
      try {
        const sourceText = await readFile(meta.absPath, 'utf8');
        const sourceFile = ts.createSourceFile(
          meta.filePath,
          sourceText,
          ts.ScriptTarget.Latest,
          true
        );

        segmentConfig = parseRouteSegmentConfig(sourceFile);

        if (segmentConfig) {
          const conflicts = detectConfigConflicts(sourceFile, segmentConfig, meta.filePath);
          conflictDiagnostics.push(...conflicts);
        }
      } catch {
        // Silently skip if file can't be read or parsed
      }
    }

    // Merge config diagnostics into route node
    if (conflictDiagnostics.length > 0) {
      const existing = diagnosticsLookup.get(meta.filePath) ?? [];
      diagnosticsLookup.set(meta.filePath, [...existing, ...conflictDiagnostics]);

      // Also add to the route node
      const existingRouteDiagnostics = nodes[routeId]?.diagnostics ?? [];
      nodes[routeId] = {
        ...(nodes[routeId] ?? {}),
        id: routeId,
        kind: 'route',
        name: route,
        children: [meta.id],
        ...(routeCache?.tags?.length ? { tags: routeCache.tags } : {}),
        diagnostics: [...existingRouteDiagnostics, ...conflictDiagnostics],
      } as XNode;
    } else {
      const routeNode: XNode = {
        id: routeId,
        kind: 'route',
        name: route,
        children: [meta.id],
        ...(routeCache?.tags?.length ? { tags: routeCache.tags } : {}),
      };

      nodes[routeId] = routeNode;
    }

    routes.push({
      route,
      rootNodeId: routeId,
      ...(routeCache ? { cache: routeCache } : {}),
      ...(segmentConfig ? { segmentConfig } : {}),
    });
  }

  routes.sort((a, b) => a.route.localeCompare(b.route));

  return {
    routes,
    nodes,
  };
}
