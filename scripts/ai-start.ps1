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
    return (Get-Content -Raw $Path | ConvertFrom-Json)
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

$repoTopLevel = (& git rev-parse --show-toplevel).Trim()
if ($LASTEXITCODE -ne 0 -or -not $repoTopLevel) {
  throw "Not inside a git repository."
}

$gitCommonDir = (& git rev-parse --path-format=absolute --git-common-dir).Trim()
if ($LASTEXITCODE -ne 0 -or -not $gitCommonDir) {
  throw "Unable to resolve git common directory."
}

$commonRoot = Split-Path -Parent $gitCommonDir
if (-not $commonRoot) {
  throw "Unable to resolve repository root from '$gitCommonDir'."
}

Set-Location $commonRoot

Invoke-Checked "Fetch latest origin/$Base" { git fetch origin $Base }

$baseRef = "origin/$Base"
& git show-ref --verify --quiet "refs/remotes/$baseRef"
if ($LASTEXITCODE -ne 0) {
  throw "Base ref '$baseRef' does not exist."
}

$sessionSource = if ($Session) { $Session } elseif ($env:CODEX_THREAD_ID) { $env:CODEX_THREAD_ID } else { "" }
if (-not $sessionSource) {
  throw "Session id is required. Provide -Session or set CODEX_THREAD_ID."
}

$sessionSlug = Get-Slug -Value $sessionSource -Fallback "session"
$taskSlug = Get-Slug -Value $Task -Fallback "task"

if ($NewTask) {
  $timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
  $branch = "ai/$taskSlug-$timestamp"
  $safeDirName = ($branch -replace "[^A-Za-z0-9._-]", "-")
  $mode = "task"
}
else {
  $branch = "ai/session-$sessionSlug"
  $safeDirName = "session-$sessionSlug"
  $mode = "session"
}

if ($branch -eq "main" -or $branch -eq "develop") {
  throw "Refusing to use protected branch '$branch'."
}

$worktreePath = Join-Path $commonRoot (Join-Path $WorktreeRoot $safeDirName)
$worktreePath = [System.IO.Path]::GetFullPath($worktreePath)
$worktreeParent = Split-Path -Parent $worktreePath
if (-not (Test-Path $worktreeParent)) {
  New-Item -ItemType Directory -Path $worktreeParent | Out-Null
}

if ($NewTask) {
  & git show-ref --verify --quiet "refs/heads/$branch"
  if ($LASTEXITCODE -eq 0) {
    throw "Local branch '$branch' already exists."
  }

  if (Test-Path $worktreePath) {
    throw "Worktree path already exists: $worktreePath"
  }

  Invoke-Checked "Create task worktree '$worktreePath' on branch '$branch' from '$baseRef'" {
    git worktree add $worktreePath -b $branch $baseRef
  }
}
else {
  & git show-ref --verify --quiet "refs/heads/$branch"
  $branchExists = ($LASTEXITCODE -eq 0)

  if (Test-Path $worktreePath) {
    $currentBranch = (& git -C $worktreePath branch --show-current).Trim()
    if (-not $currentBranch) {
      throw "Unable to determine branch for existing session worktree '$worktreePath'."
    }
    if ($currentBranch -ne $branch) {
      throw "Session worktree '$worktreePath' is on '$currentBranch', expected '$branch'."
    }
    Write-Host "==> Reuse existing session worktree '$worktreePath' on branch '$branch'"
  }
  else {
    if ($branchExists) {
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

  $lockPath = Join-Path $worktreePath ".codex-session.lock"
  $existingLock = Read-Lock -Path $lockPath
  $isActiveLock = Test-LockActive -LockData $existingLock
  if ($isActiveLock -and -not $Force) {
    $lockHost = [string]$existingLock.host
    $lockPid = [string]$existingLock.pid
    throw "Session lock is active at '$lockPath' (host=$lockHost pid=$lockPid). Use -Force to override."
  }

  if ($isActiveLock -and $Force) {
    Write-Host "==> Override active session lock with -Force"
  }
  elseif ($null -ne $existingLock) {
    Write-Host "==> Replace stale or invalid session lock."
  }

  $lock = [ordered]@{
    sessionId = $sessionSource
    branch = $branch
    task = $taskSlug
    worktreePath = $worktreePath
    host = $env:COMPUTERNAME
    user = $env:USERNAME
    pid = $PID
    codexThreadId = $env:CODEX_THREAD_ID
    createdAtUtc = (Get-Date).ToUniversalTime().ToString("o")
  } | ConvertTo-Json -Depth 4

  Write-Utf8NoBom -Path $lockPath -Text $lock
}

Write-Host ""
Write-Host "Codex start ready."
Write-Host "mode=$mode"
Write-Host "branch=$branch"
Write-Host "path=$worktreePath"
Write-Host "next=Set-Location '$worktreePath'"
