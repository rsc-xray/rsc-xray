'use client';

import { useState } from 'react';
import styles from './ReportViewer.module.css';

interface ReportViewerProps {
  scenarioTitle: string;
  onClose: () => void;
}

/**
 * Modal that displays an embedded HTML report for real-world scenarios
 *
 * This component shows a full-screen modal with:
 * - Close button
 * - Embedded iframe showing the generated RSC X-Ray HTML report
 *
 * The report is generated server-side and includes all diagnostics,
 * suggestions, bundle analysis, and component tree visualization.
 */
export function ReportViewer({ scenarioTitle, onClose }: ReportViewerProps) {
  const [isLoading, setIsLoading] = useState(true);

  const handleLoad = (): void => {
    setIsLoading(false);
  };

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <h2>{scenarioTitle} - Analysis Report</h2>
          <button className={styles.closeButton} onClick={onClose} aria-label="Close report">
            ×
          </button>
        </div>
        <div className={styles.content}>
          {isLoading && (
            <div className={styles.loading}>
              <div className={styles.spinner} />
              <p>Generating report...</p>
            </div>
          )}
          <iframe
            src="/api/report/real-world"
            className={styles.iframe}
            title="RSC X-Ray Report"
            onLoad={handleLoad}
            style={{ opacity: isLoading ? 0 : 1 }}
          />
        </div>
        <div className={styles.footer}>
          <p className={styles.hint}>
            💡 This is a full RSC X-Ray HTML report with diagnostics, suggestions, and bundle
            analysis
          </p>
        </div>
      </div>
    </div>
  );
}
