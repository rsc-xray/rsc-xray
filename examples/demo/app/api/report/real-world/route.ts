import { NextResponse } from 'next/server';
import { analyze } from '@rsc-xray/lsp-server';
import { getScenario } from '../../../lib/scenarios';

/**
 * Generate HTML report for real-world scenario
 *
 * This endpoint:
 * 1. Analyzes all files in the real-world scenario
 * 2. Generates a simplified HTML report
 * 3. Returns it as HTML for iframe embedding
 *
 * For a production app, this would use @rsc-xray/report-html
 * to generate a full offline report. For the demo, we keep it simple.
 */
export async function GET() {
  const scenario = getScenario('real-world-app');
  if (!scenario) {
    return NextResponse.json({ error: 'Scenario not found' }, { status: 404 });
  }

  try {
    // Analyze main file
    const mainFileResult = await analyze({
      code: scenario.code,
      fileName: 'app/dashboard/page.tsx',
      context: scenario.context,
    });

    // Analyze context files
    const contextResults = await Promise.all(
      (scenario.contextFiles || []).map(async (file) => ({
        fileName: file.fileName,
        diagnostics: (
          await analyze({
            code: file.code,
            fileName: `app/dashboard/${file.fileName}`,
            context: scenario.context,
          })
        ).diagnostics,
      }))
    );

    // Group diagnostics by level
    const allDiagnostics = [
      ...mainFileResult.diagnostics.map((d) => ({ ...d, file: 'page.tsx' })),
      ...contextResults.flatMap((r) => r.diagnostics.map((d) => ({ ...d, file: r.fileName }))),
    ];

    const errors = allDiagnostics.filter((d) => d.level === 'error');
    const warnings = allDiagnostics.filter((d) => d.level === 'warn');
    const infos = allDiagnostics.filter((d) => d.level === 'info');

    // Generate simplified HTML report
    const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>RSC X-Ray Report - ${scenario.title}</title>
  <style>
    :root {
      --color-bg: #ffffff;
      --color-text: #1a1a1a;
      --color-border: #e5e5e5;
      --color-error: #dc2626;
      --color-warn: #ea580c;
      --color-info: #0284c7;
      --color-success: #16a34a;
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --color-bg: #1a1a1a;
        --color-text: #e5e5e5;
        --color-border: #333;
        --color-error: #f87171;
        --color-warn: #fb923c;
        --color-info: #38bdf8;
        --color-success: #4ade80;
      }
    }
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: var(--color-bg);
      color: var(--color-text);
      padding: 2rem;
      line-height: 1.6;
    }
    .header {
      margin-bottom: 2rem;
      padding-bottom: 1rem;
      border-bottom: 2px solid var(--color-border);
    }
    h1 {
      font-size: 2rem;
      margin-bottom: 0.5rem;
    }
    .summary {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 1rem;
      margin-bottom: 2rem;
    }
    .card {
      background: var(--color-bg);
      border: 1px solid var(--color-border);
      border-radius: 8px;
      padding: 1.5rem;
    }
    .card-title {
      font-size: 0.875rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--color-text);
      opacity: 0.7;
      margin-bottom: 0.5rem;
    }
    .card-value {
      font-size: 2.5rem;
      font-weight: 700;
    }
    .error { color: var(--color-error); }
    .warn { color: var(--color-warn); }
    .info { color: var(--color-info); }
    .success { color: var(--color-success); }
    .diagnostics {
      margin-top: 2rem;
    }
    .diagnostic {
      background: var(--color-bg);
      border: 1px solid var(--color-border);
      border-left: 4px solid;
      border-radius: 4px;
      padding: 1rem;
      margin-bottom: 1rem;
    }
    .diagnostic.error { border-left-color: var(--color-error); }
    .diagnostic.warn { border-left-color: var(--color-warn); }
    .diagnostic.info { border-left-color: var(--color-info); }
    .diagnostic-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 0.5rem;
    }
    .diagnostic-title {
      font-weight: 600;
      font-size: 1rem;
    }
    .diagnostic-location {
      font-size: 0.875rem;
      opacity: 0.7;
      font-family: 'Monaco', 'Menlo', monospace;
    }
    .diagnostic-message {
      margin-top: 0.5rem;
      font-size: 0.9375rem;
    }
    .badge {
      display: inline-block;
      padding: 0.25rem 0.5rem;
      border-radius: 4px;
      font-size: 0.75rem;
      font-weight: 600;
      text-transform: uppercase;
      margin-right: 0.5rem;
    }
    .badge.error { background: var(--color-error); color: white; }
    .badge.warn { background: var(--color-warn); color: white; }
    .badge.info { background: var(--color-info); color: white; }
  </style>
</head>
<body>
  <div class="header">
    <h1>🔍 RSC X-Ray Analysis Report</h1>
    <p style="opacity: 0.7">${scenario.title}</p>
  </div>

  <div class="summary">
    <div class="card">
      <div class="card-title">Errors</div>
      <div class="card-value error">${errors.length}</div>
    </div>
    <div class="card">
      <div class="card-title">Warnings</div>
      <div class="card-value warn">${warnings.length}</div>
    </div>
    <div class="card">
      <div class="card-title">Info</div>
      <div class="card-value info">${infos.length}</div>
    </div>
    <div class="card">
      <div class="card-title">Files Analyzed</div>
      <div class="card-value">${1 + (scenario.contextFiles?.length || 0)}</div>
    </div>
  </div>

  <div class="diagnostics">
    <h2 style="margin-bottom: 1rem;">Diagnostics</h2>
    ${allDiagnostics
      .map(
        (d) => `
      <div class="diagnostic ${d.level}">
        <div class="diagnostic-header">
          <div>
            <span class="badge ${d.level}">${d.level}</span>
            <span class="diagnostic-title">${d.rule}</span>
          </div>
          <span class="diagnostic-location">${d.file}</span>
        </div>
        <div class="diagnostic-message">${d.message}</div>
      </div>
    `
      )
      .join('')}
  </div>

  <div style="margin-top: 3rem; padding-top: 2rem; border-top: 1px solid var(--color-border); opacity: 0.7;">
    <p style="font-size: 0.875rem;">
      💡 This is a simplified report for demo purposes. 
      A full RSC X-Ray report includes component trees, bundle analysis, 
      and actionable refactoring suggestions.
    </p>
    <p style="font-size: 0.875rem; margin-top: 0.5rem;">
      Learn more at <a href="https://rsc-xray.dev" style="color: var(--color-info);">rsc-xray.dev</a>
    </p>
  </div>
</body>
</html>`;

    return new NextResponse(html, {
      headers: {
        'Content-Type': 'text/html',
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    console.error('Report generation error:', error);
    return NextResponse.json(
      { error: 'Failed to generate report', details: String(error) },
      { status: 500 }
    );
  }
}
