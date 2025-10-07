'use client';

import { useState } from 'react';
import type { Diagnostic, Suggestion } from '@rsc-xray/schemas';
import { scenarios, getScenario } from '../lib/scenarios';
import { useDeepLink, useSyncUrlOnScenarioChange } from '../lib/useDeepLink';
import { Header } from './Header';
import { SplitPanel } from './SplitPanel';
import { ExplanationPanel } from './ExplanationPanel';
import { StatusBar } from './StatusBar';
import { ProModal, type ProFeature } from './ProPreview';
import { MultiFileCodeViewer, type CodeFile } from './MultiFileCodeViewer';
import { ReportViewer } from './ReportViewer';
import styles from './DemoApp.module.css';

function extractRouteSegmentFromCode(code: string): string | null {
  const match = code.match(/\/\/\s*app\/([A-Za-z0-9/_-]+)\/page\.tsx/);
  return match ? match[1] : null;
}

function formatRouteDisplayName(segment: string | null, fallback: string): string {
  if (!segment) return fallback;
  const normalized = segment.replace(/\/$/, '');
  const leaf = normalized.split('/').pop() ?? normalized;
  return `${leaf}.tsx`;
}

/**
 * Main demo application with state management
 *
 * Manages:
 * - Selected scenario (with deep linking support)
 * - Analysis status (idle/analyzing/error)
 * - Diagnostics from LSP analysis
 * - Code editor state and real-time analysis
 * - Pro feature modal state
 *
 * Deep linking:
 * - ?scenario=<id> - Load specific scenario
 * - ?line=<number> - Highlight specific line in editor
 */
interface DemoAppProps {
  initialScenarioId?: string | null;
  initialLine?: number | null;
}

export function DemoApp({ initialScenarioId = null, initialLine = null }: DemoAppProps) {
  const { initialParams } = useDeepLink();
  const initialLineFromParams = initialLine ?? initialParams.line;
  void initialLineFromParams;

  // Initialize scenario from URL param or default to first scenario
  const getInitialScenario = (): string => {
    if (initialScenarioId) {
      const scenario = getScenario(initialScenarioId);
      if (scenario) return scenario.id;
    }

    if (initialParams.scenario) {
      const scenario = getScenario(initialParams.scenario);
      if (scenario) return scenario.id;
    }
    return scenarios[0].id;
  };

  const [selectedScenarioId, setSelectedScenarioId] = useState(getInitialScenario());
  const [analysisStatus, setAnalysisStatus] = useState<'idle' | 'analyzing' | 'error'>('idle');
  const [diagnostics, setDiagnostics] = useState<Array<Diagnostic | Suggestion>>([]);
  const [analysisDuration, setAnalysisDuration] = useState<number | undefined>(undefined);
  const [proModalState, setProModalState] = useState<{
    isOpen: boolean;
    feature: ProFeature | null;
  }>({
    isOpen: false,
    feature: null,
  });
  const [showReport, setShowReport] = useState(false);

  // Sync URL with scenario changes
  useSyncUrlOnScenarioChange(selectedScenarioId);

  const scenario = getScenario(selectedScenarioId) || scenarios[0];

  const handleSelectScenario = (scenarioId: string): void => {
    setSelectedScenarioId(scenarioId);
    setAnalysisStatus('idle');
    setDiagnostics([]);
    setAnalysisDuration(undefined);
  };

  const mainRouteSegment = extractRouteSegmentFromCode(scenario.code);
  const mainFileBaseName = scenario.fileName || 'demo.tsx';
  const mainFileName = mainRouteSegment
    ? `${mainRouteSegment}/${mainFileBaseName}`
    : mainFileBaseName;
  const mainDisplayName = formatRouteDisplayName(mainRouteSegment, mainFileBaseName);

  const componentMap = new Map<string, CodeFile>();

  const registerComponent = (file: { fileName: string; code: string; description?: string }) => {
    if (componentMap.has(file.fileName)) {
      return;
    }

    componentMap.set(file.fileName, {
      fileName: file.fileName,
      displayName: file.fileName,
      code: file.code,
      description: file.description,
      editable: false,
    });
  };

  (scenario.contextFiles || []).forEach(registerComponent);

  const additionalRouteFiles: CodeFile[] = (scenario.additionalRoutes || []).map((route) => {
    const routeSegment = route.route.replace(/^\//, '').replace(/\/$/, '');
    const fileName = routeSegment ? `${routeSegment}/${route.fileName}` : route.fileName;
    const displayName = formatRouteDisplayName(routeSegment || null, route.fileName);

    (route.contextFiles || []).forEach(registerComponent);

    return {
      fileName,
      displayName,
      code: route.code,
      description: `Route ${route.route}`,
      editable: false,
    } satisfies CodeFile;
  });

  const componentFiles: CodeFile[] = Array.from(componentMap.values());

  // Prepare files for MultiFileCodeViewer
  const allFiles: CodeFile[] = [
    {
      fileName: mainFileName,
      displayName: mainDisplayName,
      code: scenario.code,
      description: scenario.description,
      editable: true, // Main file is editable
    },
    ...additionalRouteFiles,
    ...componentFiles,
  ];

  const handleOpenProModal = (feature: ProFeature): void => {
    setProModalState({ isOpen: true, feature });
  };

  const handleCloseProModal = (): void => {
    setProModalState({ isOpen: false, feature: null });
  };

  return (
    <div className={styles.app}>
      <Header showUpgradeCTA={true} />

      <main className={styles.main}>
        <SplitPanel
          leftPanel={
            <ExplanationPanel
              scenario={scenario}
              diagnosticsCount={diagnostics.length}
              onSelectScenario={handleSelectScenario}
              onOpenProModal={handleOpenProModal}
              onShowReport={() => setShowReport(true)}
            />
          }
          rightPanel={
            <MultiFileCodeViewer
              key={selectedScenarioId} // Force remount on scenario change
              files={allFiles}
              initialFile={allFiles[0]?.fileName}
              scenario={scenario} // Pass scenario for analysis context
              onAnalysisComplete={(diags, duration) => {
                setDiagnostics(diags);
                setAnalysisDuration(duration);
                setAnalysisStatus('idle');
              }}
              onAnalysisStart={() => setAnalysisStatus('analyzing')}
            />
          }
        />
      </main>

      <StatusBar
        status={analysisStatus}
        diagnosticsCount={diagnostics.length}
        duration={analysisDuration}
      />

      {proModalState.feature && (
        <ProModal
          feature={proModalState.feature}
          isOpen={proModalState.isOpen}
          onClose={handleCloseProModal}
        />
      )}

      {showReport && (
        <ReportViewer scenarioTitle={scenario.title} onClose={() => setShowReport(false)} />
      )}
    </div>
  );
}
