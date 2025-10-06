import * as ts from 'typescript';
import type { Diagnostic } from '@rsc-xray/schemas';
import { createDiagnosticFromNode } from '../lib/diagnosticHelpers.js';

import { classifyComponent } from '../lib/classify.js';
import type { ComponentKind } from '../lib/classify.js';

export interface AnalyzeClientSourceOptions {
  fileName: string;
  sourceText: string;
  forbiddenModules?: readonly string[];
}

const DEFAULT_MODULES = new Set([
  'fs',
  'path',
  'child_process',
  'os',
  'net',
  'tls',
  'http',
  'https',
  'worker_threads',
  'perf_hooks',
]);

function resolveModuleSet(forbiddenModules?: readonly string[]): Set<string> {
  return forbiddenModules ? new Set(forbiddenModules) : DEFAULT_MODULES;
}

function normalizeModule(moduleName: string): string {
  return moduleName.startsWith('node:') ? moduleName.slice(5) : moduleName;
}

function isForbiddenModule(moduleName: string, modules: Set<string>): boolean {
  return modules.has(moduleName) || modules.has(normalizeModule(moduleName));
}

function createDiagnostic(
  sourceFile: ts.SourceFile,
  node: ts.Node,
  moduleName: string
): Diagnostic {
  // For imports, highlight the module specifier (string literal) instead of entire import
  let targetNode: ts.Node = node;
  if (ts.isImportDeclaration(node) && node.moduleSpecifier) {
    targetNode = node.moduleSpecifier;
  }

  return createDiagnosticFromNode(
    sourceFile,
    targetNode,
    sourceFile.fileName,
    'client-forbidden-import',
    `Client components must not import '${moduleName}'.`,
    'error'
  );
}

function analyzeSource({
  fileName,
  sourceText,
  forbiddenModules,
}: AnalyzeClientSourceOptions): Diagnostic[] {
  const sourceFile = ts.createSourceFile(
    fileName,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );
  const diagnostics: Diagnostic[] = [];
  const modules = resolveModuleSet(forbiddenModules);

  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const moduleName = node.moduleSpecifier.text;
      if (isForbiddenModule(moduleName, modules)) {
        diagnostics.push(createDiagnostic(sourceFile, node.moduleSpecifier, moduleName));
      }
    }

    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'require'
    ) {
      const [firstArg] = node.arguments;
      if (firstArg && ts.isStringLiteral(firstArg)) {
        const moduleName = firstArg.text;
        if (isForbiddenModule(moduleName, modules)) {
          diagnostics.push(createDiagnostic(sourceFile, firstArg, moduleName));
        }
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return diagnostics;
}

export interface AnalyzeClientFileOptions {
  fileName: string;
  sourceText: string;
  forbiddenModules?: readonly string[];
}

export function analyzeClientFileForForbiddenImports({
  fileName,
  sourceText,
  forbiddenModules,
}: AnalyzeClientFileOptions): Diagnostic[] {
  const classification = classifyComponent({ fileName, sourceText });
  if (classification.kind !== 'client') {
    return [];
  }
  const options = forbiddenModules ? { forbiddenModules } : {};
  return analyzeSource({ fileName, sourceText, ...options });
}

export interface CollectForbiddenImportsOptions {
  files: Array<{ filePath: string; sourceText: string; kind: ComponentKind }>;
  forbiddenModules?: readonly string[];
}

export function collectForbiddenImportDiagnostics({
  files,
  forbiddenModules,
}: CollectForbiddenImportsOptions): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  for (const file of files) {
    if (file.kind !== 'client') continue;
    const options = forbiddenModules ? { forbiddenModules } : {};
    diagnostics.push(
      ...analyzeSource({
        fileName: file.filePath,
        sourceText: file.sourceText,
        ...options,
      })
    );
  }
  return diagnostics;
}

export const __testing = { analyzeSource, resolveModuleSet, normalizeModule };
