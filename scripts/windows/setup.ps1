# Congruence Eye - one-click setup for Windows (steps 2-5 of the install guide)
#   1. checks Docker Desktop        2. creates .env with strong random passwords
#   3. asks the staff uniform colour 4. builds and starts everything (docker compose)
#   5. creates your store + edge device key and connects the AI service
# Safe to run again: it re-uses what already exists. A log is written to setup-log.txt.
# Plain ASCII on purpose (Windows PowerShell 5.1 reads scripts as ANSI).

$ErrorActionPreference = 'Stop'
$Root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Set-Location $Root
$Base = 'http://localhost:8080'
try { Start-Transcript -Path (Join-Path $Root 'setup-log.txt') -Append | Out-Null } catch {}

function Say($msg, $color = 'Gray') { Write-Host $msg -ForegroundColor $color }
function Step($n, $msg) { Write-Host ''; Write-Host "[$n/6] $msg" -ForegroundColor Cyan }
function Fail($msg) {
  Write-Host ''; Write-Host "STOPPED: $msg" -ForegroundColor Red
  Write-Host 'Fix the problem above and double-click START-HERE.bat again (it continues where it stopped).' -ForegroundColor Yellow
  try { Stop-Transcript | Out-Null } catch {}
  exit 1
}
function WriteUtf8NoBom($path, $text) {
  # docker compose cannot read a .env that starts with a byte-order mark
  [IO.File]::WriteAllText($path, ($text -replace "`r`n", "`n"), (New-Object Text.UTF8Encoding($false)))
}
function NewSecret($len) {
  # letters + digits only: valid for SQL Server and never mis-read by docker compose ($, #, quotes)
  $chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'.ToCharArray()
  $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
  $bytes = New-Object byte[] $len; $rng.GetBytes($bytes)
  $s = -join ($bytes | ForEach-Object { $chars[$_ % $chars.Length] })
  return 'Ce' + $s + '9'   # guarantees upper, lower and digit
}
function GetEnv($text, $key) {
  $m = [regex]::Match($text, "(?m)^$key=(.*)$")
  if ($m.Success) { return $m.Groups[1].Value.Trim() } else { return $null }
}
function SetEnv($text, $key, $value) {
  if ([regex]::IsMatch($text, "(?m)^$key=")) { return [regex]::Replace($text, "(?m)^$key=.*$", "$key=$value") }
  return $text.TrimEnd() + "`n$key=$value`n"
}
function Api($method, $path, $body = $null, $token = $null) {
  $h = @{}
  if ($token) { $h['Authorization'] = "Bearer $token" }
  $p = @{ Method = $method; Uri = "$Base$path"; Headers = $h; TimeoutSec = 30; UseBasicParsing = $true }
  if ($body -ne $null) { $p['Body'] = ($body | ConvertTo-Json -Depth 6); $p['ContentType'] = 'application/json' }
  return Invoke-RestMethod @p
}
function Ask($prompt, $default) {
  $v = Read-Host $prompt
  if ($v -eq $null -or [string]::IsNullOrWhiteSpace([string]$v)) { return $default }
  return ([string]$v).Trim()
}
function ApiError($err) {
  if ($err.ErrorDetails -and $err.ErrorDetails.Message) { return $err.ErrorDetails.Message }
  try {
    $r = $err.Exception.Response
    if ($r) { $sr = New-Object IO.StreamReader($r.GetResponseStream()); return "$([int]$r.StatusCode) $($sr.ReadToEnd())" }
  } catch {}
  return $err.Exception.Message
}

Write-Host '=============================================' -ForegroundColor Green
Write-Host '   Congruence Eye - setup on this computer' -ForegroundColor Green
Write-Host '=============================================' -ForegroundColor Green
Say "Folder: $Root"

# ------------------------------------------------------------------ 1. Docker
Step 1 'Checking this computer and Docker Desktop'
try {
  $ramGb = [math]::Round((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory / 1GB)
  if ($ramGb -lt 12) { Say "  WARNING: this computer has $ramGb GB RAM. 16 GB is recommended; it may run slowly." 'Yellow' }
  else { Say "  RAM: $ramGb GB (ok)" }
} catch {}
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  Fail 'Docker Desktop is not installed. Install it from https://www.docker.com/products/docker-desktop/ , restart the computer, open Docker Desktop once, then run this again.'
}
$dockerOk = $false
docker info *> $null; if ($LASTEXITCODE -eq 0) { $dockerOk = $true }
if (-not $dockerOk) {
  $dd = Join-Path $env:ProgramFiles 'Docker\Docker\Docker Desktop.exe'
  if (Test-Path $dd) { Say '  Starting Docker Desktop (can take 1-2 minutes)...'; Start-Process $dd | Out-Null }
  for ($i = 0; $i -lt 60 -and -not $dockerOk; $i++) {
    Start-Sleep -Seconds 5
    docker info *> $null; if ($LASTEXITCODE -eq 0) { $dockerOk = $true }
  }
}
if (-not $dockerOk) { Fail 'Docker Desktop is not running. Open Docker Desktop, wait until it says "Engine running", then run this again.' }
docker compose version *> $null
if ($LASTEXITCODE -ne 0) { Fail 'Your Docker Desktop is too old (no "docker compose"). Update Docker Desktop and run this again.' }
Say '  Docker Desktop is running.' 'Green'

# ------------------------------------------------------------------ 2. .env
Step 2 'Creating the settings file (.env) with strong passwords'
$envPath = Join-Path $Root '.env'
if (Test-Path $envPath) {
  $envText = [IO.File]::ReadAllText($envPath)
  Say '  .env already exists - keeping your existing passwords.'
} else {
  $envText = [IO.File]::ReadAllText((Join-Path $Root '.env.example'))
  Say '  New .env created.'
}
$changed = $false
foreach ($k in @('SA_PASSWORD', 'JWT_SECRET', 'RECORDER_SECRET')) {
  $v = GetEnv $envText $k
  if (-not $v -or $v -like 'Change-Me*' -or $v -like 'replace-with*') {
    $envText = SetEnv $envText $k (NewSecret 28); $changed = $true
  }
}
WriteUtf8NoBom $envPath $envText
if ($changed) { Say '  Random passwords written to .env (keep this file safe; do not share it).' 'Green' }
else { Say '  Passwords already set.' 'Green' }

# ------------------------------------------------------------------ 3. uniform colour
Step 3 'Staff uniform colour (so staff are not counted as customers)'
$aiEnvPath = Join-Path $Root 'ai-service.env'
$colours = [ordered]@{
  '1' = @('Red',             '[[[0,120,60],[8,255,255]],[[172,120,60],[179,255,255]]]')
  '2' = @('Orange',          '[[[10,120,80],[22,255,255]]]')
  '3' = @('Yellow',          '[[[23,100,80],[35,255,255]]]')
  '4' = @('Green',           '[[[36,80,50],[78,255,255]]]')
  '5' = @('Teal / sea green','[[[80,120,60],[95,255,255]]]')
  '6' = @('Blue',            '[[[96,100,50],[128,255,255]]]')
  '7' = @('Purple',          '[[[129,80,50],[150,255,255]]]')
  '8' = @('Pink / maroon',   '[[[151,80,60],[171,255,255]]]')
  '9' = @('Black (less reliable - many customers wear black)', '[[[0,0,0],[179,255,50]]]')
  '0' = @('White (less reliable)', '[[[0,0,190],[179,40,255]]]')
}
$existingAi = ''
if (Test-Path $aiEnvPath) { $existingAi = [IO.File]::ReadAllText($aiEnvPath) }
$currentName = $null
if ($existingAi -match '(?m)^# UNIFORM_NAME=(.*)$') { $currentName = $Matches[1].Trim() }
if ($currentName) { Say "  Current choice: $currentName (press Enter to keep it)" }
foreach ($key in $colours.Keys) { Say ("   {0}) {1}" -f $key, $colours[$key][0]) }
$pick = Ask '  Type the number of your staff uniform colour' ''
if ([string]::IsNullOrWhiteSpace($pick) -and $currentName) {
  Say "  Keeping: $currentName" 'Green'
} else {
  if (-not $colours.Contains($pick)) { Say '  Not a valid choice - using Teal for now (run again to change).' 'Yellow'; $pick = '5' }
  $name = $colours[$pick][0]; $hsv = $colours[$pick][1]
  $aiText = @"
# Shop-specific settings for the AI service (read by docker-compose.yml). Run START-HERE.bat again to change.
# UNIFORM_NAME=$name
STAFF_UNIFORM_HSV=$hsv
# Frames analysed per second per camera. On an i5 without graphics card keep 3-4 cameras at 5.
TARGET_FPS=5
"@
  WriteUtf8NoBom $aiEnvPath $aiText
  Say "  Saved: $name" 'Green'
}

# ------------------------------------------------------------------ 4. build + start
Step 4 'Building and starting the app (first time: 15-25 minutes, please wait)'
docker compose up -d --build
if ($LASTEXITCODE -ne 0) { Fail 'docker compose could not start the app. Read the red lines above (common causes: no internet, disk full, Docker short of memory).' }
Say '  Waiting for the app to answer at http://localhost:8080 ...'
$up = $false
for ($i = 0; $i -lt 120 -and -not $up; $i++) {
  try { $h = Api 'GET' '/api/health'; if ($h.status -eq 'ok') { $up = $true } } catch { Start-Sleep -Seconds 5 }
}
if (-not $up) {
  docker compose ps
  Fail 'The app did not come up within 10 minutes. Run "docker compose logs backend" in this folder and send the last lines to your IT person / Claude.'
}
Say '  The app is running.' 'Green'

# ------------------------------------------------------------------ 5. store + edge key
Step 5 'Creating your store and connecting the AI service'
$token = $null
try { $token = (Api 'POST' '/api/auth/login' @{ email = 'admin@congruence.in'; password = 'Password@123' }).accessToken }
catch {
  Say '  The default admin password has already been changed.' 'Yellow'
  $sec = Read-Host '  Enter the current password of admin@congruence.in' -AsSecureString
  $plain = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec))
  try { $token = (Api 'POST' '/api/auth/login' @{ email = 'admin@congruence.in'; password = $plain }).accessToken }
  catch { Fail 'Wrong admin password.' }
}

$stores = @(Api 'GET' '/api/stores' $null $token | ForEach-Object { $_ } | Where-Object { $_ -and $_.id })
$store = $null
if ($stores.Count -gt 0) {
  Say '  Stores already in the app:'
  for ($i = 0; $i -lt $stores.Count; $i++) { Say ("   {0}) {1} ({2})" -f ($i + 1), $stores[$i].name, $stores[$i].code) }
  $sel = Ask '  Type the number of the store this computer is for (or press Enter to add a new store)' ''
  if ($sel -match '^\d+$' -and [int]$sel -ge 1 -and [int]$sel -le $stores.Count) { $store = $stores[[int]$sel - 1] }
}
if (-not $store) {
  $sName = Ask '  Store name (example: Congruence T Nagar)' 'My Store'
  $sCode = Ask '  Short store code (example: TNAGAR)' 'STORE1'
  $sCode = ($sCode.ToUpper() -replace '[^A-Z0-9_-]', ''); if (-not $sCode) { $sCode = 'STORE1' }
  $sCity = Ask '  City (example: Chennai)' 'Chennai'
  if ($sCity -match '\d') { $sCity = 'Chennai' }
  $open = Ask '  Opening time HH:mm (Enter = 10:00)' '10:00'; if ($open -notmatch '^\d{2}:\d{2}$') { $open = '10:00' }
  $close = Ask '  Closing time HH:mm (Enter = 21:30)' '21:30'; if ($close -notmatch '^\d{2}:\d{2}$') { $close = '21:30' }
  $regions = @(Api 'GET' '/api/regions' $null $token | ForEach-Object { $_ } | Where-Object { $_ -and $_.id })
  $region = $regions | Where-Object { $sCity -and $_.name -eq $sCity } | Select-Object -First 1
  if (-not $region -and $sCity) { try { $region = Api 'POST' '/api/regions' @{ name = $sCity } $token } catch {} }
  if (-not $region) { $region = $regions | Select-Object -First 1 }
  if (-not $region) { $region = Api 'POST' '/api/regions' @{ name = 'Main' } $token }
  $body = @{ code = $sCode; name = $sName; regionId = [int]$region.id; city = $sCity; timezone = 'Asia/Kolkata'; openTime = $open; closeTime = $close }
  try { $store = Api 'POST' '/api/stores' $body $token }
  catch { Fail ("Could not create the store: " + (ApiError $_)) }
  Say "  Store created: $($store.name)" 'Green'
}

$envText = [IO.File]::ReadAllText($envPath)
$key = GetEnv $envText 'EDGE_API_KEY'
$devices = @(Api 'GET' "/api/edge-devices?storeId=$($store.id)" $null $token | ForEach-Object { $_ } | Where-Object { $_ -and $_.id })
$needKey = (-not $key) -or ($key -eq 'dev-edge-key-store-1') -or ($devices.Count -eq 0)
if ($needKey) {
  try { $dev = Api 'POST' '/api/edge-devices' @{ storeId = [int]$store.id; name = "$($store.code) edge PC ($env:COMPUTERNAME)" } $token }
  catch { Fail ("Could not create the edge device: " + (ApiError $_)) }
  $envText = SetEnv $envText 'EDGE_API_KEY' $dev.apiKey
  WriteUtf8NoBom $envPath $envText
  Say '  Edge device key created and saved in .env.' 'Green'
} else {
  Say '  Edge device key already set - keeping it.'
}
Say '  Restarting the AI service with the key...'
docker compose up -d ai-service
if ($LASTEXITCODE -ne 0) { Fail 'Could not restart the AI service.' }

# ------------------------------------------------------------------ 6. check
Step 6 'Checking that the AI service is connected'
$connected = $false
for ($i = 0; $i -lt 24 -and -not $connected; $i++) {
  Start-Sleep -Seconds 5
  try {
    $d = @(Api 'GET' "/api/edge-devices?storeId=$($store.id)" $null $token) | Where-Object { $_.lastSeenAt } | Select-Object -First 1
    if ($d) { $connected = $true }
  } catch {}
}
if ($connected) { Say '  AI service is connected to the app.' 'Green' }
else { Say '  The AI service has not reported in yet. It can take a few minutes; check Admin > Edge devices > Last seen. If it stays empty, run "docker compose logs ai-service".' 'Yellow' }

Write-Host ''
Write-Host '=============================================' -ForegroundColor Green
Write-Host '  DONE. Steps 2-5 are complete.' -ForegroundColor Green
Write-Host '=============================================' -ForegroundColor Green
Say "  Open: $Base   (opening it for you now)"
Say '  Login: admin@congruence.in  /  Password@123  -> CHANGE THIS PASSWORD after you log in.' 'Yellow'
Say '  Do NOT run "seed:prod" - it adds fake demo stores and data.' 'Yellow'
Say '  Next, AT THE SHOP: Admin > Stores > your store > Recorders > Add recorder (DVR IP, user, password),'
Say '  then Test selected, add the channels as cameras and draw the entrance line.'
Say '  Before that, you can run CHECK-DVR.bat at the shop to test the DVR connection.'
try { Start-Process $Base | Out-Null } catch {}
try { Stop-Transcript | Out-Null } catch {}
