param(
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'

Write-Host 'Helmr installer'
Write-Host '1. Check Node.js and npm'
Write-Host '2. Invoke create-helmr@latest'
Write-Host '3. Start Hatchery onboarding through the bootstrapper'

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw 'Node.js is required. Install Node.js 18 or newer first.'
}
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
  throw 'npm is required. Install Node.js/npm first.'
}

if ($DryRun) {
  Write-Host 'Dry run: would execute npm exec create-helmr@latest -- --dry-run'
  Write-Host 'No packages were installed and no daemon was started.'
} else {
  Write-Host 'Executing npm exec create-helmr@latest'
  npm exec create-helmr@latest
}
