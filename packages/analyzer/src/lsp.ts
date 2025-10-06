/**
 * LSP-friendly API for real-time single-file analysis
 *
 * This module provides a clean interface for LSP servers and editors
 * that need to analyze code snippets without full project context.
 */

import * as ts from 'typescript';
import type { Diagnostic, Suggestion, RouteSegmentConfig } from '@rsc-xray/schemas';
import { analyzeSerializationBoundary } from './rules/serializationBoundary.js';
import { detectSuspenseBoundaryIssues } from './rules/suspenseBoundary.js';
import { detectReact19CacheOpportunities } from './rules/react19Cache.js';
import { detectClientSizeIssues } from './rules/clientSizeThreshold.js';
import { analyzeClientFileForForbiddenImports } from './rules/clientForbiddenImports.js';
import { detectConfigConflicts } from './rules/routeSegmentConfig.js';
import type { ClientComponentBundle } from './lib/clientBundles.js';

/**
 * LSP analysis request configuration
 */
export interface LspAnalysisRequest {
  /** Source code to analyze */
  code: string;

  /** File name (used for determining .ts vs .tsx and diagnostics) */
  fileName: string;

  /** Specific scenario to analyze (if omitted, runs all applicable rules) */
  scenario?:
    | 'serialization-boundary'
    | 'suspense-boundary'
    | 'react19-cache'
    | 'client-size'
    | 'duplicate-dependencies'
    | 'client-forbidden-imports'
    | 'route-config';

  /** Specific rule IDs to run (if omitted, runs all applicable rules) */
  rules?: string[];

  /** Additional context for rules that need it */
  context?: {
    /** Client component bundles (for client-size analysis) */
    clientBundles?: ClientComponentBundle[];

    /** Route segment config (for route-config analysis) */
    routeConfig?: RouteSegmentConfig;

    /** React version (for react19-cache analysis) */
    reactVersion?: string;

    /** Known client component paths (for serialization-boundary) */
    clientComponentPaths?: string[];
  };
}

/**
 * LSP analysis response
 */
export interface LspAnalysisResponse {
  /** Diagnostics and suggestions found */
  diagnostics: Array<Diagnostic | Suggestion>;

  /** Analysis duration in milliseconds */
  duration: number;

  /** Rules that were executed */
  rulesExecuted: string[];
}

/**
 * Create a TypeScript SourceFile from code string
 */
export function createSourceFile(code: string, fileName: string): ts.SourceFile {
  const scriptKind = fileName.endsWith('.tsx')
    ? ts.ScriptKind.TSX
    : fileName.endsWith('.jsx')
      ? ts.ScriptKind.JSX
      : fileName.endsWith('.ts')
        ? ts.ScriptKind.TS
        : ts.ScriptKind.JS;

  return ts.createSourceFile(
    fileName,
    code,
    ts.ScriptTarget.Latest,
    true, // setParentNodes
    scriptKind
  );
}

/**
 * Analyze a single file using LSP-compatible API
 *
 * This is the main entry point for LSP servers and real-time analysis.
 * It accepts code strings and returns diagnostics without requiring
 * file system access or full project context.
 *
 * @example
 * ```typescript
 * const result = analyzeLspRequest({
 *   code: 'export default function Page() { ... }',
 *   fileName: 'app/page.tsx',
 *   scenario: 'serialization-boundary'
 * });
 * ```
 */
export function analyzeLspRequest(request: LspAnalysisRequest): LspAnalysisResponse {
  const startTime = performance.now();
  const diagnostics: Array<Diagnostic | Suggestion> = [];
  const rulesExecuted: string[] = [];

  const sourceFile = createSourceFile(request.code, request.fileName);
  const { scenario, rules, context = {}, fileName } = request;

  // Helper to check if a rule should run
  const shouldRun = (ruleId: string, scenarioId: string): boolean => {
    if (scenario && scenario !== scenarioId) return false;
    if (rules && !rules.includes(ruleId)) return false;
    return true;
  };

  // Serialization boundary analysis
  if (shouldRun('serialization-boundary-violation', 'serialization-boundary')) {
    try {
      const clientComponents = context.clientComponentPaths
        ? new Set(context.clientComponentPaths)
        : undefined;

      const serializationOptions = clientComponents ? { clientComponents } : {};

      const results = analyzeSerializationBoundary({
        sourceText: request.code,
        fileName,
        ...serializationOptions,
      });
      diagnostics.push(...results);
      rulesExecuted.push('serialization-boundary-violation');
    } catch (error) {
      // Log error but continue with other rules
      console.error('[LSP] Serialization boundary analysis failed:', error);
    }
  }

  // Suspense boundary analysis
  if (
    shouldRun('suspense-boundary-missing', 'suspense-boundary') ||
    shouldRun('suspense-boundary-opportunity', 'suspense-boundary')
  ) {
    try {
      const results = detectSuspenseBoundaryIssues(sourceFile, fileName);
      diagnostics.push(...results);
      rulesExecuted.push('suspense-boundary-missing', 'suspense-boundary-opportunity');
    } catch (error) {
      console.error('[LSP] Suspense boundary analysis failed:', error);
    }
  }

  // React 19 cache() opportunities
  if (shouldRun('react19-cache-opportunity', 'react19-cache')) {
    try {
      const config = context.reactVersion ? { reactVersion: context.reactVersion } : {};
      const results = detectReact19CacheOpportunities(sourceFile, fileName, config);
      diagnostics.push(...results);
      rulesExecuted.push('react19-cache-opportunity');
    } catch (error) {
      console.error('[LSP] React 19 cache analysis failed:', error);
    }
  }

  // Client component size analysis
  if (
    shouldRun('client-component-oversized', 'client-size') ||
    shouldRun('duplicate-dependencies', 'client-size') ||
    shouldRun('duplicate-dependencies', 'duplicate-dependencies')
  ) {
    if (context.clientBundles && context.clientBundles.length > 0) {
      try {
        const results = detectClientSizeIssues(context.clientBundles, {
          sourceFile,
        });
        diagnostics.push(...results);
        rulesExecuted.push('client-component-oversized', 'duplicate-dependencies');
      } catch (error) {
        console.error('[LSP] Client size analysis failed:', error);
      }
    }
  }

  // Client forbidden imports
  if (shouldRun('client-forbidden-import', 'client-forbidden-imports')) {
    try {
      const results = analyzeClientFileForForbiddenImports({
        fileName,
        sourceText: request.code,
      });
      diagnostics.push(...results);
      rulesExecuted.push('client-forbidden-import');
    } catch (error) {
      console.error('[LSP] Forbidden imports analysis failed:', error);
    }
  }

  // Route segment config conflicts
  if (shouldRun('route-segment-config-conflict', 'route-config')) {
    if (context.routeConfig) {
      try {
        const results = detectConfigConflicts(sourceFile, context.routeConfig, fileName);
        diagnostics.push(...results);
        rulesExecuted.push('route-segment-config-conflict');
      } catch (error) {
        console.error('[LSP] Route config analysis failed:', error);
      }
    }
  }

  const duration = performance.now() - startTime;

  return {
    diagnostics,
    duration,
    rulesExecuted,
  };
}

/**
 * Analyze specific scenario with code string
 *
 * Convenience wrapper for single-scenario analysis
 */
export function analyzeScenario(
  code: string,
  fileName: string,
  scenario: LspAnalysisRequest['scenario'],
  context?: LspAnalysisRequest['context']
): Array<Diagnostic | Suggestion> {
  const request: LspAnalysisRequest = {
    code,
    fileName,
    ...(scenario ? { scenario } : {}),
    ...(context ? { context } : {}),
  };
  const result = analyzeLspRequest(request);
  return result.diagnostics;
}

/**
 * Check if a file should be analyzed based on its path
 *
 * Some rules only apply to specific file patterns:
 * - Route files (app/page.tsx, app/layout.tsx, etc.)
 * - Client components (with 'use client' directive)
 * - Server components (default)
 */
export function shouldAnalyzeFile(
  fileName: string,
  code: string
): {
  isRouteFile: boolean;
  isClientComponent: boolean;
  isServerComponent: boolean;
} {
  const isRouteFile = /app\/.*\/(page|layout|route|error|loading|not-found)\.(tsx?|jsx?)$/.test(
    fileName
  );
  const isClientComponent = code.includes("'use client'") || code.includes('"use client"');
  const isServerComponent = !isClientComponent;

  return {
    isRouteFile,
    isClientComponent,
    isServerComponent,
  };
}
