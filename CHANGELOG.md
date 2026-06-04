# Changelog

## Unreleased

- Added **Skill Guard**: a static security scanner, Ed25519 skill signing/verification, and a combined admit/quarantine/block trust gate for runtime-loaded skills (`@helmr/skills`).
- Added `helmr skills scan|keygen|sign|verify` CLI commands and `SkillRegistry.scan`/`listUntrusted`/`listTrustedEnabled`.
- Fixed an unresolved merge conflict in `package.json` that broke installs and builds.

## 1.0.0

- Added Gateway protocol schemas and contract tests.
- Added fail-closed security policy, security audit command, and exposure docs.
- Expanded dynamic skill manifests, registry quarantine, CLI skill management, and starter skills.
- Added plugin/provider SDK skeletons and channel/runtime/governor contracts.
- Modernized package metadata, CI, deployment templates, and product documentation.
