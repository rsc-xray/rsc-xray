import { describe, expect, it } from 'vitest';
import * as ts from 'typescript';
import { parseRouteSegmentConfig, detectConfigConflicts, isRouteFile } from '../routeSegmentConfig';
import { ensureDefined } from '../../testUtils/assert';

function createSourceFile(code: string): ts.SourceFile {
  return ts.createSourceFile('test.tsx', code, ts.ScriptTarget.Latest, true);
}

describe('parseRouteSegmentConfig', () => {
  it('parses dynamic config', () => {
    const source = createSourceFile(`export const dynamic = 'force-static'`);
    const config = parseRouteSegmentConfig(source);
    expect(config?.dynamic).toBe('force-static');
  });

  it('parses revalidate as number', () => {
    const source = createSourceFile(`export const revalidate = 60`);
    const config = parseRouteSegmentConfig(source);
    expect(config?.revalidate).toBe(60);
  });

  it('parses revalidate as false', () => {
    const source = createSourceFile(`export const revalidate = false`);
    const config = parseRouteSegmentConfig(source);
    expect(config?.revalidate).toBe(false);
  });

  it('parses fetchCache config', () => {
    const source = createSourceFile(`export const fetchCache = 'force-no-store'`);
    const config = parseRouteSegmentConfig(source);
    expect(config?.fetchCache).toBe('force-no-store');
  });

  it('parses runtime config', () => {
    const source = createSourceFile(`export const runtime = 'edge'`);
    const config = parseRouteSegmentConfig(source);
    expect(config?.runtime).toBe('edge');
  });

  it('parses preferredRegion as string', () => {
    const source = createSourceFile(`export const preferredRegion = 'us-east-1'`);
    const config = parseRouteSegmentConfig(source);
    expect(config?.preferredRegion).toBe('us-east-1');
  });

  it('parses preferredRegion as array', () => {
    const source = createSourceFile(`export const preferredRegion = ['us-east-1', 'eu-west-1']`);
    const config = parseRouteSegmentConfig(source);
    expect(config?.preferredRegion).toEqual(['us-east-1', 'eu-west-1']);
  });

  it('parses all config options together', () => {
    const source = createSourceFile(`
      export const dynamic = 'force-dynamic'
      export const revalidate = 3600
      export const fetchCache = 'default-cache'
      export const runtime = 'nodejs'
      export const preferredRegion = 'us-east-1'
    `);
    const config = parseRouteSegmentConfig(source);
    expect(config?.dynamic).toBe('force-dynamic');
    expect(config?.revalidate).toBe(3600);
    expect(config?.fetchCache).toBe('default-cache');
    expect(config?.runtime).toBe('nodejs');
    expect(config?.preferredRegion).toBe('us-east-1');
  });

  it('returns undefined when no config exports found', () => {
    const source = createSourceFile(`export default function Page() { return <div>Hello</div> }`);
    const config = parseRouteSegmentConfig(source);
    expect(config).toBeUndefined();
  });

  it('ignores non-exported config', () => {
    const source = createSourceFile(`const dynamic = 'force-static'`);
    const config = parseRouteSegmentConfig(source);
    expect(config).toBeUndefined();
  });

  it('ignores invalid dynamic values', () => {
    const source = createSourceFile(`export const dynamic = 'invalid-value'`);
    const config = parseRouteSegmentConfig(source);
    expect(config).toBeUndefined();
  });
});

describe('detectConfigConflicts', () => {
  it('detects force-static with cookies()', () => {
    const source = createSourceFile(`
      export const dynamic = 'force-static'
      export default async function Page() {
        const cookieStore = cookies()
        return <div>Page</div>
      }
    `);
    const config = { dynamic: 'force-static' as const };
    const diagnostics = detectConfigConflicts(source, config, 'app/page.tsx');

    expect(diagnostics).toHaveLength(1);
    const firstDiagnostic = ensureDefined(diagnostics[0]);
    expect(firstDiagnostic.rule).toBe('route-segment-config-conflict');
    expect(firstDiagnostic.level).toBe('error');
    expect(firstDiagnostic.message).toContain('force-static');
    expect(firstDiagnostic.message).toContain('cookies');
  });

  it('detects force-static with headers()', () => {
    const source = createSourceFile(`
      export const dynamic = 'force-static'
      export default async function Page() {
        const headersList = headers()
        return <div>Page</div>
      }
    `);
    const config = { dynamic: 'force-static' as const };
    const diagnostics = detectConfigConflicts(source, config, 'app/page.tsx');

    expect(diagnostics).toHaveLength(1);
    const firstDiagnostic = ensureDefined(diagnostics[0]);
    expect(firstDiagnostic.message).toContain('headers');
  });

  it('detects force-static with searchParams', () => {
    const source = createSourceFile(`
      export const dynamic = 'force-static'
      export default async function Page({ params }: { params: { id: string } }) {
        const search = params.searchParams
        return <div>Page</div>
      }
    `);
    const config = { dynamic: 'force-static' as const };
    const diagnostics = detectConfigConflicts(source, config, 'app/page.tsx');

    expect(diagnostics).toHaveLength(1);
    const firstDiagnostic = ensureDefined(diagnostics[0]);
    expect(firstDiagnostic.message).toContain('searchParams');
  });

  it('detects revalidate with force-dynamic conflict', () => {
    const source = createSourceFile(`export const dynamic = 'force-dynamic'`);
    const config = {
      dynamic: 'force-dynamic' as const,
      revalidate: 60,
    };
    const diagnostics = detectConfigConflicts(source, config, 'app/page.tsx');

    expect(diagnostics).toHaveLength(1);
    const firstDiagnostic = ensureDefined(diagnostics[0]);
    expect(firstDiagnostic.level).toBe('warn');
    expect(firstDiagnostic.message).toContain('revalidate');
    expect(firstDiagnostic.message).toContain('force-dynamic');
  });

  it('detects edge runtime with Node.js APIs', () => {
    const source = createSourceFile(`
      import { readFileSync } from 'fs'
      export const runtime = 'edge'
      export default function Page() {
        return <div>Page</div>
      }
    `);
    const config = { runtime: 'edge' as const };
    const diagnostics = detectConfigConflicts(source, config, 'app/page.tsx');

    expect(diagnostics).toHaveLength(1);
    const firstDiagnostic = ensureDefined(diagnostics[0]);
    expect(firstDiagnostic.level).toBe('error');
    expect(firstDiagnostic.message).toContain('edge');
    expect(firstDiagnostic.message).toContain('Node.js');
  });

  it('detects edge runtime with node: imports', () => {
    const source = createSourceFile(`
      import { readFile } from 'node:fs/promises'
      export const runtime = 'edge'
    `);
    const config = { runtime: 'edge' as const };
    const diagnostics = detectConfigConflicts(source, config, 'app/page.tsx');

    expect(diagnostics).toHaveLength(1);
    const firstDiagnostic = ensureDefined(diagnostics[0]);
    expect(firstDiagnostic.message).toContain('Node.js');
  });

  it('detects force-no-store with revalidate conflict', () => {
    const source = createSourceFile(`export const fetchCache = 'force-no-store'`);
    const config = {
      fetchCache: 'force-no-store' as const,
      revalidate: 60,
    };
    const diagnostics = detectConfigConflicts(source, config, 'app/page.tsx');

    expect(diagnostics).toHaveLength(1);
    const firstDiagnostic = ensureDefined(diagnostics[0]);
    expect(firstDiagnostic.level).toBe('warn');
    expect(firstDiagnostic.message).toContain('force-no-store');
    expect(firstDiagnostic.message).toContain('revalidate');
  });

  it('allows force-static without dynamic APIs', () => {
    const source = createSourceFile(`
      export const dynamic = 'force-static'
      export default function Page() {
        return <div>Static Page</div>
      }
    `);
    const config = { dynamic: 'force-static' as const };
    const diagnostics = detectConfigConflicts(source, config, 'app/page.tsx');

    expect(diagnostics).toHaveLength(0);
  });

  it('allows valid revalidate with auto dynamic', () => {
    const source = createSourceFile(`export const revalidate = 60`);
    const config = { revalidate: 60 };
    const diagnostics = detectConfigConflicts(source, config, 'app/page.tsx');

    expect(diagnostics).toHaveLength(0);
  });
});

describe('isRouteFile', () => {
  it('identifies page.tsx as route file', () => {
    expect(isRouteFile('app/page.tsx')).toBe(true);
    expect(isRouteFile('app/dashboard/page.tsx')).toBe(true);
  });

  it('identifies layout.tsx as route file', () => {
    expect(isRouteFile('app/layout.tsx')).toBe(true);
    expect(isRouteFile('app/dashboard/layout.tsx')).toBe(true);
  });

  it('identifies route.ts as route file', () => {
    expect(isRouteFile('app/api/route.ts')).toBe(true);
    expect(isRouteFile('app/api/users/route.ts')).toBe(true);
  });

  it('supports all valid extensions', () => {
    expect(isRouteFile('app/page.js')).toBe(true);
    expect(isRouteFile('app/page.jsx')).toBe(true);
    expect(isRouteFile('app/page.ts')).toBe(true);
    expect(isRouteFile('app/layout.js')).toBe(true);
  });

  it('rejects non-route files', () => {
    expect(isRouteFile('app/components/Button.tsx')).toBe(false);
    expect(isRouteFile('app/utils/helpers.ts')).toBe(false);
    expect(isRouteFile('app/loading.tsx')).toBe(false);
  });

  it('handles Windows paths', () => {
    expect(isRouteFile('app\\page.tsx')).toBe(true);
    expect(isRouteFile('app\\dashboard\\page.tsx')).toBe(true);
  });
});
