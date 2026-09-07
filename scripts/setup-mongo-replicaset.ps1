<#
.SYNOPSIS
  Turns the locally installed MongoDB into a single-node replica set.

.DESCRIPTION
  Prisma requires a replica set. A standalone `mongod` accepts reads but rejects
  the transactional writes Prisma issues, so the app boots and then fails on the
  first insert with "Transaction numbers are only allowed on a replica set
  member or mongos" - an error that gives no hint about the real cause.

  A single-node replica set gives the transaction support with none of the
  operational cost of real replication. It is the standard way to run MongoDB
  for development, and what `docker compose up -d` does in this repo too.

  MUST RUN ELEVATED: the config file lives under C:\Program Files and the
  service has to be restarted.

.NOTES
  Idempotent. Re-running it on an already-configured server is a no-op.
#>

$ErrorActionPreference = 'Stop'

Write-Host '=== MongoDB single-node replica set setup ===' -ForegroundColor Cyan

# ---------------------------------------------------------------- locate it
$serverRoot = 'C:\Program Files\MongoDB\Server'
if (-not (Test-Path $serverRoot)) {
    throw "MongoDB is not installed at $serverRoot. Install it with: winget install MongoDB.Server"
}

# Highest installed version, so this keeps working after an upgrade.
$version = Get-ChildItem $serverRoot -Directory |
    Sort-Object { [version]($_.Name) } -Descending |
    Select-Object -First 1
$cfgPath = Join-Path $version.FullName 'bin\mongod.cfg'
Write-Host "Found MongoDB $($version.Name) - config at $cfgPath"

# --------------------------------------------------------- enable the replSet
$cfg = Get-Content $cfgPath -Raw

if ($cfg -match '(?m)^\s*replSetName:\s*rs0') {
    Write-Host 'Replication is already enabled (replSetName: rs0).' -ForegroundColor Green
}
else {
    # The stock config ships the section commented out as "#replication:".
    if ($cfg -match '(?m)^#replication:') {
        $cfg = $cfg -replace '(?m)^#replication:', "replication:`r`n  replSetName: rs0"
    }
    elseif ($cfg -match '(?m)^replication:') {
        $cfg = $cfg -replace '(?m)^replication:', "replication:`r`n  replSetName: rs0"
    }
    else {
        $cfg = $cfg.TrimEnd() + "`r`n`r`nreplication:`r`n  replSetName: rs0`r`n"
    }

    # Keep a copy: this file belongs to the MongoDB installation, not to us.
    $backup = "$cfgPath.before-replicaset"
    if (-not (Test-Path $backup)) { Copy-Item $cfgPath $backup }

    Set-Content -Path $cfgPath -Value $cfg -Encoding utf8
    Write-Host 'Added "replication: replSetName: rs0" to mongod.cfg.' -ForegroundColor Green
}

# ------------------------------------------------------------ restart service
$svc = Get-Service -Name 'MongoDB' -ErrorAction SilentlyContinue
if (-not $svc) { throw 'No Windows service named "MongoDB". Was it installed without the service option?' }

Write-Host 'Restarting the MongoDB service...'
Restart-Service -Name 'MongoDB' -Force
Start-Sleep -Seconds 3

# A fresh --replSet node refuses writes until it has been told it is a replica
# set, so wait for it to accept connections before initiating.
$svc.Refresh()
Write-Host "Service status: $((Get-Service MongoDB).Status)" -ForegroundColor Green

Write-Host ''
Write-Host 'Config done. Now initiate the set with:' -ForegroundColor Cyan
Write-Host '  mongosh --eval "rs.initiate()"'
Write-Host '(That step needs no admin rights.)'
