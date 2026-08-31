#Requires -Version 5.1
<#
.SYNOPSIS
  One-command merge of all known MechPro Windows folders into the unified repo.

.DESCRIPTION
  Inventories C:\MechPro-work, C:\mechpro-dispatch, C:\MechPro-dcdaf6e,
  OneDrive backup, and worktrees; compares each to the unified repo; copies
  files that exist only in external folders; reports content differences for
  manual review; runs npm validate.

.PARAMETER RepoPath
  Path to the unified MechPro git clone. Defaults to C:\mechpro-dispatch.

.PARAMETER Branch
  Git branch to checkout before merge. Defaults to cursor/combine-three-folders-ab9b.

.PARAMETER DryRun
  Report only — do not copy files or commit.

.PARAMETER Commit
  Stage copied files and create a git commit (requires -DryRun:$false).

.PARAMETER SkipValidate
  Skip npm ci / npm run validate after merge.

.EXAMPLE
  .\scripts\merge-windows.ps1

.EXAMPLE
  .\scripts\merge-windows.ps1 -RepoPath C:\MechPro-unified -DryRun

.EXAMPLE
  .\scripts\merge-windows.ps1 -Commit -RepoPath C:\mechpro-dispatch
#>
[CmdletBinding()]
param(
  [string]$RepoPath = 'C:\mechpro-dispatch',
  [string]$Branch = 'cursor/combine-three-folders-ab9b',
  [switch]$DryRun,
  [switch]$Commit,
  [switch]$SkipValidate
)

$ErrorActionPreference = 'Stop'

$KnownPaths = @(
  'C:\mechpro-dispatch',
  'C:\MechPro-work',
  'C:\MechPro-dcdaf6e',
  'C:\Users\secon\OneDrive\Documents\MechPro-Lees_computer',
  'C:\Users\secon\Downloads\MechPro.worktrees'
)

$MergeSurfaces = @('src', 'desktop', 'infra', 'scripts', 'docs', 'assets')
$SkipDirNames = @('.git', 'node_modules', 'dist', 'cdk.out', '.cursor', '.vscode', 'coverage')

function Write-Step([string]$Message) {
  Write-Host ""
  Write-Host "==> $Message" -ForegroundColor Cyan
}

function Test-NodeAvailable {
  $node = Get-Command node -ErrorAction SilentlyContinue
  if (-not $node) {
    throw "Node.js not found on PATH. Install Node 20+ or use nvm-windows, then re-run."
  }
}

function Get-WorktreePaths([string]$MainRepo) {
  if (-not (Test-Path (Join-Path $MainRepo '.git'))) { return @() }
  Push-Location $MainRepo
  try {
    $lines = git worktree list --porcelain 2>$null
    if (-not $lines) { return @() }
    $paths = @()
    foreach ($line in $lines) {
      if ($line -match '^worktree (.+)$') {
        $wt = $Matches[1].Trim()
        if ($wt -ne (Resolve-Path $MainRepo).Path) { $paths += $wt }
      }
    }
    return $paths
  } finally {
    Pop-Location
  }
}

function Invoke-CompareFolder([string]$External, [string]$Repo) {
  $json = & node (Join-Path $Repo 'scripts\compare-folders.mjs') $External $Repo --deep --json 2>&1
  if ($LASTEXITCODE -ne 0) {
    return $null
  }
  return $json | ConvertFrom-Json
}

function Copy-UniqueMergeFiles([string]$External, [string]$Repo, [object]$Report, [ref]$Copied, [ref]$Skipped) {
  if (-not $Report.deep) { return }

  foreach ($rel in $Report.deep.onlyExternal) {
    $src = Join-Path $External ($rel -replace '/', '\')
    $dest = Join-Path $Repo ($rel -replace '/', '\')

    if (-not (Test-Path $src)) { continue }

    # Never copy secrets or machine-specific config
    $leaf = Split-Path $rel -Leaf
    if ($leaf -match '^\.env' -or $leaf -match 'credentials' -or $leaf -match '_conflict_') {
      Write-Host "  SKIP (sensitive/conflict): $rel" -ForegroundColor Yellow
      $Skipped.Value++
      continue
    }

    if ($DryRun) {
      Write-Host "  WOULD COPY: $rel" -ForegroundColor DarkGreen
      $Copied.Value++
      continue
    }

    $destDir = Split-Path $dest -Parent
    if (-not (Test-Path $destDir)) {
      New-Item -ItemType Directory -Force -Path $destDir | Out-Null
    }

    if (Test-Path $dest) {
      Write-Host "  SKIP (exists in repo): $rel" -ForegroundColor Yellow
      $Skipped.Value++
      continue
    }

    Copy-Item -Path $src -Destination $dest -Force
    Write-Host "  COPIED: $rel" -ForegroundColor Green
    $Copied.Value++
  }
}

function Show-DifferingFiles([object]$Report) {
  if (-not $Report.deep -or $Report.deep.differing.Count -eq 0) { return }

  Write-Host "  Content differs (manual review — repo may already be ahead):" -ForegroundColor Yellow
  foreach ($d in $Report.deep.differing) {
    $hint = if ($d.newerLikely -eq 'repo') { 'prefer repo' } else { 'review both' }
    Write-Host ("    ~ {0}  ext={1}B repo={2}B  ({3})" -f $d.path, $d.externalBytes, $d.repoBytes, $hint)
  }
}

# --- Main ---

Write-Host @"

MechPro Windows folder merge
==============================
Repo:    $RepoPath
Branch:  $Branch
DryRun:  $DryRun
Commit:  $Commit

"@ -ForegroundColor White

Test-NodeAvailable

if (-not (Test-Path $RepoPath)) {
  Write-Step "Cloning unified repo to $RepoPath"
  if ($DryRun) {
    Write-Host "  WOULD: git clone https://github.com/tinytim3271-wq/mechpro-dispatch.git $RepoPath"
  } else {
    git clone https://github.com/tinytim3271-wq/mechpro-dispatch.git $RepoPath
  }
}

if (-not $DryRun) {
  Write-Step "Fetching latest and checking out $Branch"
  Push-Location $RepoPath
  try {
    git fetch origin
    git checkout $Branch 2>$null
    if ($LASTEXITCODE -ne 0) {
      git checkout -b $Branch "origin/$Branch"
    }
    git pull origin $Branch
  } finally {
    Pop-Location
  }
}

# Build list of paths to compare (known paths + worktree children)
$ComparePaths = @()
foreach ($p in $KnownPaths) {
  if (Test-Path $p) {
    if ($p -match 'worktrees$') {
      Get-ChildItem $p -Directory -ErrorAction SilentlyContinue | ForEach-Object {
        $ComparePaths += $_.FullName
      }
      if ((Get-ChildItem $p -Directory -ErrorAction SilentlyContinue).Count -eq 0) {
        $ComparePaths += $p
      }
    } else {
      # Skip if this IS the repo we're merging into (avoid self-compare)
      $resolved = (Resolve-Path $p -ErrorAction SilentlyContinue).Path
      $repoResolved = if (Test-Path $RepoPath) { (Resolve-Path $RepoPath).Path } else { '' }
      if ($resolved -and $repoResolved -and $resolved -eq $repoResolved) {
        Write-Host "Skipping self: $p (canonical repo)" -ForegroundColor DarkGray
      } else {
        $ComparePaths += $p
      }
    }
  } else {
    Write-Host "MISSING: $p" -ForegroundColor DarkGray
  }
}

# Add git worktree checkouts from main clone
$wtFrom = if (Test-Path 'C:\mechpro-dispatch') { 'C:\mechpro-dispatch' } elseif (Test-Path $RepoPath) { $RepoPath } else { $null }
if ($wtFrom) {
  foreach ($wt in (Get-WorktreePaths $wtFrom)) {
    if ($ComparePaths -notcontains $wt) { $ComparePaths += $wt }
  }
}

Write-Step "Comparing $($ComparePaths.Count) folder(s)"
$totalCopied = 0
$totalSkipped = 0
$allReports = @()

foreach ($external in $ComparePaths) {
  Write-Host ""
  Write-Host "--- $external ---" -ForegroundColor White

  $report = Invoke-CompareFolder -External $external -Repo $RepoPath
  if (-not $report) {
    Write-Host "  Could not compare (path missing or compare script failed)" -ForegroundColor Red
    continue
  }

  $allReports += $report
  Write-Host "  Kind: $($report.kind)  Layout: src=$($report.layout.hasSrc) desktop=$($report.layout.hasDesktop) infra=$($report.layout.hasInfra) legacy=$($report.layout.hasLegacyRoot)"

  if ($report.layout.hasLegacyRoot) {
    Write-Host "  NOTE: Legacy root app.js detected. Map changes to src/runtime/legacy.js manually or rely on repo (modular) version." -ForegroundColor Yellow
  }

  $copied = 0
  $skipped = 0
  Copy-UniqueMergeFiles -External $external -Repo $RepoPath -Report $report -Copied ([ref]$copied) -Skipped ([ref]$skipped)
  Show-DifferingFiles -Report $report

  $totalCopied += $copied
  $totalSkipped += $skipped
}

Write-Step "Merge summary"
Write-Host "  Paths compared:  $($allReports.Count)"
Write-Host "  Files copied:    $totalCopied$(if ($DryRun) { ' (dry run)' })"
Write-Host "  Files skipped:   $totalSkipped"

if (-not $SkipValidate -and -not $DryRun) {
  Write-Step "Running npm validate"
  Push-Location $RepoPath
  try {
    if (-not (Test-Path 'node_modules')) {
      npm ci
    }
    npm run validate
    if ($LASTEXITCODE -ne 0) {
      throw "npm run validate failed. Fix errors before committing."
    }
  } finally {
    Pop-Location
  }
}

if ($Commit -and -not $DryRun -and $totalCopied -gt 0) {
  Write-Step "Creating git commit"
  Push-Location $RepoPath
  try {
    git add -A
    git status --short
    git commit -m "merge(windows): import unique files from local MechPro folders

Automated merge via scripts/merge-windows.ps1.
Review differing files manually if features seem missing."
    Write-Host "Commit created. Push with: git push -u origin HEAD" -ForegroundColor Green
  } finally {
    Pop-Location
  }
} elseif ($Commit -and $totalCopied -eq 0) {
  Write-Host "No new files to commit." -ForegroundColor Yellow
}

Write-Step "Done"
Write-Host @"
Next steps:
  1. Review any 'Content differs' lines above — unified repo is often ahead of old copies.
  2. If validate passed, push:  git push -u origin $Branch
  3. Archive redundant folders after confirming nothing unique remains:
       New-Item -Force C:\MechPro-archive | Out-Null
       Move-Item C:\MechPro-dcdaf6e C:\MechPro-archive\ -ErrorAction SilentlyContinue

See docs/MERGE_WINDOWS_FOLDERS.md for details.
"@
