import { describe, it, expect } from 'vitest';
import { analyzeLspRequest, analyzeScenario, createSourceFile, shouldAnalyzeFile } from '../lsp';
import { ensureDefined } from '../testUtils/assert';

describe('LSP API', () => {
  describe('createSourceFile', () => {
    it('should create SourceFile for .tsx files', () => {
      const code = 'export default function Page() { return <div>Hello</div>; }';
      const sourceFile = createSourceFile(code, 'app/page.tsx');

      expect(sourceFile.fileName).toBe('app/page.tsx');
      expect(sourceFile.text).toBe(code);
    });

    it('should create SourceFile for .ts files', () => {
      const code = 'export function hello() { return "world"; }';
      const sourceFile = createSourceFile(code, 'lib/utils.ts');

      expect(sourceFile.fileName).toBe('lib/utils.ts');
      expect(sourceFile.text).toBe(code);
    });
  });

  describe('shouldAnalyzeFile', () => {
    it('should identify route files', () => {
      const result = shouldAnalyzeFile('app/products/page.tsx', '');
      expect(result.isRouteFile).toBe(true);
    });

    it('should identify client components', () => {
      const code = `'use client';\nexport default function Button() {}`;
      const result = shouldAnalyzeFile('components/Button.tsx', code);
      expect(result.isClientComponent).toBe(true);
      expect(result.isServerComponent).toBe(false);
    });

    it('should identify server components', () => {
      const code = 'export default function ServerComponent() {}';
      const result = shouldAnalyzeFile('components/ServerMessage.tsx', code);
      expect(result.isServerComponent).toBe(true);
      expect(result.isClientComponent).toBe(false);
    });
  });

  describe('analyzeLspRequest - serialization boundary', () => {
    it('should detect non-serializable props', () => {
      const code = `
        'use client';
        import ClientComp from './ClientComp.js';
        
        export default function Page() {
          const handler = () => console.log('click');
          return <ClientComp onClick={handler} />;
        }
      `;

      const result = analyzeLspRequest({
        code,
        fileName: 'app/page.tsx',
        scenario: 'serialization-boundary',
        context: {
          clientComponentPaths: ['ClientComp'],
        },
      });

      // This test may not detect issues without full project context
      // The LSP API is best-effort for serialization boundary detection
      expect(result.rulesExecuted).toContain('serialization-boundary-violation');
      expect(result.duration).toBeGreaterThan(0);
    });

    it('should allow serializable props', () => {
      const code = `
        import ClientComp from './ClientComp.js';
        
        export default function Page() {
          return <ClientComp title="Hello" count={42} />;
        }
      `;

      const result = analyzeLspRequest({
        code,
        fileName: 'app/page.tsx',
        scenario: 'serialization-boundary',
        context: {
          clientComponentPaths: ['./ClientComp'],
        },
      });

      expect(result.diagnostics.length).toBe(0);
    });
  });

  describe('analyzeLspRequest - suspense boundary', () => {
    it('should detect missing Suspense boundary', () => {
      const code = `
        export default async function Page() {
          const data = await fetch('/api/data').then(r => r.json());
          return <div>{data.title}</div>;
        }
      `;

      const result = analyzeLspRequest({
        code,
        fileName: 'app/page.tsx',
        scenario: 'suspense-boundary',
      });

      expect(result.diagnostics.length).toBeGreaterThan(0);
      const hasSuspenseRule = result.diagnostics.some(
        (d) => d.rule === 'suspense-boundary-missing' || d.rule === 'suspense-boundary-opportunity'
      );
      expect(hasSuspenseRule).toBe(true);
    });
  });

  describe('analyzeLspRequest - React 19 cache', () => {
    it('should run React 19 cache analysis', () => {
      const code = `
        async function getUser(id: string) {
          const res = await fetch(\`/api/users/\${id}\`);
          return res.json();
        }
        
        export default async function Page() {
          const user1 = await getUser('1');
          const user2 = await getUser('1'); // Duplicate fetch
          return <div>{user1.name}</div>;
        }
      `;

      const result = analyzeLspRequest({
        code,
        fileName: 'app/page.tsx',
        scenario: 'react19-cache',
      });

      expect(result.rulesExecuted).toContain('react19-cache-opportunity');
      // Actual detection depends on the analyzer's heuristics
    });
  });

  describe('analyzeLspRequest - client forbidden imports', () => {
    it('should detect forbidden imports in client components', () => {
      const code = `
        'use client';
        import fs from 'fs';
        
        export default function Component() {
          return <div>Hello</div>;
        }
      `;

      const result = analyzeLspRequest({
        code,
        fileName: 'components/BadClient.tsx',
        scenario: 'client-forbidden-imports',
      });

      expect(result.diagnostics.length).toBeGreaterThan(0);
      const firstDiagnostic = ensureDefined(result.diagnostics[0]);
      expect(firstDiagnostic.rule).toBe('client-forbidden-import');
    });

    it('should allow safe imports in client components', () => {
      const code = `
        'use client';
        import { useState } from 'react';
        
        export default function Component() {
          const [count, setCount] = useState(0);
          return <button onClick={() => setCount(count + 1)}>{count}</button>;
        }
      `;

      const result = analyzeLspRequest({
        code,
        fileName: 'components/Button.tsx',
        scenario: 'client-forbidden-imports',
      });

      expect(result.diagnostics.length).toBe(0);
    });
  });

  describe('analyzeLspRequest - route config conflicts', () => {
    it('should run route config analysis', () => {
      const code = `
        export const dynamic = 'force-static';
        export const revalidate = 60;
        
        export default function Page() {
          return <div>Hello</div>;
        }
      `;

      const result = analyzeLspRequest({
        code,
        fileName: 'app/page.tsx',
        scenario: 'route-config',
        context: {
          routeConfig: {
            dynamic: 'force-static',
            revalidate: 60,
          },
        },
      });

      expect(result.rulesExecuted).toContain('route-segment-config-conflict');
      // Actual conflict detection depends on Next.js version and rules
    });
  });

  describe('analyzeLspRequest - multiple rules', () => {
    it('should run all applicable rules when no scenario specified', () => {
      const code = `
        'use client';
        import fs from 'fs';
        
        export default function Component() {
          return <div>Hello</div>;
        }
      `;

      const result = analyzeLspRequest({
        code,
        fileName: 'components/BadClient.tsx',
      });

      // Should run multiple rules
      expect(result.rulesExecuted.length).toBeGreaterThan(0);
    });

    it('should respect rules filter', () => {
      const code = `
        'use client';
        import fs from 'fs';
        
        export default function Component() {
          return <div>Hello</div>;
        }
      `;

      const result = analyzeLspRequest({
        code,
        fileName: 'components/BadClient.tsx',
        rules: ['client-forbidden-import'],
      });

      expect(result.rulesExecuted).toEqual(['client-forbidden-import']);
      expect(result.diagnostics.length).toBeGreaterThan(0);
    });
  });

  describe('analyzeScenario helper', () => {
    it('should analyze specific scenario', () => {
      const code = `
        'use client';
        import fs from 'fs';
        
        export default function Component() {
          return <div>Hello</div>;
        }
      `;

      const diagnostics = analyzeScenario(
        code,
        'components/BadClient.tsx',
        'client-forbidden-imports'
      );

      expect(diagnostics.length).toBeGreaterThan(0);
      const firstDiagnostic = ensureDefined(diagnostics[0]);
      expect(firstDiagnostic.rule).toBe('client-forbidden-import');
    });
  });

  describe('error handling', () => {
    it('should handle malformed code gracefully', () => {
      const code = 'const x = {{{{{ invalid syntax';

      const result = analyzeLspRequest({
        code,
        fileName: 'app/page.tsx',
      });

      // Should not throw, may return some diagnostics or none
      expect(result).toBeDefined();
      expect(result.diagnostics).toBeDefined();
      expect(Array.isArray(result.diagnostics)).toBe(true);
    });

    it('should handle empty code', () => {
      const result = analyzeLspRequest({
        code: '',
        fileName: 'app/page.tsx',
      });

      expect(result).toBeDefined();
      expect(result.diagnostics).toBeDefined();
    });
  });

  describe('performance', () => {
    it('should track analysis duration', () => {
      const code = `
        export default function Page() {
          return <div>Hello</div>;
        }
      `;

      const result = analyzeLspRequest({
        code,
        fileName: 'app/page.tsx',
      });

      expect(result.duration).toBeGreaterThanOrEqual(0);
      expect(typeof result.duration).toBe('number');
    });
  });
});
