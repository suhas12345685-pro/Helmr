# Gateway Protocol

The Gateway protocol is a typed envelope used by HTTP/WebSocket clients and future channel adapters.

Every message includes `id`, `type`, `protocolVersion`, `timestamp`, `requestId` or `correlationId`, optional `principal`, optional `idempotencyKey`, and `payload`.

Supported message types: `HELLO`, `AUTH`, `HEARTBEAT`, `EVENT`, `REQUEST`, `RESPONSE`, `ERROR`, `APPROVAL_REQUEST`, `APPROVAL_DECISION`, `JOB_STATUS`, `CHANNEL_EVENT`, `TOOL_RECEIPT`, and `AUDIT_EVENT`.

Side-effecting messages such as `REQUEST`, `EVENT`, and `APPROVAL_DECISION` require `idempotencyKey` so retries are safe.

WebSocket flow:

1. Server sends `HELLO` with protocol version and capabilities.
2. Client sends `AUTH` when a Gateway token is configured.
3. Client sends `HEARTBEAT` for liveness or `REQUEST` for job status.
4. Server rejects invalid JSON/schema/protocol with typed `ERROR` envelopes.
