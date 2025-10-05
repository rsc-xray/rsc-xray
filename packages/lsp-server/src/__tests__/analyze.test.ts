import { describe, it, expect } from 'vitest';
import { analyze } from '../analyze.js';
import type { LspAnalysisRequest } from '../types.js';

function ensureDefined<T>(value: T | null | undefined, message?: string): T {
  if (value === undefined || value === null) {
    throw new Error(message ?? 'Expected value to be defined');
  }
  return value;
}

describe('OSS LSP Server - Basic Wrapper Tests', () => {
  describe('Basic Analysis', () => {
    it('should analyze simple valid code', async () => {
      const request: LspAnalysisRequest = {
        code: 'export default function Page() { return <div>Hello</div>; }',
        fileName: 'app/page.tsx',
      };

      const response = await analyze(request);

      expect(response).toBeDefined();
      expect(response.diagnostics).toBeDefined();
      expect(Array.isArray(response.diagnostics)).toBe(true);
      expect(response.duration).toBeGreaterThanOrEqual(0);
      expect(response.rulesExecuted).toBeDefined();
      expect(Array.isArray(response.rulesExecuted)).toBe(true);
      expect(response.version).toBeDefined();
      expect(response.error).toBeUndefined();
    });

    it('should detect serialization boundary violations', async () => {
      const request: LspAnalysisRequest = {
        code: `
          import ClientComp from './ClientComp';
          
          export default function Page() {
            const handler = () => console.log('click');
            return <ClientComp onClick={handler} />;
          }
        `,
        fileName: 'app/page.tsx',
        scenario: 'serialization-boundary',
        context: { clientComponentPaths: ['./ClientComp'] },
      };

      const response = await analyze(request);

      expect(response.error).toBeUndefined();
      expect(response.rulesExecuted).toContain('serialization-boundary-violation');
    });

    it('should detect forbidden client imports', async () => {
      const request: LspAnalysisRequest = {
        code: `
          'use client';
          import fs from 'fs';
          
          export default function BadClient() {
            fs.readFileSync('file.txt');
            return <div>Client</div>;
          }
        `,
        fileName: 'components/BadClient.tsx',
        scenario: 'client-forbidden-imports',
      };

      const response = await analyze(request);

      expect(response.error).toBeUndefined();
      expect(response.diagnostics.length).toBeGreaterThan(0);
      const firstDiagnostic = ensureDefined(response.diagnostics[0]);
      expect(firstDiagnostic.rule).toBe('client-forbidden-import');
    });

    it('should detect missing Suspense boundaries', async () => {
      const request: LspAnalysisRequest = {
        code: `
          async function fetchData() {
            return new Promise(resolve => setTimeout(resolve, 100));
          }
          
          export default async function Page() {
            await fetchData();
            return <div>Content</div>;
          }
        `,
        fileName: 'app/page.tsx',
        scenario: 'suspense-boundary',
      };

      const response = await analyze(request);

      expect(response.error).toBeUndefined();
      expect(response.diagnostics.length).toBeGreaterThan(0);
      const hasSuspenseRule = response.diagnostics.some(
        (d) => d.rule === 'suspense-boundary-missing' || d.rule === 'suspense-boundary-opportunity'
      );
      expect(hasSuspenseRule).toBe(true);
    });
  });

  describe('Scenarios and Rules', () => {
    it('should run only specified scenario', async () => {
      const request: LspAnalysisRequest = {
        code: `
          'use client';
          import fs from 'fs';
          export default function BadClient() {
            return <div>Client</div>;
          }
        `,
        fileName: 'components/BadClient.tsx',
        scenario: 'client-forbidden-imports',
      };

      const response = await analyze(request);
      expect(response.rulesExecuted).toContain('client-forbidden-import');
    });

    it('should run only specified rules', async () => {
      const request: LspAnalysisRequest = {
        code: `
          'use client';
          import fs from 'fs';
          export default function BadClient() {
            return <div>Client</div>;
          }
        `,
        fileName: 'components/BadClient.tsx',
        rules: ['client-forbidden-import'],
      };

      const response = await analyze(request);
      expect(response.rulesExecuted).toEqual(['client-forbidden-import']);
    });

    it('should run all applicable rules when no scenario specified', async () => {
      const request: LspAnalysisRequest = {
        code: `
          'use client';
          import fs from 'fs';
          export default function BadClient() {
            fs.readFileSync('file.txt');
            return <div>Client</div>;
          }
        `,
        fileName: 'components/BadClient.tsx',
      };

      const response = await analyze(request);

      // Should run multiple rules
      expect(response.rulesExecuted.length).toBeGreaterThan(0);
    });
  });

  describe('Error Handling', () => {
    it('should handle malformed code gracefully', async () => {
      const request: LspAnalysisRequest = {
        code: 'const x = {{{{{ invalid syntax',
        fileName: 'app/page.tsx',
      };

      const response = await analyze(request);

      // Should not throw, may return diagnostics or none
      expect(response).toBeDefined();
      expect(response.diagnostics).toBeDefined();
      expect(Array.isArray(response.diagnostics)).toBe(true);
    });

    it('should handle empty code', async () => {
      const request: LspAnalysisRequest = {
        code: '',
        fileName: 'app/page.tsx',
      };

      const response = await analyze(request);

      // Empty code is allowed by OSS analyzer (it's up to the caller to validate)
      expect(response).toBeDefined();
      expect(response.diagnostics).toBeDefined();
    });
  });

  describe('Performance', () => {
    it('should track analysis duration', async () => {
      const request: LspAnalysisRequest = {
        code: 'export default function Page() { return <div>Hello</div>; }',
        fileName: 'app/page.tsx',
      };

      const response = await analyze(request);

      expect(response.duration).toBeGreaterThanOrEqual(0);
      expect(typeof response.duration).toBe('number');
    });
  });

  describe('Version Info', () => {
    it('should include analyzer version', async () => {
      const request: LspAnalysisRequest = {
        code: 'export default function Page() { return <div>Hello</div>; }',
        fileName: 'app/page.tsx',
      };

      const response = await analyze(request);

      expect(response.version).toBeDefined();
      expect(typeof response.version).toBe('string');
      expect(response.version).toMatch(/^\d+\.\d+\.\d+$/); // SemVer format
    });
  });
});
