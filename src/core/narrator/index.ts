/**
 * Barrel exports for the narrator module.
 */

export type { NarratorProvider, NarrateRequest, NarrateResponse, NarratorModelConfig, NarratorModelParams, CommitEvent, NarrationResult, NarrateCommandOptions, ExplainCommandOptions, NarrateFocus, NarrateFormat } from './types.js'
export { redact, redactAll } from './redact.js'
export type { RedactResult } from './redact.js'
export { recordAudit, withAudit } from './audit.js'
export type { NarratorAuditEntry } from './audit.js'
export { ChattydeerNarratorProvider, createChattydeerProvider, createDisabledProvider } from './chattydeerProvider.js'
export { resolveNarratorProvider, listNarratorConfigs, getNarratorConfigById, getNarratorConfigByName, saveNarratorConfig, deleteNarratorConfig, getActiveNarratorConfig, getActiveNarratorConfigId, setActiveNarratorConfig, clearActiveNarratorConfig, getSetting, setSetting, deleteSetting } from './resolveNarrator.js'
export { runNarrate, runExplain, fetchCommitEvents } from './narrator.js'
