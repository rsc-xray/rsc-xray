import * as ts from 'typescript';
import type { Diagnostic } from '@rsc-xray/schemas';

import type { ClientComponentBundle } from '../lib/clientBundles.js';
import { createLocationFromNode, createLocationFromOffsets } from '../lib/diagnosticHelpers.js';

const OVERSIZED_RULE = 'client-component-oversized';
const DUPLICATE_DEPS_RULE = 'duplicate-dependencies';

const DEFAULT_THRESHOLD_BYTES = 51200; // 50KB

export interface SizeThresholdConfig {
  thresholdBytes?: number;
  /** Optional source file for accurate diagnostic positioning */
  sourceFile?: ts.SourceFile;
  /** Current route being analyzed (for route-specific duplicate messages) */
  route?: string;
}

interface ChunkUsage {
  chunk: string;
  components: string[];
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  const kb = bytes / 1024;
  return `${kb.toFixed(1)}KB`;
}

function toDiagnostic(
  filePath: string,
  rule: string,
  message: string,
  level: 'error' | 'warn',
  sourceFile?: ts.SourceFile
): Diagnostic {
  // Try to find the first import statement for more accurate positioning
  if (sourceFile) {
    // Normalize paths for comparison (remove leading ./)
    const normalizedSourcePath = sourceFile.fileName.replace(/^\.\//, '');
    const normalizedFilePath = filePath.replace(/^\.\//, '');

    if (normalizedSourcePath === normalizedFilePath) {
      // Find the first import declaration and its module specifier (package name)
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

      if (firstImport && ts.isImportDeclaration(firstImport) && firstImport.moduleSpecifier) {
        // Point to the module specifier (string literal) for precise highlighting
        return {
          rule,
          level,
          message,
          loc: createLocationFromNode(sourceFile, firstImport.moduleSpecifier, filePath),
        };
      }
    }
  }

  // Fallback: start of file
  return {
    rule,
    level,
    message,
    loc: createLocationFromOffsets(filePath, 0, 0),
  };
}

/**
 * Find chunks shared across multiple components
 */
function findDuplicateDependencies(bundles: ClientComponentBundle[]): ChunkUsage[] {
  const chunkToComponents = new Map<string, Set<string>>();

  for (const bundle of bundles) {
    for (const chunk of bundle.chunks) {
      const components = chunkToComponents.get(chunk) || new Set<string>();
      components.add(bundle.filePath);
      chunkToComponents.set(chunk, components);
    }
  }

  const duplicates: ChunkUsage[] = [];
  for (const [chunk, components] of chunkToComponents.entries()) {
    if (components.size > 1) {
      duplicates.push({
        chunk,
        components: Array.from(components).sort(),
      });
    }
  }

  return duplicates;
}

/**
 * Detect client components exceeding size thresholds and duplicate dependencies
 */
export function detectClientSizeIssues(
  bundles: ClientComponentBundle[] | undefined,
  config: SizeThresholdConfig = {}
): Diagnostic[] {
  if (!bundles || bundles.length === 0) {
    return [];
  }

  const diagnostics: Diagnostic[] = [];
  const threshold = config.thresholdBytes ?? DEFAULT_THRESHOLD_BYTES;
  const { sourceFile } = config;

  // Check for oversized components
  for (const bundle of bundles) {
    if (bundle.totalBytes > threshold) {
      const overage = bundle.totalBytes - threshold;
      const percentage = ((overage / threshold) * 100).toFixed(0);

      diagnostics.push(
        toDiagnostic(
          bundle.filePath,
          OVERSIZED_RULE,
          `Client component is ${formatBytes(bundle.totalBytes)} (${percentage}% over ${formatBytes(threshold)} threshold). Consider code splitting or lazy loading.`,
          'warn',
          sourceFile
        )
      );
    }
  }

  // Check for duplicate dependencies
  const duplicates = findDuplicateDependencies(bundles);

  // Group duplicates by components that share them
  const componentPairsDuplicates = new Map<string, Set<string>>();

  for (const { chunk, components } of duplicates) {
    const pairKey = components.join('|');
    const chunks = componentPairsDuplicates.get(pairKey) || new Set<string>();
    chunks.add(chunk);
    componentPairsDuplicates.set(pairKey, chunks);
  }

  // Report duplicate dependencies with route-aware messages
  const { route } = config;

  for (const [pairKey, chunks] of componentPairsDuplicates.entries()) {
    const components = pairKey.split('|');
    if (chunks.size >= 1) {
      // Report any shared dependencies (even single chunks can be meaningful)
      for (const component of components) {
        // Get other component names (extract filename from path for clarity)
        const otherComponents = components
          .filter((c) => c !== component)
          .map((path) => {
            const match = path.match(/([^/]+)\.(tsx?|jsx?)$/);
            return match ? match[1] : path;
          });

        // Build route-aware message
        const routeContext = route ? ` in route '${route}'` : '';
        const otherComponentsList = otherComponents.join(', ');
        const chunksList = Array.from(chunks).join(', ');

        const message =
          `Duplicate dependencies${routeContext}: ${chunksList} ` +
          `(also imported by ${otherComponentsList}). ` +
          `Consider extracting shared code to a common module or using dynamic imports.`;

        diagnostics.push(toDiagnostic(component, DUPLICATE_DEPS_RULE, message, 'warn', sourceFile));
      }
    }
  }

  return diagnostics;
}
