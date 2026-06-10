# Descarga node.exe, yt-dlp.exe y WinSW.exe portables para empaquetar con el instalador.

$BinsDir = Join-Path $PSScriptRoot "..\resources\bins"
New-Item -ItemType Directory -Force -Path $BinsDir | Out-Null

Write-Host "Descargando yt-dlp.exe..."
Invoke-WebRequest `
  -Uri "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe" `
  -OutFile (Join-Path $BinsDir "yt-dlp.exe")

Write-Host "Descargando WinSW.exe..."
Invoke-WebRequest `
  -Uri "https://github.com/winsw/winsw/releases/download/v3.0.0-alpha.11/WinSW-x64.exe" `
  -OutFile (Join-Path $BinsDir "WinSW.exe")

Write-Host "Descargando node.exe (portable)..."
$NodeZip = Join-Path $env:TEMP "node-portable.zip"
Invoke-WebRequest `
  -Uri "https://nodejs.org/dist/v22.16.0/node-v22.16.0-win-x64.zip" `
  -OutFile $NodeZip

Write-Host "Extrayendo node.exe..."
$ExtractDir = Join-Path $env:TEMP "node-extract"
Expand-Archive -Path $NodeZip -DestinationPath $ExtractDir -Force
$NodeExe = Get-ChildItem -Path $ExtractDir -Filter "node.exe" -Recurse | Select-Object -First 1
Copy-Item $NodeExe.FullName (Join-Path $BinsDir "node.exe")

Remove-Item -Recurse -Force $NodeZip, $ExtractDir

Write-Host ""
Write-Host "Binarios listos en: $BinsDir"
Get-ChildItem $BinsDir | Format-Table Name, @{L='Size (MB)';E={[math]::Round($_.Length/1MB, 1)}}