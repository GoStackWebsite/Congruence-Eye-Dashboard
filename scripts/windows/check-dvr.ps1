# Congruence Eye - quick DVR / NVR connection check (run at the shop, on the same network as the DVR)
# Tests whether this computer can reach the DVR and which ports are open. Plain ASCII on purpose.
$ErrorActionPreference = 'Continue'
Write-Host '=== DVR connection check ===' -ForegroundColor Green
$ip = Read-Host 'DVR IP address (example: 192.168.1.64)'
if ([string]::IsNullOrWhiteSpace($ip)) { Write-Host 'No IP entered.' -ForegroundColor Red; exit 1 }
$ip = $ip.Trim()

Write-Host ''
Write-Host "Ping $ip ..." -ForegroundColor Cyan
if (Test-Connection -ComputerName $ip -Count 2 -Quiet) { Write-Host '  Reachable (ping ok)' -ForegroundColor Green }
else { Write-Host '  No ping reply (some DVRs block ping - the port tests below matter more)' -ForegroundColor Yellow }

function TestPort($port) {
  $c = New-Object Net.Sockets.TcpClient
  try { $ar = $c.BeginConnect($ip, $port, $null, $null); $ok = $ar.AsyncWaitHandle.WaitOne(2000) -and $c.Connected; return $ok }
  catch { return $false } finally { $c.Close() }
}
$ports = [ordered]@{ '554' = 'RTSP video stream (REQUIRED)'; '80' = 'Web page of the DVR'; '8000' = 'Hikvision / Prama / HiLook service port'; '37777' = 'CP Plus / Dahua service port'; '8554' = 'Alternative RTSP port' }
$open = @()
Write-Host ''
foreach ($k in @($ports.Keys)) {
  $p = [int]$k
  $ok = TestPort $p
  if ($ok) { $open += $p; Write-Host ("  Port {0,-6} OPEN    {1}" -f $p, $ports[$k]) -ForegroundColor Green }
  else { Write-Host ("  Port {0,-6} closed  {1}" -f $p, $ports[$k]) -ForegroundColor DarkGray }
}
Write-Host ''
if ($open -contains 8000) { Write-Host 'Brand hint: looks like HIKVISION (or Prama / HiLook).' -ForegroundColor Cyan }
elseif ($open -contains 37777) { Write-Host 'Brand hint: looks like CP PLUS or DAHUA.' -ForegroundColor Cyan }
if ($open -contains 554 -or $open -contains 8554) {
  Write-Host 'RESULT: GOOD - the DVR video port is reachable. Now add it in the app:' -ForegroundColor Green
  Write-Host '  http://localhost:8080 > Admin > Stores > your store > Recorders > Add recorder > Test selected'
} elseif ($open.Count -gt 0) {
  Write-Host 'RESULT: The DVR is reachable but RTSP (port 554) is closed.' -ForegroundColor Yellow
  Write-Host '  Open the DVR menu > Network > Advanced/Port settings and enable RTSP (port 554), then run this again.'
  if ($open -contains 80) { Write-Host "  You can also do this from a browser: http://$ip" }
} else {
  Write-Host 'RESULT: This computer cannot reach the DVR.' -ForegroundColor Red
  Write-Host '  - Is this computer on the SAME Wi-Fi / LAN as the DVR?'
  Write-Host '  - Is the IP correct? (DVR menu > Network shows it)'
}
Write-Host ''
