import { createContext } from 'react';
import type { ReportInsertOptions } from '../../../../shared/report-document-editing';

export type ReportInsertAction = 'paragraph' | 'table' | 'image';
export interface ReportInsertionTarget {
  insert: (kind: ReportInsertAction, options?: ReportInsertOptions) => boolean;
}
/** A transient caret target, never persisted in the report document. */
export const ReportInsertionContext = createContext<((target: ReportInsertionTarget) => void) | null>(null);
