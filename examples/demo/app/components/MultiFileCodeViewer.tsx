'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { EditorView, basicSetup } from 'codemirror';
import { javascript } from '@codemirror/lang-javascript';
import { linter, forceLinting, type Diagnostic as CMDiagnostic } from '@codemirror/lint';
import type { Diagnostic, Suggestion } from '@rsc-xray/schemas';
import styles from './MultiFileCodeViewer.module.css';

/**
 * A single code file with optional diagnostics
 */
export interface CodeFile {
  /** File name (displayed in tab) */
  fileName: string;
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
  /** Callback when active file changes */
  onFileChange?: (fileName: string) => void;
  /** Callback when editable file content changes */
  onCodeChange?: (fileName: string, code: string) => void;
  /** Scenario object for analysis context (required for analysis) */
  scenario?: {
    id: string;
    fileName?: string;
    context?: Record<string, unknown>;
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
  const [localDiagnostics, setLocalDiagnostics] = useState<Array<Diagnostic | Suggestion>>([]);
  const diagnosticsRef = useRef<Array<Diagnostic | Suggestion>>([]);
  const reAnalyzeTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Keep scenario ref up to date
  useEffect(() => {
    scenarioRef.current = scenario;
  }, [scenario]);

  // Keep diagnostics ref in sync with state
  useEffect(() => {
    diagnosticsRef.current = localDiagnostics;
  }, [localDiagnostics]);

  const activeFile = files.find((f) => f.fileName === activeFileName);

  // Re-analyze function (debounced)
  const triggerReAnalysis = useCallback(
    (code: string, fileName: string) => {
      if (!scenario) return;

      // Clear existing timeout
      if (reAnalyzeTimeoutRef.current) {
        clearTimeout(reAnalyzeTimeoutRef.current);
      }

      // Debounce: wait 500ms after last edit
      reAnalyzeTimeoutRef.current = setTimeout(async () => {
        console.log(`[MultiFileCodeViewer] Re-analyzing after edit: ${fileName}`);
        if (onAnalysisStart) onAnalysisStart();

        try {
          const response = await fetch('/api/analyze', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Cache-Control': 'no-cache',
            },
            body: JSON.stringify({
              code,
              fileName,
              scenario: scenario.id,
              context: scenario.context,
            }),
          });

          if (!response.ok) {
            throw new Error(`Analysis failed: ${response.statusText}`);
          }

          const result = await response.json();
          setLocalDiagnostics(result.diagnostics || []);
          if (onAnalysisComplete) {
            onAnalysisComplete(result.diagnostics || [], result.duration);
          }
        } catch (error) {
          console.error('[MultiFileCodeViewer] Re-analysis error:', error);
        }
      }, 500);
    },
    [scenario, onAnalysisStart, onAnalysisComplete]
  );

  // Run analysis on mount or when scenario changes
  useEffect(() => {
    if (!scenario) {
      setLocalDiagnostics([]);
      return;
    }

    const runAnalysis = async () => {
      console.log(`[MultiFileCodeViewer] Running initial analysis for scenario "${scenario.id}"`);
      if (onAnalysisStart) onAnalysisStart();

      try {
        // Analyze the main file (page.tsx or first file)
        // The editable flag is UI-only; all files are source code for analysis
        const mainFile =
          files.find((f) => scenario.fileName && f.fileName === scenario.fileName) || files[0];
        if (!mainFile) {
          console.log('[MultiFileCodeViewer] No files to analyze');
          setLocalDiagnostics([]);
          return;
        }

        console.log(`[MultiFileCodeViewer] Analyzing ${mainFile.fileName}`);

        const response = await fetch('/api/analyze', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-cache',
          },
          body: JSON.stringify({
            code: mainFile.code,
            fileName: mainFile.fileName,
            scenario: scenario.id,
            context: scenario.context,
          }),
        });

        if (!response.ok) {
          throw new Error(`Analysis failed: ${response.statusText}`);
        }

        const result = await response.json();
        console.log(
          '[MultiFileCodeViewer] Analysis complete:',
          result.diagnostics.length,
          'diagnostics'
        );

        setLocalDiagnostics(result.diagnostics || []);
        if (onAnalysisComplete) {
          onAnalysisComplete(result.diagnostics || [], result.duration);
        }
      } catch (error) {
        console.error('[MultiFileCodeViewer] Analysis error:', error);
        setLocalDiagnostics([]);
      }
    };

    runAnalysis();
  }, [scenario?.id]); // Only re-run when scenario changes (files/callbacks change too often)

  // Convert RSC X-Ray diagnostics to CodeMirror diagnostics for the active file
  const convertDiagnostics = (
    diags: Array<Diagnostic | Suggestion>,
    fileName: string
  ): CMDiagnostic[] => {
    const filtered = diags.filter((d) => {
      if (!d.loc?.file) return false;

      // Match exact file name or if loc.file contains this file name
      return (
        d.loc.file === fileName ||
        d.loc.file.endsWith(`/${fileName}`) ||
        d.loc.file.includes(fileName)
      );
    });

    if (!viewRef.current) return [];

    return filtered
      .filter((diag) => {
        // Skip component-level diagnostics (0-0 range) - they should be shown in a summary panel, not inline
        if (diag.loc?.range && diag.loc.range.from === 0 && diag.loc.range.to === 0) {
          return false;
        }
        return true;
      })
      .map((diag) => {
        try {
          // Use the precise range from the analyzer if available
          if (diag.loc?.range) {
            return {
              from: diag.loc.range.from,
              to: diag.loc.range.to,
              severity: diag.level === 'error' ? 'error' : 'warning',
              message: diag.message,
              source: diag.rule,
            } as CMDiagnostic;
          }

          // Fallback: shouldn't happen with new schema, but kept for safety
          return {
            from: 0,
            to: 10,
            severity: diag.level === 'error' ? 'error' : 'warning',
            message: diag.message,
            source: diag.rule,
          } as CMDiagnostic;
        } catch (e) {
          console.error('[MultiFileCodeViewer] Error converting diagnostic:', e);
          return {
            from: 0,
            to: 10,
            severity: diag.level === 'error' ? 'error' : 'warning',
            message: diag.message,
            source: diag.rule,
          } as CMDiagnostic;
        }
      });
  };

  // Initialize or update CodeMirror editor
  useEffect(() => {
    if (!editorRef.current || !activeFile) return;

    // Destroy existing editor if present
    if (viewRef.current) {
      viewRef.current.destroy();
      viewRef.current = null;
    }

    // Use sync linter that filters local diagnostics for the active file
    // Use diagnosticsRef to always read the latest diagnostics (closure issue fix)
    const linterExtension = linter(() => {
      const currentDiags = diagnosticsRef.current;
      console.log(
        `[MultiFileCodeViewer] Filtering ${currentDiags.length} diagnostics for ${activeFile.fileName}`
      );
      return convertDiagnostics(currentDiags, activeFile.fileName);
    });

    const view = new EditorView({
      doc: activeFile.code,
      extensions: [
        basicSetup,
        javascript({ jsx: true, typescript: activeFile.language !== 'javascript' }),
        EditorView.editable.of(activeFile.editable || false),
        linterExtension,
        EditorView.updateListener.of((update) => {
          if (update.docChanged && activeFile.editable) {
            const newCode = update.state.doc.toString();
            if (onCodeChange) {
              onCodeChange(activeFile.fileName, newCode);
            }
            // Trigger re-analysis after edit (debounced)
            triggerReAnalysis(newCode, activeFile.fileName);
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
  }, [activeFileName, activeFile?.code]);

  // Update diagnostics when they change
  useEffect(() => {
    console.log(
      `[MultiFileCodeViewer] Diagnostics changed: ${localDiagnostics.length}, isReady: ${isReady}, viewRef: ${!!viewRef.current}`
    );

    if (!viewRef.current || !isReady) {
      console.log('[MultiFileCodeViewer] Skipping forceLinting (editor not ready)');
      return;
    }

    console.log('[MultiFileCodeViewer] Forcing linter to re-run');
    forceLinting(viewRef.current);
  }, [localDiagnostics, isReady]);

  const handleTabChange = (fileName: string) => {
    setActiveFileName(fileName);
    if (onFileChange) {
      onFileChange(fileName);
    }
  };

  return (
    <div className={styles.container}>
      {/* Tab navigation */}
      <div className={styles.tabNavigation}>
        {files.map((file) => (
          <button
            key={file.fileName}
            className={`${styles.tabButton} ${
              activeFileName === file.fileName ? styles.activeTabButton : ''
            }`}
            onClick={() => handleTabChange(file.fileName)}
            title={file.description}
          >
            {file.fileName}
            {file.editable && <span className={styles.editableIndicator}>✎</span>}
          </button>
        ))}
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
