import * as ts from 'typescript';

import type { Suggestion } from '@rsc-xray/schemas';
import { createSuggestionFromNode } from '../lib/diagnosticHelpers.js';

const SUSPENSE_MISSING_RULE = 'suspense-boundary-missing';
const SUSPENSE_OPPORTUNITY_RULE = 'suspense-boundary-opportunity';

function toSuggestion(
  sourceFile: ts.SourceFile,
  node: ts.Node,
  rule: string,
  message: string,
  level: 'info' | 'warn',
  filePath: string
): Suggestion {
  // For function components, find the JSX return statement instead of function declaration
  let targetNode = node;

  if (ts.isFunctionDeclaration(node) || ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
    // Try to find the return statement with JSX
    const body = ts.isFunctionDeclaration(node)
      ? node.body
      : ts.isArrowFunction(node)
        ? node.body
        : ts.isFunctionExpression(node)
          ? node.body
          : null;

    if (body) {
      let foundJsxReturn = false;

      const findJsxReturn = (n: ts.Node): void => {
        if (foundJsxReturn) return;

        // Check if this is a return statement with JSX
        if (ts.isReturnStatement(n) && n.expression) {
          let expr = n.expression;

          // Unwrap parenthesized expressions (e.g., return (...))
          while (ts.isParenthesizedExpression(expr)) {
            expr = expr.expression;
          }

          if (ts.isJsxElement(expr) || ts.isJsxSelfClosingElement(expr) || ts.isJsxFragment(expr)) {
            targetNode = expr;
            foundJsxReturn = true;
            return;
          }
        }

        // For arrow functions with direct JSX expression (no block)
        if (!ts.isBlock(body)) {
          let expr = body;

          // Unwrap parenthesized expressions
          while (ts.isParenthesizedExpression(expr)) {
            expr = expr.expression;
          }

          if (ts.isJsxElement(expr) || ts.isJsxSelfClosingElement(expr) || ts.isJsxFragment(expr)) {
            targetNode = expr;
            foundJsxReturn = true;
            return;
          }
        }

        ts.forEachChild(n, findJsxReturn);
      };

      findJsxReturn(body);
    }
  }

  return createSuggestionFromNode(sourceFile, targetNode, filePath, rule, message, level);
}

/**
 * Check if a JSX element is a Suspense component
 */
function isSuspenseElement(node: ts.JsxElement | ts.JsxSelfClosingElement): boolean {
  const tagName = ts.isJsxElement(node) ? node.openingElement.tagName : node.tagName;

  if (ts.isIdentifier(tagName)) {
    return tagName.text === 'Suspense';
  }

  // Handle React.Suspense
  if (ts.isPropertyAccessExpression(tagName)) {
    return (
      ts.isIdentifier(tagName.expression) &&
      tagName.expression.text === 'React' &&
      tagName.name.text === 'Suspense'
    );
  }

  return false;
}

/**
 * Check if a function/component is async or contains await expressions
 */
function isAsyncComponent(
  node: ts.FunctionDeclaration | ts.ArrowFunction | ts.FunctionExpression
): boolean {
  // Explicit async keyword
  if (node.modifiers?.some((mod) => mod.kind === ts.SyntaxKind.AsyncKeyword)) {
    return true;
  }

  // Check for await expressions in body
  let hasAwait = false;
  const visit = (child: ts.Node) => {
    if (hasAwait) return; // Early exit
    if (ts.isAwaitExpression(child)) {
      hasAwait = true;
      return;
    }
    // Don't traverse into nested functions
    if (
      !ts.isFunctionDeclaration(child) &&
      !ts.isArrowFunction(child) &&
      !ts.isFunctionExpression(child)
    ) {
      ts.forEachChild(child, visit);
    }
  };

  if (node.body) {
    ts.forEachChild(node.body, visit);
  }

  return hasAwait;
}

/**
 * Check if a component is likely a server component (not marked with 'use client')
 */
function isServerComponent(sourceFile: ts.SourceFile): boolean {
  const text = sourceFile.getFullText();
  const useClientRegex = /['"]use client['"]/;
  return !useClientRegex.test(text);
}

/**
 * Find React component exports (default or named)
 */
function findComponentExports(
  sourceFile: ts.SourceFile
): Array<ts.FunctionDeclaration | ts.ArrowFunction | ts.FunctionExpression> {
  const components: Array<ts.FunctionDeclaration | ts.ArrowFunction | ts.FunctionExpression> = [];

  const visit = (node: ts.Node) => {
    // Function declarations
    if (ts.isFunctionDeclaration(node)) {
      if (node.modifiers?.some((mod) => mod.kind === ts.SyntaxKind.ExportKeyword)) {
        components.push(node);
      }
    }

    // Variable declarations with arrow functions
    if (ts.isVariableStatement(node)) {
      const isExported = node.modifiers?.some((mod) => mod.kind === ts.SyntaxKind.ExportKeyword);
      if (isExported) {
        node.declarationList.declarations.forEach((decl) => {
          if (decl.initializer && ts.isArrowFunction(decl.initializer)) {
            components.push(decl.initializer);
          }
        });
      }
    }

    // Export assignments
    if (ts.isExportAssignment(node)) {
      if (ts.isArrowFunction(node.expression) || ts.isFunctionExpression(node.expression)) {
        components.push(node.expression);
      }
    }

    ts.forEachChild(node, visit);
  };

  ts.forEachChild(sourceFile, visit);
  return components;
}

/**
 * Count await expressions in a function body
 */
function countAwaits(node: ts.Node): number {
  let count = 0;

  const visit = (child: ts.Node) => {
    if (ts.isAwaitExpression(child)) {
      count++;
    }
    // Don't count awaits in nested functions
    if (
      !ts.isFunctionDeclaration(child) &&
      !ts.isArrowFunction(child) &&
      !ts.isFunctionExpression(child)
    ) {
      ts.forEachChild(child, visit);
    }
  };

  ts.forEachChild(node, visit);
  return count;
}

/**
 * Check if component body contains Suspense boundary
 */
function hasSuspenseBoundary(node: ts.Node): boolean {
  let found = false;

  const visit = (child: ts.Node) => {
    if (found) return;

    if (ts.isJsxElement(child) && isSuspenseElement(child)) {
      found = true;
      return;
    }

    if (ts.isJsxSelfClosingElement(child) && isSuspenseElement(child)) {
      found = true;
      return;
    }

    // Don't traverse into nested components
    if (
      !ts.isFunctionDeclaration(child) &&
      !ts.isArrowFunction(child) &&
      !ts.isFunctionExpression(child)
    ) {
      ts.forEachChild(child, visit);
    }
  };

  ts.forEachChild(node, visit);
  return found;
}

/**
 * Detect async server components without Suspense boundaries
 */
export function detectSuspenseBoundaryIssues(
  sourceFile: ts.SourceFile,
  filePath: string
): Suggestion[] {
  const suggestions: Suggestion[] = [];

  // Only check server components
  if (!isServerComponent(sourceFile)) {
    return suggestions;
  }

  const components = findComponentExports(sourceFile);

  for (const component of components) {
    if (!isAsyncComponent(component)) {
      continue;
    }

    // Component is async but doesn't have Suspense boundary
    if (!hasSuspenseBoundary(component)) {
      const awaitCount = countAwaits(component.body || component);

      if (awaitCount === 0) {
        continue; // Skip if no actual awaits (might be async for other reasons)
      }

      suggestions.push(
        toSuggestion(
          sourceFile,
          component,
          SUSPENSE_MISSING_RULE,
          `Async server component with ${awaitCount} await expression${awaitCount > 1 ? 's' : ''} should be wrapped in a Suspense boundary for optimal streaming.`,
          'warn',
          filePath
        )
      );

      // Suggest parallel Suspense opportunities for multiple awaits
      if (awaitCount > 1) {
        suggestions.push(
          toSuggestion(
            sourceFile,
            component,
            SUSPENSE_OPPORTUNITY_RULE,
            `Consider splitting ${awaitCount} await expressions into parallel Suspense boundaries for better streaming performance.`,
            'info',
            filePath
          )
        );
      }
    }
  }

  return suggestions;
}
