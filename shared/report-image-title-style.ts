import type { FieldDefinition, StyleOverride } from './types';

/** Explicit report edits override only selected properties, retaining source title styling. */
export function reportImageTitleStyle(field: FieldDefinition, inherited?: StyleOverride): StyleOverride | undefined {
  return field.report_image_title_style ? { ...inherited, ...field.report_image_title_style } : inherited;
}
