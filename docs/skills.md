# Skills

Helmr skills are runtime-loaded capability manifests. A skill can describe triggers, instructions, permissions, tools, input/output schemas, required secrets, health checks, runtime constraints, risk, approvals, examples, tests, and checksum/signature placeholders.

Commands: `helmr skills list`, `inspect`, `enable`, `disable`, `doctor`, and `validate`.

## Skill Guard: supply-chain defense

OpenClaw-style marketplaces ship thousands of unvetted, unsigned skills — field scans have found roughly a quarter of them carrying exploitable patterns, and nothing ties a skill on disk to the author who published it. Skill Guard closes both gaps so a malicious or tampered skill never reaches execution.

It has three layers, all available in code (`@helmr/skills`) and on the CLI:

1. **Static security scanner** (`scanSkill`) inspects a manifest's instructions, examples, and tool descriptions for dangerous patterns — remote-code pipes (`curl … | bash`), destructive filesystem ops, privilege escalation, secret exfiltration, known exfiltration sinks, prompt-injection phrasing, reverse shells, and dynamic `eval`. It also catches *structural* risk: sensitive permissions with an under-declared `riskLevel`, high-risk skills granted unfettered network access, and high-risk skills exposing auto-approved tools. Each finding has a rule id, severity, and matched evidence, plus an aggregate 0–100 risk score.

2. **Cryptographic signing** (`signSkill` / `verifySkillSignature`) binds a manifest to an Ed25519 author key. The signature covers a deterministic, canonical digest of the security-relevant fields (operational metadata like timestamps and `enabled` are excluded), so any post-signing tamper is detected as a checksum mismatch. Verification returns one of `valid`, `unsigned`, `untrusted`, `tampered`, or `invalid`.

3. **Trust gate** (`evaluateSkillTrust`) fuses scan + signature into one `admit` / `quarantine` / `block` decision that the registry (`SkillRegistry.scan`, `listUntrusted`, `listTrustedEnabled`) and the Governor consult before a skill runs. Critical scan findings and integrity tampering hard-block; medium/high findings, invalid/untrusted signatures, and (under a strict policy) unsigned skills are quarantined.

### CLI

```bash
helmr skills keygen          # generate an Ed25519 author key (private + trusted public)
helmr skills sign <path> <key.pem>   # sign a skill manifest in place
helmr skills verify <path>   # check a skill's integrity and signature
helmr skills scan            # scan & verify every installed skill
```

`skills scan` exits `0` (all admitted), `1` (something quarantined), or `2` (something blocked), so it drops cleanly into CI.

### Configuration

- `HELMR_REQUIRE_SIGNED_SKILLS=true` — quarantine unsigned skills (signatures become mandatory).
- Trusted author public keys are loaded from `<configDir>/trusted-keys/*.pem` and from inline PEM in `HELMR_TRUSTED_SKILL_KEYS`.
- `HELMR_SKILL_SIGNING_KEY` — default private key path for `helmr skills sign`.

`helmr skills keygen` writes the private key (mode `0600`) under `<configDir>/skill-keys/` and the matching public key into `<configDir>/trusted-keys/`, so a freshly generated key is trusted immediately.
