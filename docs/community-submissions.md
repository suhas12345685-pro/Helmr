# Community submissions

Helmr is meant to grow. Anyone — a Helmr user or an external developer — can
contribute new capabilities to the **Helmr Marketplace**: skills, toolpacks,
channels, providers, workflows, agents, policies, templates, plus bug reports
and fixes.

But growth must never compromise safety. **Nobody can publish directly to the
official marketplace.** Every submission goes through validation, a security
scan, contract tests, and a decision before it can be installed — and even then
a community submission is *unverified* until a maintainer reviews it.

This document is the contributor's guide. For the reviewer's view of what the
scanner checks, see [marketplace-security-review.md](./marketplace-security-review.md).
For the trust model, see [verified-skill-policy.md](./verified-skill-policy.md).

## What you can submit

| Kind | What it is |
| --- | --- |
| `skill` | A declarative capability the agents discover and use |
| `toolpack` | A bundle of tools |
| `channel` | A communication channel integration |
| `provider` | A model/provider integration |
| `workflow` | A reusable multi-step workflow |
| `agent` | A specialised agent definition |
| `policy` | A standing-approval / safety policy |
| `template` | A project or capability template |
| bug report | A problem report (see [bug-reporting.md](./bug-reporting.md)) |
| fix / patch | A change that resolves a bug |

## Three ways to submit

### 1. GitHub PR (recommended)

Add your submission under `marketplace/<id>/` and open a PR. The
**Marketplace security** workflow automatically validates, scans, tests, and
comments a report on your PR, and labels it. Critical/high findings block merge.

### 2. Marketplace upload form

The Hatchery UI exposes an upload form that runs the exact same pipeline before
anything is stored. Failed submissions are quarantined, not published.

### 3. CLI

```bash
helmr marketplace submit ./my-skill
helmr marketplace submit github:owner/repo
```

## The submission contract (manifest)

Every submission needs a manifest (`helmr.manifest.json`, `manifest.json`, or
`skill.json`):

```json
{
  "id": "my-skill",
  "name": "My Skill",
  "description": "What it does",
  "kind": "skill",
  "version": "1.0.0",
  "author": "your-handle",
  "supportedOS": ["any"],
  "permissions": ["network"],
  "riskLevel": "low",
  "declaredTools": ["http_request"],
  "requiredSecrets": ["MY_API_KEY"],
  "installCommands": [],
  "healthChecks": ["helmr self-test my-skill"],
  "examples": ["my-skill: do the thing"],
  "requiredFiles": ["index.js"],
  "instructions": "How the agent should use this skill.",
  "changelog": ["1.0.0 — initial submission"]
}
```

Key rules:

- **Declare everything you use.** If your code makes network calls, declare the
  `network` permission. Undeclared capabilities are flagged as a *permission
  mismatch* and send the submission to review.
- **No secrets in code.** Declare them in `requiredSecrets` and read them at
  runtime. Hard-coded keys fail the scan.
- **No remote install scripts.** `curl … | sh` style install commands are
  rejected outright.
- **Be honest about risk.** Understating `riskLevel` is detected and surfaced.

## What happens to your submission

```
submit → validate → security scan → contract tests → decision
```

| Decision | Meaning | Result |
| --- | --- | --- |
| `PASS` | Valid, clean scan, tests green | Installable as **community** (unverified); eligible for maintainer verification |
| `NEEDS_REVIEW` | Medium findings, warnings, failing tests, or self-declared high risk | A maintainer must review before publish |
| `FAIL` | Invalid manifest or a high/critical finding | **Blocked and quarantined**; a fix report is generated |

A community skill is **never auto-enabled** after install. High-risk skills
**always** require explicit owner approval. See the trust policy for details.

## Fixing a failed submission

```bash
helmr marketplace scan ./my-skill      # see the findings
helmr marketplace fix ./my-skill       # get fix suggestions + auto-fixable count
```

Address the findings, re-run `scan` until it is clean, then re-submit. Only a
clean scan **and** maintainer approval can publish.
