import { ROUTE_WATERFALL_SUGGESTION_RULE } from '@rsc-xray/schemas';
import type { Model, RouteCacheMetadata, Suggestion, Diagnostic } from '@rsc-xray/schemas';

const styles = `
  body {
    font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    background: #0f172a;
    color: #e2e8f0;
    margin: 0;
    padding: 32px;
  }
  h1 {
    margin-bottom: 24px;
  }
  .route {
    background: rgba(148, 163, 184, 0.08);
    border: 1px solid rgba(148, 163, 184, 0.2);
    border-radius: 12px;
    margin-bottom: 24px;
    padding: 16px 20px;
  }
  .route-header {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 12px;
    margin-bottom: 16px;
  }
  .route-chunks {
    font-size: 13px;
    color: rgba(148, 163, 184, 0.8);
  }
  .route-cache-tags {
    margin-top: 8px;
    font-size: 12px;
    color: rgba(148, 163, 184, 0.85);
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    align-items: center;
  }
  .route-cache-tags strong {
    color: rgba(226, 232, 240, 0.85);
    font-weight: 600;
    margin-right: 4px;
  }
  .route-tag-chip {
    background: rgba(56, 189, 248, 0.15);
    border: 1px solid rgba(56, 189, 248, 0.3);
    color: rgba(191, 219, 254, 0.95);
    font-size: 11px;
    padding: 2px 6px;
    border-radius: 999px;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    margin-top: 12px;
  }
  th, td {
    border-bottom: 1px solid rgba(148, 163, 184, 0.15);
    padding: 8px 4px;
    text-align: left;
    font-size: 14px;
  }
  th {
    color: rgba(226, 232, 240, 0.8);
    font-weight: 600;
  }
  .badge {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    background: rgba(148, 163, 184, 0.15);
    border-radius: 999px;
    padding: 2px 10px;
    font-size: 12px;
    color: rgba(226, 232, 240, 0.9);
  }
  .badge.error {
    background: rgba(239, 68, 68, 0.2);
    color: rgb(248, 113, 113);
  }
  .badge.warn {
    background: rgba(249, 115, 22, 0.2);
    color: rgb(251, 191, 36);
  }
  .badge.info {
    background: rgba(56, 189, 248, 0.2);
    color: rgb(125, 211, 252);
  }
  .suggestions-table {
    margin-top: 12px;
    width: 100%;
    border-collapse: collapse;
    font-size: 13px;
  }
  .suggestions-table th,
  .suggestions-table td {
    border-bottom: 1px solid rgba(148, 163, 184, 0.15);
    padding: 6px 4px;
    text-align: left;
  }
  .suggestions-table th {
    text-transform: uppercase;
    letter-spacing: 0.04em;
    font-size: 12px;
    color: rgba(226, 232, 240, 0.7);
  }
  .suggestion-level-error {
    color: rgb(239, 68, 68);
    font-weight: 600;
  }
  .suggestion-level-warn {
    color: rgb(249, 115, 22);
  }
  .suggestion-level-info {
    color: rgb(56, 189, 248);
  }
`;

function formatBytes(bytes?: number): string {
  if (!bytes || bytes <= 0) {
    return '';
  }
  const kilobytes = bytes / 1024;
  if (kilobytes < 1) {
    return `${bytes.toFixed(0)} B`;
  }
  return `${kilobytes.toFixed(kilobytes >= 100 ? 0 : 1)} KB`;
}

function renderDiagnosticsBadge(diagnostics?: Diagnostic[]): string {
  if (!diagnostics || diagnostics.length === 0) {
    return '';
  }
  const hasError = diagnostics.some((item) => item.level === 'error');
  const title = diagnostics
    .map((item) => `${item.level.toUpperCase()}: ${item.message}`)
    .join('\n');
  const level = hasError ? 'error' : 'warn';
  return `<span class="badge ${level}" title="${escapeHtmlAttr(title)}">Issues ${diagnostics.length}</span>`;
}

function renderSuggestionsBadge(suggestions?: Suggestion[]): string {
  if (!suggestions || suggestions.length === 0) {
    return '';
  }
  const hasWarn = suggestions.some((item) => item.level === 'warn');
  const title = suggestions
    .map((item) => `${item.level.toUpperCase()}: ${item.message}`)
    .join('\n');
  return `<span class="badge ${hasWarn ? 'warn' : 'info'}" title="${escapeHtmlAttr(title)}">Suggestions ${suggestions.length}</span>`;
}

function escapeHtmlAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function indentLabel(label: string, depth: number): string {
  if (depth <= 0) {
    return label;
  }
  const padding = '&nbsp;'.repeat(depth * 4);
  return `${padding}${label}`;
}

function renderNodeRows(model: Model, nodeId: string, depth: number): string {
  const node = model.nodes[nodeId];
  if (!node) {
    return '';
  }

  const label = indentLabel(node.file ?? node.name ?? node.id, depth);
  const bytesLabel = formatBytes(node.bytes);
  const diagnostics = renderDiagnosticsBadge(node.diagnostics);
  const suggestions = renderSuggestionsBadge(node.suggestions);

  // Combine diagnostics and suggestions into one cell
  const issues = [diagnostics, suggestions].filter(Boolean).join(' ');

  const currentRow = `<tr>
    <td>${node.kind.toUpperCase()}</td>
    <td>${label}</td>
    <td>${bytesLabel}</td>
    <td>${issues || ''}</td>
  </tr>`;

  const childRows = (node.children ?? [])
    .map((childId) => renderNodeRows(model, childId, depth + 1))
    .join('');

  return `${currentRow}${childRows}`;
}

interface CollectedDiagnostic {
  nodeLabel: string;
  diagnostic: Diagnostic;
}

interface CollectedSuggestion {
  nodeLabel: string;
  suggestion: Suggestion;
}

function collectRouteDiagnostics(model: Model, nodeId: string): CollectedDiagnostic[] {
  const node = model.nodes[nodeId];
  if (!node) {
    return [];
  }

  const nodeLabel = node.file ?? node.name ?? node.id;
  const ownDiagnostics = (node.diagnostics ?? []).map((diagnostic) => ({
    nodeLabel,
    diagnostic,
  }));

  const childDiagnostics = (node.children ?? [])
    .map((childId) => collectRouteDiagnostics(model, childId))
    .flat();

  return [...ownDiagnostics, ...childDiagnostics];
}

function collectRouteSuggestions(model: Model, nodeId: string): CollectedSuggestion[] {
  const node = model.nodes[nodeId];
  if (!node) {
    return [];
  }

  const nodeLabel = node.file ?? node.name ?? node.id;
  const ownSuggestions = (node.suggestions ?? []).map((suggestion) => ({
    nodeLabel,
    suggestion,
  }));

  const childSuggestions = (node.children ?? [])
    .map((childId) => collectRouteSuggestions(model, childId))
    .flat();

  return [...ownSuggestions, ...childSuggestions];
}

function formatDynamicLabel(dynamic: RouteCacheMetadata['dynamic']): string | null {
  if (!dynamic) {
    return null;
  }
  switch (dynamic) {
    case 'force-dynamic':
      return 'Force dynamic';
    case 'force-static':
      return 'Force static';
    case 'error':
      return 'Dynamic error';
    case 'auto':
      return 'Dynamic auto';
    default:
      return dynamic;
  }
}

function renderRouteCacheBadges(cache: RouteCacheMetadata | undefined): string {
  if (!cache) {
    return '';
  }

  const badges: string[] = [];

  if (typeof cache.revalidateSeconds !== 'undefined') {
    const label =
      cache.revalidateSeconds === false ? 'Manual revalidate' : `ISR ${cache.revalidateSeconds}s`;
    badges.push(`<span class="badge info">${label}</span>`);
  }

  const dynamicLabel = formatDynamicLabel(cache.dynamic);
  if (dynamicLabel) {
    badges.push(`<span class="badge info">${dynamicLabel}</span>`);
  }

  if (cache.experimentalPpr) {
    badges.push('<span class="badge info">PPR</span>');
  }

  return badges.join('');
}

function renderRouteCacheTags(cache: RouteCacheMetadata | undefined): string {
  if (!cache?.tags?.length) {
    return '';
  }
  const chips = cache.tags
    .map((tag) => `<span class="route-tag-chip">${escapeHtml(tag)}</span>`)
    .join('');
  return `<div class="route-cache-tags"><strong>Cache tags:</strong>${chips}</div>`;
}

export function renderHtmlReport(model: Model): string {
  const routeSections = model.routes
    .map((route) => {
      const node = model.nodes[route.rootNodeId];
      const rows = (node?.children ?? [])
        .map((childId) => renderNodeRows(model, childId, 0))
        .join('');

      const collectedDiagnostics = collectRouteDiagnostics(model, route.rootNodeId);
      const collectedSuggestions = collectRouteSuggestions(model, route.rootNodeId);
      const routeWaterfall = node?.suggestions?.find(
        (suggestion) => suggestion.rule === ROUTE_WATERFALL_SUGGESTION_RULE
      );
      const waterfallBadge = routeWaterfall
        ? `<span class="badge warn" title="${escapeHtmlAttr(routeWaterfall.message)}">Waterfall suspected</span>`
        : '';
      const cacheBadges = renderRouteCacheBadges(route.cache);

      const diagnosticsTable = collectedDiagnostics.length
        ? `<h3 style="margin-top: 24px; margin-bottom: 12px; font-size: 16px;">Diagnostics (${collectedDiagnostics.length})</h3>
           <table class="suggestions-table">
            <thead>
              <tr>
                <th>Rule</th>
                <th>Level</th>
                <th>Location</th>
                <th>Message</th>
                <th>Node</th>
              </tr>
            </thead>
            <tbody>
              ${collectedDiagnostics
                .map(({ nodeLabel, diagnostic }) => {
                  const loc = diagnostic.loc
                    ? `${diagnostic.loc.file}:${diagnostic.loc.range.from}-${diagnostic.loc.range.to}`
                    : 'n/a';
                  const levelClass = `suggestion-level-${diagnostic.level}`;
                  return `<tr>
                    <td>${escapeHtml(diagnostic.rule)}</td>
                    <td class="${levelClass}">${diagnostic.level.toUpperCase()}</td>
                    <td>${escapeHtml(loc)}</td>
                    <td>${escapeHtml(diagnostic.message)}</td>
                    <td>${escapeHtml(nodeLabel)}</td>
                  </tr>`;
                })
                .join('')}
            </tbody>
          </table>`
        : '';

      const suggestionsTable = collectedSuggestions.length
        ? `<h3 style="margin-top: 24px; margin-bottom: 12px; font-size: 16px;">Suggestions (${collectedSuggestions.length})</h3>
           <table class="suggestions-table">
            <thead>
              <tr>
                <th>Rule</th>
                <th>Level</th>
                <th>Location</th>
                <th>Message</th>
                <th>Node</th>
              </tr>
            </thead>
            <tbody>
              ${collectedSuggestions
                .map(({ nodeLabel, suggestion }) => {
                  const loc = suggestion.loc
                    ? `${suggestion.loc.file}:${suggestion.loc.range.from}-${suggestion.loc.range.to}`
                    : 'n/a';
                  const levelClass = `suggestion-level-${suggestion.level}`;
                  return `<tr>
                    <td>${escapeHtml(suggestion.rule)}</td>
                    <td class="${levelClass}">${suggestion.level.toUpperCase()}</td>
                    <td>${escapeHtml(loc)}</td>
                    <td>${escapeHtml(suggestion.message)}</td>
                    <td>${escapeHtml(nodeLabel)}</td>
                  </tr>`;
                })
                .join('')}
            </tbody>
          </table>`
        : '';

      const noIssuesMessage =
        !collectedDiagnostics.length && !collectedSuggestions.length
          ? '<p style="margin-top: 12px; font-size: 13px; color: rgba(148, 163, 184, 0.75);">No issues found for this route.</p>'
          : '';

      const chunkLabel = route.chunks?.join(', ') ?? 'n/a';
      const bytesLabel = formatBytes(route.totalBytes);

      return `<section class="route">
        <div class="route-header">
          <h2>${route.route}</h2>
          <span class="route-chunks">${chunkLabel}</span>
          <span class="badge">${node?.kind.toUpperCase()}</span>
          <span class="badge">${bytesLabel || '0 KB'}</span>
          ${cacheBadges}
          ${waterfallBadge}
        </div>
        ${renderRouteCacheTags(route.cache)}
        <table>
          <thead>
            <tr>
              <th>Kind</th>
              <th>File</th>
              <th>Bytes</th>
              <th>Issues</th>
            </tr>
         </thead>
         <tbody>${rows}
          </tbody>
       </table>
        ${diagnosticsTable}
        ${suggestionsTable}
        ${noIssuesMessage}
      </section>`;
    })
    .join('\n');

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>RSC XRay Report</title>
    <style>${styles}</style>
  </head>
  <body>
    <h1>RSC XRay Report</h1>
    ${routeSections}
  </body>
</html>`;
}
