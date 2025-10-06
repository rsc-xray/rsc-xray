import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { classifyFiles } from '../../lib/classifyFiles';
import {
  analyzeClientFileForForbiddenImports,
  collectForbiddenImportDiagnostics,
} from '../clientForbiddenImports';
import { ensureDefined } from '../../testUtils/assert';

const COMPONENT_ROOT = join(__dirname, '../../lib/__tests__/__fixtures__/components');

async function loadSource(absolutePath: string) {
  const fs = await import('node:fs/promises');
  return fs.readFile(absolutePath, 'utf8');
}

describe('client forbidden imports', () => {
  it('flags forbidden imports inside client components', async () => {
    const sourceText = "'use client';\nimport fs from 'fs';\nexport const Button = () => null;";
    const diagnostics = analyzeClientFileForForbiddenImports({
      fileName: 'Client.tsx',
      sourceText,
    });

    expect(diagnostics).toHaveLength(1);
    const firstDiagnostic = ensureDefined(diagnostics[0]);
    expect(firstDiagnostic).toMatchObject({
      rule: 'client-forbidden-import',
      level: 'error',
    });
  });

  it('skips server files automatically', async () => {
    const sourceText = "import fs from 'fs';\nexport const Server = () => null;";
    const diagnostics = analyzeClientFileForForbiddenImports({
      fileName: 'Server.tsx',
      sourceText,
    });

    expect(diagnostics).toHaveLength(0);
  });

  it('collects diagnostics across files', async () => {
    const filePaths = [
      join(COMPONENT_ROOT, 'ClientComponent.ts'),
      join(COMPONENT_ROOT, 'ServerComponent.ts'),
    ];
    const sources = await Promise.all(filePaths.map(loadSource));
    const classified = await classifyFiles({ projectRoot: COMPONENT_ROOT, filePaths });
    const files = classified.map((entry, index) => {
      const sourceText = ensureDefined(sources[index]);
      return {
        filePath: entry.filePath,
        kind: entry.kind,
        sourceText,
      };
    });

    const diagnostics = collectForbiddenImportDiagnostics({ files });
    expect(diagnostics).toHaveLength(0);
  });
});
