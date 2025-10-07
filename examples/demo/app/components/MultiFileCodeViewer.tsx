'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { EditorView, basicSetup } from 'codemirror';
import { javascript } from '@codemirror/lang-javascript';
import { setDiagnostics, lintGutter, type Diagnostic as CMDiagnostic } from '@codemirror/lint';
import type { Diagnostic, Suggestion } from '@rsc-xray/schemas';
import styles from './MultiFileCodeViewer.module.css';

function extractRouteSegmentFromCode(code?: string): string | null {
  if (!code) return null;
  const match = code.match(/\/\/\s*app\/([A-Za-z0-9/_-]+)\/page\.tsx/);
  return match ? match[1] : null;
}

function formatRouteLabel(segment: string | null, fallback: string): string {
  if (!segment) return fallback;
  return segment.startsWith('/') ? segment : `/${segment}`;
}

function annotateDuplicateDiagnostics(
  diagnostics: Array<Diagnostic | Suggestion>,
  routeLabel: string | null
): Array<Diagnostic | Suggestion> {
  if (!routeLabel) return diagnostics;

  return diagnostics.map((diag) => {
    if (diag.rule !== 'duplicate-dependencies') {
      return diag;
    }

    if (diag.message.includes(`Route ${routeLabel}:`)) {
      return diag;
    }

    return {
      ...diag,
      message: `Route ${routeLabel}: ${diag.message}`,
    };
  });
}

type DiagnosticsByFile = Record<string, Array<Diagnostic | Suggestion>>;

function normalizeDiagnosticsForFile(
  diags: Array<Diagnostic | Suggestion>,
  fileKey: string
): Array<Diagnostic | Suggestion> {
  return diags.map((diag) => {
    if (!diag.loc || diag.loc.file === fileKey) {
      return diag;
    }

    return {
      ...diag,
      loc: {
        ...diag.loc,
        file: fileKey,
      },
    };
  });
}

function setDiagnosticsForFile(
  store: DiagnosticsByFile,
  fileKey: string,
  diags: Array<Diagnostic | Suggestion>
): void {
  const filtered = diags.filter((diag) => {
    const locFile = diag.loc?.file;
    if (!locFile) return true;
    if (locFile === fileKey) return true;
    if (locFile.endsWith(`/${fileKey}`)) return true;
    return false;
  });

  console.log('[MultiFileCodeViewer] setDiagnosticsForFile', {
    fileKey,
    originalCount: diags.length,
    filteredCount: filtered.length,
    sample: filtered[0]?.loc?.file ?? diags[0]?.loc?.file ?? null,
  });

  store[fileKey] = normalizeDiagnosticsForFile(filtered, fileKey);
}

/**
 * A single code file with optional diagnostics
 */
export interface CodeFile {
  /** File name (displayed in tab) */
  fileName: string;
  /** Optional display name for tab labels */
  displayName?: string;
  /** File content (code) */
  code: string;
  /** Optional description shown above the editor */
  description?: string;
  /** Whether this file is editable (default: false) */
  editable?: boolean;
  /** Language for syntax highlighting (default: 'typescript') */
  language?: 'typescript' | 'javascript' | 'tsx' | 'jsx';
}

interface MultiFileCodeViewerConfig {
  /** Array of files to display in tabs */
  files: CodeFile[];
  /** Initial active file (defaults to first file) */
  initialFile?: string;
  /** Precomputed diagnostics to display (optional) */
  diagnostics?: Array<Diagnostic | Suggestion>;
  /** Enable live re-analysis when code changes (defaults to true if scenario provided) */
  enableRealTimeAnalysis?: boolean;
  /** Optional custom analyzer callback used when live analysis is enabled */
  onAnalyze?: (fileName: string, code: string) => Promise<Array<Diagnostic | Suggestion>>;
  /** Debounce interval (ms) between edits and re-analysis, defaults to 500ms */
  analysisDebounceMs?: number;
  /** Callback when active file changes */
  onFileChange?: (fileName: string) => void;
  /** Callback when editable file content changes */
  onCodeChange?: (fileName: string, code: string) => void;
  /** Scenario object for analysis context (required for analysis) */
  scenario?: {
    id: string;
    fileName?: string;
    code: string;
    context?: Record<string, unknown>;
    contextFiles?: Array<{
      fileName: string;
      code: string;
      description?: string;
    }>;
    additionalRoutes?: Array<{
      route: string;
      fileName: string;
      code: string;
      context?: Record<string, unknown>;
      contextFiles?: Array<{
        fileName: string;
        code: string;
        description?: string;
      }>;
    }>;
  };
  /** Callback when analysis completes */
  onAnalysisComplete?: (diagnostics: Array<Diagnostic | Suggestion>, duration: number) => void;
  /** Callback when analysis starts */
  onAnalysisStart?: () => void;
}

/**
 * Multi-file code viewer with tabs and optional diagnostics
 *
 * Features:
 * - Tab navigation for multiple files
 * - Syntax highlighting (TypeScript/JavaScript)
 * - Read-only or editable mode per file
 * - Diagnostic overlays (errors/warnings) from RSC X-Ray
 * - Smart package name highlighting for import diagnostics
 *
 * Usage:
 * ```tsx
 * <MultiFileCodeViewer
 *   files={[
 *     { fileName: 'App.tsx', code: '...', editable: true },
 *     { fileName: 'utils.ts', code: '...' }
 *   ]}
 *   diagnostics={diagnostics}
 *   onCodeChange={(file, code) => console.log('Changed:', file)}
 * />
 * ```
 */
export function MultiFileCodeViewer({
  files,
  initialFile,
  diagnostics,
  enableRealTimeAnalysis = false,
  onAnalyze,
  analysisDebounceMs = 500,
  onFileChange,
  onCodeChange,
  scenario,
  onAnalysisComplete,
  onAnalysisStart,
}: MultiFileCodeViewerConfig) {
  const [activeFileName, setActiveFileName] = useState<string>(
    initialFile || files[0]?.fileName || ''
  );
  const editorRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const [isReady, setIsReady] = useState(false);
  const scenarioRef = useRef(scenario);
  const logRealWorldDiagnostics = useCallback((stage: string, payload: Record<string, unknown>) => {
    const currentScenario = scenarioRef.current;
    if (currentScenario?.id !== 'real-world-app') {
      return;
    }

    console.log('[RealWorldDiagnostics]', stage, {
      scenarioId: currentScenario.id,
      ...payload,
    });
  }, []);
  const mainRouteSegment = useMemo(
    () => (scenario ? extractRouteSegmentFromCode(scenario.code) : null),
    [scenario?.id, scenario?.code]
  );
  const mainRouteLabel = useMemo(() => formatRouteLabel(mainRouteSegment, ''), [mainRouteSegment]);
  const mainRouteLabelRef = useRef(mainRouteLabel);
  useEffect(() => {
    mainRouteLabelRef.current = mainRouteLabel;
  }, [mainRouteLabel]);
  const [diagnosticsByFile, setDiagnosticsByFile] = useState<DiagnosticsByFile>({});
  const diagnosticsRef = useRef<DiagnosticsByFile>({});
  const reAnalyzeTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Keep scenario ref up to date
  useEffect(() => {
    scenarioRef.current = scenario;
  }, [scenario]);

  useEffect(() => {
    return () => {
      if (reAnalyzeTimeoutRef.current) {
        clearTimeout(reAnalyzeTimeoutRef.current);
        reAnalyzeTimeoutRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    diagnosticsRef.current = diagnosticsByFile;
  }, [diagnosticsByFile]);

  const activeFile = files.find((f) => f.fileName === activeFileName);

  const applyDiagnosticsToView = useCallback(
    (view: EditorView | null, fileName: string, diagnosticsByFile: DiagnosticsByFile) => {
      if (!view) return;
      const currentDiags = diagnosticsByFile[fileName] ?? [];
      console.log('[MultiFileCodeViewer] Rendering diagnostics', {
        fileName,
        diagnosticCount: currentDiags.length,
        availableFiles: Object.keys(diagnosticsByFile),
        diags: currentDiags.slice(0, 3).map((diag) => ({
          message: diag.message,
          rule: 'rule' in diag ? diag.rule : 'suggestion',
          loc: diag.loc,
        })),
      });
      const doc = view.state.doc;

      const cmDiagnostics = currentDiags
        .filter((diag) => {
          const range = diag.loc?.range;
          return !range || range.from !== range.to;
        })
        .map((diag) => {
          const range = diag.loc?.range;
          let from = 0;
          let to = doc.length;

          if (range) {
            from = Math.max(0, Math.min(range.from, doc.length));
            to = Math.max(from + 1, Math.min(range.to, doc.length));
          }

          const severity =
            diag.level === 'error' ? 'error' : diag.level === 'warn' ? 'warning' : 'info';

          return {
            from,
            to,
            severity,
            message: diag.message,
            source: diag.rule,
          } as CMDiagnostic;
        });

      console.log('[MultiFileCodeViewer] Converted diagnostics', {
        fileName,
        cmDiagnostics: cmDiagnostics.slice(0, 3),
      });

      view.dispatch(setDiagnostics(view.state, cmDiagnostics));
    },
    []
  );

  const applyDiagnosticsToViewRef = useRef(applyDiagnosticsToView);
  useEffect(() => {
    applyDiagnosticsToViewRef.current = applyDiagnosticsToView;
  }, [applyDiagnosticsToView]);

  const lintExtension = useMemo(() => lintGutter(), []);

  useEffect(() => {
    if (!diagnostics || diagnostics.length === 0) return;
    const mainFile = files[0];
    if (!mainFile) return;

    const annotated = annotateDuplicateDiagnostics(diagnostics, mainRouteLabelRef.current);
    setDiagnosticsByFile((prev) => {
      const next = { ...prev };
      setDiagnosticsForFile(next, mainFile.fileName, annotated);
      logRealWorldDiagnostics('prop-diagnostics-applied', {
        fileKey: mainFile.fileName,
        diagnostics: next[mainFile.fileName] ?? [],
        source: 'prop-update',
      });
      return next;
    });
  }, [diagnostics, files, logRealWorldDiagnostics]);

  // Re-analyze function (debounced)
  const triggerReAnalysis = useCallback(
    (code: string, fileName: string) => {
      if (!enableRealTimeAnalysis && !scenarioRef.current && !onAnalyze) {
        return;
      }

      if (reAnalyzeTimeoutRef.current) {
        clearTimeout(reAnalyzeTimeoutRef.current);
      }

      reAnalyzeTimeoutRef.current = setTimeout(async () => {
        if (onAnalysisStart) onAnalysisStart();

        try {
          const start = performance.now();
          let nextDiagnostics: Array<Diagnostic | Suggestion> = [];
          let duration = 0;

          if (onAnalyze) {
            nextDiagnostics = await onAnalyze(fileName, code);
          } else {
            const currentScenario = scenarioRef.current;
            if (!currentScenario) return;

            const response = await fetch('/api/analyze', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Cache-Control': 'no-cache',
              },
              body: JSON.stringify({
                code,
                fileName,
                scenario: currentScenario.id,
                context: currentScenario.context,
              }),
            });

            if (!response.ok) {
              throw new Error(`Analysis failed: ${response.statusText}`);
            }

            const result = await response.json();
            const serverDiagnostics =
              (result.diagnosticsByFile?.[fileName] as
                | Array<Diagnostic | Suggestion>
                | undefined) ??
              (result.diagnostics as Array<Diagnostic | Suggestion> | undefined) ??
              [];

            logRealWorldDiagnostics('reanalysis-server-response', {
              fileKey: fileName,
              diagnostics: serverDiagnostics,
              diagnosticsByFileKeys: Object.keys(
                (result.diagnosticsByFile as DiagnosticsByFile) ?? {}
              ),
            });

            duration = result.duration ?? Math.round(performance.now() - start);
            nextDiagnostics = serverDiagnostics;
          }

          const annotated = annotateDuplicateDiagnostics(
            nextDiagnostics,
            mainRouteLabelRef.current
          );

          setDiagnosticsByFile((prev) => {
            const next = { ...prev } as DiagnosticsByFile;
            setDiagnosticsForFile(next, fileName, annotated);
            logRealWorldDiagnostics('tab-diagnostics-updated', {
              fileKey: fileName,
              diagnostics: next[fileName] ?? [],
              source: 'reanalysis',
            });
            diagnosticsRef.current = next;
            return next;
          });

          if (onAnalysisComplete) {
            onAnalysisComplete(annotated, duration || Math.round(performance.now() - start));
          }
        } catch (error) {
          console.error('[MultiFileCodeViewer] Re-analysis error:', error);
        }
      }, analysisDebounceMs);
    },
    [
      enableRealTimeAnalysis,
      onAnalyze,
      analysisDebounceMs,
      onAnalysisStart,
      onAnalysisComplete,
      logRealWorldDiagnostics,
    ]
  );

  const triggerReAnalysisRef = useRef(triggerReAnalysis);
  useEffect(() => {
    triggerReAnalysisRef.current = triggerReAnalysis;
  }, [triggerReAnalysis]);

  // Run analysis on mount or when scenario changes
  useEffect(() => {
    diagnosticsRef.current = {};
    setDiagnosticsByFile({});

    if (!scenario) {
      return;
    }

    const currentScenario = scenario;
    const runAnalysis = async () => {
      if (onAnalysisStart) onAnalysisStart();

      try {
        const mainFile = files[0];
        if (!mainFile) {
          diagnosticsRef.current = {};
          setDiagnosticsByFile({});
          return;
        }

        const mainRouteLabelForTargets =
          mainRouteLabel && mainRouteLabel.length > 0 ? mainRouteLabel : null;
        const seenFileKeys = new Set<string>();
        const routeLabels = new Map<string, string | null>();
        const analysisTargets: Array<{
          fileKey: string;
          fileName: string;
          code: string;
          context?: Record<string, unknown>;
        }> = [];

        const pushTarget = (target: {
          fileKey: string;
          fileName: string;
          code: string;
          context?: Record<string, unknown>;
          routeLabel: string | null;
        }) => {
          if (seenFileKeys.has(target.fileKey)) {
            return;
          }

          seenFileKeys.add(target.fileKey);
          analysisTargets.push({
            fileKey: target.fileKey,
            fileName: target.fileKey,
            code: target.code,
            context: target.context,
          });
          routeLabels.set(target.fileKey, target.routeLabel);
        };

        pushTarget({
          fileKey: mainFile.fileName,
          fileName: mainFile.fileName,
          code: mainFile.code,
          context: currentScenario.context,
          routeLabel: mainRouteLabelForTargets,
        });

        const registerContextFile = (
          file: { fileName: string; code: string },
          routeLabel: string | null,
          mergedContext: Record<string, unknown> | undefined
        ) => {
          pushTarget({
            fileKey: file.fileName,
            fileName: file.fileName,
            code: file.code,
            context: mergedContext,
            routeLabel,
          });
        };

        (currentScenario.contextFiles || []).forEach((file) =>
          registerContextFile(file, mainRouteLabelForTargets, currentScenario.context)
        );

        (currentScenario.additionalRoutes || []).forEach((route) => {
          const routeSegment = route.route.replace(/^\//, '').replace(/\/$/, '');
          const routeFileKey = routeSegment ? `${routeSegment}/${route.fileName}` : route.fileName;
          const mergedContext = route.context
            ? { ...(currentScenario.context ?? {}), ...route.context }
            : currentScenario.context;
          const routeLabel =
            route.route || (routeSegment ? formatRouteLabel(routeSegment, route.fileName) : null);

          pushTarget({
            fileKey: routeFileKey,
            fileName: route.fileName,
            code: route.code,
            context: mergedContext,
            routeLabel,
          });

          (route.contextFiles || []).forEach((file) =>
            registerContextFile(file, routeLabel, mergedContext)
          );
        });

        files.forEach((file) => {
          if (!seenFileKeys.has(file.fileName)) {
            pushTarget({
              fileKey: file.fileName,
              fileName: file.fileName,
              code: file.code,
              context: currentScenario.context,
              routeLabel: mainRouteLabelForTargets,
            });
          }
        });

        if (analysisTargets.length === 0) {
          diagnosticsRef.current = {};
          setDiagnosticsByFile({});
          return;
        }

        const response = await fetch('/api/analyze', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-cache',
          },
          body: JSON.stringify({
            scenario: currentScenario.id,
            context: currentScenario.context,
            analysisTargets: analysisTargets.map((target) => ({
              fileKey: target.fileKey,
              fileName: target.fileName,
              code: target.code,
              context: target.context,
            })),
          }),
        });

        if (!response.ok) {
          throw new Error(`Analysis failed: ${response.statusText}`);
        }

        const result = await response.json();
        const incomingDiagnostics: DiagnosticsByFile =
          (result.diagnosticsByFile as DiagnosticsByFile) ?? {};

        const nextDiagnosticsByFile: DiagnosticsByFile = {};

        for (const [fileKey, diags] of Object.entries(incomingDiagnostics)) {
          console.log('[MultiFileCodeViewer] Incoming diagnostics', {
            scenarioId: currentScenario.id,
            fileKey,
            count: (diags ?? []).length,
            sample: (diags ?? [])[0]?.loc,
          });
          logRealWorldDiagnostics('initial-server-diagnostics', {
            fileKey,
            diagnostics: diags ?? [],
          });
          const routeLabel = routeLabels.get(fileKey) ?? null;
          setDiagnosticsForFile(
            nextDiagnosticsByFile,
            fileKey,
            annotateDuplicateDiagnostics(diags ?? [], routeLabel)
          );
          logRealWorldDiagnostics('initial-tab-diagnostics', {
            fileKey,
            diagnostics: nextDiagnosticsByFile[fileKey] ?? [],
            source: 'initial-load',
          });
        }

        if (
          Object.keys(incomingDiagnostics).length === 0 &&
          Array.isArray(result.diagnostics) &&
          result.diagnostics.length > 0
        ) {
          const routeLabel = routeLabels.get(mainFile.fileName) ?? null;
          logRealWorldDiagnostics('initial-server-diagnostics-fallback', {
            fileKey: mainFile.fileName,
            diagnostics: result.diagnostics,
          });
          setDiagnosticsForFile(
            nextDiagnosticsByFile,
            mainFile.fileName,
            annotateDuplicateDiagnostics(result.diagnostics, routeLabel)
          );
          logRealWorldDiagnostics('initial-tab-diagnostics-fallback', {
            fileKey: mainFile.fileName,
            diagnostics: nextDiagnosticsByFile[mainFile.fileName] ?? [],
            source: 'initial-load-fallback',
          });
        } else {
          console.log('[MultiFileCodeViewer] Incoming diagnostics keys', {
            scenarioId: currentScenario.id,
            keys: Object.keys(incomingDiagnostics),
          });
          logRealWorldDiagnostics('initial-server-diagnostics-keys', {
            keys: Object.keys(incomingDiagnostics),
            diagnosticsCount: Object.values(incomingDiagnostics).reduce(
              (total, diags) => total + (diags?.length ?? 0),
              0
            ),
          });
        }

        diagnosticsRef.current = nextDiagnosticsByFile;
        setDiagnosticsByFile(nextDiagnosticsByFile);
        logRealWorldDiagnostics('diagnostics-by-file-ready', {
          diagnosticsByFile: nextDiagnosticsByFile,
          activeFile: activeFileName,
        });

        if (viewRef.current && activeFileName) {
          applyDiagnosticsToViewRef.current(
            viewRef.current,
            activeFileName,
            diagnosticsRef.current
          );
        }

        if (onAnalysisComplete) {
          const flattenedDiagnostics = Object.values(nextDiagnosticsByFile).flat();
          const durationsByFile = (result.durationsByFile ?? {}) as Record<string, number>;
          const aggregatedDuration =
            typeof result.duration === 'number'
              ? result.duration
              : Object.values(durationsByFile).reduce((sum, value) => sum + value, 0);

          onAnalysisComplete(flattenedDiagnostics, aggregatedDuration);
        }
      } catch (error) {
        console.error('[MultiFileCodeViewer] Analysis error:', error);
        diagnosticsRef.current = {};
        setDiagnosticsByFile({});
      }
    };

    runAnalysis();
  }, [scenario?.id, logRealWorldDiagnostics]);

  // Convert RSC X-Ray diagnostics to CodeMirror diagnostics for the active file
  // Initialize or update CodeMirror editor
  useEffect(() => {
    if (!editorRef.current || !activeFile) return;

    // Destroy existing editor if present
    if (viewRef.current) {
      viewRef.current.destroy();
      viewRef.current = null;
    }

    const view = new EditorView({
      doc: activeFile.code,
      extensions: [
        basicSetup,
        lintExtension,
        javascript({ jsx: true, typescript: activeFile.language !== 'javascript' }),
        EditorView.editable.of(activeFile.editable || false),
        EditorView.updateListener.of((update) => {
          if (update.docChanged && activeFile.editable) {
            const newCode = update.state.doc.toString();
            if (onCodeChange) {
              onCodeChange(activeFile.fileName, newCode);
            }
            // Trigger re-analysis after edit (debounced)
            triggerReAnalysisRef.current(newCode, activeFile.fileName);
          }
        }),
        EditorView.theme({
          '&': {
            height: '100%',
            fontSize: '14px',
            // Read-only files: slightly tinted background (works in light/dark mode)
            backgroundColor: activeFile.editable
              ? 'var(--color-bg-primary)'
              : 'var(--color-bg-secondary)',
          },
          '.cm-scroller': {
            overflow: 'auto',
            fontFamily: 'var(--font-mono)',
          },
          '.cm-content': {
            caretColor: activeFile.editable ? 'var(--color-text-primary)' : 'transparent',
          },
          '.cm-gutters': {
            backgroundColor: 'var(--color-bg-secondary)',
            color: 'var(--color-text-tertiary)',
            border: 'none',
          },
        }),
      ],
      parent: editorRef.current,
    });

    viewRef.current = view;
    setIsReady(true);

    return () => {
      view.destroy();
      viewRef.current = null;
      setIsReady(false);
    };
  }, [activeFileName, activeFile?.code, lintExtension, onCodeChange]);

  // Update diagnostics when they change
  useEffect(() => {
    if (!viewRef.current || !isReady || !activeFileName) {
      return;
    }

    logRealWorldDiagnostics('apply-diagnostics-to-view', {
      fileName: activeFileName,
      diagnostics: diagnosticsRef.current[activeFileName] ?? [],
    });
    applyDiagnosticsToViewRef.current(viewRef.current, activeFileName, diagnosticsRef.current);
  }, [diagnosticsByFile, isReady, activeFileName, logRealWorldDiagnostics]);

  const handleTabChange = (fileName: string) => {
    logRealWorldDiagnostics('active-tab-selected', {
      fileName,
      diagnostics: diagnosticsRef.current[fileName] ?? [],
    });
    setActiveFileName(fileName);
    if (onFileChange) {
      onFileChange(fileName);
    }
  };

  useEffect(() => {
    if (!isReady || !viewRef.current || !activeFileName) {
      return;
    }

    logRealWorldDiagnostics('apply-diagnostics-after-ready', {
      fileName: activeFileName,
      diagnostics: diagnosticsRef.current[activeFileName] ?? [],
    });
    applyDiagnosticsToViewRef.current(viewRef.current, activeFileName, diagnosticsRef.current);
  }, [isReady, activeFileName, logRealWorldDiagnostics]);

  return (
    <div className={styles.container}>
      {/* Tab navigation */}
      <div className={styles.tabNavigation}>
        {files.map((file) => {
          const label = file.displayName ?? file.fileName;

          return (
            <button
              key={label}
              className={`${styles.tabButton} ${
                activeFileName === file.fileName ? styles.activeTabButton : ''
              }`}
              onClick={() => handleTabChange(file.fileName)}
              title={file.description}
            >
              {label}
              {file.editable && <span className={styles.editableIndicator}>✎</span>}
            </button>
          );
        })}
      </div>

      {/* File description (optional) */}
      {activeFile?.description && (
        <div className={styles.description}>{activeFile.description}</div>
      )}

      {/* CodeMirror editor */}
      <div ref={editorRef} className={styles.editor} />
    </div>
  );
}
