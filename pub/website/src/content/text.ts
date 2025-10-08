export type TextId =
  | 'tag'
  | 'h1_l1'
  | 'h1_accent'
  | 'h1_l2'
  | 'sub'
  | 'cta_demo'
  | 'cta_copy'
  | 'cli_label'
  | 'chip_next'
  | 'chip_local'
  | 'chip_notel'
  | 'cli_command';

export const TEXTS: Record<TextId, string> = {
  tag: 'Free Analyzer · Pro Overlay',
  h1_l1: 'See your React Server',
  h1_accent: 'Components',
  h1_l2: 'Fix waterfalls. Ship faster.',
  sub: 'The free analyzer generates model.json and a shareable HTML report. Pro unlocks the live overlay with hydration timings, cache lens, a Flight timeline, and CI budgets.',
  cta_demo: 'Try the live demo',
  cta_copy: 'Copy install command',
  cli_label: 'CLI install',
  chip_next: 'Works with Next.js App Router 13.4–15.x',
  chip_local: 'Local analysis by default',
  chip_notel: 'No telemetry without consent',
  cli_command:
    'npm i -D @rsc-xray/cli && npx @rsc-xray/cli analyze --project . --out model.json && npx @rsc-xray/cli report --model model.json --out report.html',
};

export function t(id: TextId): string {
  return TEXTS[id];
}
