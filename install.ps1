# Helmr bootstrap installer (Windows PowerShell).
#
# Usage:
#   powershell -c "irm https://helmr.ai/install.ps1 | iex"
#   powershell -c "irm https://helmr.ai/install.ps1 | iex" --dry-run
#
# This is a thin wrapper. It verifies Node.js/npm, prints what it will do, and
# then hands off to `create-helmr@latest`, which owns the real onboarding.
[CmdletBinding()]
param(
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
$MinNodeMajor = 18

# Support the piped one-liner form where args arrive via $args.
if ($args -contains '--dry-run' -or $args -contains '-n') { $DryRun = $true }

function Write-Step($text) { Write-Host "`n==> $text" }
function Write-Info($text) { Write-Host "  $text" }
function Fail($text) { Write-Error $text; exit 1 }

Write-Step 'Helmr setup'
if ($DryRun) {
  Write-Info 'Dry run: prerequisites are checked and intended actions are printed only.'
  Write-Info 'No packages are installed and no daemons are started.'
}

Write-Step '1. Checking operating system and shell'
Write-Info "OS: $([System.Environment]::OSVersion.VersionString)"
Write-Info "PowerShell: $($PSVersionTable.PSVersion)"

Write-Step '2. Checking Node.js, npm, and Git'
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) { Fail "Node.js not found. Install Node.js >= $MinNodeMajor from https://nodejs.org" }
$nodeVersion = (& node --version).TrimStart('v')
$nodeMajor = [int]($nodeVersion.Split('.')[0])
if ($nodeMajor -lt $MinNodeMajor) { Fail "Node.js >= $MinNodeMajor is required (found $nodeVersion)." }
Write-Info "Node.js $nodeVersion OK"

$npm = Get-Command npm -ErrorAction SilentlyContinue
if (-not $npm) { Fail 'npm not found. Install Node.js from https://nodejs.org' }
Write-Info "npm $(& npm --version) OK"

$git = Get-Command git -ErrorAction SilentlyContinue
if ($git) { Write-Info "git OK" } else { Write-Info 'git not found (optional, recommended)' }

Write-Step '3. Bootstrapping Helmr via create-helmr'
if ($DryRun) {
  Write-Info 'Would run: npm create helmr@latest -- --dry-run'
  Write-Step 'Dry run complete'
  Write-Info 'Re-run without --dry-run to install Helmr and open Hatchery onboarding.'
  exit 0
}

Write-Info 'Running: npm create helmr@latest'
& npm create helmr@latest

Write-Step 'Helmr bootstrap finished'
Write-Info 'Continue setup in Hatchery: http://localhost:4000'
