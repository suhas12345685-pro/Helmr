param(
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'

Write-Host 'Helmr installer'
Write-Host '1. Check Node.js and npm'
Write-Host '2. Invoke create-helmr@latest'
Write-Host '3. Start Hatchery onboarding through the bootstrapper'

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw 'Node.js is required. Install Node.js 22.19.0 or newer first.'
}
$ExecCmd = "npm exec"
$PkgMgr = "npm"

if (Get-Command pnpm -ErrorAction SilentlyContinue) {
  $PkgMgr = "pnpm"
  $ExecCmd = "pnpm dlx"
} elseif (Get-Command npm -ErrorAction SilentlyContinue) {
  $PkgMgr = "npm"
  $ExecCmd = "npm exec"
} else {
  throw 'npm or pnpm is required. Install Node.js/npm or pnpm first.'
}

if ($DryRun) {
  Write-Host "Dry run: would execute $ExecCmd create-helmr@latest -- --dry-run"
  Write-Host 'No packages were installed and no daemon was started.'
} else {
  Write-Host "Executing $ExecCmd create-helmr@latest"
  if ($PkgMgr -eq "pnpm") {
    pnpm dlx create-helmr@latest
  } else {
    npm exec create-helmr@latest
  }
}
