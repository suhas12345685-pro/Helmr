// The Council reasoning package owns deterministic plan/result orchestration:
// merging sub-agent results into a coherent report. The model-backed Council
// *agent* lives in packages/mastra; this package stays framework-free so it is
// fast to test and safe to replay.
export * from './merge-results.js';
