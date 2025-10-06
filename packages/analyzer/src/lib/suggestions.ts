import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import * as ts from 'typescript';

import type { Suggestion } from '@rsc-xray/schemas';
import { createSuggestionFromNode } from './diagnosticHelpers.js';

import type { ClassifiedFile } from './classifyFiles.js';
import type { ComponentKind } from './classify.js';
import { detectSuspenseBoundaryIssues } from '../rules/suspenseBoundary.js';
import { detectReact19CacheOpportunities } from '../rules/react19Cache.js';

interface CollectSuggestionsForSourceOptions {
  filePath: string;
  sourceText: string;
  kind: ComponentKind;
  reactVersion?: string;
}

const FETCH_RULE = 'client-hoist-fetch';
const PARALLEL_RULE = 'server-promise-all';

function createSourceFile(filePath: string, sourceText: string): ts.SourceFile {
  const scriptKind =
    filePath.endsWith('.tsx') || filePath.endsWith('.jsx')
      ? ts.ScriptKind.TSX
      : filePath.endsWith('.ts')
        ? ts.ScriptKind.TS
        : ts.ScriptKind.JS;

  return ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true, scriptKind);
}

function toSuggestion(
  sourceFile: ts.SourceFile,
  node: ts.Node,
  rule: string,
  message: string,
  level: 'info' | 'warn',
  filePath: string
): Suggestion {
  return createSuggestionFromNode(sourceFile, node, filePath, rule, message, level);
}

function isFetchCall(expr: ts.Expression): boolean {
  if (ts.isIdentifier(expr)) {
    return expr.text === 'fetch';
  }

  if (ts.isPropertyAccessExpression(expr)) {
    return isFetchCall(expr.name);
  }

  return false;
}

function collectFetchSuggestions(sourceFile: ts.SourceFile, filePath: string): Suggestion[] {
  const suggestions: Suggestion[] = [];

  const visit = (node: ts.Node) => {
    if (ts.isAwaitExpression(node) && ts.isCallExpression(node.expression)) {
      if (isFetchCall(node.expression.expression)) {
        suggestions.push(
          toSuggestion(
            sourceFile,
            node,
            FETCH_RULE,
            'Move this fetch call to a server component or loader to avoid fetching on the client.',
            'warn',
            filePath
          )
        );
      }
    }
    ts.forEachChild(node, visit);
  };

  ts.forEachChild(sourceFile, visit);
  return suggestions;
}

function isPromiseAllCall(node: ts.CallExpression): boolean {
  const { expression } = node;
  if (ts.isPropertyAccessExpression(expression)) {
    return (
      ts.isIdentifier(expression.expression) &&
      expression.expression.text === 'Promise' &&
      expression.name.text === 'all'
    );
  }
  if (ts.isIdentifier(expression)) {
    return expression.text === 'Promise_all';
  }
  return false;
}

function collectAwaitExpressions(sourceFile: ts.SourceFile): ts.AwaitExpression[] {
  const awaits: ts.AwaitExpression[] = [];

  const visit = (node: ts.Node, withinPromiseAll = false) => {
    if (ts.isCallExpression(node)) {
      const nextWithin = withinPromiseAll || isPromiseAllCall(node);
      ts.forEachChild(node, (child) => visit(child, nextWithin));
      return;
    }

    if (ts.isAwaitExpression(node)) {
      if (!withinPromiseAll) {
        awaits.push(node);
      }
      ts.forEachChild(node, (child) => visit(child, withinPromiseAll));
      return;
    }

    ts.forEachChild(node, (child) => visit(child, withinPromiseAll));
  };

  ts.forEachChild(sourceFile, (child) => visit(child, false));
  return awaits;
}

function collectParallelSuggestions(sourceFile: ts.SourceFile, filePath: string): Suggestion[] {
  const awaits = collectAwaitExpressions(sourceFile).filter((expr) => {
    // Skip awaits that already wrap Promise.all directly
    const expression = expr.expression;
    if (ts.isCallExpression(expression) && isPromiseAllCall(expression)) {
      return false;
    }
    return true;
  });

  if (awaits.length < 2) {
    return [];
  }

  const target = awaits[1];
  if (!target) {
    return [];
  }

  return [
    toSuggestion(
      sourceFile,
      target,
      PARALLEL_RULE,
      'Consider wrapping independent awaits in Promise.all to run them in parallel.',
      'info',
      filePath
    ),
  ];
}

function collectSuggestionsForSource({
  filePath,
  sourceText,
  kind,
  reactVersion,
}: CollectSuggestionsForSourceOptions): Suggestion[] {
  const sourceFile = createSourceFile(filePath, sourceText);
  const suggestions: Suggestion[] = [];

  if (kind === 'client') {
    suggestions.push(...collectFetchSuggestions(sourceFile, filePath));
  } else {
    // Server component suggestions
    suggestions.push(...collectParallelSuggestions(sourceFile, filePath));
    suggestions.push(...detectSuspenseBoundaryIssues(sourceFile, filePath));
    const reactConfig = reactVersion ? { reactVersion } : {};
    suggestions.push(...detectReact19CacheOpportunities(sourceFile, filePath, reactConfig));
  }

  return suggestions;
}

export interface CollectSuggestionsOptions {
  projectRoot: string;
  classifiedFiles: ClassifiedFile[];
  reactVersion?: string;
}

export async function collectSuggestions({
  projectRoot,
  classifiedFiles,
  reactVersion,
}: CollectSuggestionsOptions): Promise<Record<string, Suggestion[]>> {
  const entries = await Promise.all(
    classifiedFiles.map(async (entry) => {
      const absPath = join(projectRoot, entry.filePath);
      const sourceText = await readFile(absPath, 'utf8');
      const suggestions = collectSuggestionsForSource({
        filePath: entry.filePath.replace(/\\/g, '/'),
        sourceText,
        kind: entry.kind,
        ...(reactVersion ? { reactVersion } : {}),
      });
      return [entry.filePath.replace(/\\/g, '/'), suggestions] as const;
    })
  );

  const result: Record<string, Suggestion[]> = {};
  for (const [filePath, suggestions] of entries) {
    if (suggestions.length > 0) {
      result[filePath] = suggestions;
    }
  }
  return result;
}

export { collectSuggestionsForSource };
