# Helmr one-line installer for Windows PowerShell.
# Usage:
#   powershell -c "irm https://helmr.ai/install.ps1 | iex"
#   powershell -c "irm https://helmr.ai/install.ps1 | iex" --dry-run
#
# Flags:
#   -DryRun     Print what would happen without making changes.
#   -NoOpen     Do not open the Hatchery WebUI when setup completes.

[CmdletBinding()]
param(
  [switch]$DryRun,
  [switch]$NoOpen
)

$ErrorActionPreference = 'Stop'
$MinNodeMajor = 18

function Banner($text) {
  $line = ('-' * 60)
  Write-Host ""
  Write-Host $line
  Write-Host "  $text"
  Write-Host $line
}

function Log($text) {
  Write-Host "  $text"
}

function Run-OrPrint($command) {
  if ($DryRun) {
    Write-Host "  [dry-run] $command"
  } else {
    Invoke-Expression $command
  }
}

Banner 'Helmr installer'

Log "Platform: Windows $([System.Environment]::OSVersion.Version)"

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Error "Node.js is required but was not found. Install Node $MinNodeMajor+ from https://nodejs.org"
  exit 1
}
$nodeVersion = (node --version)
$nodeMajor = [int]($nodeVersion -replace '^v(\d+).*', '$1')
Log "Node.js: $nodeVersion"
if ($nodeMajor -lt $MinNodeMajor) {
  Write-Error "Node.js $MinNodeMajor+ is required; found $nodeVersion."
  exit 1
}

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
  Write-Error "npm is required but was not found. Reinstall Node from https://nodejs.org"
  exit 1
}
Log "npm: $(npm --version)"

if (Get-Command git -ErrorAction SilentlyContinue) {
  Log "git: $(git --version)"
} else {
  Log "git: not found (recommended but not required)"
}

Banner 'Running create-helmr@latest'
Run-OrPrint 'npm create helmr@latest'

if ($DryRun) {
  Banner 'Dry run complete - no changes made'
  exit 0
}

if (-not $NoOpen) {
  $url = 'http://localhost:4000'
  Banner 'Opening Hatchery'
  try {
    Start-Process $url | Out-Null
  } catch {
    Log "Visit $url manually."
  }
  Log "Hatchery WebUI: $url"
}

Banner 'Helmr installed'
Log "Run 'helmr ask `"summarize this workspace`"' to try the first job."
Log "Run 'helmr self-test' to verify your environment."
