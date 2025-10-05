import * as ts from 'typescript';

export interface FileCacheMetadata {
  tags: Set<string>;
  cacheModes: Set<'force-cache' | 'no-store'>;
  revalidateSeconds: Set<number>;
  hasRevalidateFalse: boolean;
  revalidateTagCalls: Set<string>;
  revalidatePathCalls: Set<string>;
  exportedDynamic?: 'auto' | 'force-dynamic' | 'force-static' | 'error';
  experimentalPpr: boolean;
  usesDynamicApis: boolean;
}

interface CollectOptions {
  sourceText: string;
}

const CACHE_LITERAL_VALUES = new Set(['force-cache', 'no-store']);
const DYNAMIC_LITERAL_VALUES = new Set(['auto', 'force-dynamic', 'force-static', 'error']);

function createEmptyMetadata(): FileCacheMetadata {
  return {
    tags: new Set<string>(),
    cacheModes: new Set<'force-cache' | 'no-store'>(),
    revalidateSeconds: new Set<number>(),
    hasRevalidateFalse: false,
    revalidateTagCalls: new Set<string>(),
    revalidatePathCalls: new Set<string>(),
    experimentalPpr: false,
    usesDynamicApis: false,
  };
}

function extractStaticString(node: ts.Expression): string | null {
  if (ts.isStringLiteralLike(node)) {
    return node.text;
  }
  if (ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text;
  }
  if (ts.isTemplateExpression(node) && node.templateSpans.length === 0) {
    return node.head.text;
  }
  return null;
}

function extractStaticNumber(node: ts.Expression): number | null {
  if (ts.isNumericLiteral(node)) {
    const value = Number(node.text);
    return Number.isFinite(value) ? value : null;
  }
  return null;
}

function extractStaticBoolean(node: ts.Expression): boolean | null {
  if (node.kind === ts.SyntaxKind.TrueKeyword) {
    return true;
  }
  if (node.kind === ts.SyntaxKind.FalseKeyword) {
    return false;
  }
  return null;
}

function collectTagsFromExpression(target: ts.Expression, into: Set<string>) {
  if (ts.isArrayLiteralExpression(target)) {
    for (const element of target.elements) {
      if (!ts.isExpression(element)) {
        continue;
      }
      const value = extractStaticString(element);
      if (value && !value.startsWith('_N_')) {
        into.add(value);
      }
    }
    return;
  }

  const literal = extractStaticString(target);
  if (literal) {
    literal
      .split(/[,\n]/)
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0 && !entry.startsWith('_N_'))
      .forEach((entry) => {
        into.add(entry);
      });
  }
}

function collectCacheFromObjectLiteral(
  node: ts.ObjectLiteralExpression,
  metadata: FileCacheMetadata
) {
  for (const property of node.properties) {
    if (!ts.isPropertyAssignment(property) || !property.name) {
      continue;
    }

    const name = ts.isIdentifier(property.name)
      ? property.name.text
      : ts.isStringLiteralLike(property.name)
        ? property.name.text
        : undefined;

    if (!name) {
      continue;
    }

    if (!ts.isExpression(property.initializer)) {
      continue;
    }

    switch (name) {
      case 'cache': {
        const literal = extractStaticString(property.initializer);
        if (literal && CACHE_LITERAL_VALUES.has(literal as 'force-cache' | 'no-store')) {
          metadata.cacheModes.add(literal as 'force-cache' | 'no-store');
        }
        break;
      }
      case 'revalidate': {
        if (property.initializer.kind === ts.SyntaxKind.FalseKeyword) {
          metadata.hasRevalidateFalse = true;
        } else {
          const value = extractStaticNumber(property.initializer);
          if (typeof value === 'number') {
            metadata.revalidateSeconds.add(value);
          }
        }
        break;
      }
      case 'next': {
        if (ts.isObjectLiteralExpression(property.initializer)) {
          collectCacheFromObjectLiteral(property.initializer, metadata);
        }
        break;
      }
      case 'tags': {
        collectTagsFromExpression(property.initializer, metadata.tags);
        break;
      }
      case 'headers': {
        if (ts.isObjectLiteralExpression(property.initializer)) {
          collectCacheFromObjectLiteral(property.initializer, metadata);
        }
        break;
      }
      case 'x-next-cache-tags': {
        collectTagsFromExpression(property.initializer, metadata.tags);
        break;
      }
      default:
        break;
    }
  }
}

function isIdentifierWithName(node: ts.Expression, name: string): boolean {
  if (ts.isIdentifier(node)) {
    return node.text === name;
  }
  if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.name)) {
    return node.name.text === name;
  }
  return false;
}

export function collectCacheMetadata({ sourceText }: CollectOptions): FileCacheMetadata {
  const metadata = createEmptyMetadata();
  const sourceFile = ts.createSourceFile(
    'inline.tsx',
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );

  // Track local identifiers imported for dynamic APIs
  const headersIdents = new Set<string>();
  const cookiesIdents = new Set<string>();
  const draftModeIdents = new Set<string>();
  const noStoreIdents = new Set<string>();
  const headersNamespaces = new Set<string>();
  const cacheNamespaces = new Set<string>();

  const visit = (node: ts.Node) => {
    // import { cookies, headers, draftMode } from 'next/headers'
    // import { noStore, unstable_noStore } from 'next/cache'
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const module = node.moduleSpecifier.text;
      const bindings = node.importClause?.namedBindings;
      if (bindings && ts.isNamedImports(bindings)) {
        for (const element of bindings.elements) {
          const importedNode = element.propertyName ?? element.name;
          const importedName = ts.isIdentifier(importedNode) ? importedNode.text : undefined;
          const localName = ts.isIdentifier(element.name) ? element.name.text : undefined;
          if (!localName) continue;
          if (module === 'next/headers') {
            if (importedName === 'headers') headersIdents.add(localName);
            if (importedName === 'cookies') cookiesIdents.add(localName);
            if (importedName === 'draftMode') draftModeIdents.add(localName);
          } else if (module === 'next/cache') {
            if (importedName === 'noStore' || importedName === 'unstable_noStore') {
              noStoreIdents.add(localName);
            }
          }
        }
      } else if (bindings && ts.isNamespaceImport(bindings)) {
        const localName = bindings.name.text;
        if (module === 'next/headers') {
          headersNamespaces.add(localName);
        } else if (module === 'next/cache') {
          cacheNamespaces.add(localName);
        }
      }
    }

    if (
      ts.isVariableStatement(node) &&
      node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)
    ) {
      for (const declaration of node.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name)) {
          continue;
        }
        const initializer = declaration.initializer;
        if (!initializer || !ts.isExpression(initializer)) {
          continue;
        }

        switch (declaration.name.text) {
          case 'revalidate': {
            if (initializer.kind === ts.SyntaxKind.FalseKeyword) {
              metadata.hasRevalidateFalse = true;
            } else {
              const value = extractStaticNumber(initializer);
              if (typeof value === 'number') {
                metadata.revalidateSeconds.add(value);
              }
            }
            break;
          }
          case 'dynamic': {
            const literal = extractStaticString(initializer);
            if (literal && DYNAMIC_LITERAL_VALUES.has(literal)) {
              metadata.exportedDynamic = literal as
                | 'auto'
                | 'force-dynamic'
                | 'force-static'
                | 'error';
            }
            break;
          }
          case 'experimental_ppr': {
            const value = extractStaticBoolean(initializer);
            if (value === true) {
              metadata.experimentalPpr = true;
            }
            break;
          }
          default:
            break;
        }
      }
    }

    // Detect dynamic import patterns assigning next/headers or next/cache
    if (ts.isVariableDeclaration(node)) {
      const init = node.initializer;
      // Handle: const nh = await import('next/headers')
      //         const { headers } = await import('next/headers')
      //         const nh = import('next/headers')
      let call: ts.CallExpression | null = null;
      if (init && ts.isAwaitExpression(init) && ts.isCallExpression(init.expression)) {
        call = init.expression;
      } else if (init && ts.isCallExpression(init)) {
        call = init;
      }
      if (
        call &&
        call.expression.kind === ts.SyntaxKind.ImportKeyword &&
        call.arguments.length >= 1 &&
        ts.isStringLiteral(call.arguments[0]!)
      ) {
        const spec = (call.arguments[0] as ts.StringLiteral).text;
        const isHeaders = spec === 'next/headers';
        const isCache = spec === 'next/cache';
        if (isHeaders || isCache) {
          // Conservative: mark dynamic
          metadata.usesDynamicApis = true;

          const name = node.name;
          if (ts.isObjectBindingPattern(name)) {
            for (const elem of name.elements) {
              const importedNode = elem.propertyName ?? elem.name;
              if (!ts.isIdentifier(importedNode)) continue;
              const imported = importedNode.text;
              const local = ts.isIdentifier(elem.name) ? elem.name.text : undefined;
              if (!local) continue;
              if (isHeaders) {
                if (imported === 'headers') headersIdents.add(local);
                if (imported === 'cookies') cookiesIdents.add(local);
                if (imported === 'draftMode') draftModeIdents.add(local);
              } else if (isCache) {
                if (imported === 'noStore' || imported === 'unstable_noStore') {
                  noStoreIdents.add(local);
                }
              }
            }
          } else if (ts.isIdentifier(name)) {
            // Namespace-style
            if (isHeaders) headersNamespaces.add(name.text);
            if (isCache) cacheNamespaces.add(name.text);
          }
        }
      }
    }

    if (ts.isCallExpression(node)) {
      if (isIdentifierWithName(node.expression, 'fetch') && node.arguments.length >= 2) {
        const options = node.arguments[1];
        if (options && ts.isObjectLiteralExpression(options)) {
          collectCacheFromObjectLiteral(options, metadata);
        }
      } else if (
        ts.isIdentifier(node.expression) &&
        (headersIdents.has(node.expression.text) ||
          cookiesIdents.has(node.expression.text) ||
          draftModeIdents.has(node.expression.text) ||
          noStoreIdents.has(node.expression.text))
      ) {
        metadata.usesDynamicApis = true;
      } else if (ts.isPropertyAccessExpression(node.expression)) {
        const expr = node.expression;
        if (ts.isIdentifier(expr.expression) && ts.isIdentifier(expr.name)) {
          const ns = expr.expression.text;
          const prop = expr.name.text;
          if (
            (headersNamespaces.has(ns) &&
              (prop === 'headers' || prop === 'cookies' || prop === 'draftMode')) ||
            (cacheNamespaces.has(ns) && (prop === 'noStore' || prop === 'unstable_noStore'))
          ) {
            metadata.usesDynamicApis = true;
          }
        }
      } else if (isIdentifierWithName(node.expression, 'revalidateTag')) {
        const [first] = node.arguments;
        if (first && ts.isExpression(first)) {
          const tag = extractStaticString(first);
          if (tag) {
            metadata.revalidateTagCalls.add(tag);
          }
        }
      } else if (isIdentifierWithName(node.expression, 'revalidatePath')) {
        const [first] = node.arguments;
        if (first && ts.isExpression(first)) {
          const path = extractStaticString(first);
          if (path) {
            metadata.revalidatePathCalls.add(path);
          }
        }
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return metadata;
}
