# Bug reporting

Helmr treats bugs as first-class, triagable work items. A bug moves through a
fixed, safe pipeline:

```
report → triage (classify + reproducibility) → reproduce → fix → test → PR
```

The triage logic lives in `packages/bug-triage`; the CLI drives the side
effects (writing tests, preparing branches, scaffolding PRs).

## Reporting a bug

```bash
helmr bugs report \
  --title "Skill crashes on install" \
  --description "Installing weather-fetch throws" \
  --step "helmr marketplace submit ./weather-fetch" \
  --step "helmr marketplace approve weather-fetch" \
  --expected "the skill installs" \
  --actual "an unhandled exception" \
  --capability weather-fetch
```

On report, Helmr automatically:

- **classifies severity** — `critical`, `high`, `medium`, or `low`, from signals
  in the title/description (e.g. "leak", "exfiltration", "data loss" →
  `critical`; "crash", "cannot install", "hang" → `high`);
- **assesses reproducibility** — do we have steps plus an expected/actual? If
  not, the bug is labelled `needs-reproduction` and you are told exactly what is
  missing;
- **labels** the report (`bug`, `severity:…`, `needs-reproduction`,
  `marketplace`).

## Reproducing

```bash
helmr bugs reproduce <id>
```

When the report is reproducible, Helmr writes a **failing regression test** that
encodes the steps and the expected/actual behaviour. The test fails until the
bug is fixed, so it becomes the definition of done.

## Checking whether it is safe to auto-fix

```bash
helmr bugs scan <id>
```

Helmr only opens a fix automatically when the bug is **reproducible** and **not
security-critical**. Critical/security bugs always require a human in the loop
before any automated change.

## Preparing a fix

```bash
helmr bugs fix <id>
```

This derives a branch name (`bugfix/<id>-<slug>`), records it, and points you at
the failing test. Implement the fix, run `npm run verify`, and confirm the
regression test now passes.

## Opening the PR

```bash
helmr bugs create-pr <id>
```

This scaffolds the branch, title, and body for the fix PR. **All checks must
pass before the PR is opened.** If the bug touches a marketplace submission, the
marketplace security workflow re-scans it as part of the PR.

## GitHub automation

When a bug is reported through GitHub, the automation:

- classifies severity and labels the issue,
- asks for a reproduction when one is missing,
- generates a failing test when possible,
- opens a fix branch **only when safe**, and
- runs all checks before any PR is opened.
