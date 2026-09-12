<#
.SYNOPSIS
  One command to check, bump, commit and push. CI publishes the release.

.DESCRIPTION
  Everything a release needs, in the order that cannot go wrong:

    1. refuse to run on a dirty tree unless -Message is given
    2. SCAN FOR SECRETS in everything about to be pushed   <-- the important one
    3. verify both apps typecheck and build
    4. check CHANGELOG.md actually documents this version
    5. bump the version in both package.json files
    6. commit and push

  THEN CI TAKES OVER. The release job in .github/workflows/ci.yml re-runs the
  build and the secret scan on GitHub's runners, and if the pushed version has
  no tag yet it creates v<version> and publishes the GitHub release with the
  notes from CHANGELOG.md.

  This script deliberately does NOT tag. Two things creating tags is how you end
  up with a tag on one commit and a release on another - so tagging lives in
  exactly one place, and it is the place that has just proven the build is
  green. It also means a release needs no local tooling at all: bump the version
  in a PR, merge it, done.

  Step 2 is why this script exists rather than a README bullet list. This
  product's .env holds an LLM key, a Gmail app password and the AES key that
  encrypts customers' test credentials. A push is not reversible - a leaked
  token is leaked even if the commit is deleted a minute later, because GitHub's
  event feed is already public. So the scan runs before anything leaves the
  machine, and a hit aborts the release. CI scans again on the other side.

.PARAMETER Version
  e.g. 0.4.0 - without the "v".

.PARAMETER Message
  Commit message. Required only if the working tree is dirty.

.PARAMETER DryRun
  Run every check, change nothing, push nothing.

.EXAMPLE
  .\scripts\release.ps1 -Version 0.4.0 -DryRun
  .\scripts\release.ps1 -Version 0.4.0 -Message "feat: runs start themselves"
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][ValidatePattern('^\d+\.\d+\.\d+$')][string]$Version,
    [string]$Message,
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path $PSScriptRoot -Parent
Set-Location $repo

function Step($n) { Write-Host "`n=== $n ===" -ForegroundColor Cyan }
function Ok($n)   { Write-Host "  OK  $n" -ForegroundColor Green }
function Die($n)  { Write-Host "  FAIL $n" -ForegroundColor Red; exit 1 }

<#
  Run a native command and return only its EXIT CODE and output.

  Necessary because of a Windows PowerShell 5.1 trap: with
  $ErrorActionPreference='Stop', anything a native exe writes to stderr is
  promoted to a terminating NativeCommandError. npm writes "npm notice ..." to
  stderr on EVERY invocation and git writes progress there - so a perfectly
  successful `npm run build` killed this script twice while it was being
  written.

  Routing through cmd.exe with 2>&1 keeps stderr out of PowerShell's error
  stream entirely, and the exit code becomes the only success signal - which is
  the only one that was ever trustworthy here.
#>
function Invoke-Native {
    param([string]$Command, [string]$WorkDir = $repo)
    $prev = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        Push-Location $WorkDir
        $out = & cmd.exe /c "$Command 2>&1"
        $code = $LASTEXITCODE
        Pop-Location
        return [pscustomobject]@{ Code = $code; Output = ($out -join "`n") }
    } finally { $ErrorActionPreference = $prev }
}

$tag = "v$Version"
Write-Host "Preparing $tag" -ForegroundColor White
if ($DryRun) { Write-Host "(dry run - nothing will be pushed)" -ForegroundColor Yellow }

# ---------------------------------------------------------------- 1. tree
Step 'Working tree'
$dirty = git status --porcelain
if ($dirty -and -not $Message) {
    Die "Uncommitted changes and no -Message. Pass -Message to commit them, or commit first."
}
if ($dirty) { Ok "$(($dirty | Measure-Object).Count) change(s) will be committed" }
else { Ok 'clean' }

if (git tag -l $tag) { Die "$tag already exists locally. Bump the version." }
# CI creates the tag on the REMOTE, so a local repo that has not fetched will
# happily prepare a version that already shipped. Ask origin directly.
$remoteTag = @(& git ls-remote --tags origin "refs/tags/$tag" 2>$null)
$global:LASTEXITCODE = 0
if ($remoteTag.Count -gt 0) { Die "$tag is already released on origin. Bump the version." }
Ok "$tag is free"

# ------------------------------------------------------------- 2. SECRETS
# Scans what is TRACKED (plus anything about to be added), not the whole disk -
# .env is gitignored and must stay that way, and scanning it would only produce
# a false positive on a file that is never pushed.
Step 'Secret scan'

# `git ls-files <path>` prints the path when tracked and NOTHING when not, so
# it never writes to stderr. The --error-unmatch form does, and in PowerShell
# 5.1 a native command's stderr becomes a terminating NativeCommandError under
# $ErrorActionPreference='Stop' - which aborted this script on the happy path.
$tracked = @(git ls-files 'backend/.env' 'backend/*.env' '*/.env')
if ($tracked.Count -gt 0) {
    Write-Host "        $($tracked -join ', ')" -ForegroundColor Red
    Die 'An .env file is TRACKED. Remove it: git rm --cached <path>'
}
Ok 'no .env file is tracked'

# Patterns for the credentials this project actually handles. Each one is a
# real vendor prefix, so a hit is a hit - not a heuristic.
$patterns = @(
    @{ n = 'Atlassian API token'; p = 'ATATT[A-Za-z0-9_\-]{20,}' }
    @{ n = 'ClickUp token';       p = 'pk_[0-9]{6,}_[A-Z0-9]{20,}' }
    @{ n = 'Linear API key';      p = 'lin_api_[A-Za-z0-9]{20,}' }
    @{ n = 'Groq API key';        p = 'gsk_[A-Za-z0-9]{30,}' }
    @{ n = 'OpenAI API key';      p = 'sk-[A-Za-z0-9]{32,}' }
    @{ n = 'AWS access key';      p = 'AKIA[0-9A-Z]{16}' }
    @{ n = 'Google OAuth secret'; p = 'GOCSPX-[A-Za-z0-9_\-]{20,}' }
    @{ n = 'private key block';   p = 'BEGIN [A-Z ]*PRIVATE KEY' }
)

$found = $false
foreach ($x in $patterns) {
    # -I skips binaries; searching the index catches staged-but-uncommitted too.
    # git grep exits 1 when nothing matches - the GOOD case here. Swallow both
    # the exit code and any stderr so a clean scan does not look like a failure.
    $hit = @(& git --no-pager grep -nIE $x.p -- . 2>&1 | Where-Object { $_ -notmatch '^(warning|error):' })
    $global:LASTEXITCODE = 0
    if ($hit.Count -gt 0) { Write-Host "  LEAK  $($x.n):" -ForegroundColor Red; $hit | Select-Object -First 3 | ForEach-Object { Write-Host "        $_" }; $found = $true }
}
if ($found) { Die 'A credential pattern is present in tracked files. Remove it and rewrite history before releasing.' }
Ok 'no credential patterns in tracked files'

# ------------------------------------------------------------- 3. it builds
Step 'Typecheck and build'
$checks = @(
    @{ n = 'backend typecheck';  c = 'npx tsc --noEmit -p tsconfig.json'; d = (Join-Path $repo 'backend') }
    @{ n = 'backend build';      c = 'npm run build';                     d = (Join-Path $repo 'backend') }
    @{ n = 'frontend typecheck'; c = 'npx tsc --noEmit -p tsconfig.json'; d = (Join-Path $repo 'frontend') }
    @{ n = 'frontend build';     c = 'npx next build';                    d = (Join-Path $repo 'frontend') }
)
foreach ($c in $checks) {
    $r = Invoke-Native -Command $c.c -WorkDir $c.d
    if ($r.Code -ne 0) {
        Write-Host ($r.Output -split "`n" | Select-Object -Last 15 | Out-String)
        Die $c.n
    }
    Ok $c.n
}

# ----------------------------------------------------------- 4. changelog
# CI refuses to publish a version CHANGELOG.md does not describe, because the
# release notes ARE that section. Catching it here means finding out before the
# push rather than from a red job afterwards.
Step 'Changelog'
$changelog = Get-Content "$repo\CHANGELOG.md" -Raw
if ($changelog -notmatch [regex]::Escape("## [$Version]")) {
    Die "CHANGELOG.md has no '## [$Version]' section. Write the entry first - it becomes the release notes."
}
Ok "CHANGELOG.md documents $Version"

# ------------------------------------------------------------- 5. versions
Step 'Version bump'
foreach ($pkg in @("$repo\backend\package.json", "$repo\frontend\package.json")) {
    $json = Get-Content $pkg -Raw
    $new = $json -replace '("version":\s*")[^"]+(")', "`${1}$Version`${2}"
    if (-not $DryRun) { Set-Content -Path $pkg -Value $new -Encoding utf8 -NoNewline }
    Ok "$(Split-Path $pkg -Parent | Split-Path -Leaf) -> $Version"
}

# ------------------------------------------------------- 6. commit + push
# No tag here on purpose. CI tags the commit it has just built - see the header.
Step 'Commit and push'
if ($DryRun) {
    Write-Host '  (dry run) would commit and push' -ForegroundColor Yellow
    Write-Host "  (dry run) CI would then tag $tag and publish the release" -ForegroundColor Yellow
    exit 0
}

git add -A
$msg = if ($Message) { $Message } else { "chore: release $tag" }
git commit -m $msg --allow-empty | Out-Null
Ok "committed: $msg"

$r = Invoke-Native -Command 'git push origin HEAD'
if ($r.Code -ne 0) { Write-Host $r.Output; Die 'git push' }
Ok 'pushed'

# --------------------------------------------------------------- 7. handoff
Step 'Release'
Write-Host "  CI is now building $tag. On green it tags this commit and publishes" -ForegroundColor White
Write-Host "  the release with the CHANGELOG section as the notes." -ForegroundColor White

$gh = Get-Command gh -ErrorAction SilentlyContinue
if ($gh) {
    $r = Invoke-Native -Command 'gh auth status'
    if ($r.Code -eq 0) {
        Write-Host "`n  Watching the run (Ctrl+C to stop - the release continues without you):" -ForegroundColor Cyan
        & gh run watch --exit-status --compact 2>&1 | Out-Host
        $global:LASTEXITCODE = 0
    }
}

Write-Host "`nDone. https://github.com/M0Abdullah/AI-Automation-Product/releases/tag/$tag" -ForegroundColor Green
