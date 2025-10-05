import { MockDiagnostic } from './CodeMirrorEditor';

/**
 * Helper to calculate character offset from line/column position
 */
export function getOffsetFromPosition(
  code: string,
  line: number, // 1-based
  column: number // 0-based
): number {
  const lines = code.split('\n');
  let offset = 0;

  for (let i = 0; i < line - 1 && i < lines.length; i++) {
    const currentLine = lines[i] ?? '';
    offset += currentLine.length + 1; // +1 for newline
  }

  return offset + column;
}

/**
 * Helper to find text in code and return diagnostic range
 */
export function findTextDiagnostic(
  code: string,
  searchText: string,
  severity: 'error' | 'warning' | 'info',
  message: string,
  source?: string
): MockDiagnostic | null {
  const index = code.indexOf(searchText);
  if (index === -1) return null;

  return {
    from: index,
    to: index + searchText.length,
    severity,
    message,
    ...(source ? { source } : {}),
  };
}

/**
 * Helper to find all occurrences and create diagnostics
 */
export function findAllTextDiagnostics(
  code: string,
  searchText: string,
  severity: 'error' | 'warning' | 'info',
  message: string,
  source?: string
): MockDiagnostic[] {
  const diagnostics: MockDiagnostic[] = [];
  let startIndex = 0;

  while (true) {
    const index = code.indexOf(searchText, startIndex);
    if (index === -1) break;

    diagnostics.push({
      from: index,
      to: index + searchText.length,
      severity,
      message,
      ...(source ? { source } : {}),
    });

    startIndex = index + searchText.length;
  }

  return diagnostics;
}

/**
 * Helper to create diagnostics for a line range
 */
export function createLineDiagnostic(
  code: string,
  startLine: number, // 1-based
  endLine: number, // 1-based
  severity: 'error' | 'warning' | 'info',
  message: string,
  source?: string
): MockDiagnostic | null {
  const lines = code.split('\n');
  if (startLine < 1 || startLine > lines.length) return null;

  const from = getOffsetFromPosition(code, startLine, 0);
  const to = getOffsetFromPosition(code, Math.min(endLine + 1, lines.length + 1), 0);

  return {
    from,
    to: Math.min(to, code.length),
    severity,
    message,
    ...(source ? { source } : {}),
  };
}
