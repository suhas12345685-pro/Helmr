# Windows Service Guidance

Use WSL2 for production-like Helmr deployments. For a native scheduled task, run PowerShell as Administrator and create a task that launches `node dist/src/cli.js start gateway` with explicit environment variables loaded from a protected profile script.
