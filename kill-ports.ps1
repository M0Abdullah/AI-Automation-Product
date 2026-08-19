# Frees the ports this project uses, and kills any stray node process still
# holding files (which is what causes "EADDRINUSE" and Prisma's EPERM error).
#
#   .\kill-ports.ps1
#
# Safe to run any time. It only touches processes listening on these ports, or
# node processes whose command line points at this project folder.

$ports = 3000, 4000
$killed = @()

foreach ($port in $ports) {
  $conns = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
  foreach ($c in $conns) {
    $p = Get-Process -Id $c.OwningProcess -ErrorAction SilentlyContinue
    if ($p) {
      $killed += "  port $port  ->  PID $($p.Id)  ($($p.ProcessName))"
      Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
    }
  }
}

# Watch-mode compilers keep running after the server dies, and they hold the
# Prisma query-engine DLL open. Clear those too.
Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -like '*AI Automation Product*' } |
  ForEach-Object {
    $killed += "  stray node   ->  PID $($_.ProcessId)"
    Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
  }

Start-Sleep -Seconds 2

if ($killed.Count -eq 0) {
  Write-Host "Nothing was running. Ports are already free." -ForegroundColor Green
} else {
  Write-Host "Stopped:" -ForegroundColor Yellow
  $killed | ForEach-Object { Write-Host $_ }
}

Write-Host ""
foreach ($port in $ports) {
  $busy = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
  if ($busy) {
    Write-Host "  $port : STILL BUSY" -ForegroundColor Red
  } else {
    Write-Host "  $port : free" -ForegroundColor Green
  }
}
Write-Host ""
Write-Host "Now run:  cd backend; npm run start:dev    (and in another terminal)  cd frontend; npm run dev"
