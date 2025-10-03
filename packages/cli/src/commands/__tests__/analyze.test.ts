import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { MockedFunction, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Model } from '@rsc-xray/schemas';

vi.mock('@rsc-xray/analyzer', async () => {
  const actual = await vi.importActual<typeof import('@rsc-xray/analyzer')>('@rsc-xray/analyzer');
  return {
    ...actual,
    analyzeProject: vi.fn(),
  } satisfies Partial<typeof actual>;
});

const { analyzeProject } = await import('@rsc-xray/analyzer');
const analyzeProjectMock = analyzeProject as MockedFunction<typeof analyzeProject>;

const VALID_MODEL: Model = {
  version: '0.1',
  routes: [{ route: '/', rootNodeId: 'route:/' }],
  nodes: {
    'route:/': {
      id: 'route:/',
      kind: 'route',
      name: '/',
      children: [],
    },
  },
  build: {
    nextVersion: '14.2.0',
    timestamp: '2025-09-20T10:00:00.000Z',
  },
};

beforeEach(() => {
  analyzeProjectMock.mockReset();
  analyzeProjectMock.mockResolvedValue(VALID_MODEL);
});

describe('analyze command', () => {
  it('writes the model to disk when schema validation succeeds', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'scx-cli-analyze-'));
    try {
      const outputPath = join(dir, 'model.json');

      const { analyze } = await import('../analyze');

      const model = await analyze({
        projectRoot: dir,
        outputPath,
        pretty: false,
      });

      expect(model).toEqual(VALID_MODEL);
      const raw = await readFile(outputPath, 'utf8');
      expect(JSON.parse(raw)).toEqual(VALID_MODEL);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('throws when generated model fails schema validation', async () => {
    analyzeProjectMock.mockResolvedValueOnce({ version: '0.1' } as Model);

    const dir = await mkdtemp(join(tmpdir(), 'scx-cli-analyze-invalid-'));
    try {
      const outputPath = join(dir, 'model.json');
      const { analyze } = await import('../analyze');

      await expect(analyze({ projectRoot: dir, outputPath })).rejects.toThrowError(
        /schema validation failed/i
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('produces JSON-serializable output with route segment config', async () => {
    const modelWithSegmentConfig: Model = {
      version: '0.1',
      routes: [
        {
          route: '/products',
          rootNodeId: 'route:/products',
          segmentConfig: {
            dynamic: 'force-dynamic',
            revalidate: 60,
          },
        },
      ],
      nodes: {
        'route:/products': {
          id: 'route:/products',
          kind: 'route',
          name: '/products',
          children: [],
        },
      },
      build: {
        nextVersion: '14.2.0',
        timestamp: '2025-09-20T10:00:00.000Z',
      },
    };

    analyzeProjectMock.mockResolvedValueOnce(modelWithSegmentConfig);

    const dir = await mkdtemp(join(tmpdir(), 'scx-cli-analyze-segment-'));
    try {
      const outputPath = join(dir, 'model.json');
      const { analyze } = await import('../analyze');

      const model = await analyze({
        projectRoot: dir,
        outputPath,
        pretty: false,
      });

      expect(model).toEqual(modelWithSegmentConfig);

      // Verify JSON is valid and can be parsed back
      const raw = await readFile(outputPath, 'utf8');
      const parsed = JSON.parse(raw);
      expect(parsed).toEqual(modelWithSegmentConfig);

      // Ensure no circular references or AST nodes leaked through
      expect(parsed.routes[0].segmentConfig).not.toHaveProperty('nodes');
      expect(parsed.routes[0].segmentConfig).toMatchObject({
        dynamic: 'force-dynamic',
        revalidate: 60,
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
