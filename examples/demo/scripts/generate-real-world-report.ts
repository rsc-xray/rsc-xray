/**
 * Pre-generate HTML report for the real-world scenario at build time
 *
 * This script:
 * 1. Analyzes all files in the real-world multi-route scenario
 * 2. Builds a Model object with 2 routes
 * 3. Generates the HTML report using @rsc-xray/report-html
 * 4. Saves it to public/reports/real-world.html
 *
 * Run during build: `pnpm prebuild`
 */
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { renderHtmlReport } from '@rsc-xray/report-html';
import { analyze } from '@rsc-xray/lsp-server';
import type { Model, Suggestion } from '@rsc-xray/schemas';

/**
 * Generate a multi-route real-world demo report
 *
 * Route 1: /dashboard - Has duplicate chart-lib, date-fns, lodash
 * Route 2: /products - Has duplicate date-fns only (ProductChart + ProductGrid)
 */
async function generateReport() {
  console.log('🔍 Generating multi-route real-world scenario report...');

  // Route 1: Dashboard
  const dashboardRoute = {
    route: '/dashboard',
    pageCode: `// app/dashboard/page.tsx
// E-Commerce Dashboard with Analytics

import fs from 'fs'; // ❌ Node API in potential client context
import { Suspense } from 'react';
import { ProductChart } from '../../components/ProductChart';
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
    components: [
      {
        fileName: 'ProductChart.tsx',
        filePath: 'app/components/ProductChart.tsx',
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
        filePath: 'app/dashboard/SalesMetrics.tsx',
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
        filePath: 'app/dashboard/UserActivity.tsx',
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
      clientComponentPaths: ['../../components/ProductChart', './SalesMetrics', './UserActivity'],
      routeConfig: {
        revalidate: 60,
        dynamic: 'force-dynamic' as const,
      },
      clientBundles: [
        {
          filePath: 'app/components/ProductChart.tsx',
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

  // Route 2: Products
  const productsRoute = {
    route: '/products',
    pageCode: `// app/products/page.tsx
// Product Listing Page

import { ProductChart } from '../../components/ProductChart';
import { ProductGrid } from './ProductGrid';
import { FilterBar } from './FilterBar';

async function getProducts() {
  const products = await fetch('https://api.example.com/products');
  return products.json();
}

async function getCategories() {
  const categories = await fetch('https://api.example.com/categories');
  return categories.json();
}

export default async function Products() {
  // ❌ Sequential awaits (waterfall)
  const products = await getProducts();
  const categories = await getCategories();
  
  // ✅ No duplicate chart-lib in this route (only ProductChart uses it)
  // ❌ Still missing Suspense boundary
  return (
    <div>
      <h1>Products</h1>
      <FilterBar categories={categories} />
      <ProductChart data={products} />
      <ProductGrid products={products} />
    </div>
  );
}`,
    components: [
      // ProductChart is shared - analyzed only once
      {
        fileName: 'ProductGrid.tsx',
        filePath: 'app/products/ProductGrid.tsx',
        code: `'use client';
import { format } from 'date-fns'; // ⚠️ Duplicate with ProductChart in this route

interface Product {
  id: string;
  name: string;
  price: number;
  updatedAt: Date;
}

export function ProductGrid({ products }: { products: Product[] }) {
  return (
    <div className="grid">
      {products.map((p) => (
        <div key={p.id}>
          <h3>{p.name}</h3>
          <p>$\{p.price}</p>
          <small>Updated: {format(p.updatedAt, 'PPP')}</small>
        </div>
      ))}
    </div>
  );
}`,
      },
      {
        fileName: 'FilterBar.tsx',
        filePath: 'app/products/FilterBar.tsx',
        code: `'use client';
import { useState } from 'react';

export function FilterBar({ categories }: { categories: string[] }) {
  const [selected, setSelected] = useState<string>('all');
  
  return (
    <div>
      {categories.map((cat) => (
        <button 
          key={cat} 
          onClick={() => setSelected(cat)}
          className={selected === cat ? 'active' : ''}
        >
          {cat}
        </button>
      ))}
    </div>
  );
}`,
      },
    ],
    context: {
      clientComponentPaths: ['../../components/ProductChart', './ProductGrid', './FilterBar'],
      clientBundles: [
        {
          filePath: 'app/components/ProductChart.tsx',
          chunks: ['chart-lib', 'date-fns'],
          totalBytes: 145000,
        },
        {
          filePath: 'app/products/ProductGrid.tsx',
          chunks: ['date-fns'],
          totalBytes: 25000,
        },
        {
          filePath: 'app/products/FilterBar.tsx',
          chunks: [],
          totalBytes: 8000,
        },
      ],
      reactVersion: '18.3.1',
    },
  };

  // Analyze route 1: Dashboard
  console.log('\n📊 Analyzing Route 1: /dashboard');
  const dashPageResult = await analyze({
    code: dashboardRoute.pageCode,
    fileName: 'app/dashboard/page.tsx',
    context: dashboardRoute.context,
  });
  console.log(`  Page diagnostics: ${dashPageResult.diagnostics.length}`);

  const dashCompResults = await Promise.all(
    dashboardRoute.components.map(async (comp) => {
      const result = await analyze({
        code: comp.code,
        fileName: comp.filePath,
        context: dashboardRoute.context,
      });
      console.log(`  ${comp.fileName} diagnostics: ${result.diagnostics.length}`);
      return { ...comp, diagnostics: result.diagnostics };
    })
  );

  // Analyze route 2: Products
  console.log('\n📊 Analyzing Route 2: /products');
  const prodPageResult = await analyze({
    code: productsRoute.pageCode,
    fileName: 'app/products/page.tsx',
    context: productsRoute.context,
  });
  console.log(`  Page diagnostics: ${prodPageResult.diagnostics.length}`);

  const prodCompResults = await Promise.all(
    productsRoute.components.map(async (comp) => {
      const result = await analyze({
        code: comp.code,
        fileName: comp.filePath,
        context: productsRoute.context,
      });
      console.log(`  ${comp.fileName} diagnostics: ${result.diagnostics.length}`);
      return { ...comp, diagnostics: result.diagnostics };
    })
  );

  // Build Model object with 2 routes
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
      {
        route: '/products',
        rootNodeId: 'route-products',
        chunks: ['main', 'products'],
        totalBytes: 178000,
      },
    ],
    nodes: {
      // Route 1: Dashboard
      'route-dashboard': {
        id: 'route-dashboard',
        kind: 'route',
        file: 'app/dashboard/page.tsx',
        name: 'Dashboard',
        bytes: 2048,
        children: ['comp-product-chart-dash', 'comp-sales-metrics', 'comp-user-activity'],
        diagnostics: dashPageResult.diagnostics
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
      'comp-product-chart-dash': {
        id: 'comp-product-chart-dash',
        kind: 'client',
        file: 'app/components/ProductChart.tsx',
        name: 'ProductChart',
        bytes: 145000,
        diagnostics: dashCompResults[0]?.diagnostics
          .filter((d) => d.level !== 'info')
          .map((d) => ({
            rule: d.rule,
            level: d.level as 'error' | 'warn',
            message: d.message,
            loc: d.loc
              ? {
                  file: 'app/components/ProductChart.tsx',
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
        diagnostics: dashCompResults[1]?.diagnostics
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
        diagnostics: dashCompResults[2]?.diagnostics
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
      // Route 2: Products
      'route-products': {
        id: 'route-products',
        kind: 'route',
        file: 'app/products/page.tsx',
        name: 'Products',
        bytes: 1800,
        children: ['comp-product-chart-prod', 'comp-product-grid', 'comp-filter-bar'],
        diagnostics: prodPageResult.diagnostics
          .filter((d) => d.level !== 'info')
          .map((d) => ({
            rule: d.rule,
            level: d.level as 'error' | 'warn',
            message: d.message,
            loc: d.loc
              ? {
                  file: 'app/products/page.tsx',
                  range: d.loc.range,
                }
              : undefined,
          })),
      },
      'comp-product-chart-prod': {
        id: 'comp-product-chart-prod',
        kind: 'client',
        file: 'app/components/ProductChart.tsx',
        name: 'ProductChart',
        bytes: 145000,
        // Note: ProductChart diagnostics already collected in dashboard route
        // For now, include them here too (in real analysis, would be deduplicated)
        diagnostics: dashCompResults[0]?.diagnostics
          .filter((d) => d.level !== 'info')
          .map((d) => ({
            rule: d.rule,
            level: d.level as 'error' | 'warn',
            message: d.message,
            loc: d.loc
              ? {
                  file: 'app/components/ProductChart.tsx',
                  range: d.loc.range,
                }
              : undefined,
          })),
      },
      'comp-product-grid': {
        id: 'comp-product-grid',
        kind: 'client',
        file: 'app/products/ProductGrid.tsx',
        name: 'ProductGrid',
        bytes: 25000,
        diagnostics: prodCompResults[0]?.diagnostics
          .filter((d) => d.level !== 'info')
          .map((d) => ({
            rule: d.rule,
            level: d.level as 'error' | 'warn',
            message: d.message,
            loc: d.loc
              ? {
                  file: 'app/products/ProductGrid.tsx',
                  range: d.loc.range,
                }
              : undefined,
          })),
      },
      'comp-filter-bar': {
        id: 'comp-filter-bar',
        kind: 'client',
        file: 'app/products/FilterBar.tsx',
        name: 'FilterBar',
        bytes: 8000,
        diagnostics: prodCompResults[1]?.diagnostics
          .filter((d) => d.level !== 'info')
          .map((d) => ({
            rule: d.rule,
            level: d.level as 'error' | 'warn',
            message: d.message,
            loc: d.loc
              ? {
                  file: 'app/products/FilterBar.tsx',
                  range: d.loc.range,
                }
              : undefined,
          })),
      },
    },
    suggestions: [
      ...dashPageResult.diagnostics.filter((d): d is Suggestion => d.level === 'info'),
      ...dashCompResults.flatMap((r) =>
        r.diagnostics.filter((d): d is Suggestion => d.level === 'info')
      ),
      ...prodPageResult.diagnostics.filter((d): d is Suggestion => d.level === 'info'),
      ...prodCompResults.flatMap((r) =>
        r.diagnostics.filter((d): d is Suggestion => d.level === 'info')
      ),
    ],
  };

  // Generate HTML report
  const html = renderHtmlReport(model);

  // Ensure reports directory exists
  const reportsDir = join(process.cwd(), 'public', 'reports');
  mkdirSync(reportsDir, { recursive: true });

  // Write report
  const reportPath = join(reportsDir, 'real-world.html');
  writeFileSync(reportPath, html, 'utf-8');

  const totalDiagnostics = Object.values(model.nodes).reduce(
    (sum, node) => sum + (node.diagnostics?.length || 0),
    0
  );
  console.log(`\n✅ Multi-route report generated: ${reportPath}`);
  console.log(`   Routes: ${model.routes.length}`);
  console.log(`   Components: ${Object.keys(model.nodes).length}`);
  console.log(`   Diagnostics: ${totalDiagnostics} issues across all routes`);
}

generateReport();
