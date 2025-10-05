import { describe, it, expect } from 'vitest';
import { analyzeSerializationBoundary } from '../serializationBoundary';
import { ensureDefined } from '../../testUtils/assert';

describe('Serialization Boundary Analyzer', () => {
  const clientComponents = new Set(['ClientButton', 'ClientCard', 'ClientComponent']);
  const getFirstDiagnostic = (diagnostics: ReturnType<typeof analyzeSerializationBoundary>) =>
    ensureDefined(diagnostics[0]);
  const getDiagnosticAt = (
    diagnostics: ReturnType<typeof analyzeSerializationBoundary>,
    index: number
  ) => ensureDefined(diagnostics[index]);

  describe('Arrow Functions', () => {
    it('detects arrow function props', () => {
      const source = `
        export default function ServerComponent() {
          const handleClick = () => console.log('clicked');
          return <ClientButton onClick={handleClick} />;
        }
      `;

      const diagnostics = analyzeSerializationBoundary({
        fileName: 'test.tsx',
        sourceText: source,
        clientComponents,
      });

      expect(diagnostics).toHaveLength(1);
      const diagnostic = getFirstDiagnostic(diagnostics);
      expect(diagnostic.rule).toBe('server-client-serialization-violation');
      expect(diagnostic.level).toBe('error');
      expect(diagnostic.message).toContain('arrow function');
      expect(diagnostic.message).toContain('onClick');
      expect(diagnostic.message).toContain('Server Actions');
    });

    it('detects inline arrow functions', () => {
      const source = `
        export default function ServerComponent() {
          return <ClientButton onClick={() => console.log('clicked')} />;
        }
      `;

      const diagnostics = analyzeSerializationBoundary({
        fileName: 'test.tsx',
        sourceText: source,
        clientComponents,
      });

      expect(diagnostics).toHaveLength(1);
      expect(getFirstDiagnostic(diagnostics).message).toContain('arrow function');
    });
  });

  describe('Function Expressions', () => {
    it('detects function expression props', () => {
      const source = `
        export default function ServerComponent() {
          const handler = function() { return 'test'; };
          return <ClientButton onSubmit={handler} />;
        }
      `;

      const diagnostics = analyzeSerializationBoundary({
        fileName: 'test.tsx',
        sourceText: source,
        clientComponents,
      });

      expect(diagnostics).toHaveLength(1);
      expect(getFirstDiagnostic(diagnostics).message).toContain('function');
    });

    it('detects inline function expressions', () => {
      const source = `
        export default function ServerComponent() {
          return <ClientButton onClick={function() { alert('hi'); }} />;
        }
      `;

      const diagnostics = analyzeSerializationBoundary({
        fileName: 'test.tsx',
        sourceText: source,
        clientComponents,
      });

      expect(diagnostics).toHaveLength(1);
      expect(getFirstDiagnostic(diagnostics).message).toContain('function');
    });
  });

  describe('Date Instances', () => {
    it('detects new Date() props', () => {
      const source = `
        export default function ServerComponent() {
          const timestamp = new Date();
          return <ClientCard createdAt={timestamp} />;
        }
      `;

      const diagnostics = analyzeSerializationBoundary({
        fileName: 'test.tsx',
        sourceText: source,
        clientComponents,
      });

      expect(diagnostics).toHaveLength(1);
      expect(getFirstDiagnostic(diagnostics).message).toContain('Date instance');
      expect(getFirstDiagnostic(diagnostics).message).toContain('ISO string');
    });

    it('detects inline new Date()', () => {
      const source = `
        export default function ServerComponent() {
          return <ClientCard timestamp={new Date()} />;
        }
      `;

      const diagnostics = analyzeSerializationBoundary({
        fileName: 'test.tsx',
        sourceText: source,
        clientComponents,
      });

      expect(diagnostics).toHaveLength(1);
      expect(getFirstDiagnostic(diagnostics).message).toContain('Date instance');
    });
  });

  describe('Map and Set Instances', () => {
    it('detects Map instances', () => {
      const source = `
        export default function ServerComponent() {
          const data = new Map([['key', 'value']]);
          return <ClientCard data={data} />;
        }
      `;

      const diagnostics = analyzeSerializationBoundary({
        fileName: 'test.tsx',
        sourceText: source,
        clientComponents,
      });

      expect(diagnostics).toHaveLength(1);
      expect(getFirstDiagnostic(diagnostics).message).toContain('Map instance');
      expect(getFirstDiagnostic(diagnostics).message).toContain('array or plain object');
    });

    it('detects Set instances', () => {
      const source = `
        export default function ServerComponent() {
          const tags = new Set(['a', 'b', 'c']);
          return <ClientCard tags={tags} />;
        }
      `;

      const diagnostics = analyzeSerializationBoundary({
        fileName: 'test.tsx',
        sourceText: source,
        clientComponents,
      });

      expect(diagnostics).toHaveLength(1);
      expect(getFirstDiagnostic(diagnostics).message).toContain('Set instance');
    });
  });

  describe('Promise Instances', () => {
    it('detects Promise instances', () => {
      const source = `
        export default function ServerComponent() {
          const dataPromise = new Promise(resolve => resolve('data'));
          return <ClientCard data={dataPromise} />;
        }
      `;

      const diagnostics = analyzeSerializationBoundary({
        fileName: 'test.tsx',
        sourceText: source,
        clientComponents,
      });

      expect(diagnostics).toHaveLength(1);
      expect(getFirstDiagnostic(diagnostics).message).toContain('Promise');
      expect(getFirstDiagnostic(diagnostics).message).toContain('Await');
    });
  });

  describe('Symbol', () => {
    it('detects Symbol usage', () => {
      const source = `
        export default function ServerComponent() {
          const key = Symbol('key');
          return <ClientCard id={key} />;
        }
      `;

      const diagnostics = analyzeSerializationBoundary({
        fileName: 'test.tsx',
        sourceText: source,
        clientComponents,
      });

      expect(diagnostics).toHaveLength(1);
      expect(getFirstDiagnostic(diagnostics).message).toContain('Symbol');
    });
  });

  describe('Class Instances', () => {
    it('detects custom class instances', () => {
      const source = `
        class User {
          constructor(public name: string) {}
        }
        
        export default function ServerComponent() {
          const user = new User('John');
          return <ClientCard user={user} />;
        }
      `;

      const diagnostics = analyzeSerializationBoundary({
        fileName: 'test.tsx',
        sourceText: source,
        clientComponents,
      });

      expect(diagnostics).toHaveLength(1);
      expect(getFirstDiagnostic(diagnostics).message).toContain('class instance');
      expect(getFirstDiagnostic(diagnostics).message).toContain('plain object');
    });
  });

  describe('React Elements', () => {
    it('detects React element props (non-children)', () => {
      const source = `
        export default function ServerComponent() {
          const icon = <svg><path d="M0 0" /></svg>;
          return <ClientButton icon={icon} />;
        }
      `;

      const diagnostics = analyzeSerializationBoundary({
        fileName: 'test.tsx',
        sourceText: source,
        clientComponents,
      });

      expect(diagnostics).toHaveLength(1);
      expect(getFirstDiagnostic(diagnostics).message).toContain('React element');
    });

    it('allows React elements in children prop', () => {
      const source = `
        export default function ServerComponent() {
          return (
            <ClientCard>
              <div>This is allowed as children</div>
            </ClientCard>
          );
        }
      `;

      const diagnostics = analyzeSerializationBoundary({
        fileName: 'test.tsx',
        sourceText: source,
        clientComponents,
      });

      expect(diagnostics).toHaveLength(0);
    });
  });

  describe('Multiple Violations', () => {
    it('detects multiple violations in one component', () => {
      const source = `
        export default function ServerComponent() {
          const handleClick = () => {};
          const timestamp = new Date();
          const data = new Map();
          
          return (
            <ClientCard
              onClick={handleClick}
              createdAt={timestamp}
              metadata={data}
            />
          );
        }
      `;

      const diagnostics = analyzeSerializationBoundary({
        fileName: 'test.tsx',
        sourceText: source,
        clientComponents,
      });

      expect(diagnostics).toHaveLength(3);
      expect(getFirstDiagnostic(diagnostics).message).toContain('arrow function');
      expect(getDiagnosticAt(diagnostics, 1).message).toContain('Date instance');
      expect(getDiagnosticAt(diagnostics, 2).message).toContain('Map instance');
    });
  });

  describe('Client Component Detection', () => {
    it('does not flag violations in client components', () => {
      const source = `
        'use client';
        
        export default function ClientComponent() {
          const handleClick = () => {};
          return <AnotherClientComponent onClick={handleClick} />;
        }
      `;

      const diagnostics = analyzeSerializationBoundary({
        fileName: 'test.tsx',
        sourceText: source,
        clientComponents: new Set(['AnotherClientComponent']),
      });

      // Client to client is OK
      expect(diagnostics).toHaveLength(0);
    });

    it('only flags known client components', () => {
      const source = `
        export default function ServerComponent() {
          const handleClick = () => {};
          return (
            <>
              <div onClick={handleClick}>Native element - OK</div>
              <ClientButton onClick={handleClick}>Should flag</ClientButton>
            </>
          );
        }
      `;

      const diagnostics = analyzeSerializationBoundary({
        fileName: 'test.tsx',
        sourceText: source,
        clientComponents,
      });

      expect(diagnostics).toHaveLength(1);
      expect(getFirstDiagnostic(diagnostics).message).toContain('ClientButton');
    });
  });

  describe('Edge Cases', () => {
    it('handles empty props', () => {
      const source = `
        export default function ServerComponent() {
          return <ClientButton />;
        }
      `;

      const diagnostics = analyzeSerializationBoundary({
        fileName: 'test.tsx',
        sourceText: source,
        clientComponents,
      });

      expect(diagnostics).toHaveLength(0);
    });

    it('handles spread props (no diagnostic - requires type analysis)', () => {
      const source = `
        export default function ServerComponent() {
          const props = { onClick: () => {} };
          return <ClientButton {...props} />;
        }
      `;

      const diagnostics = analyzeSerializationBoundary({
        fileName: 'test.tsx',
        sourceText: source,
        clientComponents,
      });

      // Spread props are hard to analyze without type info
      // This is a known limitation for Phase 1
      expect(diagnostics).toHaveLength(0);
    });

    it('handles serializable props (no diagnostics)', () => {
      const source = `
        export default function ServerComponent() {
          const data = { name: 'John', age: 30 };
          const list = [1, 2, 3];
          return (
            <ClientCard
              user={data}
              items={list}
              count={42}
              label="test"
              active={true}
              value={null}
            />
          );
        }
      `;

      const diagnostics = analyzeSerializationBoundary({
        fileName: 'test.tsx',
        sourceText: source,
        clientComponents,
      });

      expect(diagnostics).toHaveLength(0);
    });

    it('provides appropriate suggestions based on type', () => {
      const source = `
        export default function ServerComponent() {
          return (
            <>
              <ClientButton onClick={() => {}} />
              <ClientCard timestamp={new Date()} />
              <ClientCard data={new Map()} />
            </>
          );
        }
      `;

      const diagnostics = analyzeSerializationBoundary({
        fileName: 'test.tsx',
        sourceText: source,
        clientComponents,
      });

      expect(diagnostics).toHaveLength(3);
      expect(getFirstDiagnostic(diagnostics).message).toContain('Server Actions');
      expect(getDiagnosticAt(diagnostics, 1).message).toContain('ISO string');
      expect(getDiagnosticAt(diagnostics, 2).message).toContain('array or plain object');
    });

    it('handles nested JSX', () => {
      const source = `
        export default function ServerComponent() {
          const handler = () => {};
          return (
            <div>
              <section>
                <ClientButton onClick={handler} />
              </section>
            </div>
          );
        }
      `;

      const diagnostics = analyzeSerializationBoundary({
        fileName: 'test.tsx',
        sourceText: source,
        clientComponents,
      });

      expect(diagnostics).toHaveLength(1);
      expect(getFirstDiagnostic(diagnostics).message).toContain('arrow function');
    });

    it('reports correct file location', () => {
      const source = `export default function ServerComponent() {
  const handleClick = () => {};
  return <ClientButton onClick={handleClick} />;
}`;

      const diagnostics = analyzeSerializationBoundary({
        fileName: 'app/page.tsx',
        sourceText: source,
        clientComponents,
      });

      expect(diagnostics).toHaveLength(1);
      expect(getFirstDiagnostic(diagnostics)?.loc?.file).toBe('app/page.tsx');
      expect(getFirstDiagnostic(diagnostics)?.loc?.range).toBeDefined();
      expect(getFirstDiagnostic(diagnostics)?.loc?.range?.from).toBeGreaterThanOrEqual(0);
      expect(getFirstDiagnostic(diagnostics)?.loc?.range?.to).toBeGreaterThan(
        getFirstDiagnostic(diagnostics)?.loc?.range?.from || 0
      );
    });
  });

  describe('Complex Scenarios', () => {
    it('handles async server components', () => {
      const source = `
        export default async function ServerComponent() {
          const data = await fetchData();
          const processData = () => data.map(x => x * 2);
          
          return <ClientCard processor={processData} />;
        }
      `;

      const diagnostics = analyzeSerializationBoundary({
        fileName: 'test.tsx',
        sourceText: source,
        clientComponents,
      });

      expect(diagnostics).toHaveLength(1);
      expect(getFirstDiagnostic(diagnostics).message).toContain('arrow function');
    });

    it('handles conditional props', () => {
      const source = `
        export default function ServerComponent({ showHandler }: { showHandler: boolean }) {
          const handler = () => {};
          
          return <ClientButton onClick={showHandler ? handler : undefined} />;
        }
      `;

      const diagnostics = analyzeSerializationBoundary({
        fileName: 'test.tsx',
        sourceText: source,
        clientComponents,
      });

      // Ternary expressions with non-serializable values
      // The arrow function is in the ternary, but detectNonSerializableExpression
      // won't catch it in a ternary without deeper analysis
      // This is a known limitation - would need recursive expression analysis
      expect(diagnostics).toHaveLength(0);
    });

    it('handles different JSX element types', () => {
      const source = `
        export default function ServerComponent() {
          const handler = () => {};
          
          return (
            <>
              <ClientButton onClick={handler}>
                Self-closing style
              </ClientButton>
              <ClientCard onSubmit={function() {}} />
            </>
          );
        }
      `;

      const diagnostics = analyzeSerializationBoundary({
        fileName: 'test.tsx',
        sourceText: source,
        clientComponents,
      });

      expect(diagnostics).toHaveLength(2);
      expect(getFirstDiagnostic(diagnostics).message).toContain('arrow function');
      expect(getDiagnosticAt(diagnostics, 1).message).toContain('function');
    });
  });

  describe('Advanced Edge Cases', () => {
    it('handles method references from objects', () => {
      const source = `
        const api = {
          handleClick: () => console.log('clicked'),
          getData: function() { return 'data'; }
        };
        
        export default function ServerComponent() {
          return <ClientButton onClick={api.handleClick} />;
        }
      `;

      const diagnostics = analyzeSerializationBoundary({
        fileName: 'test.tsx',
        sourceText: source,
        clientComponents,
      });

      // Property access patterns (api.handleClick) are not detected in Phase 1
      // This would require object tracking, which is a Phase 2 feature
      expect(diagnostics).toHaveLength(0);
    });

    it('handles imported functions', () => {
      const source = `
        import { helperFunction } from './utils.js';
        
        export default function ServerComponent() {
          return <ClientButton onClick={helperFunction} />;
        }
      `;

      const diagnostics = analyzeSerializationBoundary({
        fileName: 'test.tsx',
        sourceText: source,
        clientComponents,
      });

      // Imported identifiers are not tracked in Phase 1 (no cross-file analysis)
      expect(diagnostics).toHaveLength(0);
    });

    it('handles destructured variables', () => {
      const source = `
        export default function ServerComponent() {
          const { onClick } = { onClick: () => {} };
          return <ClientButton onClick={onClick} />;
        }
      `;

      const diagnostics = analyzeSerializationBoundary({
        fileName: 'test.tsx',
        sourceText: source,
        clientComponents,
      });

      // Destructuring patterns are not tracked in Phase 1
      expect(diagnostics).toHaveLength(0);
    });

    it('handles reassigned variables', () => {
      const source = `
        export default function ServerComponent() {
          let handler = () => {};
          handler = () => { console.log('new'); };
          return <ClientButton onClick={handler} />;
        }
      `;

      const diagnostics = analyzeSerializationBoundary({
        fileName: 'test.tsx',
        sourceText: source,
        clientComponents,
      });

      // We track the first assignment
      expect(diagnostics).toHaveLength(1);
      expect(getFirstDiagnostic(diagnostics).message).toContain('arrow function');
    });

    it('handles multiple components in same file', () => {
      const source = `
        function SubComponent() {
          const localHandler = () => {};
          return <ClientButton onClick={localHandler} />;
        }
        
        export default function ServerComponent() {
          const mainHandler = function() {};
          return (
            <div>
              <SubComponent />
              <ClientCard onSubmit={mainHandler} />
            </div>
          );
        }
      `;

      const diagnostics = analyzeSerializationBoundary({
        fileName: 'test.tsx',
        sourceText: source,
        clientComponents,
      });

      expect(diagnostics).toHaveLength(2);
      expect(getFirstDiagnostic(diagnostics).message).toContain('arrow function');
      expect(getDiagnosticAt(diagnostics, 1).message).toContain('function');
    });

    it('handles Date instances with various constructors', () => {
      const source = `
        export default function ServerComponent() {
          const now = new Date();
          const specific = new Date('2024-01-01');
          const fromTimestamp = new Date(1234567890);
          
          return (
            <ClientCard
              now={now}
              specific={specific}
              timestamp={fromTimestamp}
            />
          );
        }
      `;

      const diagnostics = analyzeSerializationBoundary({
        fileName: 'test.tsx',
        sourceText: source,
        clientComponents,
      });

      expect(diagnostics).toHaveLength(3);
      diagnostics.forEach((d) => {
        expect(d.message).toContain('Date instance');
      });
    });

    it('handles WeakMap and WeakSet', () => {
      const source = `
        export default function ServerComponent() {
          const weakMap = new WeakMap();
          const weakSet = new WeakSet();
          
          return (
            <ClientCard
              map={weakMap}
              set={weakSet}
            />
          );
        }
      `;

      const diagnostics = analyzeSerializationBoundary({
        fileName: 'test.tsx',
        sourceText: source,
        clientComponents,
      });

      // WeakMap and WeakSet are detected as generic class instances
      expect(diagnostics).toHaveLength(2);
      diagnostics.forEach((d) => {
        expect(d.message).toContain('class instance');
      });
    });

    it('handles RegExp instances', () => {
      const source = `
        export default function ServerComponent() {
          const pattern = new RegExp('[a-z]+');
          const literal = /test/i;
          
          return <ClientCard pattern={pattern} />;
        }
      `;

      const diagnostics = analyzeSerializationBoundary({
        fileName: 'test.tsx',
        sourceText: source,
        clientComponents,
      });

      // new RegExp() is detected as class instance
      // RegExp literals (/test/) are not detected in Phase 1
      expect(diagnostics).toHaveLength(1);
      expect(getFirstDiagnostic(diagnostics).message).toContain('class instance');
    });

    it('handles Error instances', () => {
      const source = `
        export default function ServerComponent() {
          const error = new Error('Something went wrong');
          return <ClientCard error={error} />;
        }
      `;

      const diagnostics = analyzeSerializationBoundary({
        fileName: 'test.tsx',
        sourceText: source,
        clientComponents,
      });

      expect(diagnostics).toHaveLength(1);
      expect(getFirstDiagnostic(diagnostics).message).toContain('class instance');
    });

    it('handles async functions', () => {
      const source = `
        export default function ServerComponent() {
          const fetchData = async () => { return 'data'; };
          return <ClientCard onFetch={fetchData} />;
        }
      `;

      const diagnostics = analyzeSerializationBoundary({
        fileName: 'test.tsx',
        sourceText: source,
        clientComponents,
      });

      // Async arrow functions are still arrow functions
      expect(diagnostics).toHaveLength(1);
      expect(getFirstDiagnostic(diagnostics).message).toContain('arrow function');
    });

    it('handles generator functions', () => {
      const source = `
        export default function ServerComponent() {
          const generator = function*() { yield 1; };
          return <ClientCard generator={generator} />;
        }
      `;

      const diagnostics = analyzeSerializationBoundary({
        fileName: 'test.tsx',
        sourceText: source,
        clientComponents,
      });

      // Generator functions are still functions
      expect(diagnostics).toHaveLength(1);
      expect(getFirstDiagnostic(diagnostics).message).toContain('function');
    });

    it('handles mixed violations with proper messages', () => {
      const source = `
        class CustomClass {
          constructor(public name: string) {}
        }
        
        export default function ServerComponent() {
          const onClick = () => {};
          const date = new Date();
          const map = new Map();
          const set = new Set();
          const promise = new Promise((resolve) => resolve('ok'));
          const symbol = Symbol('key');
          const instance = new CustomClass('test');
          
          return (
            <ClientCard
              onClick={onClick}
              date={date}
              map={map}
              set={set}
              promise={promise}
              symbol={symbol}
              instance={instance}
            />
          );
        }
      `;

      const diagnostics = analyzeSerializationBoundary({
        fileName: 'test.tsx',
        sourceText: source,
        clientComponents,
      });

      expect(diagnostics).toHaveLength(7);

      // Verify each diagnostic has the right type and suggestion
      const messages = diagnostics.map((d) => d.message);
      expect(
        messages.some((m) => m.includes('arrow function') && m.includes('Server Actions'))
      ).toBe(true);
      expect(messages.some((m) => m.includes('Date instance') && m.includes('ISO string'))).toBe(
        true
      );
      expect(
        messages.some((m) => m.includes('Map instance') && m.includes('array or plain object'))
      ).toBe(true);
      expect(messages.some((m) => m.includes('Set instance'))).toBe(true);
      expect(messages.some((m) => m.includes('Promise') && m.includes('Await'))).toBe(true);
      expect(messages.some((m) => m.includes('Symbol'))).toBe(true);
      expect(messages.some((m) => m.includes('class instance') && m.includes('plain object'))).toBe(
        true
      );
    });

    it('does not flag serializable complex objects', () => {
      const source = `
        interface User {
          id: string;
          name: string;
          metadata: {
            age: number;
            tags: string[];
          };
        }
        
        export default function ServerComponent() {
          const user: User = {
            id: '123',
            name: 'John',
            metadata: {
              age: 30,
              tags: ['admin', 'user']
            }
          };
          
          const numbers = [1, 2, 3, 4, 5];
          const nested = { a: { b: { c: 'deep' } } };
          
          return (
            <ClientCard
              user={user}
              numbers={numbers}
              nested={nested}
              nullValue={null}
              undefinedValue={undefined}
              booleanValue={true}
              stringValue="test"
              numberValue={42}
            />
          );
        }
      `;

      const diagnostics = analyzeSerializationBoundary({
        fileName: 'test.tsx',
        sourceText: source,
        clientComponents,
      });

      // All of these are serializable
      expect(diagnostics).toHaveLength(0);
    });

    it('handles variables with no initializer', () => {
      const source = `
        export default function ServerComponent() {
          let handler;
          handler = () => {};
          return <ClientButton onClick={handler} />;
        }
      `;

      const diagnostics = analyzeSerializationBoundary({
        fileName: 'test.tsx',
        sourceText: source,
        clientComponents,
      });

      // Variables without initializers are not tracked in Phase 1
      // (would need flow analysis to track assignments)
      expect(diagnostics).toHaveLength(0);
    });

    it('handles function parameters', () => {
      const source = `
        export default function ServerComponent({ onClick }: { onClick: () => void }) {
          return <ClientButton onClick={onClick} />;
        }
      `;

      const diagnostics = analyzeSerializationBoundary({
        fileName: 'test.tsx',
        sourceText: source,
        clientComponents,
      });

      // Function parameters are not tracked in Phase 1
      // This would require type analysis to detect function types
      expect(diagnostics).toHaveLength(0);
    });
  });
});
