# Architecture

Gateway routes events and exposes HTTP/WebSocket protocol. Council classifies requests, selects skills/providers, estimates risk, builds plans, requests approval, and summarizes outcomes. Governor enforces budgets, tools, channel permissions, workspace locks, kill-switches, retries, rollback, and safe failure. Runtime persists jobs with idempotency, leases, pause/resume, cancellation, approval wait, status streams, receipts, and audit hashes.
