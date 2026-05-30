import type { Tool } from '@mastra/core/tools';

export interface ToolSummary {
  name: string;
  summary: string;
  keywords?: string[];
}

export interface ToolSelectionOptions {
  maxTools?: number;
}

export function selectRelevantTools<T extends Tool>(
  tools: Record<string, T>,
  query: string,
  summaries: ToolSummary[] = [],
  options: ToolSelectionOptions = {},
): Record<string, T> {
  const maxTools = options.maxTools ?? 8;
  const terms = tokenize(query);
  const summaryByName = new Map(summaries.map((summary) => [summary.name, summary]));

  return Object.fromEntries(
    Object.entries(tools)
      .map(([name, tool]) => {
        const summary = summaryByName.get(name);
        const haystack = tokenize([
          name,
          summary?.summary ?? '',
          ...(summary?.keywords ?? []),
        ].join(' '));
        const score = [...terms].reduce((total: number, term: string) => total + (haystack.has(term) ? 1 : 0), 0);
        return { name, tool, score };
      })
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
      .slice(0, maxTools)
      .map((entry) => [entry.name, entry.tool]),
  );
}

function tokenize(value: string): Set<string> {
  return new Set(value.toLowerCase().match(/[a-z0-9_/-]{3,}/g) ?? []);
}
