import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from '../route';
import { NextRequest } from 'next/server';
import type { LspAnalysisRequest } from '@rsc-xray/lsp-server';

describe('POST /api/analyze', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should analyze serialization-boundary scenario and return diagnostics', async () => {
    const code = `import { ClientButton } from './ClientButton';

export default function Page() {
  const handleClick = () => console.log('clicked');
  
  return <ClientButton onClick={handleClick} />;
}`;

    const request = new NextRequest('http://localhost:3001/api/analyze', {
      method: 'POST',
      body: JSON.stringify({
        code,
        fileName: 'demo.tsx',
        scenario: 'serialization-boundary',
        context: {
          clientComponentPaths: ['./ClientButton', 'ClientButton'],
        },
      } as LspAnalysisRequest),
      headers: {
        'Content-Type': 'application/json',
      },
    });

    const response = await POST(request);
    const result = await response.json();

    console.log('Serialization boundary result:', JSON.stringify(result, null, 2));

    expect(response.status).toBe(200);
    expect(result.diagnostics).toBeDefined();
    expect(result.rulesExecuted).toBeDefined();
    expect(result.version).toBeDefined();

    // Should have at least 1 diagnostic for the function prop
    expect(result.diagnostics.length).toBeGreaterThan(0);
    expect(result.rulesExecuted.length).toBeGreaterThan(0);
    expect(result.rulesExecuted).toContain('serialization-boundary-violation');
  });

  it('should analyze client-forbidden-imports scenario and return diagnostics', async () => {
    const code = `'use client';
import fs from 'fs';
import path from 'path';

export function FileReader() {
  const files = fs.readdirSync('/tmp');
  return <div>Files: {files.length}</div>;
}`;

    const request = new NextRequest('http://localhost:3001/api/analyze', {
      method: 'POST',
      body: JSON.stringify({
        code,
        fileName: 'demo.tsx',
        scenario: 'client-forbidden-imports',
      } as LspAnalysisRequest),
      headers: {
        'Content-Type': 'application/json',
      },
    });

    const response = await POST(request);
    const result = await response.json();

    console.log('Client forbidden imports result:', JSON.stringify(result, null, 2));

    expect(response.status).toBe(200);
    expect(result.diagnostics).toBeDefined();

    // Should have diagnostics for fs and path imports
    expect(result.diagnostics.length).toBeGreaterThanOrEqual(2);
    expect(result.rulesExecuted).toContain('client-forbidden-import');
  });

  it('should analyze suspense-boundary scenario and return diagnostics', async () => {
    const code = `export default async function Page() {
  const data = await fetch('https://api.example.com/data');
  const json = await data.json();
  
  return <div>Data: {json.value}</div>;
}`;

    const request = new NextRequest('http://localhost:3001/api/analyze', {
      method: 'POST',
      body: JSON.stringify({
        code,
        fileName: 'page.tsx',
        scenario: 'suspense-boundary',
      } as LspAnalysisRequest),
      headers: {
        'Content-Type': 'application/json',
      },
    });

    const response = await POST(request);
    const result = await response.json();

    console.log('Suspense boundary result:', JSON.stringify(result, null, 2));

    expect(response.status).toBe(200);
    expect(result.diagnostics).toBeDefined();
    expect(result.rulesExecuted).toContain('suspense-boundary-missing');
  });

  it('should analyze client-size scenario and return diagnostics', async () => {
    const code = `'use client';
import _ from 'lodash'; // 71KB!
import moment from 'moment'; // 67KB!
import * as icons from 'react-icons/all'; // 200KB+!

export default function LargeClientComponent() {
  return (
    <div>
      <p>This client component imports large libraries.</p>
      <p>Lodash version: {_.VERSION}</p>
      <p>Current month: {moment().format('MMMM')}</p>
      <p>Total icons: {Object.keys(icons).length}</p>
    </div>
  );
}`;

    const request = new NextRequest('http://localhost:3001/api/analyze', {
      method: 'POST',
      body: JSON.stringify({
        code,
        fileName: 'demo.tsx',
        scenario: 'client-size',
        context: {
          clientBundles: [
            {
              filePath: 'demo.tsx',
              chunks: ['chunk-1.js', 'chunk-2.js', 'chunk-3.js'],
              totalBytes: 320000, // 320 KB - exceeds threshold
            },
          ],
        },
      } as LspAnalysisRequest),
      headers: {
        'Content-Type': 'application/json',
      },
    });

    const response = await POST(request);
    const result = await response.json();

    console.log('Client size result:', JSON.stringify(result, null, 2));

    expect(response.status).toBe(200);
    expect(result.diagnostics).toBeDefined();
    expect(result.rulesExecuted).toContain('client-component-oversized');
  });

  it('should analyze duplicate-dependencies scenario and return diagnostics', async () => {
    const code = `import { format } from 'date-fns';

export function DateDisplay({ date }: { date: Date }) {
  return <div>{format(date, 'PPP')}</div>;
}`;

    const request = new NextRequest('http://localhost:3001/api/analyze', {
      method: 'POST',
      body: JSON.stringify({
        code,
        fileName: 'components/DateDisplay.tsx',
        scenario: 'duplicate-dependencies',
        context: {
          clientBundles: [
            {
              filePath: 'components/DateDisplay.tsx',
              chunks: ['date-fns.js', 'lodash.js', 'moment.js'],
              totalBytes: 45000,
            },
            {
              filePath: 'components/Header.tsx',
              chunks: ['date-fns.js', 'lodash.js', 'moment.js'],
              totalBytes: 44000,
            },
            {
              filePath: 'components/Footer.tsx',
              chunks: ['date-fns.js', 'lodash.js', 'moment.js'],
              totalBytes: 43000,
            },
          ],
        },
      } as LspAnalysisRequest),
      headers: {
        'Content-Type': 'application/json',
      },
    });

    const response = await POST(request);
    const result = await response.json();

    console.log('Duplicate dependencies result:', JSON.stringify(result, null, 2));

    expect(response.status).toBe(200);
    expect(result.diagnostics).toBeDefined();
    expect(result.rulesExecuted).toContain('duplicate-dependencies');
    // Should detect 3 duplicate chunks shared across components
    expect(result.diagnostics.length).toBeGreaterThan(0);
    expect(result.diagnostics[0].message).toContain('3 dependencies');
  });

  it('should analyze react19-cache scenario and return diagnostics', async () => {
    const code = `export default async function Page() {
  const user = await fetch('/api/user/1');
  const userData = await user.json();
  
  const userAgain = await fetch('/api/user/1'); // Duplicate!
  const userDataAgain = await userAgain.json();
  
  return <div>{userData.name}</div>;
}`;

    const request = new NextRequest('http://localhost:3001/api/analyze', {
      method: 'POST',
      body: JSON.stringify({
        code,
        fileName: 'page.tsx',
        scenario: 'react19-cache',
      } as LspAnalysisRequest),
      headers: {
        'Content-Type': 'application/json',
      },
    });

    const response = await POST(request);
    const result = await response.json();

    console.log('React19 cache result:', JSON.stringify(result, null, 2));

    expect(response.status).toBe(200);
    expect(result.diagnostics).toBeDefined();
    expect(result.rulesExecuted).toContain('react19-cache-opportunity');
    // Should detect duplicate fetch
    expect(result.diagnostics.length).toBeGreaterThan(0);
    expect(result.diagnostics[0].message).toContain('Duplicate fetch');
    expect(result.diagnostics[0].message).toContain('/api/user/1');
  });

  it('should analyze route-config scenario with force-dynamic + revalidate conflict', async () => {
    const code = `export const dynamic = 'force-dynamic';
export const revalidate = 60; // Conflict!

export default function Page() {
  return <div>Dynamic page with revalidate?</div>;
}`;

    const request = new NextRequest('http://localhost:3001/api/analyze', {
      method: 'POST',
      body: JSON.stringify({
        code,
        fileName: 'page.tsx',
        scenario: 'route-config',
        context: {
          routeConfig: {
            dynamic: 'force-dynamic',
            revalidate: 60,
          },
        },
      } as LspAnalysisRequest),
      headers: {
        'Content-Type': 'application/json',
      },
    });

    const response = await POST(request);
    const result = await response.json();

    console.log(
      'Route config (force-dynamic + revalidate) result:',
      JSON.stringify(result, null, 2)
    );

    expect(response.status).toBe(200);
    expect(result.diagnostics).toBeDefined();
    expect(result.rulesExecuted).toContain('route-segment-config-conflict');
    expect(result.diagnostics.length).toBeGreaterThan(0);
    expect(result.diagnostics[0].message).toContain('force-dynamic');
    expect(result.diagnostics[0].message).toContain('revalidate');
  });

  it('should analyze route-config scenario with force-static + dynamic APIs conflict', async () => {
    const code = `import { cookies } from 'next/headers';

export const dynamic = 'force-static';

export default function Page() {
  const cookieStore = cookies(); // Conflict with force-static!
  return <div>Page</div>;
}`;

    const request = new NextRequest('http://localhost:3001/api/analyze', {
      method: 'POST',
      body: JSON.stringify({
        code,
        fileName: 'page.tsx',
        scenario: 'route-config',
        context: {
          routeConfig: {
            dynamic: 'force-static',
          },
        },
      } as LspAnalysisRequest),
      headers: {
        'Content-Type': 'application/json',
      },
    });

    const response = await POST(request);
    const result = await response.json();

    console.log('Route config (force-static + cookies) result:', JSON.stringify(result, null, 2));

    expect(response.status).toBe(200);
    expect(result.diagnostics).toBeDefined();
    expect(result.rulesExecuted).toContain('route-segment-config-conflict');
    expect(result.diagnostics.length).toBeGreaterThan(0);
    expect(result.diagnostics[0].message).toContain('force-static');
    expect(result.diagnostics[0].message).toContain('cookies');
  });

  it('should return 400 for missing required fields', async () => {
    const request = new NextRequest('http://localhost:3001/api/analyze', {
      method: 'POST',
      body: JSON.stringify({
        code: 'const x = 1;',
        // Missing fileName
      }),
      headers: {
        'Content-Type': 'application/json',
      },
    });

    const response = await POST(request);
    const result = await response.json();

    expect(response.status).toBe(400);
    expect(result.error).toBeDefined();
    expect(result.error.code).toBe('INVALID_REQUEST');
  });

  it('should handle analysis errors gracefully', async () => {
    const request = new NextRequest('http://localhost:3001/api/analyze', {
      method: 'POST',
      body: JSON.stringify({
        code: 'invalid typescript syntax {{{',
        fileName: 'demo.tsx',
        scenario: 'serialization-boundary',
      } as LspAnalysisRequest),
      headers: {
        'Content-Type': 'application/json',
      },
    });

    const response = await POST(request);
    const result = await response.json();

    // Should still return 200 with empty diagnostics (analysis may handle invalid syntax)
    // or return 500 with error
    expect([200, 500]).toContain(response.status);
    expect(result.diagnostics).toBeDefined();
  });
});
