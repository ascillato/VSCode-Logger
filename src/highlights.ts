/**
 * @file highlights.ts
 * @brief Shared interface for highlight entries stored per log panel.
 */

export interface HighlightDefinition {
    id: number;
    key: string;
    baseColor: string;
    color: string;
    backgroundColor: string;
}
