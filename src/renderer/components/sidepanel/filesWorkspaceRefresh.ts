import type { FilesReadRelResult } from '@shared/types/filesWorkspace';

export async function readWorkspaceDocument(
  read: () => Promise<FilesReadRelResult>,
  state: () => { revision: number; migrating: boolean }
): Promise<FilesReadRelResult | null> {
  const { revision, migrating } = state();
  if (migrating) return null;
  const result = await read();
  const current = state();
  return current.migrating || current.revision !== revision ? null : result;
}

export interface WorkspaceDocument {
  contents: string;
  draft: string;
  version: number;
  dirty: boolean;
  conflict: boolean;
  tooLarge?: boolean;
}

export function refreshWorkspaceDocument<T extends WorkspaceDocument>(
  doc: T,
  content: string | null
): T {
  if (content === null) return { ...doc, conflict: true };
  if (doc.dirty) {
    return content !== doc.contents && content !== doc.draft ? { ...doc, conflict: true } : doc;
  }
  if (content === doc.draft && !doc.tooLarge) return doc;
  return {
    ...doc,
    contents: content,
    draft: content,
    version: doc.version + 1,
    conflict: false,
    tooLarge: false,
  };
}
