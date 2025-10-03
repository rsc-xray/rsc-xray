import * as ts from 'typescript';
import type { RouteSegmentConfig, Diagnostic, RouteSegmentFetchCache } from '@rsc-xray/schemas';
import { createLocationFromNode } from '../lib/diagnosticHelpers.js';

const ROUTE_SEGMENT_CONFIG_CONFLICT_RULE = 'route-segment-config-conflict';

/** Internal type to track config with AST node positions */
export interface RouteSegmentConfigWithNodes extends RouteSegmentConfig {
  nodes?: {
    dynamic?: ts.Node;
    revalidate?: ts.Node;
    fetchCache?: ts.Node;
    runtime?: ts.Node;
    preferredRegion?: ts.Node;
  };
}

/**
 * Parse route segment config from a TypeScript source file
 * Looks for exported const declarations matching Next.js route segment config options
 * Returns config with AST nodes for accurate diagnostic positioning
 */
export function parseRouteSegmentConfig(
  sourceFile: ts.SourceFile
): RouteSegmentConfigWithNodes | undefined {
  const config: RouteSegmentConfigWithNodes = { nodes: {} };
  let foundAny = false;

  const visit = (node: ts.Node) => {
    // Look for: export const dynamic = 'force-static'
    if (ts.isVariableStatement(node)) {
      const isExported = node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
      if (!isExported) {
        ts.forEachChild(node, visit);
        return;
      }

      for (const declaration of node.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name)) {
          continue;
        }

        const name = declaration.name.text;
        const initializer = declaration.initializer;

        if (!initializer) {
          continue;
        }

        // Parse each config option and track AST nodes
        switch (name) {
          case 'dynamic':
            if (ts.isStringLiteral(initializer)) {
              const value = initializer.text as 'auto' | 'force-dynamic' | 'force-static' | 'error';
              if (['auto', 'force-dynamic', 'force-static', 'error'].includes(value)) {
                config.dynamic = value;
                config.nodes!.dynamic = node; // Track the export statement node
                foundAny = true;
              }
            }
            break;

          case 'revalidate':
            if (ts.isNumericLiteral(initializer)) {
              config.revalidate = parseInt(initializer.text, 10);
              config.nodes!.revalidate = node; // Track the export statement node
              foundAny = true;
            } else if (initializer.kind === ts.SyntaxKind.FalseKeyword) {
              config.revalidate = false;
              config.nodes!.revalidate = node;
              foundAny = true;
            }
            break;

          case 'fetchCache':
            if (ts.isStringLiteral(initializer)) {
              const value = initializer.text;
              if (
                [
                  'auto',
                  'default-cache',
                  'only-cache',
                  'force-cache',
                  'force-no-store',
                  'default-no-store',
                  'only-no-store',
                ].includes(value)
              ) {
                config.fetchCache = value as RouteSegmentFetchCache;
                config.nodes!.fetchCache = node;
                foundAny = true;
              }
            }
            break;

          case 'runtime':
            if (ts.isStringLiteral(initializer)) {
              const value = initializer.text;
              if (['nodejs', 'edge'].includes(value)) {
                config.runtime = value as 'nodejs' | 'edge';
                config.nodes!.runtime = node;
                foundAny = true;
              }
            }
            break;

          case 'preferredRegion':
            if (ts.isStringLiteral(initializer)) {
              config.preferredRegion = initializer.text;
              config.nodes!.preferredRegion = node;
              foundAny = true;
            } else if (ts.isArrayLiteralExpression(initializer)) {
              const regions: string[] = [];
              for (const element of initializer.elements) {
                if (ts.isStringLiteral(element)) {
                  regions.push(element.text);
                }
              }
              if (regions.length > 0) {
                config.preferredRegion = regions;
                config.nodes!.preferredRegion = node;
                foundAny = true;
              }
            }
            break;
        }
      }
    }

    ts.forEachChild(node, visit);
  };

  ts.forEachChild(sourceFile, visit);

  return foundAny ? config : undefined;
}

/**
 * Detect conflicts between route segment config and actual code behavior
 */

/** Helper to get location from AST node */
function getLocation(
  sourceFile: ts.SourceFile,
  node: ts.Node | undefined,
  filePath: string
): import('@rsc-xray/schemas').DiagnosticLocation {
  if (node) {
    return createLocationFromNode(sourceFile, node, filePath);
  }
  // Fallback: create a location at the start of the file
  return {
    file: filePath,
    range: { from: 0, to: 0 },
  };
}

export function detectConfigConflicts(
  sourceFile: ts.SourceFile,
  config: RouteSegmentConfig | RouteSegmentConfigWithNodes,
  filePath: string
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  let configWithNodes = config as RouteSegmentConfigWithNodes;

  // If nodes aren't provided (e.g., from LSP context), parse them from the source file
  if (!configWithNodes.nodes) {
    const parsed = parseRouteSegmentConfig(sourceFile);
    if (parsed) {
      configWithNodes = parsed;
    }
  }

  // Check for force-static with dynamic APIs
  if (config.dynamic === 'force-static') {
    let usesDynamicAPIs = false;
    const dynamicAPIs = [
      'cookies',
      'headers',
      'searchParams',
      'unstable_noStore',
      'unstable_after',
    ];

    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node)) {
        if (ts.isIdentifier(node.expression)) {
          const name = node.expression.text;
          if (dynamicAPIs.includes(name)) {
            usesDynamicAPIs = true;
          }
        }
      } else if (ts.isPropertyAccessExpression(node)) {
        // Check for params.searchParams
        if (ts.isIdentifier(node.name) && node.name.text === 'searchParams') {
          usesDynamicAPIs = true;
        }
      }
      ts.forEachChild(node, visit);
    };

    ts.forEachChild(sourceFile, visit);

    if (usesDynamicAPIs) {
      diagnostics.push({
        rule: ROUTE_SEGMENT_CONFIG_CONFLICT_RULE,
        level: 'error',
        message:
          'Route config \'dynamic = "force-static"\' conflicts with usage of dynamic APIs (cookies, headers, searchParams). Remove force-static or avoid dynamic APIs.',
        loc: getLocation(sourceFile, configWithNodes.nodes?.dynamic, filePath),
      });
    }
  }

  // Check for revalidate = false with ISR-like behavior
  if (config.revalidate === false && config.dynamic === 'force-static') {
    // This is actually valid (fully static), no conflict
  } else if (
    typeof config.revalidate === 'number' &&
    config.revalidate > 0 &&
    config.dynamic === 'force-dynamic'
  ) {
    // Point to whichever was defined first (prefer dynamic as it's the conflicting one)
    diagnostics.push({
      rule: ROUTE_SEGMENT_CONFIG_CONFLICT_RULE,
      level: 'warn',
      message: `Route config 'dynamic = "force-dynamic"' conflicts with 'revalidate = ${config.revalidate}'. ISR (revalidate) requires static or auto dynamic mode.`,
      loc: getLocation(
        sourceFile,
        configWithNodes.nodes?.dynamic || configWithNodes.nodes?.revalidate,
        filePath
      ),
    });
  }

  // Check for edge runtime with Node.js-only APIs
  if (config.runtime === 'edge') {
    let usesNodeAPIs = false;
    const nodeAPIs = ['fs', 'path', 'crypto', 'buffer', 'stream', 'process'];

    const visit = (node: ts.Node) => {
      if (ts.isImportDeclaration(node)) {
        if (ts.isStringLiteral(node.moduleSpecifier)) {
          const module = node.moduleSpecifier.text;
          if (nodeAPIs.some((api) => module.includes(`node:${api}`) || module === api)) {
            usesNodeAPIs = true;
          }
        }
      }
      ts.forEachChild(node, visit);
    };

    ts.forEachChild(sourceFile, visit);

    if (usesNodeAPIs) {
      diagnostics.push({
        rule: ROUTE_SEGMENT_CONFIG_CONFLICT_RULE,
        level: 'error',
        message:
          'Route config \'runtime = "edge"\' conflicts with usage of Node.js-only APIs (fs, path, crypto, etc.). Use nodejs runtime or remove Node.js imports.',
        loc: getLocation(sourceFile, configWithNodes.nodes?.runtime, filePath),
      });
    }
  }

  // Check for fetchCache conflicts
  if (
    config.fetchCache === 'force-no-store' &&
    typeof config.revalidate === 'number' &&
    config.revalidate > 0
  ) {
    diagnostics.push({
      rule: ROUTE_SEGMENT_CONFIG_CONFLICT_RULE,
      level: 'warn',
      message: `Route config 'fetchCache = "force-no-store"' conflicts with 'revalidate = ${config.revalidate}'. force-no-store disables caching, making revalidation ineffective.`,
      loc: getLocation(
        sourceFile,
        configWithNodes.nodes?.fetchCache || configWithNodes.nodes?.revalidate,
        filePath
      ),
    });
  }

  return diagnostics;
}

/**
 * Check if a file is a Next.js route file (page, layout, route)
 */
export function isRouteFile(filePath: string): boolean {
  const normalizedPath = filePath.replace(/\\/g, '/');
  return (
    normalizedPath.endsWith('/page.tsx') ||
    normalizedPath.endsWith('/page.ts') ||
    normalizedPath.endsWith('/page.jsx') ||
    normalizedPath.endsWith('/page.js') ||
    normalizedPath.endsWith('/layout.tsx') ||
    normalizedPath.endsWith('/layout.ts') ||
    normalizedPath.endsWith('/layout.jsx') ||
    normalizedPath.endsWith('/layout.js') ||
    normalizedPath.endsWith('/route.ts') ||
    normalizedPath.endsWith('/route.js')
  );
}
