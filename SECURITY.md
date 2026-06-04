# Security Policy

Report security issues privately through the repository owner before public disclosure.

Helmr private APIs must be protected with `HELMR_API_TOKEN` in production or whenever the Gateway is exposed beyond loopback. Use `helmr security audit` and `npm run verify:deployment` before internet exposure.
