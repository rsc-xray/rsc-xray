import { NextRequest, NextResponse } from 'next/server';
import { analyze } from '@rsc-xray/lsp-server';
import type { LspAnalysisRequest } from '@rsc-xray/lsp-server';
import * as ts from 'typescript';
import type { Diagnostic, Suggestion } from '@rsc-xray/schemas';
import { scenarios, type Scenario } from '../../lib/scenarios';

/**
 * POST /api/analyze
 *
 * Server-side LSP analysis endpoint
 *
 * Accepts code and scenario, returns RSC X-Ray diagnostics
 *
 * Note: Using server-side analysis because @rsc-xray/analyzer
 * depends on Node.js APIs (fs, path, vm) that can't run in browser.
 * This is still real-time - just server-executed instead of browser-executed.
 */

// Disable caching for this API route - we need fresh analysis every time
export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * Expand duplicate-dependencies diagnostics to show one diagnostic per duplicated import
 * Instead of "shares 3 dependencies", show 3 separate diagnostics
 */
function expandDuplicateDependenciesDiagnostics(
  diagnostics: Array<Diagnostic | Suggestion>,
  scenarioId: string
): Array<Diagnostic | Suggestion> {
  const scenario = scenarios.find((s: Scenario) => s.id === scenarioId);
  if (!scenario) return diagnostics;

  // Only expand if there are duplicate-dependencies diagnostics
  const hasDuplicateDeps = diagnostics.some((d) => d.rule === 'duplicate-dependencies');
  if (!hasDuplicateDeps) return diagnostics;

  const expanded: Array<Diagnostic | Suggestion> = [];

  for (const diag of diagnostics) {
    if (diag.rule !== 'duplicate-dependencies') {
      expanded.push(diag);
      continue;
    }

    // Find the source code for this diagnostic's file
    let sourceCode: string | undefined;
    let fileName: string | undefined;
    let matchedFile: string | undefined;

    if (diag.loc?.file === 'demo.tsx') {
      sourceCode = scenario.code;
      fileName = 'demo.tsx';
      matchedFile = 'demo.tsx';
    } else {
      const contextFile = scenario.contextFiles?.find(
        (cf: { fileName: string; code: string }) =>
          diag.loc?.file === cf.fileName ||
          diag.loc?.file.endsWith(`/${cf.fileName}`) ||
          diag.loc?.file.includes(cf.fileName)
      );
      if (contextFile) {
        sourceCode = contextFile.code;
        fileName = contextFile.fileName;
        matchedFile = diag.loc?.file; // Keep original file path for filtering
      }
    }

    if (!sourceCode || !fileName) {
      expanded.push(diag);
      continue;
    }

    // Parse the diagnostic message to extract which packages are actually duplicated
    // Message format: "Duplicate dependencies: chart-lib (also imported by X), date-fns (also imported by Y). Consider..."
    const duplicatedPackages = new Set<string>();
    const messageMatch = diag.message.match(/Duplicate dependencies[^:]*:\s*([^.]+)\./);
    if (messageMatch) {
      const packagesStr = messageMatch[1];
      // Extract package names before " (also imported by"
      const packageMatches = packagesStr.matchAll(/([^\s,]+)\s*\(also imported by/g);
      for (const match of packageMatches) {
        duplicatedPackages.add(match[1]);
      }
    }

    // Parse the source code and find all imports
    const sourceFile = ts.createSourceFile(fileName, sourceCode, ts.ScriptTarget.Latest, true);

    const imports = sourceFile.statements.filter((stmt) => ts.isImportDeclaration(stmt));

    // Create one diagnostic per DUPLICATED import (not all imports)
    for (const importStmt of imports) {
      if (ts.isImportDeclaration(importStmt)) {
        const moduleSpecifier = importStmt.moduleSpecifier;
        if (ts.isStringLiteral(moduleSpecifier)) {
          const packageName = moduleSpecifier.text;

          // Only create diagnostic if this package is mentioned in the original diagnostic message
          if (!duplicatedPackages.has(packageName)) {
            continue;
          }

          expanded.push({
            ...diag,
            loc: {
              file: matchedFile || fileName, // Use the matched file path to preserve original path format
              range: {
                from: moduleSpecifier.getStart(sourceFile),
                to: moduleSpecifier.getEnd(),
              },
            },
          });
        }
      }
    }
  }

  return expanded;
}

/**
 * Fix diagnostic positions for context files by finding first import in their source code
 */
function fixContextFileDiagnostics(
  diagnostics: Array<Diagnostic | Suggestion>,
  scenarioId: string
): Array<Diagnostic | Suggestion> {
  const scenario = scenarios.find((s: Scenario) => s.id === scenarioId);
  if (!scenario?.contextFiles) return diagnostics;

  return diagnostics.map((diag) => {
    // Only fix diagnostics that reference context files
    const contextFile = scenario.contextFiles?.find(
      (cf: { fileName: string; code: string }) =>
        diag.loc?.file === cf.fileName ||
        diag.loc?.file.endsWith(`/${cf.fileName}`) ||
        diag.loc?.file.includes(cf.fileName)
    );

    if (!contextFile || !diag.loc) return diag;

    const hasMeaningfulRange =
      diag.loc.range !== undefined && diag.loc.range.from < diag.loc.range.to;

    if (hasMeaningfulRange) {
      return diag;
    }

    // Parse the context file's code and find the first import
    const sourceFile = ts.createSourceFile(
      contextFile.fileName,
      contextFile.code,
      ts.ScriptTarget.Latest,
      true
    );

    const firstImport = sourceFile.statements.find(
      (stmt) =>
        ts.isImportDeclaration(stmt) ||
        (ts.isVariableStatement(stmt) &&
          stmt.declarationList.declarations.some((decl) =>
            decl.initializer && ts.isCallExpression(decl.initializer)
              ? decl.initializer.expression.getText(sourceFile) === 'require'
              : false
          ))
    );

    if (firstImport && ts.isImportDeclaration(firstImport)) {
      // Find the module specifier (the string literal part, e.g., 'date-fns')
      const moduleSpecifier = firstImport.moduleSpecifier;
      if (ts.isStringLiteral(moduleSpecifier)) {
        return {
          ...diag,
          loc: {
            ...diag.loc,
            range: {
              from: moduleSpecifier.getStart(sourceFile),
              to: moduleSpecifier.getEnd(),
            },
          },
        };
      }
    }

    return diag;
  });
}

/**
 * Parse route segment config from code
 *
 * Extracts export const declarations for route config options:
 * - dynamic, revalidate, fetchCache, runtime, preferredRegion
 */
function parseRouteConfigFromCode(code: string): Record<string, string | number | false> {
  const config: Record<string, string | number | false> = {};

  // Match: export const <name> = <value>;
  // Handles: 'string', "string", number, false
  const exportPattern =
    /export\s+const\s+(dynamic|revalidate|fetchCache|runtime|preferredRegion)\s*=\s*([^;]+);/g;

  let match;
  while ((match = exportPattern.exec(code)) !== null) {
    const [, name, rawValue] = match;
    const value = rawValue.trim();

    // Parse value based on type
    if (name === 'revalidate') {
      // Handle: number or false
      if (value === 'false') {
        config[name] = false;
      } else {
        const num = parseInt(value, 10);
        if (!isNaN(num)) {
          config[name] = num;
        }
      }
    } else {
      // Handle: string (remove quotes)
      const stringMatch = value.match(/^['"](.+)['"]$/);
      if (stringMatch) {
        config[name] = stringMatch[1];
      }
    }
  }

  return config;
}

const CACHE_HEADERS = {
  'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
  Pragma: 'no-cache',
  Expires: '0',
};

const ROUTE_SEGMENT_FILE_NAMES = new Set([
  'page.tsx',
  'layout.tsx',
  'default.tsx',
  'template.tsx',
  'error.tsx',
  'loading.tsx',
  'route.ts',
]);

function isRouteSegmentFile(fileName: string): boolean {
  if (ROUTE_SEGMENT_FILE_NAMES.has(fileName)) {
    return true;
  }

  for (const segment of ROUTE_SEGMENT_FILE_NAMES) {
    if (fileName.endsWith(`/${segment}`)) {
      return true;
    }
  }

  return false;
}

function sanitizeContextForTarget(
  context: LspAnalysisRequest['context'] | undefined,
  fileName: string
): LspAnalysisRequest['context'] | undefined {
  if (!context) {
    return undefined;
  }

  if (!('routeConfig' in context) || context.routeConfig === undefined) {
    return { ...context };
  }

  if (isRouteSegmentFile(fileName)) {
    return { ...context };
  }

  const { routeConfig, ...rest } = context;
  void routeConfig;
  return Object.keys(rest).length > 0 ? (rest as LspAnalysisRequest['context']) : undefined;
}

interface AnalysisTargetPayload {
  fileKey?: string;
  fileName: string;
  code: string;
  context?: LspAnalysisRequest['context'];
}

interface AnalyzedTargetResult {
  key: string;
  diagnostics: Array<Diagnostic | Suggestion>;
  duration: number;
  rulesExecuted: string[];
  version: string;
}

type ContextWithClientBundles = LspAnalysisRequest['context'] & {
  clientBundles: Array<{ filePath: string; chunks: string[] }>;
};

function hasClientBundles(
  context: LspAnalysisRequest['context'] | undefined
): context is ContextWithClientBundles {
  return Boolean(context && Array.isArray(context.clientBundles));
}

function buildTargetContext(
  target: AnalysisTargetPayload,
  sharedContext?: LspAnalysisRequest['context']
): LspAnalysisRequest['context'] | undefined {
  if (!sharedContext && !target.context) {
    return undefined;
  }

  return {
    ...(sharedContext ?? {}),
    ...(target.context ?? {}),
  };
}

function createAnalysisRequest(
  target: AnalysisTargetPayload,
  scenarioId: string | undefined,
  sharedContext?: LspAnalysisRequest['context']
): LspAnalysisRequest {
  const context = sanitizeContextForTarget(
    buildTargetContext(target, sharedContext),
    target.fileName
  );

  const request: LspAnalysisRequest = {
    code: target.code,
    fileName: target.fileName,
    ...(context ? { context } : {}),
  };

  if (scenarioId === 'route-config' && request.context?.routeConfig) {
    request.context = {
      ...request.context,
      routeConfig: parseRouteConfigFromCode(target.code),
    };
  }

  return request;
}

async function analyzeTargetPayload(
  target: AnalysisTargetPayload,
  scenarioId: string | undefined,
  sharedContext?: LspAnalysisRequest['context']
): Promise<AnalyzedTargetResult> {
  const analysisRequest = createAnalysisRequest(target, scenarioId, sharedContext);

  const result = await analyze(analysisRequest);

  let diagnostics = result.diagnostics;
  if (scenarioId) {
    diagnostics = expandDuplicateDependenciesDiagnostics(diagnostics, scenarioId);
    if (scenarioId !== 'duplicate-dependencies') {
      diagnostics = fixContextFileDiagnostics(diagnostics, scenarioId);
    }
  }

  return {
    key: target.fileKey ?? target.fileName,
    diagnostics,
    duration: result.duration ?? 0,
    rulesExecuted: result.rulesExecuted ?? [],
    version: result.version ?? '0.6.0',
  };
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = (await request.json()) as {
      code?: string;
      fileName?: string;
      fileKey?: string;
      context?: LspAnalysisRequest['context'];
      scenario?: string;
      analysisTargets?: AnalysisTargetPayload[];
    };

    const scenarioId = typeof body.scenario === 'string' ? body.scenario : undefined;
    const debugLog = scenarioId === 'real-world-app' ? console.log.bind(console) : () => undefined;

    debugLog('[analyze API] Request received', {
      scenario: body.scenario,
      fileName: body.fileName,
      targets: Array.isArray(body.analysisTargets) ? body.analysisTargets.length : 0,
    });

    if (Array.isArray(body.analysisTargets) && body.analysisTargets.length > 0) {
      const sharedContext = body.context;
      const invalidTarget = body.analysisTargets.find(
        (target) =>
          !target || typeof target.code !== 'string' || typeof target.fileName !== 'string'
      );

      if (invalidTarget) {
        return NextResponse.json(
          {
            error: {
              code: 'INVALID_REQUEST',
              message: 'Each analysis target must include code and fileName',
            },
          },
          { status: 400 }
        );
      }

      debugLog(
        '[analysis-targets]',
        body.analysisTargets.map((target) => ({
          fileKey: target.fileKey,
          fileName: target.fileName,
          hasBundles: hasClientBundles(target.context),
        }))
      );

      const analyses = await Promise.all(
        body.analysisTargets.map((target) =>
          analyzeTargetPayload(target, scenarioId, sharedContext)
        )
      );

      debugLog('[analyze API] Multi-target analysis complete', {
        scenario: scenarioId,
        files: analyses.map((entry) => ({ key: entry.key, duration: entry.duration })),
      });

      const diagnosticsByFile: Record<string, Array<Diagnostic | Suggestion>> = {};
      const durationsByFile: Record<string, number> = {};
      const diagnosticKeysByFile = new Map<string, Set<string>>();
      const durationContributorsByFile = new Map<string, Set<string>>();
      const rulesExecutedSet = new Set<string>();
      let totalDuration = 0;
      let version = analyses[0]?.version ?? '0.6.0';

      const getDiagnosticKey = (diag: Diagnostic | Suggestion): string => {
        const rule = 'rule' in diag ? diag.rule : 'suggestion';
        const message = diag.message ?? '';
        const locFile = diag.loc?.file ?? '';
        const range = diag.loc?.range;
        const rangeKey = range ? `${range.from}:${range.to}` : '';
        return `${rule}|${message}|${locFile}|${rangeKey}`;
      };

      const addDurationForFile = (fileKey: string, duration: number, contributorId: string) => {
        const contributors = durationContributorsByFile.get(fileKey) ?? new Set<string>();
        if (!contributors.has(contributorId)) {
          durationsByFile[fileKey] = (durationsByFile[fileKey] ?? 0) + duration;
          contributors.add(contributorId);
          durationContributorsByFile.set(fileKey, contributors);
        }
      };

      const assignDiagnostic = (
        key: string,
        diag: Diagnostic | Suggestion,
        duration: number,
        contributorId: string
      ) => {
        const diagKey = getDiagnosticKey(diag);
        const existingKeys = diagnosticKeysByFile.get(key) ?? new Set<string>();

        if (existingKeys.has(diagKey)) {
          addDurationForFile(key, duration, contributorId);
          return;
        }

        existingKeys.add(diagKey);
        diagnosticKeysByFile.set(key, existingKeys);

        if (!diagnosticsByFile[key]) {
          diagnosticsByFile[key] = [];
        }

        diagnosticsByFile[key].push(diag);
        addDurationForFile(key, duration, contributorId);
      };

      analyses.forEach((entry) => {
        const duration = entry.duration;
        totalDuration += duration;
        version = entry.version || version;
        entry.rulesExecuted.forEach((rule) => rulesExecutedSet.add(rule));

        if (entry.diagnostics.length === 0) {
          if (!diagnosticsByFile[entry.key]) {
            diagnosticsByFile[entry.key] = [];
          }
          addDurationForFile(entry.key, duration, entry.key);
          return;
        }

        entry.diagnostics.forEach((diag) => {
          const locFile = diag.loc?.file;
          if (locFile) {
            const normalizedLoc = locFile.replace(/^\.\//, '');
            const normalizedKey = entry.key.replace(/^\.\//, '');

            if (
              normalizedLoc === normalizedKey ||
              normalizedLoc.endsWith(`/${normalizedKey}`) ||
              normalizedKey.endsWith(`/${normalizedLoc}`)
            ) {
              assignDiagnostic(entry.key, diag, duration, entry.key);
              return;
            }

            const fileName = normalizedLoc.split('/').pop();
            if (fileName) {
              assignDiagnostic(fileName, diag, duration, entry.key);
              return;
            }
          }

          assignDiagnostic(entry.key, diag, duration, entry.key);
        });
      });

      const flattenedDiagnostics = Object.values(diagnosticsByFile).flat();

      return NextResponse.json(
        {
          diagnostics: flattenedDiagnostics,
          diagnosticsByFile,
          durationsByFile,
          duration: totalDuration,
          rulesExecuted: Array.from(rulesExecutedSet),
          version,
        },
        { headers: CACHE_HEADERS }
      );
    }

    if (!body.code || !body.fileName) {
      return NextResponse.json(
        { error: { code: 'INVALID_REQUEST', message: 'Missing required fields: code, fileName' } },
        { status: 400 }
      );
    }

    const analyzedTarget = await analyzeTargetPayload(
      {
        fileKey: body.fileKey ?? body.fileName,
        fileName: body.fileName,
        code: body.code,
        context: body.context,
      },
      scenarioId
    );

    debugLog('[analyze API] Single-target analysis complete', {
      scenario: scenarioId,
      fileKey: analyzedTarget.key,
      duration: analyzedTarget.duration,
      diagnostics: analyzedTarget.diagnostics.length,
    });

    return NextResponse.json(
      {
        diagnostics: analyzedTarget.diagnostics,
        diagnosticsByFile: { [analyzedTarget.key]: analyzedTarget.diagnostics },
        duration: analyzedTarget.duration,
        durationsByFile: { [analyzedTarget.key]: analyzedTarget.duration },
        rulesExecuted: analyzedTarget.rulesExecuted,
        version: analyzedTarget.version,
      },
      { headers: CACHE_HEADERS }
    );
  } catch (error) {
    console.error('Analysis API error:', error);

    return NextResponse.json(
      {
        diagnostics: [],
        duration: 0,
        rulesExecuted: [],
        version: '0.6.0',
        error: {
          code: 'INTERNAL_ERROR',
          message: error instanceof Error ? error.message : 'Unknown error',
        },
      },
      { status: 500 }
    );
  }
}
