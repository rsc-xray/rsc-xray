'use client';

import { Scenario } from '../lib/scenarios';
import { ScenarioSelector } from './ScenarioSelector';
import type { ProFeature } from './ProPreview';
import styles from './ExplanationPanel.module.css';

interface ExplanationPanelConfig {
  scenario: Scenario;
  diagnosticsCount: number;
  onSelectScenario: (scenarioId: string) => void;
  onOpenProModal: (feature: ProFeature) => void;
  onShowReport?: () => void;
}

/**
 * Explanation panel showing rule details and current diagnostics
 *
 * Structure:
 * - Scenario selector dropdown
 * - Rule explanation (What/Why/How)
 * - Current diagnostics count
 * - Pro feature teaser with interactive preview buttons
 */
export function ExplanationPanel({
  scenario,
  diagnosticsCount,
  onSelectScenario,
  onOpenProModal,
  onShowReport,
}: ExplanationPanelConfig) {
  return (
    <div className={styles.panel}>
      <ScenarioSelector selectedScenarioId={scenario.id} onSelectScenario={onSelectScenario} />

      {scenario.showReport && onShowReport && (
        <button onClick={onShowReport} className={styles.reportButton}>
          📊 View Full Analysis Report
        </button>
      )}

      <div className={styles.content}>
        <header className={styles.header}>
          <h2 className={styles.title}>{scenario.title}</h2>
          {scenario.isPro && <span className={styles.proBadge}>Pro Only</span>}
        </header>

        <div className={styles.sections}>
          {scenario.contextDescription && (
            <section className={styles.section}>
              <h3 className={styles.sectionTitle}>
                <span className={styles.icon}>🔍</span> What analyzer checks
              </h3>
              <p className={styles.sectionContent}>{scenario.contextDescription}</p>
            </section>
          )}

          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>
              <span className={styles.icon}>❓</span> What is it?
            </h3>
            <p className={styles.sectionContent}>{scenario.explanation.what}</p>
          </section>

          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>
              <span className={styles.icon}>⚠️</span> Why does it matter?
            </h3>
            <p className={styles.sectionContent}>{scenario.explanation.why}</p>
          </section>

          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>
              <span className={styles.icon}>✅</span> How to fix it?
            </h3>
            <p className={styles.sectionContent}>{scenario.explanation.how}</p>
          </section>
        </div>

        {diagnosticsCount > 0 && (
          <div className={styles.diagnosticsAlert}>
            <strong>{diagnosticsCount}</strong> {diagnosticsCount === 1 ? 'issue' : 'issues'} found
            in the code →
          </div>
        )}

        {scenario.proFeatures && scenario.proFeatures.length > 0 && (
          <div className={styles.proTeaser}>
            <h4 className={styles.proTeaserTitle}>
              ✨ Pro Features {scenario.isPro && <span>(Required for this scenario)</span>}
            </h4>
            <ul className={styles.proFeaturesList}>
              {scenario.proFeatures.map((feature, i) => (
                <li key={i}>{feature}</li>
              ))}
            </ul>

            <div className={styles.proPreviewButtons}>
              <button
                type="button"
                className={styles.previewButton}
                onClick={() => onOpenProModal('overlay')}
              >
                👁️ Preview Boundary Tree
              </button>
              <button
                type="button"
                className={styles.previewButton}
                onClick={() => onOpenProModal('cache-lens')}
              >
                🔍 Preview Cache Lens
              </button>
              <button
                type="button"
                className={styles.previewButton}
                onClick={() => onOpenProModal('flight-timeline')}
              >
                📊 Preview Flight Timeline
              </button>
              <button
                type="button"
                className={styles.previewButton}
                onClick={() => onOpenProModal('hydration')}
              >
                ⚡ Preview Hydration
              </button>
            </div>

            <a href="https://rsc-xray.dev/pricing" className={styles.upgradeButton}>
              {scenario.isPro ? 'Get Pro Access' : 'Learn More'}
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
