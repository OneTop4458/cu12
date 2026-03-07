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

function Get-BranchSlug([string]$BranchName) {
  $slug = ($BranchName -replace "^ai/", "" -replace "[^a-zA-Z0-9]+", "-").Trim("-").ToLowerInvariant()
  if (-not $slug) {
    return "changes"
  }
  return $slug
}

$repoRoot = (& git rev-parse --show-toplevel).Trim()
if ($LASTEXITCODE -ne 0 -or -not $repoRoot) {
  throw "Not inside a git repository."
}

$gitMetaPath = Join-Path $repoRoot ".git"
if ((Test-Path $gitMetaPath -PathType Container) -and -not $AllowPrimaryCheckout) {
  throw "Run this script from a linked worktree (for example .worktrees/<branch>) to avoid multi-agent conflicts. Use -AllowPrimaryCheckout to override."
}

Set-Location $repoRoot

$branch = (& git branch --show-current).Trim()
if (-not $branch) {
  throw "Unable to detect current branch."
}

if ($branch -eq "main" -or $branch -eq "develop") {
  throw "Refusing to run on protected branch '$branch'. Use a feature branch/worktree."
}

$npmCommand = Get-Command npm.cmd -ErrorAction SilentlyContinue
if ($npmCommand) {
  $npmExe = "npm.cmd"
}
else {
  $npmExe = "npm"
}

& gh --version | Out-Null
if ($LASTEXITCODE -ne 0) {
  throw "GitHub CLI (gh) is required."
}
Invoke-Checked "Verify GitHub CLI authentication" { gh auth status }

if ($NoPush -and -not $NoPr) {
  throw "-NoPush cannot be used without -NoPr. PR creation requires a remote branch."
}

Invoke-Checked "Validate text quality" { & $npmExe run check:text }
Invoke-Checked "Validate OpenAPI sync" { & $npmExe run check:openapi }
Invoke-Checked "Typecheck all workspaces" { & $npmExe run typecheck }
if (-not $SkipBuildWeb) {
  Invoke-Checked "Build web app" { & $npmExe run build:web }
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
  $Title = (& git log -1 --pretty=%s).Trim()
}

if (-not $Body) {
  $Body = @"
Automated PR created by `scripts/ai-pr.ps1`.

Validation executed in order:
- npm run check:text
- npm run check:openapi
- npm run typecheck
- npm run build:web
"@
}

$prArgs = @("pr", "create", "--base", $Base, "--head", $branch, "--title", $Title, "--body", $Body)
if ($Draft) {
  $prArgs += "--draft"
}

if ($NoPr) {
  Write-Host "==> Skip pull request creation by -NoPr."
}
else {
  Write-Host "==> Create pull request"
  & gh @prArgs
  if ($LASTEXITCODE -ne 0) {
    Write-Host "PR create failed. Attempting to print existing PR URL for this branch..."
    & gh pr view $branch --json url --jq ".url"
    if ($LASTEXITCODE -ne 0) {
      throw "Failed to create or locate pull request for branch '$branch'."
    }
  }
}
