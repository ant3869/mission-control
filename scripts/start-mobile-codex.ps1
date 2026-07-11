[CmdletBinding()]
param(
    [string]$RepoPath = (Get-Location).Path
)

$ErrorActionPreference = 'Stop'
$branch = 'mobile/capacitor-responsive-design'
$branchRef = "refs/heads/$branch"
$remoteRef = "origin/$branch"
$promptRelativePath = 'docs\superpowers\prompts\2026-07-11-codex-mobile-execution.md'

function Assert-LastExitCode {
    param([string]$Action)
    if ($LASTEXITCODE -ne 0) {
        throw "$Action failed with exit code $LASTEXITCODE."
    }
}

$repoRoot = (& git -C $RepoPath rev-parse --show-toplevel).Trim()
Assert-LastExitCode 'Locating the Git repository'

Write-Host "Fetching $remoteRef..." -ForegroundColor Cyan
& git -C $repoRoot fetch origin $branch
Assert-LastExitCode 'Fetching the mobile branch'

$existingWorktree = $null
$currentWorktree = $null
foreach ($line in (& git -C $repoRoot worktree list --porcelain)) {
    if ($line.StartsWith('worktree ')) {
        $currentWorktree = $line.Substring('worktree '.Length)
        continue
    }
    if ($line -eq "branch $branchRef") {
        $existingWorktree = $currentWorktree
    }
}
Assert-LastExitCode 'Reading Git worktrees'

if ($existingWorktree) {
    $worktree = $existingWorktree
    Write-Host "Using existing mobile worktree: $worktree" -ForegroundColor Green
} else {
    $worktree = Join-Path (Split-Path $repoRoot -Parent) 'mission-control-mobile-worktree'

    if (Test-Path $worktree) {
        $entries = @(Get-ChildItem -Force $worktree)
        if ($entries.Count -gt 0) {
            throw "The target worktree path already exists and is not registered with Git: $worktree"
        }
    }

    & git -C $repoRoot show-ref --verify --quiet $branchRef
    $localBranchExists = $LASTEXITCODE -eq 0

    if ($localBranchExists) {
        & git -C $repoRoot worktree add $worktree $branch
    } else {
        & git -C $repoRoot worktree add -b $branch $worktree $remoteRef
    }
    Assert-LastExitCode 'Creating the isolated mobile worktree'
    Write-Host "Created mobile worktree: $worktree" -ForegroundColor Green
}

& git -C $worktree pull --ff-only origin $branch
Assert-LastExitCode 'Updating the mobile worktree'

$dirty = @(& git -C $worktree status --porcelain)
Assert-LastExitCode 'Checking the mobile worktree status'
if ($dirty.Count -gt 0) {
    Write-Warning 'The mobile worktree has uncommitted changes. Codex will inspect them and resume cautiously rather than deleting them.'
}

$codexCommand = Get-Command codex -ErrorAction SilentlyContinue
if (-not $codexCommand) {
    throw 'Codex CLI was not found. Install it with: powershell -ExecutionPolicy ByPass -c "irm https://chatgpt.com/codex/install.ps1 | iex"'
}

& codex login status
if ($LASTEXITCODE -ne 0) {
    Write-Host 'Codex is not signed in. Starting the ChatGPT sign-in flow...' -ForegroundColor Yellow
    & codex login
    Assert-LastExitCode 'Signing in to Codex'
}

$promptPath = Join-Path $worktree $promptRelativePath
if (-not (Test-Path $promptPath)) {
    throw "Execution prompt not found: $promptPath"
}

$prompt = Get-Content $promptPath -Raw
Write-Host "Launching Codex in $worktree" -ForegroundColor Cyan
Write-Host 'Codex may request approval for Android SDK, Gradle cache, ADB, or other operations outside the worktree.' -ForegroundColor DarkGray

& codex -C $worktree --ask-for-approval on-request --sandbox workspace-write $prompt
$codexExit = $LASTEXITCODE
if ($codexExit -ne 0) {
    throw "Codex exited with code $codexExit. Re-run this script to resume from the worktree and progress ledger."
}
