param(
  [string]$Task = "task",
  [string]$Base = "main",
  [string]$WorktreeRoot = ".worktrees",
  [string]$Branch = "",
  [switch]$NoFetch
)

$ErrorActionPreference = "Stop"

function Invoke-Checked([string]$Description, [scriptblock]$Command) {
  Write-Host "==> $Description"
  & $Command
  if ($LASTEXITCODE -ne 0) {
    throw "Command failed: $Description"
  }
}

$repoRoot = (& git rev-parse --show-toplevel).Trim()
if ($LASTEXITCODE -ne 0 -or -not $repoRoot) {
  throw "Not inside a git repository."
}

Set-Location $repoRoot

if (-not $NoFetch) {
  Invoke-Checked "Fetch latest origin/$Base" { git fetch origin $Base }
}

$baseRef = "origin/$Base"
& git show-ref --verify --quiet "refs/remotes/$baseRef"
if ($LASTEXITCODE -ne 0) {
  throw "Base ref '$baseRef' does not exist."
}

if (-not $Branch) {
  $taskSlug = ($Task.ToLowerInvariant() -replace "[^a-z0-9]+", "-").Trim("-")
  if (-not $taskSlug) {
    $taskSlug = "task"
  }
  $timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
  $Branch = "ai/$taskSlug-$timestamp"
}

if ($Branch -eq "main" -or $Branch -eq "develop") {
  throw "Refusing to create worktree on protected branch name: $Branch"
}

& git show-ref --verify --quiet "refs/heads/$Branch"
if ($LASTEXITCODE -eq 0) {
  throw "Local branch '$Branch' already exists."
}

$safeDirName = ($Branch -replace "[^A-Za-z0-9._-]", "-")
$worktreePath = Join-Path $repoRoot (Join-Path $WorktreeRoot $safeDirName)

if (Test-Path $worktreePath) {
  throw "Worktree path already exists: $worktreePath"
}

$worktreeParent = Split-Path -Parent $worktreePath
if (-not (Test-Path $worktreeParent)) {
  New-Item -ItemType Directory -Path $worktreeParent | Out-Null
}

Invoke-Checked "Create worktree '$worktreePath' on branch '$Branch' from '$baseRef'" {
  git worktree add $worktreePath -b $Branch $baseRef
}

Write-Host ""
Write-Host "Worktree ready."
Write-Host "branch=$Branch"
Write-Host "path=$worktreePath"
Write-Host "next=Set-Location '$worktreePath'"
