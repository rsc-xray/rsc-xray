'use client';

import { scenarios } from '../lib/scenarios';
import styles from './ScenarioSelector.module.css';

interface ScenarioSelectorConfig {
  selectedScenarioId: string;
  onSelectScenario: (scenarioId: string) => void;
}

/**
 * Scenario selector dropdown with categorized options
 *
 * Groups scenarios by category:
 * - Fundamentals: Core RSC rules (free)
 * - Performance: Optimization rules (free)
 * - Real-World: Complex multi-file examples (free)
 * - Pro: Advanced features (requires upgrade)
 */
export function ScenarioSelector({ selectedScenarioId, onSelectScenario }: ScenarioSelectorConfig) {
  const fundamentals = scenarios.filter((s) => s.category === 'fundamentals');
  const performance = scenarios.filter((s) => s.category === 'performance');
  const realWorld = scenarios.filter((s) => s.category === 'real-world');
  const pro = scenarios.filter((s) => s.category === 'pro');

  const selectedScenario = scenarios.find((s) => s.id === selectedScenarioId);

  return (
    <div className={styles.container}>
      <label htmlFor="scenario-select" className={styles.label}>
        Choose a scenario:
      </label>

      <select
        id="scenario-select"
        aria-label="Select scenario"
        value={selectedScenarioId}
        onChange={(e) => onSelectScenario(e.target.value)}
        className={styles.select}
      >
        <optgroup label="🎯 Fundamentals">
          {fundamentals.map((scenario) => (
            <option key={scenario.id} value={scenario.id}>
              {scenario.title}
            </option>
          ))}
        </optgroup>

        <optgroup label="⚡ Performance">
          {performance.map((scenario) => (
            <option key={scenario.id} value={scenario.id}>
              {scenario.title}
            </option>
          ))}
        </optgroup>

        <optgroup label="🏗️ Real-World Examples">
          {realWorld.map((scenario) => (
            <option key={scenario.id} value={scenario.id}>
              {scenario.title}
            </option>
          ))}
        </optgroup>

        <optgroup label="✨ Pro Features">
          {pro.map((scenario) => (
            <option key={scenario.id} value={scenario.id}>
              {scenario.title} 🔒
            </option>
          ))}
        </optgroup>
      </select>

      {selectedScenario && (
        <p className={styles.description}>
          {selectedScenario.description}
          {selectedScenario.isPro && <span className={styles.proBadge}>Pro</span>}
        </p>
      )}
    </div>
  );
}
