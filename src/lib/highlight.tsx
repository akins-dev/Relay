/**
 * highlight(text, query)
 *
 * Splits `text` on every occurrence of `query` (case-insensitive) and returns
 * an array of React nodes where each match is wrapped in a styled <mark>.
 *
 * Used the same way Algolia InstantSearch / GitHub / Linear do it:
 *   pure client-side post-processing, zero extra network calls.
 */
import type { ReactNode } from 'react';

export function highlight(text: string, query: string): ReactNode[] {
  if (!query.trim() || !text) return [text];

  // Escape regex special chars in the user's query
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex   = new RegExp(`(${escaped})`, 'gi');
  const parts   = text.split(regex);

  return parts.map((part, i) =>
    regex.test(part)
      ? <mark
          key={i}
          className="bg-transparent text-[#22d3ee] font-semibold not-italic"
        >
          {part}
        </mark>
      : part
  );
}
