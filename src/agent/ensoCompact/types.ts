export interface CompactBranchEntry {
  type?: string;
  message?: {
    role?: string;
    content?: unknown;
    toolCallId?: string;
    tool_call_id?: string;
  };
}

export interface CompactFacts {
  goal: string;
  constraints: string[];
  errors: string[];
  files: string[];
  openLoops: string[];
}

export interface CompactSummaryModelRef {
  provider: string;
  id: string;
}

export interface EnsoCompactOptions {
  mode?: 'auto' | 'fast' | 'balanced' | 'thorough';
  summaryModel?: CompactSummaryModelRef | null;
}
