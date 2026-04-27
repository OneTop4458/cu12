param(
  [string]$Commit = "",
  [string]$Title = "",
  [string]$Body = "",
  [string]$Base = "main",
  [switch]$Draft,
  [switch]$SkipBuildWeb,
  [switch]$AllowPrimaryCheckout,
  [switch]$NoPr,
  [switch]$NoPush
)

$ErrorActionPreference = "Stop"

function Invoke-Checked([string]$Description, [scriptblock]$Command) {
  Write-Host "==> $Description"
  & $Command
  if ($LASTEXITCODE -ne 0) {
    throw "Command failed: $Description"
  }
}

function Get-CommandText([scriptblock]$Command, [string]$ErrorMessage) {
  $output = & $Command
  if ($LASTEXITCODE -ne 0) {
    throw $ErrorMessage
  }
  if ($null -eq $output) {
    return ""
  }
  return ($output | Out-String).Trim()
}

function Get-BranchSlug([string]$BranchName) {
  $slug = ($BranchName -replace "^ai/", "" -replace "[^a-zA-Z0-9]+", "-").Trim("-").ToLowerInvariant()
  if (-not $slug) {
    return "changes"
  }
  return $slug
}

function Invoke-Pnpm([string[]]$Arguments) {
  $pnpmCommand = Get-Command pnpm.cmd -ErrorAction SilentlyContinue
  if ($pnpmCommand) {
    & $pnpmCommand.Source @Arguments
  }
  else {
    & corepack pnpm @Arguments
  }

  if ($LASTEXITCODE -ne 0) {
    throw "pnpm failed: $($Arguments -join ' ')"
  }
}

function Release-SessionLock([string]$RepoRoot) {
  $lockPath = Join-Path $RepoRoot '.codex-session.lock'
  if (Test-Path $lockPath -PathType Leaf) {
    Remove-Item -LiteralPath $lockPath -Force
    Write-Host "==> Released session lock '$lockPath'"
    Write-Host "next=pnpm run ai:clean"
  }
}

function Test-RemoteLooksLikeGitHub([string]$RemoteName) {
  try {
    $remoteUrl = Get-CommandText -Command { git remote get-url $RemoteName } -ErrorMessage "Unable to resolve remote '$RemoteName'."
  }
  catch {
    return $false
  }

  if (-not $remoteUrl) {
    return $false
  }

  return ($remoteUrl -match "github\.com[:/]")
}

function Test-BranchHasMergedPr([string]$Branch, [string]$Base) {
  if (-not (Test-RemoteLooksLikeGitHub -RemoteName "origin")) {
    return $false
  }

  try {
    $json = & gh pr list --head $Branch --base $Base --state merged --json number --limit 1 2>$null
  }
  catch {
    return $false
  }

  if ($LASTEXITCODE -ne 0 -or -not $json) {
    return $false
  }

  try {
    $prs = $json | ConvertFrom-Json
  }
  catch {
    return $false
  }

  return (@($prs).Count -gt 0)
}

function Assert-BranchCanShip([string]$Branch, [string]$Base) {
  if (Test-BranchHasMergedPr -Branch $Branch -Base $Base) {
    throw "Current branch '$Branch' already has a merged PR into '$Base'. Start a fresh branch with pnpm run ai:start --task <next-task> before committing more changes."
  }
}

$repoRoot = Get-CommandText -Command { git rev-parse --show-toplevel } -ErrorMessage "Not inside a git repository."
if (-not $repoRoot) {
  throw "Not inside a git repository."
}

$gitMetaPath = Join-Path $repoRoot ".git"
if ((Test-Path $gitMetaPath -PathType Container) -and -not $AllowPrimaryCheckout) {
  throw "Run this script from a linked worktree (for example .worktrees/<branch>) to avoid multi-agent conflicts. Use -AllowPrimaryCheckout to override."
}

Set-Location $repoRoot

$branch = Get-CommandText -Command { git branch --show-current } -ErrorMessage "Unable to detect current branch."
if (-not $branch) {
  throw "Unable to detect current branch."
}

if ($branch -eq "main" -or $branch -eq "develop") {
  throw "Refusing to run on protected branch '$branch'. Use a feature branch/worktree."
}

& gh --version | Out-Null
if ($LASTEXITCODE -ne 0) {
  throw "GitHub CLI (gh) is required."
}
Invoke-Checked "Verify GitHub CLI authentication" { gh auth status }
Assert-BranchCanShip -Branch $branch -Base $Base

if ($NoPush -and -not $NoPr) {
  throw "-NoPush cannot be used without -NoPr. PR creation requires a remote branch."
}

Invoke-Checked "Validate text quality" { Invoke-Pnpm @('run', 'check:text') }
Invoke-Checked "Validate OpenAPI sync" { Invoke-Pnpm @('run', 'check:openapi') }
Invoke-Checked "Generate Prisma client" { Invoke-Pnpm @('run', 'prisma:generate') }
Invoke-Checked "Typecheck all workspaces" { Invoke-Pnpm @('run', 'typecheck') }
Invoke-Checked "Run all regression tests" { Invoke-Pnpm @('run', 'test:all') }
if (-not $SkipBuildWeb) {
  Invoke-Checked "Build web app" { Invoke-Pnpm @('run', 'build:web') }
}

Invoke-Checked "Stage all changes" { git add -A }
& git diff --cached --quiet
if ($LASTEXITCODE -eq 0) {
  throw "No staged changes to commit."
}

if (-not $Commit) {
  $branchSlug = Get-BranchSlug -BranchName $branch
  $Commit = "chore(ai): $branchSlug apply requested changes"
  Write-Host "==> Generated commit message: $Commit"
}

Invoke-Checked "Create commit" { git commit -m $Commit }
if (-not $NoPush) {
  Invoke-Checked "Push branch to origin" { git push --set-upstream origin $branch }
}

if (-not $Title) {
  $Title = Get-CommandText -Command { git log -1 --pretty=%s } -ErrorMessage "Unable to read latest commit subject."
}

if (-not $Body) {
  $Body = @"
Automated PR created by `scripts/ai-pr.ps1`.

Validation executed in order:
- pnpm run check:text
- pnpm run check:openapi
- pnpm run prisma:generate
- pnpm run typecheck
- pnpm run test:all
- pnpm run build:web
"@
}

$prArgs = @('pr', 'create', '--base', $Base, '--head', $branch, '--title', $Title, '--body', $Body)
if ($Draft) {
  $prArgs += '--draft'
}

if ($NoPr) {
  Write-Host "==> Skip pull request creation by -NoPr."
}
else {
  Write-Host "==> Create pull request"
  & gh @prArgs
  if ($LASTEXITCODE -ne 0) {
    Write-Host "PR create failed. Attempting to print existing PR URL for this branch..."
    & gh pr view $branch --json url --jq '.url'
    if ($LASTEXITCODE -ne 0) {
      throw "Failed to create or locate pull request for branch '$branch'."
    }
  }
}

Release-SessionLock -RepoRoot $repoRoot
