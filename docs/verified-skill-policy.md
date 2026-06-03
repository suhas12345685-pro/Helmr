# Verified skill policy

Trust level is the single most important signal a marketplace item carries. It
answers: *how much has Helmr vouched for this, and what is it allowed to do on
install?* The policy is enforced in code (`packages/marketplace-submissions` ·
`trust.ts`), not just documented here.

## Trust levels

| Level | Meaning | Installable | Warn on install | May auto-enable |
| --- | --- | --- | --- | --- |
| `official` | Maintained by the Helmr core team | ✅ | no | low/medium risk |
| `verified` | Passed security scan **and** maintainer review | ✅ | no | low risk only |
| `community` | Passed a basic scan but not officially verified | ✅ | ⚠️ yes | never |
| `experimental` | Installable only with an explicit warning | ✅ | ⚠️ yes | never |
| `quarantined` | Failed a scan or is broken | ❌ | ⚠️ yes | never |
| `blocked` | Known malicious or dangerous | ❌ | ⚠️ yes | never |

## The core safety rules

1. **Nothing publishes without validation.** Direct publishing to the official
   marketplace is impossible; every item goes through the pipeline.
2. **Failed scans are quarantined.** A high/critical finding → `quarantined`,
   not installable through normal flows.
3. **Never auto-enable a community skill after install** unless it is `verified`
   *and* low risk. `community` and `experimental` items are installed disabled.
4. **High-risk skills always require explicit owner approval** before they are
   enabled — regardless of trust level. There is no path that auto-enables a
   high-risk capability.

These rules are implemented by `shouldAutoEnable(trust, risk)`:

| Trust \ Risk | low | medium | high |
| --- | --- | --- | --- |
| `official` | auto | auto | **approval** |
| `verified` | auto | **approval** | **approval** |
| `community` | **approval** | **approval** | **approval** |
| `experimental` | **approval** | **approval** | **approval** |
| `quarantined` / `blocked` | never installable | — | — |

## How an item earns a higher trust level

```
submit → PASS → community (unverified)
       → maintainer approve + clean scan → verified
```

- A clean `PASS` starts an item at **community**.
- A maintainer running `helmr marketplace approve <id>` on an item with a clean
  scan promotes it to **verified**.
- Only **verified** (or **official**) items publish via
  `helmr marketplace publish <id>`, and only after approval.
- `helmr marketplace reject <id>` moves an item to **blocked**.
- `helmr marketplace quarantine <id>` moves an item to **quarantined**.

## What every marketplace item shows

Each item surfaces, in the CLI and the Hatchery UI:

source · author · trust level · risk level · permissions · scan status ·
last-scanned date · install count · known issues · bug reports · changelog.

This metadata is the durable `SubmissionRecord`, served at `/api/marketplace`.
