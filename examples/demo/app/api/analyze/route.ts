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
        console.log(
          '[expandDuplicateDeps] Matched context file:',
          fileName,
          'for diagnostic:',
          diag.loc?.file
        );
      }
    }

    if (!sourceCode || !fileName) {
      console.log('[expandDuplicateDeps] No source code found for:', diag.loc?.file);
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

    console.log(
      '[expandDuplicateDeps] Duplicated packages in message:',
      Array.from(duplicatedPackages),
      'for file:',
      fileName
    );

    // Parse the source code and find all imports
    const sourceFile = ts.createSourceFile(fileName, sourceCode, ts.ScriptTarget.Latest, true);

    const imports = sourceFile.statements.filter((stmt) => ts.isImportDeclaration(stmt));

    console.log('[expandDuplicateDeps] Found', imports.length, 'imports in', fileName);

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

          const startPos = sourceFile.getLineAndCharacterOfPosition(
            moduleSpecifier.getStart(sourceFile)
          );

          console.log(
            '[expandDuplicateDeps] Creating diagnostic for',
            packageName,
            'at line',
            startPos.line + 1,
            'col',
            startPos.character + 1,
            'in',
            matchedFile
          );

          expanded.push({
            ...diag,
            message: `'${packageName}' is duplicated across multiple components. Consider extracting to a shared module.`,
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

  console.log(
    '[expandDuplicateDeps] Expanded',
    diagnostics.length,
    'diagnostics to',
    expanded.length
  );
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

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body: LspAnalysisRequest = await request.json();

    if (!body.code || !body.fileName) {
      return NextResponse.json(
        { error: { code: 'INVALID_REQUEST', message: 'Missing required fields: code, fileName' } },
        { status: 400 }
      );
    }

    // For route-config scenario, parse route config from actual code instead of using hardcoded context
    // This allows users to edit the code and see diagnostics update correctly
    let analysisBody = body;
    if (body.scenario === 'route-config' && body.context?.routeConfig) {
      const parsedConfig = parseRouteConfigFromCode(body.code);
      analysisBody = {
        ...body,
        context: {
          ...body.context,
          routeConfig: parsedConfig,
        },
      };
    }

    // 🎯 IMPORTANT: Don't pass scenario parameter to analyzer!
    // The 'scenario' field in LspAnalysisRequest acts as a FILTER - it only runs that scenario's rules.
    // For the demo, we want to run ALL applicable OSS rules so users can play and experiment.
    // We'll use body.scenario only for demo-specific logic (context, expansions, etc.)
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { scenario, ...analysisRequest } = analysisBody;

    // For duplicate-dependencies scenario, we pass 3 bundles to detect duplication
    // The analyzer will return 3 diagnostics (one per file), which will be shown in their respective tabs
    const result = await analyze(analysisRequest);

    // Expand duplicate-dependencies diagnostics to show one per import (instead of one per file)
    // This also handles positioning for context files, so we don't need fixContextFileDiagnostics
    if (body.scenario) {
      result.diagnostics = expandDuplicateDependenciesDiagnostics(
        result.diagnostics,
        body.scenario
      );
    }

    // Fix diagnostic positions for OTHER scenarios' context files (not duplicate-dependencies)
    // duplicate-dependencies is already handled by expandDuplicateDependenciesDiagnostics above
    if (body.scenario && body.scenario !== ('duplicate-dependencies' as typeof body.scenario)) {
      result.diagnostics = fixContextFileDiagnostics(result.diagnostics, body.scenario);
    }

    // Add cache control headers to prevent any caching
    return NextResponse.json(result, {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
        Pragma: 'no-cache',
        Expires: '0',
      },
    });
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
