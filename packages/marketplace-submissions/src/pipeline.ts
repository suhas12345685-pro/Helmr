import {
  SecurityScanner,
  type ScanFile,
  type ScanResult,
} from '../../security-scanner/src/index.js';

import { validateSubmission, type ValidationResult } from './validator.js';
import { runSubmissionTests, type TestSuiteResult } from './tester.js';
import type { MarketplaceManifest } from './manifest.js';
import type { TrustLevel } from './trust.js';

export type Decision = 'PASS' | 'FAIL' | 'NEEDS_REVIEW';

export interface PipelineResult {
  decision: Decision;
  validation: ValidationResult;
  scan: ScanResult;
  tests: TestSuiteResult;
  /** The trust level a PASS/NEEDS_REVIEW item starts at before maintainer review. */
  suggestedTrust: TrustLevel;
  /** Human-readable reasons that drove the decision. */
  reasons: string[];
}

const scanner = new SecurityScanner();

/**
 * The full submission pipeline: validate → security scan → contract tests →
 * decision. This is the single source of truth that the CLI, the GitHub
 * automation, and the Hatchery upload form all call, so a submission is judged
 * identically no matter how it arrived.
 *
 * Decision rules:
 *  - FAIL         — invalid manifest, OR a high/critical security finding. The
 *                   submission is blocked and quarantined; nothing publishes.
 *  - NEEDS_REVIEW — clean-but-not-clean-enough: medium findings, failing contract
 *                   tests, or high self-declared risk. A maintainer must review.
 *  - PASS         — valid, no high/critical findings, tests green. Installable as
 *                   "community" (basic scan) pending optional maintainer
 *                   verification to reach "verified".
 */
export function runPipeline(manifestInput: unknown, files: ScanFile[]): PipelineResult {
  const reasons: string[] = [];
  const validation = validateSubmission(manifestInput, files);

  // Without a valid manifest we cannot scan meaningfully — fail fast.
  if (!validation.valid || !validation.manifest) {
    const emptyScan = scanner.scanFiles(files);
    reasons.push('Manifest validation failed.');
    for (const issue of validation.issues.filter((i) => i.severity === 'error')) {
      reasons.push(`${issue.field}: ${issue.message}`);
    }
    return {
      decision: 'FAIL',
      validation,
      scan: emptyScan,
      tests: { passed: false, cases: [] },
      suggestedTrust: 'quarantined',
      reasons,
    };
  }

  const manifest: MarketplaceManifest = validation.manifest;
  const scan = scanner.scanFiles(files, {
    permissions: manifest.permissions,
    riskLevel: manifest.riskLevel,
    declaredTools: manifest.declaredTools,
  });
  const tests = runSubmissionTests(manifest, files);

  // FAIL: any high or critical security finding blocks the submission outright.
  if (scan.counts.critical > 0 || scan.counts.high > 0) {
    reasons.push(
      `Security scan failed: ${scan.counts.critical} critical, ${scan.counts.high} high finding(s).`,
    );
    return {
      decision: 'FAIL',
      validation,
      scan,
      tests,
      suggestedTrust: 'quarantined',
      reasons,
    };
  }

  // NEEDS_REVIEW: medium findings, failing tests, manifest warnings, or
  // self-declared high risk all require a maintainer's eyes before publishing.
  const warnings = validation.issues.filter((i) => i.severity === 'warning');
  if (scan.counts.medium > 0) reasons.push(`${scan.counts.medium} medium security finding(s).`);
  if (!tests.passed) {
    reasons.push(
      `Contract tests failed: ${tests.cases.filter((c) => !c.passed).map((c) => c.name).join(', ')}.`,
    );
  }
  if (warnings.length > 0) reasons.push(`${warnings.length} manifest warning(s).`);
  if (manifest.riskLevel === 'high') reasons.push('Author self-declared high risk.');

  if (reasons.length > 0) {
    return {
      decision: 'NEEDS_REVIEW',
      validation,
      scan,
      tests,
      suggestedTrust: 'experimental',
      reasons,
    };
  }

  // PASS: clean scan, green tests, no warnings.
  reasons.push('Clean scan, contract tests passed, no manifest warnings.');
  return {
    decision: 'PASS',
    validation,
    scan,
    tests,
    suggestedTrust: 'community',
    reasons,
  };
}
