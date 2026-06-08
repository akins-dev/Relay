/**
 * intent-classifier.ts
 *
 * Heuristic knowledge-vs-action gate for MCP search_tools.
 * REST/CLI search skips this — developers expect raw search results.
 */

const KNOWLEDGE_PATTERNS = [
  /(what|who|when|where|why|how)\s+(is|are|was|were|does|do|did|has|have|can|could|would|should|will)\b/i,
  /(explain|define|describe|tell me about|what does .+ mean|what is the difference)\b/i,
  /(compare|vs\.?|versus|difference between|which is better)\b/i,
  /(calculate|compute|solve|what is \d|convert \d)/i,
  /(history of|background on|overview of|introduction to)\b/i,
];

const ACTION_PATTERNS = [
  /\b(send|create|delete|update|fetch|get|post|push|pull|deploy|run|execute|invoke|call|trigger|schedule|notify|email|message|upload|download|save|store|insert|query)\b/i,
];

/** True when the intent looks like general knowledge, not an external tool action. */
export function looksLikeKnowledgeOnly(intent: string): boolean {
  return KNOWLEDGE_PATTERNS.some(p => p.test(intent))
    && !ACTION_PATTERNS.some(p => p.test(intent));
}

export function classifyIntent(intent: string): 'knowledge' | 'action' {
  return looksLikeKnowledgeOnly(intent) ? 'knowledge' : 'action';
}
