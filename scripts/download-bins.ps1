# Descarga node.exe, yt-dlp.exe, WinSW.exe, ffmpeg.exe y deno.exe portables para empaquetar con el instalador.

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

Write-Host "Descargando ffmpeg (essentials)..."

$FFmpegZip = Join-Path $env:TEMP "ffmpeg.zip"

Invoke-WebRequest `
  -Uri "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip" `
  -OutFile $FFmpegZip

Write-Host "Extrayendo ffmpeg.exe..."

$FFmpegDir = Join-Path $env:TEMP "ffmpeg-extract"

Expand-Archive `
  -Path $FFmpegZip `
  -DestinationPath $FFmpegDir `
  -Force

$FFmpegExe = Get-ChildItem `
  -Path $FFmpegDir `
  -Filter "ffmpeg.exe" `
  -Recurse |
  Select-Object -First 1

Copy-Item `
  $FFmpegExe.FullName `
  (Join-Path $BinsDir "ffmpeg.exe")

Remove-Item -Recurse -Force $FFmpegDir, $FFmpegZip
Write-Host "Descargando deno.exe..."
Invoke-WebRequest `
  -Uri "https://github.com/denoland/deno/releases/latest/download/deno-x86_64-pc-windows-msvc.zip" `
  -OutFile (Join-Path $env:TEMP "deno.zip")

Write-Host "Extrayendo deno.exe..."
$DenoDir = Join-Path $env:TEMP "deno-extract"
Expand-Archive -Path (Join-Path $env:TEMP "deno.zip") -DestinationPath $DenoDir -Force
$DenoExe = Get-ChildItem -Path $DenoDir -Filter "deno.exe" -Recurse | Select-Object -First 1
Copy-Item $DenoExe.FullName (Join-Path $BinsDir "deno.exe")
Remove-Item -Recurse -Force $DenoDir, (Join-Path $env:TEMP "deno.zip")

Write-Host ""
Write-Host "Binarios listos en: $BinsDir"
Get-ChildItem $BinsDir | Format-Table Name, @{L='Size (MB)';E={[math]::Round($_.Length/1MB, 1)}}