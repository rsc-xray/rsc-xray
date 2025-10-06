import { NextResponse } from 'next/server';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Serve pre-generated HTML report for real-world scenario
 *
 * The report is generated at build time by scripts/generate-real-world-report.ts
 * and saved to public/reports/real-world.html
 *
 * This endpoint simply serves the static HTML file.
 */
export async function GET() {
  try {
    const reportPath = join(process.cwd(), 'public/reports/real-world.html');
    const html = readFileSync(reportPath, 'utf-8');

    return new NextResponse(html, {
      headers: {
        'Content-Type': 'text/html',
        'Cache-Control': 'public, max-age=3600, immutable',
      },
    });
  } catch (error) {
    console.error('Failed to read report:', error);
    return NextResponse.json(
      {
        error: 'Report not found',
        details: 'The report may not have been generated yet. Run `pnpm build` first.',
      },
      { status: 404 }
    );
  }
}
