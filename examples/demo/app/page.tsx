import { DemoApp } from './components/DemoApp';

/**
 * Home page - Interactive RSC X-Ray Demo
 *
 * Features:
 * - Split-panel tutorial interface
 * - Real-time LSP analysis with CodeMirror
 * - Categorized scenarios (Fundamentals, Performance, Pro)
 * - Pro feature teasers and upgrade CTAs
 */
export default async function HomePage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[]>>;
}) {
  const resolvedParams = searchParams ? await searchParams : undefined;

  const scenarioParam = resolvedParams?.scenario;
  const initialScenarioId = Array.isArray(scenarioParam) ? scenarioParam[0] : scenarioParam;

  const lineParam = resolvedParams?.line;
  const initialLineStr = Array.isArray(lineParam) ? lineParam[0] : lineParam;
  const parsedLine = initialLineStr ? Number.parseInt(initialLineStr, 10) : null;
  const initialLine = Number.isFinite(parsedLine) && parsedLine! > 0 ? parsedLine : null;

  return <DemoApp initialScenarioId={initialScenarioId ?? null} initialLine={initialLine} />;
}
