import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { buildGraph } from '../graph';
import type { Suggestion } from '@rsc-xray/schemas';
import type { Diagnostic } from '@rsc-xray/schemas';
import { classifyFiles } from '../classifyFiles';
import { ensureDefined } from '../../testUtils/assert';

async function collectTsFiles(root: string): Promise<string[]> {
  async function walk(dir: string): Promise<string[]> {
    const entries = await readdir(dir, { withFileTypes: true });
    const files: string[] = [];

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...(await walk(fullPath)));
      } else if (/\.(tsx?|jsx?)$/.test(entry.name)) {
        files.push(fullPath);
      }
    }

    return files;
  }

  return walk(root);
}

describe('buildGraph', () => {
  it('constructs route and component nodes with relationships', async () => {
    const projectRoot = join(__dirname, '__fixtures__', 'graph-basic');
    const filePaths = await collectTsFiles(projectRoot);
    const classified = await classifyFiles({ projectRoot, filePaths });

    const diagnosticsByFile: Record<string, Diagnostic[]> = {
      'app/components/Button.tsx': [
        {
          rule: 'client-forbidden-import',
          level: 'error',
          message: 'Client modules must not use fs',
          loc: { file: 'app/components/Button.tsx', range: { from: 0, to: 10 } },
        },
      ],
    };

    const suggestionsByFile: Record<string, Suggestion[]> = {
      'app/components/Button.tsx': [
        {
          rule: 'client-hoist-fetch',
          level: 'warn',
          message: 'Move fetch to server',
          loc: { file: 'app/components/Button.tsx', range: { from: 100, to: 120 } },
        },
      ],
    };

    const graph = await buildGraph({
      projectRoot,
      classifiedFiles: classified,
      diagnosticsByFile,
      clientBundles: [
        {
          filePath: 'app/components/Button.tsx',
          chunks: ['static/chunks/app/button.js'],
          totalBytes: 3072,
        },
      ],
      suggestionsByFile,
    });

    expect(graph.routes).toEqual([
      { route: '/', rootNodeId: 'route:/' },
      { route: '/products', rootNodeId: 'route:/products' },
    ]);

    expect(graph.nodes['route:/']).toMatchObject({
      id: 'route:/',
      kind: 'route',
      children: ['module:app/page.tsx'],
    });

    expect(graph.nodes['module:app/page.tsx']).toMatchObject({
      id: 'module:app/page.tsx',
      kind: 'server',
      children: expect.arrayContaining([
        'module:app/components/Button.tsx',
        'module:app/components/ServerMessage.tsx',
      ]),
    });

    expect(graph.nodes['module:app/components/Button.tsx']).toMatchObject({
      kind: 'client',
      children: [],
      diagnostics: diagnosticsByFile['app/components/Button.tsx'],
      bytes: 3072,
      suggestions: suggestionsByFile['app/components/Button.tsx'],
    });

    expect(graph.nodes['route:/products']).toMatchObject({
      children: ['module:app/(shop)/products/page.tsx'],
    });

    const serverMessageNode = ensureDefined(graph.nodes['module:app/components/ServerMessage.tsx']);
    expect(serverMessageNode.diagnostics).toBeUndefined();
  });

  it('strips AST nodes from route segment config to prevent circular JSON refs', async () => {
    const projectRoot = join(__dirname, '__fixtures__', 'route-segment-config');
    const filePaths = await collectTsFiles(projectRoot);
    const classified = await classifyFiles({ projectRoot, filePaths });

    const graph = await buildGraph({
      projectRoot,
      classifiedFiles: classified,
      diagnosticsByFile: {},
      clientBundles: [],
      suggestionsByFile: {},
    });

    // Find route with segment config
    const routeWithConfig = graph.routes.find((r) => r.segmentConfig);
    expect(routeWithConfig).toBeDefined();
    expect(routeWithConfig?.segmentConfig).toBeDefined();

    // Ensure no AST nodes are present (would have 'nodes' property if they were)
    expect(routeWithConfig?.segmentConfig).not.toHaveProperty('nodes');

    // Ensure it's JSON-serializable (would throw if circular refs exist)
    expect(() => JSON.stringify(graph)).not.toThrow();

    // Verify the config values are still present
    expect(routeWithConfig?.segmentConfig).toMatchObject({
      dynamic: 'force-dynamic',
    });
  });
});
