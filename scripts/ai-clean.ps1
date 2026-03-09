param(
  [string]$Base = "main",
  [string]$WorktreeRoot = ".worktrees",
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

  if ($LockData.PSObject.Properties.Name -contains 'invalid') {
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
    throw 'Unable to list worktrees.'
  }

  foreach ($line in $lines) {
    if ($line -like 'worktree *') {
      if ($null -ne $current) {
        $records += [pscustomobject]$current
      }
      $current = [ordered]@{
        path = [System.IO.Path]::GetFullPath($line.Substring(9).Trim())
        branch = ''
      }
      continue
    }

    if ($null -eq $current) {
      continue
    }

    if ($line -like 'branch *') {
      $current.branch = $line.Substring(7).Trim()
    }
  }

  if ($null -ne $current) {
    $records += [pscustomobject]$current
  }

  return $records
}

function Resolve-BaseRef([string]$BaseName) {
  & git show-ref --verify --quiet "refs/remotes/origin/$BaseName"
  if ($LASTEXITCODE -eq 0) {
    return "origin/$BaseName"
  }

  & git show-ref --verify --quiet "refs/heads/$BaseName"
  if ($LASTEXITCODE -eq 0) {
    return $BaseName
  }

  return $null
}

$repoTopLevel = Get-CommandText -Command { git rev-parse --show-toplevel } -ErrorMessage 'Not inside a git repository.'
if (-not $repoTopLevel) {
  throw 'Not inside a git repository.'
}
$repoTopLevel = [System.IO.Path]::GetFullPath($repoTopLevel)

$gitCommonDir = Get-CommandText -Command { git rev-parse --path-format=absolute --git-common-dir } -ErrorMessage 'Unable to resolve git common directory.'
if (-not $gitCommonDir) {
  throw 'Unable to resolve git common directory.'
}

$commonRoot = Split-Path -Parent $gitCommonDir
if (-not $commonRoot) {
  throw "Unable to resolve repository root from '$gitCommonDir'."
}
$commonRoot = [System.IO.Path]::GetFullPath($commonRoot)
$managedRoot = [System.IO.Path]::GetFullPath((Join-Path $commonRoot $WorktreeRoot))

Set-Location $commonRoot
$baseRef = Resolve-BaseRef -BaseName $Base

$cleaned = New-Object System.Collections.Generic.List[string]
$skipped = New-Object System.Collections.Generic.List[string]
$worktreeRecords = Get-WorktreeRecords
$registered = @{}
foreach ($record in $worktreeRecords) {
  $registered[$record.path] = $record
}

if (Test-Path $managedRoot -PathType Container) {
  $directories = Get-ChildItem -LiteralPath $managedRoot -Directory -Force
  foreach ($directory in $directories) {
    $worktreePath = [System.IO.Path]::GetFullPath($directory.FullName)
    if ($worktreePath -eq $repoTopLevel) {
      $skipped.Add("current worktree: $worktreePath")
      continue
    }

    $lockPath = Join-Path $worktreePath '.codex-session.lock'
    $lockData = Read-Lock -Path $lockPath
    $lockActive = Test-LockActive -LockData $lockData
    if ($lockActive -and -not $Force) {
      $skipped.Add("active lock: $worktreePath")
      continue
    }

    $hasStaleLock = (Test-Path $lockPath -PathType Leaf) -and -not $lockActive
    if ($hasStaleLock) {
      Remove-Item -LiteralPath $lockPath -Force
      $cleaned.Add("removed stale lock: $lockPath")
    }

    if ($registered.ContainsKey($worktreePath)) {
      $record = $registered[$worktreePath]
      if ($record.branch -like 'refs/heads/*') {
        $branchName = $record.branch.Substring(11)
      }
      else {
        $branchName = Get-CommandText -Command { git -C $worktreePath branch --show-current } -ErrorMessage "Unable to determine branch for '$worktreePath'."
      }

      $statusLines = @(& git -C $worktreePath status --short)
      if ($LASTEXITCODE -ne 0) {
        $skipped.Add("status unavailable: $worktreePath")
        continue
      }

      if ($statusLines.Count -gt 0) {
        $skipped.Add("dirty worktree: $worktreePath")
        continue
      }

      $isMerged = $false
      if ($baseRef -and $branchName) {
        & git merge-base --is-ancestor $branchName $baseRef
        $isMerged = ($LASTEXITCODE -eq 0)
      }

      if (-not $isMerged -and -not $Force) {
        $skipped.Add("unmerged branch: $worktreePath")
        continue
      }

      if ($Force) {
        Invoke-Checked "Remove worktree '$worktreePath'" { git worktree remove --force $worktreePath }
      }
      else {
        Invoke-Checked "Remove worktree '$worktreePath'" { git worktree remove $worktreePath }
      }
      $cleaned.Add("removed worktree: $worktreePath")
      continue
    }

    if (Test-Path (Join-Path $worktreePath '.git')) {
      if ($Force) {
        Remove-Item -LiteralPath $worktreePath -Recurse -Force
        $cleaned.Add("removed orphan worktree directory: $worktreePath")
      }
      else {
        $skipped.Add("orphan worktree directory requires -Force: $worktreePath")
      }
      continue
    }

    Remove-Item -LiteralPath $worktreePath -Recurse -Force
    $cleaned.Add("removed stale directory: $worktreePath")
  }
}

Invoke-Checked 'Prune stale git worktree metadata' { git worktree prune --expire=7.days.ago }
$worktreeRecords = Get-WorktreeRecords
$usedBranches = @{}
foreach ($record in $worktreeRecords) {
  if ($record.branch -like 'refs/heads/*') {
    $usedBranches[$record.branch.Substring(11)] = $true
  }
}

$aiBranches = & git for-each-ref --format='%(refname:short)' refs/heads/ai
if ($LASTEXITCODE -ne 0) {
  throw 'Unable to list ai branches.'
}

foreach ($branchName in $aiBranches) {
  if (-not $branchName) {
    continue
  }

  if ($usedBranches.ContainsKey($branchName)) {
    $skipped.Add("branch in use: $branchName")
    continue
  }

  if (-not $baseRef) {
    $skipped.Add("base ref missing for branch cleanup: $branchName")
    continue
  }

  & git merge-base --is-ancestor $branchName $baseRef
  if ($LASTEXITCODE -ne 0) {
    $skipped.Add("branch not merged: $branchName")
    continue
  }

  Invoke-Checked "Delete merged local branch '$branchName'" { git branch -d $branchName }
  $cleaned.Add("deleted branch: $branchName")
}

Write-Host ''
Write-Host 'Cleanup summary:'
if ($cleaned.Count -eq 0) {
  Write-Host '- cleaned: none'
}
else {
  foreach ($entry in $cleaned) {
    Write-Host "- cleaned: $entry"
  }
}

if ($skipped.Count -eq 0) {
  Write-Host '- skipped: none'
}
else {
  foreach ($entry in $skipped) {
    Write-Host "- skipped: $entry"
  }
}