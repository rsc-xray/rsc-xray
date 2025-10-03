/**
 * Scenario definitions for the interactive demo
 *
 * Each scenario demonstrates a specific RSC X-Ray analysis rule with:
 * - Sample code that triggers the rule
 * - Explanation of what's wrong and why
 * - How to fix it
 * - Pro features available for this scenario
 */

export interface Scenario {
  id: string;
  title: string;
  category: 'fundamentals' | 'performance' | 'pro' | 'real-world';
  isPro: boolean;
  rule: string;
  description: string;
  /** Main file name (e.g., 'page.tsx', 'demo.tsx') - used consistently across demo and reports */
  fileName?: string;
  code: string;
  explanation: {
    what: string;
    why: string;
    how: string;
  };
  proFeatures?: string[];
  /** Human-readable description of what the analyzer is checking */
  contextDescription?: string;
  /** Context to pass to LSP analyzer (for rules that need it) */
  context?: {
    clientComponentPaths?: string[];
    clientBundles?: Array<{
      filePath: string;
      chunks: string[];
      totalBytes: number;
    }>;
    routeConfig?: {
      dynamic?: 'auto' | 'force-dynamic' | 'force-static' | 'error';
      revalidate?: number | false;
      fetchCache?:
        | 'auto'
        | 'default-cache'
        | 'only-cache'
        | 'force-cache'
        | 'default-no-store'
        | 'only-no-store'
        | 'force-no-store';
      runtime?: 'nodejs' | 'edge';
      preferredRegion?: string;
    };
    reactVersion?: string;
  };
  /** Additional context files to show in tabs (read-only) */
  contextFiles?: Array<{
    fileName: string;
    code: string;
    description: string;
  }>;
  /** Whether this scenario should show a generated report instead of live diagnostics */
  showReport?: boolean;
  /** Pre-generated HTML report content (for real-world scenarios) */
  reportHtml?: string;
}

export const scenarios: Scenario[] = [
  // Fundamentals Category
  {
    id: 'serialization-boundary', // Matches LSP scenario
    title: 'Serialization Boundary Violation',
    category: 'fundamentals',
    isPro: false,
    rule: 'serialization-boundary-violation',
    description: 'Passing non-serializable props from Server to Client components',
    code: `import { ClientButton } from './ClientButton';

export default function Page() {
  const handleClick = () => console.log('clicked');
  
  return <ClientButton onClick={handleClick} />;
}`,
    explanation: {
      what: 'This code tries to pass a function from a Server Component to a Client Component',
      why: 'Server Components run on the server, Client Components run in the browser. Functions cannot be serialized and sent over the network.',
      how: 'Move the function to the Client Component, or use a serializable prop like a URL for server actions',
    },
    proFeatures: [
      'VS Code quick fix: Convert to Server Action',
      'Overlay visual boundary tree with component-level violations',
      'Automated refactoring with codemod support',
    ],
    contextDescription:
      "Analyzer knows 'ClientButton' is a Client Component, so it checks props passed to it",
    context: {
      clientComponentPaths: ['./ClientButton', 'ClientButton'],
    },
  },

  {
    id: 'client-forbidden-imports', // Matches LSP scenario (note the 's')
    title: 'Client Component with Node.js Import',
    category: 'fundamentals',
    isPro: false,
    rule: 'client-forbidden-import',
    description: 'Importing Node.js built-ins in Client Components',
    code: `'use client';
import fs from 'fs';
import path from 'path';

export function FileReader() {
  const data = fs.readFileSync('file.txt');
  return <div>{data}</div>;
}`,
    explanation: {
      what: 'This Client Component imports Node.js built-in modules (fs, path)',
      why: 'Client Components run in the browser, which does not have access to Node.js APIs like fs or path',
      how: 'Move file operations to Server Components, or fetch data from an API route',
    },
    proFeatures: [
      "VS Code diagnostics in Problems panel with 'use client' fix",
      'Overlay visual tree showing client/server boundaries',
      'Automatic refactoring to move logic to server components',
    ],
  },

  {
    id: 'suspense-boundary', // Matches LSP scenario
    title: 'Missing Suspense Boundary',
    category: 'fundamentals',
    isPro: false,
    rule: 'suspense-boundary-missing',
    description: 'Async Server Component without Suspense wrapper',
    code: `export default async function Page() {
  const data = await fetch('https://api.example.com/data');
  const json = await data.json();
  
  return <div>{json.title}</div>;
}`,
    explanation: {
      what: 'This async Server Component fetches data but is not wrapped in a Suspense boundary',
      why: 'Without Suspense, the entire page waits for data before showing anything to users',
      how: 'Wrap async components with <Suspense fallback={<Loading />}> for better UX',
    },
    proFeatures: [
      'VS Code quick fix: Wrap in Suspense with auto-import',
      'Overlay visual indicators for missing/parallel Suspense opportunities',
      'Automated codemod to add Suspense boundaries',
    ],
  },

  // Performance Category
  {
    id: 'client-size', // Matches LSP scenario
    title: 'Oversized Client Bundle',
    category: 'performance',
    isPro: false,
    rule: 'client-component-oversized',
    description: 'Client Component bundle exceeds size threshold',
    code: `'use client';
// ⚠️ WARNING: This demo uses SIMULATED bundle size (312.5KB)
// Editing imports won't change the size because it requires real build output
// In production, RSC X-Ray analyzes actual webpack/turbopack bundle sizes
import _ from 'lodash'; // 71KB!
import moment from 'moment'; // 67KB!
import * as icons from 'react-icons/all'; // 200KB+!

export function HeavyComponent() {
  const formatted = moment().format('YYYY-MM-DD');
  const sorted = _.sortBy([1, 3, 2]);
  
  return <div>{formatted} {icons.FaCheck}</div>;
}`,
    explanation: {
      what: 'This Client Component imports large libraries, creating a 300KB+ bundle',
      why: 'Large bundles slow down page load and hurt mobile users on slow connections',
      how: 'Use lightweight alternatives (date-fns instead of moment), tree-shake imports (import { sortBy } from lodash), or move heavy logic to Server Components',
    },
    proFeatures: [
      'Dashboard with bundle size trends over time',
      'VS Code quick fix: Convert to dynamic import with guidance',
      'CI budget enforcement with PR comments',
    ],
    contextDescription:
      'Analyzer simulates a 320KB bundle (exceeding the 50KB threshold). Note: Bundle size is simulated and does not update when editing imports.',
    context: {
      clientBundles: [
        {
          filePath: 'demo.tsx',
          chunks: ['chunk-1.js', 'chunk-2.js', 'chunk-3.js'],
          totalBytes: 320000, // 320 KB - exceeds threshold
        },
      ],
    },
  },

  {
    id: 'duplicate-dependencies',
    title: 'Duplicate Dependencies',
    category: 'performance',
    isPro: false,
    rule: 'duplicate-dependencies',
    description: 'Multiple client components bundling the same heavy library',
    code: `'use client';
// ⚠️ WARNING: This demo uses SIMULATED bundle data below
// Editing imports won't change diagnostics because it requires real build output
// In production, RSC X-Ray analyzes actual webpack/turbopack bundles
import { format } from 'date-fns'; // Shared with Header.tsx and Footer.tsx
import _ from 'lodash'; // Shared
import moment from 'moment'; // Shared

export function DateDisplay({ date }: { date: Date }) {
  const formatted = format(date, 'PPP');
  const sorted = _.sortBy([formatted]);
  return <div>{moment(date).fromNow()}: {sorted[0]}</div>;
}`,
    explanation: {
      what: 'This component (DateDisplay.tsx) shares 3 dependencies (date-fns, lodash, moment) with Header.tsx and Footer.tsx',
      why: 'Duplicate dependencies waste bandwidth and increase bundle size unnecessarily',
      how: 'Extract shared dependencies into a common chunk, or move to a shared utility Server Component',
    },
    proFeatures: [
      'Dashboard showing duplicate dependency analysis across all routes',
      'Overlay visual map of shared chunks across components',
      'CI trend tracking for dependency duplication over time',
    ],
    contextDescription:
      '⚠️ NOTE: This scenario uses simulated bundle data (not real-time analysis of your edits). In production, RSC X-Ray analyzes actual Next.js build output to detect shared dependencies.',
    context: {
      clientBundles: [
        {
          filePath: 'demo.tsx', // Use demo.tsx for main file
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
    contextFiles: [
      {
        fileName: 'Header.tsx',
        code: `'use client';
import { format } from 'date-fns'; // Same as DateDisplay
import _ from 'lodash'; // Same as DateDisplay
import moment from 'moment'; // Same as DateDisplay

export function Header() {
  const now = moment().format('MMM D, YYYY');
  return <header>{now}</header>;
}`,
        description: 'Header component also imports date-fns, lodash, and moment',
      },
      {
        fileName: 'Footer.tsx',
        code: `'use client';
import { sortBy } from 'lodash'; // Same as DateDisplay
import { format } from 'date-fns'; // Same as DateDisplay
import moment from 'moment'; // Same as DateDisplay

export function Footer() {
  return <footer>© {moment().year()}</footer>;
}`,
        description: 'Footer component also imports date-fns, lodash, and moment',
      },
    ],
  },

  {
    id: 'react19-cache',
    title: 'React 19 Cache Opportunity',
    category: 'performance',
    isPro: false,
    rule: 'react19-cache-opportunity',
    description: 'Deduplicate fetch calls with React 19 cache()',
    code: `export default async function Page() {
  const user = await fetch('/api/user/1');
  const userData = await user.json();
  
  const userAgain = await fetch('/api/user/1'); // Duplicate!
  const userDataAgain = await userAgain.json();
  
  return <div>{userData.name}</div>;
}`,
    explanation: {
      what: 'The same URL is fetched multiple times in this component',
      why: 'Duplicate fetches waste bandwidth and slow down rendering',
      how: 'Wrap fetch in React 19 cache() to automatically deduplicate requests',
    },
    proFeatures: [
      'VS Code quick fix: Wrap fetch in cache() with auto-import',
      'Overlay cache lens showing fetch request patterns',
      'Dashboard tracking cache hit/miss rates over time',
    ],
  },

  // Route Configuration
  {
    id: 'route-config',
    title: 'Route Config Conflict',
    category: 'performance',
    isPro: false,
    rule: 'route-segment-config-conflict',
    description: 'Conflicting route segment configuration options',
    code: `export const dynamic = 'force-dynamic';
export const revalidate = 60; // ⚠️ Conflict!

export default function Page() {
  return <div>Dynamic page</div>;
}`,
    explanation: {
      what: 'This route has conflicting configuration: force-dynamic with revalidate',
      why: 'ISR (Incremental Static Regeneration) with revalidate requires static or auto mode, not force-dynamic',
      how: "Remove 'force-dynamic' to enable ISR, or remove revalidate for fully dynamic rendering",
    },
    proFeatures: [
      'Overlay cache lens showing ISR/PPR metadata per route',
      'Dashboard with route strategy (static/dynamic/ISR) visualization',
      'CI monitoring for route config changes affecting cache behavior',
    ],
    contextDescription:
      "Analyzer checks: dynamic = 'force-dynamic' + revalidate = 60 (conflicting options)",
    context: {
      routeConfig: {
        dynamic: 'force-dynamic',
        revalidate: 60,
      },
    },
  },

  // Pro Teasers
  {
    id: 'pro-waterfall',
    title: 'Waterfall Detection (Pro)',
    category: 'pro',
    isPro: true,
    rule: 'route-waterfall-detected',
    description: 'Sequential data fetching causes performance waterfalls',
    code: `// This scenario requires Pro subscription
export default async function Page() {
  const user = await getUser();
  const posts = await getPosts(user.id);
  const comments = await getComments(posts[0].id);
  
  return <div>...</div>;
}`,
    explanation: {
      what: 'Pro feature: Detects sequential async calls that could be parallel',
      why: 'Waterfalls add latency - each await blocks the next',
      how: 'Pro suggestion: Use Promise.all() or React 19 use() for parallel fetching',
    },
    proFeatures: [
      'Waterfall visualization',
      'Automatic refactoring suggestions',
      'Performance timeline',
    ],
  },

  // Real-World Example
  {
    id: 'real-world-app',
    title: 'Real-World E-Commerce Dashboard',
    category: 'real-world',
    isPro: false,
    rule: 'multiple',
    description: 'A realistic Next.js app with multiple RSC anti-patterns and performance issues',
    fileName: 'page.tsx',
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
    explanation: {
      what: 'This real-world dashboard component contains 7 different RSC violations across multiple analyzer rules',
      why: `The violations include:
• Server/client boundary issues (serialization, forbidden imports)
• Performance problems (sequential fetches, missing Suspense)
• Configuration conflicts (route segment config)
• Bundle size issues (duplicate dependencies across components)

These patterns are common in production Next.js apps and can cause runtime errors, slow performance, and poor user experience.`,
      how: `Fix each issue systematically:
1. Remove Node.js imports (fs) or move to server-only code
2. Resolve route config conflicts (remove dynamic or revalidate)
3. Parallelize async operations with Promise.all()
4. Wrap async components in Suspense boundaries
5. Don't pass functions/Dates to client components
6. Deduplicate shared dependencies with code splitting
7. Use React 19 cache() for fetch deduplication`,
    },
    proFeatures: [
      'Interactive overlay showing boundary tree with 7 violations highlighted',
      'Performance dashboard with A-F scoring (this app: D- grade)',
      'Automated refactoring via VS Code quick fixes (2 one-click, 5 guided)',
      'CI budget enforcement to prevent regressions',
      'Trend tracking across commits to measure improvement',
    ],
    contextDescription: `Analyzing a complete dashboard route with:
• 3 client components (ProductChart, SalesMetrics, UserActivity)
• Route segment config (revalidate + dynamic)
• Async data fetching patterns
• Cross-component dependency analysis`,
    showReport: true,
    context: {
      clientComponentPaths: ['./ProductChart', './SalesMetrics', './UserActivity'],
      routeConfig: {
        revalidate: 60,
        dynamic: 'force-dynamic',
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
        description: '❌ 3 violations: forbidden import, function prop, Date prop',
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
        description: '⚠️ 1 violation: duplicate chart-lib dependency (80KB)',
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
        description:
          '⚠️ 2 violations: duplicate dependencies (date-fns, lodash), manual cache (use React 19 cache())',
      },
    ],
  },
];

/**
 * Get scenario by ID
 */
export function getScenario(id: string): Scenario | undefined {
  return scenarios.find((s) => s.id === id);
}

/**
 * Get scenarios by category
 */
export function getScenariosByCategory(category: Scenario['category']): Scenario[] {
  return scenarios.filter((s) => s.category === category);
}
