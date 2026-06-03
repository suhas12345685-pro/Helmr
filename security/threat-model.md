# Helmr Threat Model

Primary threats: unauthenticated Gateway exposure, malicious channel input, prompt/tool injection, leaked provider keys, unsafe tools, runaway spend, tampered audit logs, weak backups, and malicious skills/plugins.

Controls: fail-closed auth, explicit dev override, approval gates, budgets, channel allowlists, permissions, receipts, rollback, audit hashes, secret redaction, security doctor checks, and future signatures.
