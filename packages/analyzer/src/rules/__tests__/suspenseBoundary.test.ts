import { describe, it, expect } from 'vitest';
import * as ts from 'typescript';

import { detectSuspenseBoundaryIssues } from '../suspenseBoundary';
import { ensureDefined } from '../../testUtils/assert';

function createSourceFile(source: string): ts.SourceFile {
  return ts.createSourceFile('test.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}

describe('Suspense Boundary Analyzer', () => {
  const firstSuggestion = (suggestions: ReturnType<typeof detectSuspenseBoundaryIssues>) =>
    ensureDefined(suggestions[0]);
  const suggestionAt = (
    suggestions: ReturnType<typeof detectSuspenseBoundaryIssues>,
    index: number
  ) => ensureDefined(suggestions[index]);

  describe('async components without Suspense', () => {
    it('detects async function component without Suspense boundary', () => {
      const source = `
        export default async function ServerComponent() {
          const data = await fetch('/api/data').then(r => r.json());
          return <div>{data.title}</div>;
        }
      `;

      const sourceFile = createSourceFile(source);
      const suggestions = detectSuspenseBoundaryIssues(sourceFile, 'test.tsx');

      expect(suggestions).toHaveLength(1);
      expect(firstSuggestion(suggestions).rule).toBe('suspense-boundary-missing');
      expect(firstSuggestion(suggestions).level).toBe('warn');
      expect(firstSuggestion(suggestions).message).toContain('1 await expression');
    });

    it('detects arrow function component without Suspense boundary', () => {
      const source = `
        export const ServerComponent = async () => {
          const data = await getData();
          return <div>{data}</div>;
        };
      `;

      const sourceFile = createSourceFile(source);
      const suggestions = detectSuspenseBoundaryIssues(sourceFile, 'test.tsx');

      expect(suggestions).toHaveLength(1);
      expect(firstSuggestion(suggestions).rule).toBe('suspense-boundary-missing');
    });

    it('detects default export arrow function without Suspense', () => {
      const source = `
        export default async () => {
          const user = await fetchUser();
          return <Profile user={user} />;
        };
      `;

      const sourceFile = createSourceFile(source);
      const suggestions = detectSuspenseBoundaryIssues(sourceFile, 'test.tsx');

      expect(suggestions).toHaveLength(1);
      expect(firstSuggestion(suggestions).rule).toBe('suspense-boundary-missing');
    });

    it('highlights JSX element when return has parentheses', () => {
      const source = `
        export default async function ServerComponent() {
          const data = await fetch('/api/data').then(r => r.json());
          return (
            <div>{data.title}</div>
          );
        }
      `;

      const sourceFile = createSourceFile(source);
      const suggestions = detectSuspenseBoundaryIssues(sourceFile, 'test.tsx');

      expect(suggestions).toHaveLength(1);
      const suggestion = firstSuggestion(suggestions);
      expect(suggestion.rule).toBe('suspense-boundary-missing');
      // Ensure diagnostic points to JSX element, not the entire function
      expect(suggestion.loc).toBeDefined();
      const { range } = ensureDefined(suggestion.loc);
      const highlightedCode = source.slice(range.from, range.to);
      expect(highlightedCode).toContain('<div>');
      expect(highlightedCode).not.toContain('export default async function');
    });

    it('highlights JSX element when return has parentheses on new line', () => {
      const source = `
        export default async function Page() {
          const data = await fetch('/api').then(r => r.json());
          return (
            <div>{data}</div>
          );
        }
      `;

      const sourceFile = createSourceFile(source);
      const suggestions = detectSuspenseBoundaryIssues(sourceFile, 'test.tsx');

      expect(suggestions).toHaveLength(1);
      // Should highlight JSX, not function signature (parentheses allow multiline)
      const { range } = ensureDefined(firstSuggestion(suggestions).loc);
      const highlightedCode = source.slice(range.from, range.to);
      expect(highlightedCode).toContain('<div>');
      expect(highlightedCode).not.toContain('async function Page');
    });
  });

  describe('async components with Suspense', () => {
    it('passes when component has Suspense boundary', () => {
      const source = `
        export default async function ServerComponent() {
          const data = await fetch('/api/data').then(r => r.json());
          return (
            <Suspense fallback={<Loading />}>
              <div>{data.title}</div>
            </Suspense>
          );
        }
      `;

      const sourceFile = createSourceFile(source);
      const suggestions = detectSuspenseBoundaryIssues(sourceFile, 'test.tsx');

      expect(suggestions).toHaveLength(0);
    });

    it('passes when component has React.Suspense boundary', () => {
      const source = `
        import React from 'react';
        
        export default async function ServerComponent() {
          const data = await fetch('/api/data').then(r => r.json());
          return (
            <React.Suspense fallback={<div>Loading...</div>}>
              <Content data={data} />
            </React.Suspense>
          );
        }
      `;

      const sourceFile = createSourceFile(source);
      const suggestions = detectSuspenseBoundaryIssues(sourceFile, 'test.tsx');

      expect(suggestions).toHaveLength(0);
    });

    it('passes with self-closing Suspense', () => {
      const source = `
        export default async function ServerComponent() {
          const data = await getData();
          return <Suspense fallback="Loading..." />;
        }
      `;

      const sourceFile = createSourceFile(source);
      const suggestions = detectSuspenseBoundaryIssues(sourceFile, 'test.tsx');

      expect(suggestions).toHaveLength(0);
    });
  });

  describe('multiple await expressions', () => {
    it('suggests parallel Suspense opportunities for multiple awaits', () => {
      const source = `
        export default async function ServerComponent() {
          const user = await fetchUser();
          const posts = await fetchPosts();
          const comments = await fetchComments();
          
          return <div>...</div>;
        }
      `;

      const sourceFile = createSourceFile(source);
      const suggestions = detectSuspenseBoundaryIssues(sourceFile, 'test.tsx');

      expect(suggestions).toHaveLength(2);
      expect(firstSuggestion(suggestions).rule).toBe('suspense-boundary-missing');
      expect(firstSuggestion(suggestions).message).toContain('3 await expressions');
      expect(suggestionAt(suggestions, 1).rule).toBe('suspense-boundary-opportunity');
      expect(suggestionAt(suggestions, 1).level).toBe('info');
      expect(suggestionAt(suggestions, 1).message).toContain('parallel Suspense boundaries');
    });

    it('counts only top-level awaits, not nested function awaits', () => {
      const source = `
        export default async function ServerComponent() {
          const data = await fetchData();
          
          const processData = async () => {
            const result = await process(data);
            return result;
          };
          
          return <div>{data}</div>;
        }
      `;

      const sourceFile = createSourceFile(source);
      const suggestions = detectSuspenseBoundaryIssues(sourceFile, 'test.tsx');

      expect(suggestions).toHaveLength(1);
      expect(firstSuggestion(suggestions).message).toContain('1 await expression');
    });
  });

  describe('client components', () => {
    it('skips client components marked with use client', () => {
      const source = `
        'use client';
        
        export default async function ClientComponent() {
          const data = await fetch('/api/data').then(r => r.json());
          return <div>{data}</div>;
        }
      `;

      const sourceFile = createSourceFile(source);
      const suggestions = detectSuspenseBoundaryIssues(sourceFile, 'test.tsx');

      expect(suggestions).toHaveLength(0);
    });

    it('skips client components with "use client" directive', () => {
      const source = `
        "use client"
        
        export const Component = async () => {
          const data = await getData();
          return <div>{data}</div>;
        };
      `;

      const sourceFile = createSourceFile(source);
      const suggestions = detectSuspenseBoundaryIssues(sourceFile, 'test.tsx');

      expect(suggestions).toHaveLength(0);
    });
  });

  describe('non-async components', () => {
    it('skips synchronous components', () => {
      const source = `
        export default function ServerComponent() {
          const data = getData();
          return <div>{data}</div>;
        }
      `;

      const sourceFile = createSourceFile(source);
      const suggestions = detectSuspenseBoundaryIssues(sourceFile, 'test.tsx');

      expect(suggestions).toHaveLength(0);
    });

    it('skips async components with no await expressions', () => {
      const source = `
        export default async function ServerComponent() {
          // Async for typing but no actual async operations
          return <div>Hello</div>;
        }
      `;

      const sourceFile = createSourceFile(source);
      const suggestions = detectSuspenseBoundaryIssues(sourceFile, 'test.tsx');

      expect(suggestions).toHaveLength(0);
    });
  });

  describe('edge cases', () => {
    it('handles implicit async from await expression', () => {
      const source = `
        export default function ServerComponent() {
          return async function() {
            const data = await fetch('/api');
            return <div>{data}</div>;
          };
        }
      `;

      const sourceFile = createSourceFile(source);
      const suggestions = detectSuspenseBoundaryIssues(sourceFile, 'test.tsx');

      // Should not detect nested function
      expect(suggestions).toHaveLength(0);
    });

    it('provides accurate location information', () => {
      const source = `
        export default async function ServerComponent() {
          const data = await fetch('/api/data').then(r => r.json());
          return <div>{data.title}</div>;
        }
      `;

      const sourceFile = createSourceFile(source);
      const suggestions = detectSuspenseBoundaryIssues(sourceFile, 'test.tsx');

      expect(firstSuggestion(suggestions)?.loc).toBeDefined();
      expect(firstSuggestion(suggestions)?.loc?.file).toBe('test.tsx');
      expect(firstSuggestion(suggestions)?.loc?.range).toBeDefined();
      expect(firstSuggestion(suggestions)?.loc?.range?.from).toBeGreaterThanOrEqual(0);
      expect(firstSuggestion(suggestions)?.loc?.range?.to).toBeGreaterThan(
        firstSuggestion(suggestions)?.loc?.range?.from || 0
      );
    });

    it('handles components with both async keyword and await', () => {
      const source = `
        export async function ServerComponent() {
          const user = await fetchUser();
          const posts = await fetchPosts();
          return <UserDashboard user={user} posts={posts} />;
        }
      `;

      const sourceFile = createSourceFile(source);
      const suggestions = detectSuspenseBoundaryIssues(sourceFile, 'test.tsx');

      expect(suggestions).toHaveLength(2);
      expect(firstSuggestion(suggestions).rule).toBe('suspense-boundary-missing');
      expect(suggestionAt(suggestions, 1).rule).toBe('suspense-boundary-opportunity');
    });

    it('handles multiple exported components', () => {
      const source = `
        export async function Component1() {
          const data = await getData();
          return <div>{data}</div>;
        }
        
        export async function Component2() {
          const user = await getUser();
          const posts = await getPosts();
          return <div>{user} {posts}</div>;
        }
      `;

      const sourceFile = createSourceFile(source);
      const suggestions = detectSuspenseBoundaryIssues(sourceFile, 'test.tsx');

      expect(suggestions).toHaveLength(3);
      // Component1: 1 suggestion (missing boundary)
      // Component2: 2 suggestions (missing boundary + opportunity)
    });
  });

  describe('real-world patterns', () => {
    it('detects in typical Next.js page component', () => {
      const source = `
        export default async function Page({ params }: { params: { id: string } }) {
          const product = await db.product.findUnique({
            where: { id: params.id }
          });
          
          return <ProductDetails product={product} />;
        }
      `;

      const sourceFile = createSourceFile(source);
      const suggestions = detectSuspenseBoundaryIssues(sourceFile, 'test.tsx');

      expect(suggestions).toHaveLength(1);
      expect(firstSuggestion(suggestions).rule).toBe('suspense-boundary-missing');
    });

    it('passes for properly structured streaming component', () => {
      const source = `
        export default async function ProductPage() {
          const product = await fetchProduct();
          
          return (
            <div>
              <ProductHeader product={product} />
              <Suspense fallback={<ReviewsSkeleton />}>
                <Reviews productId={product.id} />
              </Suspense>
            </div>
          );
        }
      `;

      const sourceFile = createSourceFile(source);
      const suggestions = detectSuspenseBoundaryIssues(sourceFile, 'test.tsx');

      expect(suggestions).toHaveLength(0);
    });
  });
});
