import { describe, it, expect } from 'vitest';

import type { ClientComponentBundle } from '../../lib/clientBundles';
import { detectClientSizeIssues } from '../clientSizeThreshold';

function createBundle(
  filePath: string,
  totalBytes: number,
  chunks: string[] = []
): ClientComponentBundle {
  return { filePath, totalBytes, chunks };
}

describe('Client Size Threshold Analyzer', () => {
  describe('oversized components', () => {
    it('detects components exceeding default threshold (50KB)', () => {
      const bundles: ClientComponentBundle[] = [
        createBundle('app/components/LargeComponent.tsx', 102400), // 100KB
      ];

      const diagnostics = detectClientSizeIssues(bundles);

      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0]?.rule).toBe('client-component-oversized');
      expect(diagnostics[0]?.level).toBe('warn');
      expect(diagnostics[0]?.message).toContain('100.0KB');
      expect(diagnostics[0]?.message).toContain('100% over');
      expect(diagnostics[0]?.loc?.file).toBe('app/components/LargeComponent.tsx');
    });

    it('passes components under threshold', () => {
      const bundles: ClientComponentBundle[] = [
        createBundle('app/components/SmallComponent.tsx', 25600), // 25KB
      ];

      const diagnostics = detectClientSizeIssues(bundles);

      const oversized = diagnostics.filter((d) => d.rule === 'client-component-oversized');
      expect(oversized).toHaveLength(0);
    });

    it('handles components exactly at threshold', () => {
      const bundles: ClientComponentBundle[] = [
        createBundle('app/components/ExactComponent.tsx', 51200), // Exactly 50KB
      ];

      const diagnostics = detectClientSizeIssues(bundles);

      const oversized = diagnostics.filter((d) => d.rule === 'client-component-oversized');
      expect(oversized).toHaveLength(0);
    });

    it('respects custom threshold configuration', () => {
      const bundles: ClientComponentBundle[] = [
        createBundle('app/components/Component.tsx', 76800), // 75KB
      ];

      const diagnostics = detectClientSizeIssues(bundles, { thresholdBytes: 102400 }); // 100KB threshold

      const oversized = diagnostics.filter((d) => d.rule === 'client-component-oversized');
      expect(oversized).toHaveLength(0);
    });

    it('detects multiple oversized components', () => {
      const bundles: ClientComponentBundle[] = [
        createBundle('app/components/Large1.tsx', 102400), // 100KB
        createBundle('app/components/Small.tsx', 10240), // 10KB
        createBundle('app/components/Large2.tsx', 153600), // 150KB
      ];

      const diagnostics = detectClientSizeIssues(bundles);

      const oversized = diagnostics.filter((d) => d.rule === 'client-component-oversized');
      expect(oversized).toHaveLength(2);
      expect(oversized.map((d) => d.loc?.file)).toContain('app/components/Large1.tsx');
      expect(oversized.map((d) => d.loc?.file)).toContain('app/components/Large2.tsx');
    });

    it('provides actionable suggestions in message', () => {
      const bundles: ClientComponentBundle[] = [
        createBundle('app/components/HugeComponent.tsx', 204800), // 200KB
      ];

      const diagnostics = detectClientSizeIssues(bundles);

      expect(diagnostics[0]?.message).toContain('code splitting');
      expect(diagnostics[0]?.message).toContain('lazy loading');
    });
  });

  describe('duplicate dependencies', () => {
    it('detects chunks shared across multiple components', () => {
      const bundles: ClientComponentBundle[] = [
        createBundle('app/components/Component1.tsx', 10240, [
          'static/chunks/shared1.js',
          'static/chunks/shared2.js',
          'static/chunks/shared3.js',
          'static/chunks/unique1.js',
        ]),
        createBundle('app/components/Component2.tsx', 10240, [
          'static/chunks/shared1.js',
          'static/chunks/shared2.js',
          'static/chunks/shared3.js',
          'static/chunks/unique2.js',
        ]),
      ];

      const diagnostics = detectClientSizeIssues(bundles);

      const duplicates = diagnostics.filter((d) => d.rule === 'duplicate-dependencies');
      expect(duplicates.length).toBeGreaterThan(0);
      // Message format changed: now lists chunk names
      expect(duplicates[0]?.message).toContain('shared1.js');
      expect(duplicates[0]?.message).toContain('shared2.js');
      expect(duplicates[0]?.message).toContain('shared3.js');
    });

    it('detects components sharing any chunks (lowered threshold)', () => {
      const bundles: ClientComponentBundle[] = [
        createBundle('app/components/Component1.tsx', 10240, [
          'static/chunks/shared1.js',
          'static/chunks/shared2.js',
        ]),
        createBundle('app/components/Component2.tsx', 10240, [
          'static/chunks/shared1.js',
          'static/chunks/shared2.js',
        ]),
      ];

      const diagnostics = detectClientSizeIssues(bundles);

      const duplicates = diagnostics.filter((d) => d.rule === 'duplicate-dependencies');
      // Should detect duplicates even with 2 shared chunks (lowered from 3 to 1)
      expect(duplicates.length).toBe(2); // One per component
      expect(duplicates[0]?.message).toContain('static/chunks/shared1.js');
      expect(duplicates[0]?.message).toContain('static/chunks/shared2.js');
    });

    it('handles no shared chunks', () => {
      const bundles: ClientComponentBundle[] = [
        createBundle('app/components/Component1.tsx', 10240, ['static/chunks/unique1.js']),
        createBundle('app/components/Component2.tsx', 10240, ['static/chunks/unique2.js']),
      ];

      const diagnostics = detectClientSizeIssues(bundles);

      const duplicates = diagnostics.filter((d) => d.rule === 'duplicate-dependencies');
      expect(duplicates).toHaveLength(0);
    });

    it('provides actionable suggestions for duplicate dependencies', () => {
      const bundles: ClientComponentBundle[] = [
        createBundle('app/components/Component1.tsx', 10240, [
          'static/chunks/shared1.js',
          'static/chunks/shared2.js',
          'static/chunks/shared3.js',
        ]),
        createBundle('app/components/Component2.tsx', 10240, [
          'static/chunks/shared1.js',
          'static/chunks/shared2.js',
          'static/chunks/shared3.js',
        ]),
      ];

      const diagnostics = detectClientSizeIssues(bundles);

      const duplicates = diagnostics.filter((d) => d.rule === 'duplicate-dependencies');
      expect(duplicates[0]?.message).toContain('common module');
      expect(duplicates[0]?.message).toContain('dynamic imports');
    });

    it('handles multiple component groups with different shared chunks', () => {
      const bundles: ClientComponentBundle[] = [
        // Group 1: Component1 & Component2 share chunks A, B, C
        createBundle('app/components/Component1.tsx', 10240, [
          'static/chunks/A.js',
          'static/chunks/B.js',
          'static/chunks/C.js',
        ]),
        createBundle('app/components/Component2.tsx', 10240, [
          'static/chunks/A.js',
          'static/chunks/B.js',
          'static/chunks/C.js',
        ]),
        // Group 2: Component3 & Component4 share chunks X, Y, Z
        createBundle('app/components/Component3.tsx', 10240, [
          'static/chunks/X.js',
          'static/chunks/Y.js',
          'static/chunks/Z.js',
        ]),
        createBundle('app/components/Component4.tsx', 10240, [
          'static/chunks/X.js',
          'static/chunks/Y.js',
          'static/chunks/Z.js',
        ]),
      ];

      const diagnostics = detectClientSizeIssues(bundles);

      const duplicates = diagnostics.filter((d) => d.rule === 'duplicate-dependencies');
      // Each component in each group should get a diagnostic
      expect(duplicates.length).toBe(4);
    });
  });

  describe('combined scenarios', () => {
    it('detects both oversized and duplicate dependencies', () => {
      const bundles: ClientComponentBundle[] = [
        createBundle('app/components/Large1.tsx', 102400, [
          // 100KB + duplicates
          'static/chunks/shared1.js',
          'static/chunks/shared2.js',
          'static/chunks/shared3.js',
        ]),
        createBundle('app/components/Large2.tsx', 102400, [
          // 100KB + duplicates
          'static/chunks/shared1.js',
          'static/chunks/shared2.js',
          'static/chunks/shared3.js',
        ]),
      ];

      const diagnostics = detectClientSizeIssues(bundles);

      const oversized = diagnostics.filter((d) => d.rule === 'client-component-oversized');
      const duplicates = diagnostics.filter((d) => d.rule === 'duplicate-dependencies');

      expect(oversized).toHaveLength(2);
      expect(duplicates).toHaveLength(2);
    });

    it('handles real-world complex scenario', () => {
      const bundles: ClientComponentBundle[] = [
        createBundle('app/components/Dashboard.tsx', 204800, [
          // 200KB
          'static/chunks/framework.js',
          'static/chunks/charts.js',
          'static/chunks/tables.js',
          'static/chunks/dashboard.js',
        ]),
        createBundle('app/components/Analytics.tsx', 153600, [
          // 150KB
          'static/chunks/framework.js',
          'static/chunks/charts.js',
          'static/chunks/tables.js',
          'static/chunks/analytics.js',
        ]),
        createBundle('app/components/SmallWidget.tsx', 10240, [
          // 10KB
          'static/chunks/widget.js',
        ]),
      ];

      const diagnostics = detectClientSizeIssues(bundles);

      // Dashboard and Analytics are oversized
      const oversized = diagnostics.filter((d) => d.rule === 'client-component-oversized');
      expect(oversized).toHaveLength(2);

      // Dashboard and Analytics share 3 chunks (framework, charts, tables)
      const duplicates = diagnostics.filter((d) => d.rule === 'duplicate-dependencies');
      expect(duplicates).toHaveLength(2);
    });
  });

  describe('edge cases', () => {
    it('handles empty bundles array', () => {
      const diagnostics = detectClientSizeIssues([]);
      expect(diagnostics).toHaveLength(0);
    });

    it('handles undefined bundles', () => {
      const diagnostics = detectClientSizeIssues(undefined);
      expect(diagnostics).toHaveLength(0);
    });

    it('handles components with zero bytes', () => {
      const bundles: ClientComponentBundle[] = [createBundle('app/components/Empty.tsx', 0)];

      const diagnostics = detectClientSizeIssues(bundles);

      const oversized = diagnostics.filter((d) => d.rule === 'client-component-oversized');
      expect(oversized).toHaveLength(0);
    });

    it('handles components with no chunks', () => {
      const bundles: ClientComponentBundle[] = [
        createBundle('app/components/NoChunks.tsx', 102400, []),
      ];

      const diagnostics = detectClientSizeIssues(bundles);

      const oversized = diagnostics.filter((d) => d.rule === 'client-component-oversized');
      expect(oversized).toHaveLength(1);

      const duplicates = diagnostics.filter((d) => d.rule === 'duplicate-dependencies');
      expect(duplicates).toHaveLength(0);
    });

    it('provides accurate location information', () => {
      const bundles: ClientComponentBundle[] = [createBundle('app/components/Large.tsx', 102400)];

      const diagnostics = detectClientSizeIssues(bundles);

      expect(diagnostics[0]?.loc).toBeDefined();
      expect(diagnostics[0]?.loc?.file).toBe('app/components/Large.tsx');
      expect(diagnostics[0]?.loc?.range).toBeDefined();
      expect(diagnostics[0]?.loc?.range?.from).toBe(0);
      expect(diagnostics[0]?.loc?.range?.to).toBe(0); // No source file provided, fallback to 0,0
    });
  });

  describe('route-aware duplicate detection', () => {
    it('includes route context in duplicate dependency messages when route is provided', () => {
      const bundles: ClientComponentBundle[] = [
        createBundle('app/dashboard/ProductChart.tsx', 145000, ['chart-lib', 'date-fns']),
        createBundle('app/dashboard/SalesMetrics.tsx', 98000, ['chart-lib', 'lodash']),
        createBundle('app/dashboard/UserActivity.tsx', 87000, ['date-fns', 'lodash']),
      ];

      const diagnostics = detectClientSizeIssues(bundles, { route: '/dashboard' });

      const duplicates = diagnostics.filter((d) => d.rule === 'duplicate-dependencies');
      expect(duplicates.length).toBeGreaterThan(0);

      // Should include route in message
      expect(duplicates[0]?.message).toContain("in route '/dashboard'");

      // Should include component names
      expect(duplicates[0]?.message).toMatch(/also imported by \w+/);
    });

    it('omits route context when route is not provided', () => {
      const bundles: ClientComponentBundle[] = [
        createBundle('app/components/Component1.tsx', 10240, ['shared-chunk']),
        createBundle('app/components/Component2.tsx', 10240, ['shared-chunk']),
      ];

      const diagnostics = detectClientSizeIssues(bundles);

      const duplicates = diagnostics.filter((d) => d.rule === 'duplicate-dependencies');
      expect(duplicates.length).toBeGreaterThan(0);

      // Should NOT include route context
      expect(duplicates[0]?.message).not.toContain('in route');

      // Should start with "Duplicate dependencies:"
      expect(duplicates[0]?.message).toMatch(/^Duplicate dependencies: /);
    });

    it('extracts component names from file paths for readability', () => {
      const bundles: ClientComponentBundle[] = [
        createBundle('app/dashboard/analytics/ProductChart.tsx', 145000, ['chart-lib']),
        createBundle('app/dashboard/metrics/SalesMetrics.tsx', 98000, ['chart-lib']),
      ];

      const diagnostics = detectClientSizeIssues(bundles, { route: '/dashboard' });

      const duplicates = diagnostics.filter((d) => d.rule === 'duplicate-dependencies');
      expect(duplicates.length).toBe(2); // One per component

      // Each diagnostic should mention the OTHER component's name
      const productChartDiag = duplicates.find((d) => d.loc?.file.includes('ProductChart.tsx'));
      const salesMetricsDiag = duplicates.find((d) => d.loc?.file.includes('SalesMetrics.tsx'));

      // ProductChart's diagnostic should mention SalesMetrics
      expect(productChartDiag?.message).toContain('SalesMetrics');
      expect(productChartDiag?.message).not.toContain('app/dashboard');

      // SalesMetrics's diagnostic should mention ProductChart
      expect(salesMetricsDiag?.message).toContain('ProductChart');
      expect(salesMetricsDiag?.message).not.toContain('app/dashboard');
    });

    it('handles single chunk duplicates (realistic threshold)', () => {
      const bundles: ClientComponentBundle[] = [
        createBundle('app/components/Header.tsx', 25000, ['date-fns']),
        createBundle('app/components/Footer.tsx', 20000, ['date-fns']),
      ];

      const diagnostics = detectClientSizeIssues(bundles);

      const duplicates = diagnostics.filter((d) => d.rule === 'duplicate-dependencies');

      // Should detect even single chunk duplicates
      expect(duplicates.length).toBe(2); // One diagnostic per component
      expect(duplicates[0]?.message).toContain('date-fns');
    });

    it('shows different duplicates for different routes', () => {
      // Route 1: /dashboard - ProductChart + SalesMetrics share chart-lib
      const dashboardBundles: ClientComponentBundle[] = [
        createBundle('app/components/ProductChart.tsx', 145000, ['chart-lib', 'date-fns']),
        createBundle('app/dashboard/SalesMetrics.tsx', 98000, ['chart-lib', 'lodash']),
      ];

      // Route 2: /products - ProductChart + ProductGrid share date-fns
      const productsBundles: ClientComponentBundle[] = [
        createBundle('app/components/ProductChart.tsx', 145000, ['chart-lib', 'date-fns']),
        createBundle('app/products/ProductGrid.tsx', 25000, ['date-fns']),
      ];

      const dashboardDiagnostics = detectClientSizeIssues(dashboardBundles, {
        route: '/dashboard',
      });
      const productsDiagnostics = detectClientSizeIssues(productsBundles, { route: '/products' });

      const dashboardDuplicates = dashboardDiagnostics.filter(
        (d) => d.rule === 'duplicate-dependencies'
      );
      const productsDuplicates = productsDiagnostics.filter(
        (d) => d.rule === 'duplicate-dependencies'
      );

      // Dashboard should report chart-lib duplicate
      const dashboardChartLib = dashboardDuplicates.find((d) => d.message.includes('chart-lib'));
      expect(dashboardChartLib).toBeDefined();
      expect(dashboardChartLib?.message).toContain("in route '/dashboard'");

      // Products should report date-fns duplicate (but NOT chart-lib)
      const productsDateFns = productsDuplicates.find((d) => d.message.includes('date-fns'));
      expect(productsDateFns).toBeDefined();
      expect(productsDateFns?.message).toContain("in route '/products'");

      const productsChartLib = productsDuplicates.find((d) => d.message.includes('chart-lib'));
      expect(productsChartLib).toBeUndefined(); // chart-lib NOT duplicated in /products
    });

    it('lists all components sharing a chunk in the message', () => {
      const bundles: ClientComponentBundle[] = [
        createBundle('app/components/A.tsx', 10000, ['shared']),
        createBundle('app/components/B.tsx', 10000, ['shared']),
        createBundle('app/components/C.tsx', 10000, ['shared']),
      ];

      const diagnostics = detectClientSizeIssues(bundles, { route: '/multi' });

      const duplicates = diagnostics.filter((d) => d.rule === 'duplicate-dependencies');

      // Each component should get a diagnostic listing the other 2
      expect(duplicates.length).toBe(3);

      // Check that component A's diagnostic mentions B and C
      const diagA = duplicates.find((d) => d.loc?.file.includes('A.tsx'));
      expect(diagA?.message).toContain('B');
      expect(diagA?.message).toContain('C');
    });
  });
});
