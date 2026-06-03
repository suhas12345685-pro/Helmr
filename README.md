# Helmr

Helmr is a self-hosted, TypeScript-first dynamic agent runtime. It does not
operate as one fixed assistant: for every task, Helmr assembles the right
identity, skills, tools, memory context, decision strategy, sub-agents, execution
method, safety policy, and verification process. Skills are discovered and loaded
at runtime rather than hardcoded, so the agent can morph into the operational form
the situation requires.

## Install Helmr

You can install Helmr using npm/pnpm or one-liners.

### Option 1: npm / pnpm

```bash
npm i -g helmr
# or
pnpm i -g helmr
```

### Option 2: One-liners

**Windows (PowerShell)**
```powershell
powershell -c "irm https://helmr.ai/install.ps1 | iex"
```

**macOS and Linux**
```bash
curl -fsSL https://helmr.ai/install.sh | bash
```

## Beta

```bash
# Install Helmr
npm i -g helmr

# Meet your lobster
helmr onboard
```
