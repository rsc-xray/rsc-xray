/**
 * Pre-generate HTML report for the real-world scenario at build time
 *
 * This script:
 * 1. Analyzes all files in the real-world scenario
 * 2. Builds a Model object
 * 3. Generates the HTML report using @rsc-xray/report-html
 * 4. Saves it to public/reports/real-world.html
 *
 * Run during build: `pnpm prebuild`
 */
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { renderHtmlReport } from '@rsc-xray/report-html';
import { analyze } from '@rsc-xray/lsp-server';
import type { Model } from '@rsc-xray/schemas';

async function generateReport() {
  console.log('🔍 Generating real-world scenario report...');

  // For now, we'll inline the scenario data since we can't easily import TS in a script
  // In production, you'd want to make scenarios.ts importable or use a different approach

  const scenario = {
    code: `// app/dashboard/page.tsx
// E-Commerce Dashboard with Analytics

import fs from 'fs'; // ❌ Node API in potential client context
import { Suspense } from 'react';
import { ProductChart } from './ProductChart';
import { SalesMetrics } from './SalesMetrics';
import { UserActivity } from './UserActivity';

export const revalidate = 60;
export const dynamic = 'force-dynamic'; // ❌ Conflicts with revalidate

async function getAnalytics() {
  const data = await fetch('https://api.example.com/analytics');
  return data.json();
}

async function getSales() {
  const sales = await fetch('https://api.example.com/sales');
  return sales.json();
}

export default async function Dashboard() {
  // ❌ Sequential awaits (waterfall)
  const analytics = await getAnalytics();
  const sales = await getSales();
  
  // ❌ Passing Date object to client component
  const handleExport = (date: Date) => {
    console.log('Exporting', date);
  };
  
  // ❌ Missing Suspense boundary
  return (
    <div>
      <h1>Dashboard</h1>
      <ProductChart 
        data={analytics} 
        onExport={handleExport}
        timestamp={new Date()}
      />
      <SalesMetrics metrics={sales} />
      <UserActivity />
    </div>
  );
}`,
    contextFiles: [
      {
        fileName: 'ProductChart.tsx',
        code: `'use client';
import fs from 'fs'; // ❌ Node API in client component
import { Chart } from 'chart-lib'; // Large dependency (80KB)
import { format } from 'date-fns'; // Shared dependency

interface Props {
  data: any;
  onExport: (date: Date) => void; // ❌ Function prop
  timestamp: Date; // ❌ Date prop
}

export function ProductChart({ data, onExport, timestamp }: Props) {
  return (
    <div>
      <h2>Product Sales</h2>
      <Chart data={data} />
      <p>Last updated: {format(timestamp, 'PPP')}</p>
      <button onClick={() => onExport(new Date())}>
        Export Report
      </button>
    </div>
  );
}`,
      },
      {
        fileName: 'SalesMetrics.tsx',
        code: `'use client';
import { Chart } from 'chart-lib'; // ⚠️ Duplicate: 80KB
import { merge } from 'lodash'; // Shared dependency (71KB)

export function SalesMetrics({ metrics }: { metrics: any }) {
  const config = merge({}, defaultConfig, metrics.config);
  
  return (
    <div>
      <h2>Sales Overview</h2>
      <Chart type="bar" data={config} />
    </div>
  );
}`,
      },
      {
        fileName: 'UserActivity.tsx',
        code: `'use client';
import { format } from 'date-fns'; // ⚠️ Duplicate
import { debounce } from 'lodash'; // ⚠️ Duplicate

// ❌ Manual deduplication (should use React 19 cache())
const activityCache = new Map();
async function fetchActivity() {
  if (activityCache.has('key')) return activityCache.get('key');
  const data = await fetch('/api/activity').then(r => r.json());
  activityCache.set('key', data);
  return data;
}

export function UserActivity() {
  // ... component logic
  return <div>Activity Feed</div>;
}`,
      },
    ],
    context: {
      clientComponentPaths: ['./ProductChart', './SalesMetrics', './UserActivity'],
      routeConfig: {
        revalidate: 60,
        dynamic: 'force-dynamic' as const,
      },
      clientBundles: [
        {
          filePath: 'app/dashboard/ProductChart.tsx',
          chunks: ['chart-lib', 'date-fns'],
          totalBytes: 145000,
        },
        {
          filePath: 'app/dashboard/SalesMetrics.tsx',
          chunks: ['chart-lib', 'lodash'],
          totalBytes: 98000,
        },
        {
          filePath: 'app/dashboard/UserActivity.tsx',
          chunks: ['date-fns', 'lodash'],
          totalBytes: 87000,
        },
      ],
      reactVersion: '18.3.1',
    },
  };

  try {
    // Analyze main file with ALL rules (omit scenario to run everything)
    const mainFileResult = await analyze({
      code: scenario.code,
      fileName: 'app/dashboard/page.tsx',
      context: scenario.context,
      // No scenario specified = run all applicable rules
    });

    console.log(`Main file diagnostics: ${mainFileResult.diagnostics.length}`);
    console.log(`Rules executed: ${mainFileResult.rulesExecuted.join(', ')}`);

    // Analyze context files with ALL rules
    const contextResults = await Promise.all(
      scenario.contextFiles.map(async (file) => {
        const result = await analyze({
          code: file.code,
          fileName: `app/dashboard/${file.fileName}`,
          context: scenario.context,
          // No scenario specified = run all applicable rules
        });
        console.log(`${file.fileName} diagnostics: ${result.diagnostics.length}`);
        return {
          fileName: file.fileName,
          diagnostics: result.diagnostics,
        };
      })
    );

    // Build Model object
    const model: Model = {
      version: '0.1',
      build: {
        nextVersion: '15.0.0',
        timestamp: new Date().toISOString(),
      },
      routes: [
        {
          route: '/dashboard',
          rootNodeId: 'route-dashboard',
          chunks: ['main', 'dashboard'],
          totalBytes: 330048,
        },
      ],
      nodes: {
        'route-dashboard': {
          id: 'route-dashboard',
          kind: 'route',
          file: 'app/dashboard/page.tsx',
          name: 'Dashboard',
          bytes: 2048,
          children: ['comp-product-chart', 'comp-sales-metrics', 'comp-user-activity'],
          diagnostics: mainFileResult.diagnostics
            .filter((d) => d.level !== 'info')
            .map((d) => ({
              rule: d.rule,
              level: d.level as 'error' | 'warn',
              message: d.message,
              loc: d.loc
                ? {
                    file: 'app/dashboard/page.tsx',
                    range: d.loc.range,
                  }
                : undefined,
            })),
        },
        'comp-product-chart': {
          id: 'comp-product-chart',
          kind: 'client',
          file: 'app/dashboard/ProductChart.tsx',
          name: 'ProductChart',
          bytes: 145000,
          diagnostics: contextResults[0]?.diagnostics
            .filter((d) => d.level !== 'info')
            .map((d) => ({
              rule: d.rule,
              level: d.level as 'error' | 'warn',
              message: d.message,
              loc: d.loc
                ? {
                    file: 'app/dashboard/ProductChart.tsx',
                    range: d.loc.range,
                  }
                : undefined,
            })),
        },
        'comp-sales-metrics': {
          id: 'comp-sales-metrics',
          kind: 'client',
          file: 'app/dashboard/SalesMetrics.tsx',
          name: 'SalesMetrics',
          bytes: 98000,
          diagnostics: contextResults[1]?.diagnostics
            .filter((d) => d.level !== 'info')
            .map((d) => ({
              rule: d.rule,
              level: d.level as 'error' | 'warn',
              message: d.message,
              loc: d.loc
                ? {
                    file: 'app/dashboard/SalesMetrics.tsx',
                    range: d.loc.range,
                  }
                : undefined,
            })),
        },
        'comp-user-activity': {
          id: 'comp-user-activity',
          kind: 'client',
          file: 'app/dashboard/UserActivity.tsx',
          name: 'UserActivity',
          bytes: 87000,
          diagnostics: contextResults[2]?.diagnostics
            .filter((d) => d.level !== 'info')
            .map((d) => ({
              rule: d.rule,
              level: d.level as 'error' | 'warn',
              message: d.message,
              loc: d.loc
                ? {
                    file: 'app/dashboard/UserActivity.tsx',
                    range: d.loc.range,
                  }
                : undefined,
            })),
        },
      },
    };

    // Generate HTML report
    const html = renderHtmlReport(model);

    // Ensure reports directory exists
    const reportsDir = join(__dirname, '../public/reports');
    mkdirSync(reportsDir, { recursive: true });

    // Write report
    const reportPath = join(reportsDir, 'real-world.html');
    writeFileSync(reportPath, html, 'utf-8');

    console.log(`✅ Report generated: ${reportPath}`);
    const totalDiagnostics = Object.values(model.nodes).reduce(
      (sum, node) => sum + (node.diagnostics?.length || 0),
      0
    );
    console.log(`   Diagnostics: ${totalDiagnostics} issues found across all components`);
  } catch (error) {
    console.error('❌ Failed to generate report:', error);
    process.exit(1);
  }
}

generateReport();
