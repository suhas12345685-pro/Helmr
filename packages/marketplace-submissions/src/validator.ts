import type { ScanFile } from '../../security-scanner/src/index.js';

import {
  safeParseMarketplaceManifest,
  type MarketplaceManifest,
} from './manifest.js';

export interface ValidationIssue {
  field: string;
  message: string;
  severity: 'error' | 'warning';
}

export interface ValidationResult {
  valid: boolean;
  manifest?: MarketplaceManifest;
  issues: ValidationIssue[];
}

/** Manifest files we recognise inside a submission. */
export const MANIFEST_FILENAMES = ['helmr.manifest.json', 'manifest.json', 'skill.json'];

/**
 * Validate a submission's manifest and structure: schema, version, supported OS,
 * permissions, declared tools, required secrets, install commands, health checks,
 * examples/tests, and the presence of every file the manifest says it requires.
 *
 * This is the "contract" stage — it runs before the security scan. A submission
 * that does not even describe itself correctly never reaches scanning.
 */
export function validateSubmission(
  manifestInput: unknown,
  files: ScanFile[],
): ValidationResult {
  const issues: ValidationIssue[] = [];

  const parsed = safeParseMarketplaceManifest(manifestInput);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      issues.push({
        field: issue.path.join('.') || '(root)',
        message: issue.message,
        severity: 'error',
      });
    }
    return { valid: false, issues };
  }

  const manifest = parsed.data;
  const present = new Set(files.map((f) => f.path));

  // Required files must actually exist in the submission.
  for (const required of manifest.requiredFiles) {
    if (!present.has(required)) {
      issues.push({
        field: 'requiredFiles',
        message: `Declared required file is missing from the submission: ${required}`,
        severity: 'error',
      });
    }
  }

  // A capability with no instructions, examples, or tools is almost certainly
  // incomplete — surface it as a warning so reviewers notice.
  if (
    manifest.instructions.trim() === '' &&
    manifest.examples.length === 0 &&
    manifest.declaredTools.length === 0
  ) {
    issues.push({
      field: 'instructions',
      message: 'Submission has no instructions, examples, or declared tools; it may be incomplete.',
      severity: 'warning',
    });
  }

  // High-risk submissions must declare at least one permission, otherwise the
  // risk level and the (empty) capability surface contradict each other.
  if (manifest.riskLevel === 'high' && manifest.permissions.length === 0) {
    issues.push({
      field: 'permissions',
      message: 'Risk level is "high" but no permissions are declared.',
      severity: 'warning',
    });
  }

  // Install commands that pipe a remote download into a shell are rejected at the
  // contract stage — they can never be reviewed safely.
  for (const cmd of manifest.installCommands) {
    if (/\b(?:curl|wget)\b[^\n|]*\|\s*(?:sudo\s+)?(?:ba)?sh\b/.test(cmd)) {
      issues.push({
        field: 'installCommands',
        message: `Install command pipes a remote download into a shell: ${cmd}`,
        severity: 'error',
      });
    }
  }

  // A health check is strongly recommended so Helmr can verify the capability.
  if (manifest.healthChecks.length === 0) {
    issues.push({
      field: 'healthChecks',
      message: 'No health checks declared; Helmr cannot automatically verify this capability.',
      severity: 'warning',
    });
  }

  const hasError = issues.some((i) => i.severity === 'error');
  return { valid: !hasError, manifest, issues };
}
