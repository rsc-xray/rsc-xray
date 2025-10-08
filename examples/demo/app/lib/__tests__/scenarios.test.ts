import { describe, it, expect } from 'vitest';
import { scenarios, getScenario, getScenariosByCategory } from '../scenarios';

describe('scenarios', () => {
  it('should export all 9 scenarios (7 OSS + 1 real-world + 1 Pro teaser)', () => {
    expect(scenarios.length).toBe(9);
  });

  it('should have required properties', () => {
    scenarios.forEach((scenario) => {
      expect(scenario).toHaveProperty('id');
      expect(scenario).toHaveProperty('title');
      expect(scenario).toHaveProperty('category');
      expect(scenario).toHaveProperty('code');
      expect(scenario).toHaveProperty('explanation');
    });
  });

  it('should get scenario by id', () => {
    const scenario = getScenario('serialization-boundary');
    expect(scenario).toBeDefined();
    expect(scenario?.id).toBe('serialization-boundary');
  });

  it('should return undefined for unknown scenario', () => {
    const scenario = getScenario('unknown-scenario');
    expect(scenario).toBeUndefined();
  });

  it('should filter scenarios by category', () => {
    const fundamentals = getScenariosByCategory('fundamentals');
    expect(fundamentals.length).toBeGreaterThan(0);
    fundamentals.forEach((s) => {
      expect(s.category).toBe('fundamentals');
    });
  });
});
