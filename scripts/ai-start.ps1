param(
  [string]$Task = "task",
  [string]$Base = "main",
  [string]$WorktreeRoot = ".worktrees",
  [string]$Session = "",
  [Alias("new-task")]
  [switch]$NewTask,
  [switch]$Force
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

function Get-Slug([string]$Value, [string]$Fallback) {
  if ($null -eq $Value) {
    $Value = ""
  }
  $slug = ($Value.ToLowerInvariant() -replace "[^a-z0-9]+", "-").Trim("-")
  if (-not $slug) {
    return $Fallback
  }
  return $slug
}

function Write-Utf8NoBom([string]$Path, [string]$Text) {
  $encoding = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($Path, $Text, $encoding)
}

function Read-Lock([string]$Path) {
  if (-not (Test-Path $Path -PathType Leaf)) {
    return $null
  }

  try {
    return Get-Content -Raw $Path | ConvertFrom-Json
  }
  catch {
    return [pscustomobject]@{
      invalid = $true
      reason = $_.Exception.Message
    }
  }
}

function Test-LockActive([object]$LockData) {
  if ($null -eq $LockData) {
    return $false
  }

  if ($LockData.PSObject.Properties.Name -contains "invalid") {
    return $false
  }

  $lockHost = [string]$LockData.host
  $lockPidRaw = $LockData.pid
  if (-not $lockHost -or -not $lockPidRaw) {
    return $false
  }

  $lockPid = 0
  [void][int]::TryParse([string]$lockPidRaw, [ref]$lockPid)
  if ($lockPid -le 0) {
    return $false
  }

  if ($lockHost -eq $env:COMPUTERNAME -and $lockPid -eq $PID) {
    return $false
  }

  if ($lockHost -ne $env:COMPUTERNAME) {
    return $true
  }

  $existingProcess = Get-Process -Id $lockPid -ErrorAction SilentlyContinue
  return ($null -ne $existingProcess)
}

function Get-WorktreeRecords() {
  $records = @()
  $current = $null
  $lines = & git worktree list --porcelain
  if ($LASTEXITCODE -ne 0) {
    throw "Unable to list worktrees."
  }

  foreach ($line in $lines) {
    if ($line -like "worktree *") {
      if ($null -ne $current) {
        $records += [pscustomobject]$current
      }
      $current = [ordered]@{
        path = [System.IO.Path]::GetFullPath($line.Substring(9).Trim())
        branch = ""
      }
      continue
    }

    if ($null -eq $current) {
      continue
    }

    if ($line -like "branch *") {
      $current.branch = $line.Substring(7).Trim()
    }
  }

  if ($null -ne $current) {
    $records += [pscustomobject]$current
  }

  return $records
}

function Test-RefExists([string]$RefName) {
  & git show-ref --verify --quiet $RefName
  return ($LASTEXITCODE -eq 0)
}

function Test-RefMergedIntoBase([string]$RefName, [string]$BaseRef) {
  if (-not (Test-RefExists -RefName $RefName)) {
    return $false
  }

  $refCommit = Get-CommandText -Command { git rev-parse $RefName } -ErrorMessage "Unable to resolve ref '$RefName'."
  $baseCommit = Get-CommandText -Command { git rev-parse $BaseRef } -ErrorMessage "Unable to resolve ref '$BaseRef'."
  if (-not $refCommit -or -not $baseCommit) {
    return $false
  }

  if ($refCommit -eq $baseCommit) {
    return $false
  }

  & git merge-base --is-ancestor $RefName $BaseRef
  return ($LASTEXITCODE -eq 0)
}

function Test-BranchMergedByGh([string]$Branch, [string]$Base) {
  $ghCommand = Get-Command gh -ErrorAction SilentlyContinue
  if ($null -eq $ghCommand) {
    return $false
  }

  try {
    $originUrl = Get-CommandText -Command { git remote get-url origin } -ErrorMessage "Unable to resolve remote "origin"."
  }
  catch {
    return $false
  }

  if (-not $originUrl -or $originUrl -notmatch "github\.com[:/]" ) {
    return $false
  }

  & $ghCommand.Source auth status *> $null
  if ($LASTEXITCODE -ne 0) {
    return $false
  }

  try {
    $json = & $ghCommand.Source pr list --head $Branch --base $Base --state merged --json number --limit 1 2>$null
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

function Assert-CleanWorktree([string]$WorktreePath, [string]$Reason) {
  $statusLines = @(& git -C $WorktreePath status --short)
  if ($LASTEXITCODE -ne 0) {
    throw "Unable to read git status for '$WorktreePath'."
  }

  if ($statusLines.Count -gt 0) {
    throw "Current worktree has uncommitted changes. Commit or stash them before $Reason."
  }
}

function Ensure-SessionLock([string]$WorktreePath, [string]$Branch, [string]$TaskSlug, [string]$SessionSource, [bool]$AllowForce) {
  $lockPath = Join-Path $WorktreePath ".codex-session.lock"
  $existingLock = Read-Lock -Path $lockPath
  $isActiveLock = Test-LockActive -LockData $existingLock
  if ($isActiveLock -and -not $AllowForce) {
    $lockHost = [string]$existingLock.host
    $lockPid = [string]$existingLock.pid
    throw "Session lock is active at '$lockPath' (host=$lockHost pid=$lockPid). Use -Force to override."
  }

  if ($isActiveLock -and $AllowForce) {
    Write-Host "==> Override active session lock with -Force"
  }
  elseif ($null -ne $existingLock) {
    Write-Host "==> Replace stale or invalid session lock."
  }

  $lock = [ordered]@{
    sessionId = $SessionSource
    branch = $Branch
    task = $TaskSlug
    worktreePath = $WorktreePath
    host = $env:COMPUTERNAME
    user = $env:USERNAME
    pid = $PID
    codexThreadId = $env:CODEX_THREAD_ID
    createdAtUtc = (Get-Date).ToUniversalTime().ToString("o")
  } | ConvertTo-Json -Depth 4

  Write-Utf8NoBom -Path $lockPath -Text $lock
}

$repoTopLevel = Get-CommandText -Command { git rev-parse --show-toplevel } -ErrorMessage "Not inside a git repository."
if (-not $repoTopLevel) {
  throw "Not inside a git repository."
}
$repoTopLevel = [System.IO.Path]::GetFullPath($repoTopLevel)

$gitCommonDir = Get-CommandText -Command { git rev-parse --path-format=absolute --git-common-dir } -ErrorMessage "Unable to resolve git common directory."
if (-not $gitCommonDir) {
  throw "Unable to resolve git common directory."
}

$commonRoot = Split-Path -Parent $gitCommonDir
if (-not $commonRoot) {
  throw "Unable to resolve repository root from '$gitCommonDir'."
}
$commonRoot = [System.IO.Path]::GetFullPath($commonRoot)

$sessionSource = if ($Session) { $Session } elseif ($env:CODEX_THREAD_ID) { $env:CODEX_THREAD_ID } else { "" }
if (-not $sessionSource) {
  throw "Session id is required. Provide -Session or set CODEX_THREAD_ID."
}

$sessionSlug = Get-Slug -Value $sessionSource -Fallback "session"
$taskSlug = Get-Slug -Value $Task -Fallback "task"
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$useCurrentWorktree = (Test-Path (Join-Path $repoTopLevel '.git') -PathType Leaf) -and [bool]$env:CODEX_THREAD_ID

$freshTaskBranch = "ai/$taskSlug-$timestamp"
$startFreshTask = $NewTask.IsPresent
$rolloverReason = ""

if ($NewTask) {
  $branch = $freshTaskBranch
  $safeDirName = ($branch -replace "[^A-Za-z0-9._-]", "-")
  $mode = if ($useCurrentWorktree) { "codex-task" } else { "task" }
}
else {
  $branch = "ai/session-$sessionSlug"
  $safeDirName = "session-$sessionSlug"
  $mode = if ($useCurrentWorktree) { "codex-session" } else { "session" }
}

if ($branch -eq "main" -or $branch -eq "develop") {
  throw "Refusing to use protected branch '$branch'."
}

Set-Location $commonRoot
Invoke-Checked "Fetch latest origin/$Base" { git fetch origin $Base }

$baseRef = "origin/$Base"
& git show-ref --verify --quiet "refs/remotes/$baseRef"
if ($LASTEXITCODE -ne 0) {
  throw "Base ref '$baseRef' does not exist."
}

if (-not $NewTask) {
  $sessionBranch = $branch
  $sessionBranchRef = "refs/heads/$sessionBranch"
  $sessionBranchMerged = (Test-RefMergedIntoBase -RefName $sessionBranchRef -BaseRef $baseRef)
  if (-not $sessionBranchMerged) {
    $sessionBranchMerged = Test-BranchMergedByGh -Branch $sessionBranch -Base $Base
  }

  if ($sessionBranchMerged) {
    $branch = $freshTaskBranch
    $safeDirName = ($branch -replace "[^A-Za-z0-9._-]", "-")
    $mode = if ($useCurrentWorktree) { "codex-task-rollover" } else { "task-rollover" }
    $startFreshTask = $true
    $rolloverReason = "session branch '$sessionBranch' is already merged into '$Base'"
    Write-Host "==> Detected merged session branch '$sessionBranch'; start fresh task branch '$branch' from '$baseRef'"
  }
}

if ($useCurrentWorktree) {
  $worktreePath = $repoTopLevel
  if ($startFreshTask) {
    $cleanReason = if ($rolloverReason) { "starting a fresh branch because $rolloverReason" } else { "starting a fresh task branch" }
    Assert-CleanWorktree -WorktreePath $worktreePath -Reason $cleanReason
  }

  $currentBranch = Get-CommandText -Command { git -C $worktreePath branch --show-current } -ErrorMessage "Unable to determine current branch for '$worktreePath'."
  $branchRef = "refs/heads/$branch"
  $worktreeOwner = Get-WorktreeRecords | Where-Object { $_.branch -eq $branchRef -and $_.path -ne $worktreePath } | Select-Object -First 1
  if ($null -ne $worktreeOwner) {
    throw "Branch '$branch' is already checked out in another worktree: $($worktreeOwner.path)"
  }

  & git show-ref --verify --quiet $branchRef
  $localBranchExists = ($LASTEXITCODE -eq 0)
  & git show-ref --verify --quiet "refs/remotes/origin/$branch"
  $remoteBranchExists = ($LASTEXITCODE -eq 0)

  if ($currentBranch -eq $branch) {
    Write-Host "==> Reuse current linked worktree '$worktreePath' on branch '$branch'"
  }
  elseif ($localBranchExists) {
    Invoke-Checked "Switch current linked worktree '$worktreePath' to local branch '$branch'" {
      git -C $worktreePath switch $branch
    }
  }
  elseif ($remoteBranchExists) {
    Invoke-Checked "Switch current linked worktree '$worktreePath' to remote branch '$branch'" {
      git -C $worktreePath switch --track -c $branch "origin/$branch"
    }
  }
  else {
    Invoke-Checked "Create branch '$branch' in current linked worktree '$worktreePath' from '$baseRef'" {
      git -C $worktreePath switch -c $branch $baseRef
    }
  }

  Ensure-SessionLock -WorktreePath $worktreePath -Branch $branch -TaskSlug $taskSlug -SessionSource $sessionSource -AllowForce $Force.IsPresent
}
else {
  $worktreePath = Join-Path $commonRoot (Join-Path $WorktreeRoot $safeDirName)
  $worktreePath = [System.IO.Path]::GetFullPath($worktreePath)
  $worktreeParent = Split-Path -Parent $worktreePath
  if (-not (Test-Path $worktreeParent)) {
    New-Item -ItemType Directory -Path $worktreeParent | Out-Null
  }

  & git show-ref --verify --quiet "refs/heads/$branch"
  $branchExists = ($LASTEXITCODE -eq 0)

  if ($NewTask) {
    if ($branchExists) {
      throw "Local branch '$branch' already exists."
    }
    if (Test-Path $worktreePath) {
      throw "Worktree path already exists: $worktreePath"
    }

    Invoke-Checked "Create fallback task worktree '$worktreePath' on branch '$branch' from '$baseRef'" {
      git worktree add $worktreePath -b $branch $baseRef
    }
  }
  else {
    if (Test-Path $worktreePath) {
      $currentBranch = Get-CommandText -Command { git -C $worktreePath branch --show-current } -ErrorMessage "Unable to determine branch for existing session worktree '$worktreePath'."
      if (-not $currentBranch) {
        throw "Unable to determine branch for existing session worktree '$worktreePath'."
      }
      if ($currentBranch -ne $branch) {
        throw "Session worktree '$worktreePath' is on '$currentBranch', expected '$branch'."
      }
      Write-Host "==> Reuse existing session worktree '$worktreePath' on branch '$branch'"
    }
    elseif ($branchExists) {
      Invoke-Checked "Attach existing session branch '$branch' to '$worktreePath'" {
        git worktree add $worktreePath $branch
      }
    }
    else {
      Invoke-Checked "Create session worktree '$worktreePath' on branch '$branch' from '$baseRef'" {
        git worktree add $worktreePath -b $branch $baseRef
      }
    }
  }

  Ensure-SessionLock -WorktreePath $worktreePath -Branch $branch -TaskSlug $taskSlug -SessionSource $sessionSource -AllowForce $Force.IsPresent
}

Write-Host ""
Write-Host "Codex start ready."
Write-Host "mode=$mode"
Write-Host "branch=$branch"
Write-Host "path=$worktreePath"
Write-Host "next=Set-Location '$worktreePath'"