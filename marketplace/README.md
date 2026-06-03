# Helmr Marketplace submissions

Each subdirectory here is one community submission to the Helmr Marketplace. A
submission is a self-contained capability — a **skill, toolpack, channel,
provider, workflow, agent, policy, or template** — plus a manifest that declares
what it is, what it needs, and how risky it is.

## Layout

```
marketplace/
  <id>/
    helmr.manifest.json   # required — the submission contract
    <code/assets...>      # the capability itself
    README.md             # optional human description
```

The manifest filename may be `helmr.manifest.json`, `manifest.json`, or
`skill.json`. See `example-skill/` for a minimal, clean template.

## How submissions are reviewed

Every PR that touches `marketplace/**` is automatically:

1. **validated** — manifest schema, version, supported OS, permissions, declared
   tools, required secrets, install commands, health checks, examples;
2. **security-scanned** — secrets, suspicious shell, network/filesystem access,
   dependency/package installs, dangerous permissions, obfuscation, postinstall
   scripts, remote downloads, token exfiltration, unsafe eval, and permission
   mismatches;
3. **tested** — dry-run install, manifest contract, health check, uninstall,
   enable/disable, OS detection, no-silent-install, and audit-log checks;
4. **decided** — `PASS`, `NEEDS_REVIEW`, or `FAIL`.

A scan report is commented on the PR and the PR is labelled. **Critical or high
findings block merge.** Nothing publishes to the official marketplace without a
clean scan **and** maintainer approval.

You can run the same checks locally:

```bash
helmr marketplace scan ./marketplace/example-skill
helmr marketplace submit ./marketplace/example-skill
helmr marketplace fix ./marketplace/example-skill
```

See [`docs/community-submissions.md`](../docs/community-submissions.md) for the
full submission guide and [`docs/marketplace-security-review.md`](../docs/marketplace-security-review.md)
for what the scanner checks.
