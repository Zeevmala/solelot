#Requires -Version 7
<#
.SYNOPSIS
    Serve the app locally and expose it over HTTPS for testing on a phone.

.DESCRIPTION
    1. Starts dev-server.py on http://localhost:<Port> (for the PC).
    2. Opens a Cloudflare "quick tunnel" that gives a temporary public
       https://<random>.trycloudflare.com URL pointing at that server (for the phone).

    The phone gets a real, trusted HTTPS certificate, so it is a Secure Context
    (GPS, service worker and PWA install all work). No account, no certificate
    to install on the phone, no firewall rule. The URL changes on every run.

    One-time setup:  winget install --id Cloudflare.cloudflared
    Press Ctrl+C to stop both the tunnel and the server.

.EXAMPLE
    ./dev-https.ps1
    ./dev-https.ps1 -Port 8080
#>
param([int]$Port = 8000)

if (-not (Get-Command cloudflared -ErrorAction SilentlyContinue)) {
    Write-Host 'cloudflared is not installed. Install it once with:' -ForegroundColor Yellow
    Write-Host '    winget install --id Cloudflare.cloudflared'
    Write-Host 'then open a NEW terminal and run this script again.'
    exit 1
}

$python = if (Get-Command py -ErrorAction SilentlyContinue) { 'py' }
          elseif (Get-Command python -ErrorAction SilentlyContinue) { 'python' }
if (-not $python) {
    Write-Host 'Python not found. Install it with:  winget install --id Python.Python.3.12' -ForegroundColor Yellow
    exit 1
}

$server = Start-Process -FilePath $python `
    -ArgumentList @("`"$PSScriptRoot/dev-server.py`"", $Port) `
    -NoNewWindow -PassThru
Start-Sleep -Seconds 1
if ($server.HasExited) {
    Write-Host "Local server failed to start (is port $Port already in use? try -Port 8080)." -ForegroundColor Red
    exit 1
}

Write-Host 'Starting HTTPS tunnel (takes a few seconds)...'
$urlShown = $false
try {
    # cloudflared logs to stderr; show only the public URL and real errors.
    & cloudflared tunnel --no-autoupdate --url "http://127.0.0.1:$Port" 2>&1 | ForEach-Object {
        $line = "$_"
        if (-not $urlShown -and $line -match 'https://[a-z0-9-]+\.trycloudflare\.com') {
            $urlShown = $true
            $url = $Matches[0]
            try { Set-Clipboard -Value $url } catch { }
            Write-Host ''
            Write-Host "  PC    : http://localhost:$Port" -ForegroundColor Green
            Write-Host "  Phone : $url   (copied to clipboard)" -ForegroundColor Green
            Write-Host ''
            Write-Host '  Tip: open the phone URL in Chrome on the PC -> address bar Share -> QR code, then scan it.'
            Write-Host '  Ctrl+C to stop.'
            Write-Host ''
        }
        elseif ($line -match '\sERR\s') {
            Write-Host $line -ForegroundColor Red
        }
    }
}
finally {
    if (-not $server.HasExited) { Stop-Process -Id $server.Id -Force }
    Write-Host 'Stopped tunnel and local server.'
}
