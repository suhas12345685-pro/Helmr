# Marketplace security review

Every marketplace submission is scanned by the Helmr **security scanner**
(`packages/security-scanner`) before it can be installed or published. This
document describes what the scanner checks, how findings are graded, and how the
pipeline turns a scan into a decision.

## The pipeline

```
validate → security scan → contract tests → decision
```

1. **Validate** (`packages/marketplace-submissions` · `validator.ts`) — manifest
   schema, version (semver), supported OS, declared permissions, declared tools,
   required secrets, install commands, health checks, examples, and the presence
   of every declared required file. An invalid manifest fails fast.
2. **Security scan** (`packages/security-scanner` · `scanner.ts`) — the catalog
   below, run line-by-line over every text file, plus permission-mismatch checks.
3. **Contract tests** (`tester.ts`) — dry-run install, manifest contract, health
   check, uninstall, enable/disable, mocked OS detection, no-silent-install, and
   audit-log checks. Untrusted code is **never executed**; install commands are
   modelled.
4. **Decision** (`pipeline.ts`) — `PASS`, `NEEDS_REVIEW`, or `FAIL`.

## What the scanner checks

| Category | Detects | Typical severity |
| --- | --- | --- |
| `secret` | Hard-coded private keys, provider API keys, inline secret literals | critical / high / medium |
| `suspicious-shell` | `curl … \| sh`, `rm -rf`, `sudo`, spawning shells | critical / high / medium |
| `network-access` | Outbound HTTP/WebSocket calls | medium |
| `remote-download` | Fetching remote scripts/binaries/archives | high |
| `filesystem-write` | Writes, especially outside the workspace | high / medium |
| `package-install` | Runtime `npm/pip/gem/cargo/apt` installs | high |
| `postinstall-script` | `pre/postinstall` lifecycle hooks in `package.json` | high |
| `obfuscated-code` | base64/hex decode-and-run, `fromCharCode` blobs | high |
| `unsafe-eval` | `eval`, `new Function`, `vm.runIn…` | high |
| `token-exfiltration` | Reading env secrets / credential files and sending them out | critical |
| `dangerous-permission` | Capabilities that exceed declared permissions | high |
| `permission-mismatch` | Behaviour the manifest did not declare; understated risk | high / medium |

## How findings are graded

Each finding carries:

- a **category** and **severity** (`info` → `low` → `medium` → `high` → `critical`),
- the exact **file and line** when known,
- a redacted **evidence** snippet (never a full secret or file),
- a **suggested fix**, and
- whether the fix is **auto-fixable**.

A scan **passes** only when there are **no high or critical findings**.

## How a scan becomes a decision

| Condition | Decision |
| --- | --- |
| Invalid manifest, or any high/critical finding | `FAIL` → blocked + quarantined |
| Medium findings, manifest warnings, failing tests, or self-declared high risk | `NEEDS_REVIEW` |
| Valid, clean scan, green tests, no warnings | `PASS` |

## When a scan fails

Per policy, on a failed scan Helmr will:

- **not publish** the submission,
- **not install** it by default (it is quarantined),
- **generate a fix report** (`helmr marketplace fix`, `buildFixReport`),
- optionally **apply auto-fixes** to a patched copy (`applyAutoFixes`) — currently
  limited to neutralising inline secret literals, which is safe and reversible,
- **re-run the scan** after fixes, and
- publish **only** after a clean scan **and** maintainer approval.

## Running it

```bash
helmr marketplace scan ./submission     # human-readable report, exit 1 on fail
helmr marketplace fix ./submission      # fix suggestions + auto-fixable count
```

In CI, `scripts/marketplace-pr-scan.mjs` runs the whole pipeline over every
`marketplace/<id>/` directory, comments the report on the PR, applies labels, and
exits non-zero (blocking merge) when any submission has a critical/high finding.
