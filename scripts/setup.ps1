# Olive Storage - dev environment check + install (safe to re-run on any PC).
# Run: double-click setup.cmd in the project root, or:  powershell -ExecutionPolicy Bypass -File scripts\setup.ps1

$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

function Refresh-Path {
    $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User') + ";$env:USERPROFILE\.cargo\bin"
}
function Has($cmd) { [bool](Get-Command $cmd -ErrorAction SilentlyContinue) }
function Ok($msg)   { Write-Host "[ OK ] $msg" -ForegroundColor Green }
function Todo($msg) { Write-Host "[ .. ] $msg" -ForegroundColor Yellow }
function Fail($msg) { Write-Host "[FAIL] $msg" -ForegroundColor Red }

function Winget-Install($id, $extra = @()) {
    winget install --id $id -e --accept-package-agreements --accept-source-agreements @extra
    Refresh-Path
}

Refresh-Path
Write-Host "`n== Olive Storage environment check ==`n"

if (-not (Has winget)) { Fail 'winget not found. Update "App Installer" from the Microsoft Store, then re-run.'; exit 1 }

# Git
if (Has git) { Ok "Git $(git --version)" } else { Todo 'Installing Git...'; Winget-Install 'Git.Git'; if (Has git) { Ok 'Git installed' } else { Fail 'Git missing - reopen terminal and re-run' } }

# Node
if (Has node) { Ok "Node $(node --version)" } else { Todo 'Installing Node LTS...'; Winget-Install 'OpenJS.NodeJS.LTS'; if (Has node) { Ok 'Node installed' } else { Fail 'Node missing - reopen terminal and re-run' } }

# Visual Studio C++ Build Tools (needed by Rust/Tauri on Windows)
$vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
$hasVC = $false
if (Test-Path $vswhere) {
    $vsPath = & $vswhere -products * -property installationPath | Select-Object -First 1
    if ($vsPath) { $hasVC = [bool](Get-ChildItem "$vsPath\VC\Tools\MSVC\*\bin\Hostx64\x64\link.exe" -ErrorAction SilentlyContinue) }
}
if ($hasVC) { Ok 'Visual Studio C++ Build Tools' } else {
    Todo 'Installing Visual Studio C++ Build Tools (large, accept the admin prompt)...'
    Winget-Install 'Microsoft.VisualStudio.2022.BuildTools' @('--override', '--wait --passive --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended')
    if (Test-Path $vswhere) { Ok 'Build Tools installed (a restart may be needed)' } else { Fail 'Build Tools install did not finish' }
}

# WebView2 runtime
$wv = Get-ItemProperty 'HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}' -ErrorAction SilentlyContinue
if ($wv) { Ok "WebView2 $($wv.pv)" } else { Todo 'Installing WebView2...'; Winget-Install 'Microsoft.EdgeWebView2Runtime' }

# Rust
if (Has rustc) { Ok "Rust $(rustc --version)" } else {
    Todo 'Installing Rust (rustup)...'; Winget-Install 'Rustlang.Rustup'
    if (Has rustup) { rustup default stable-x86_64-pc-windows-msvc; Refresh-Path }
    if (Has rustc) { Ok "Rust $(rustc --version)" } else { Fail 'Rust missing - reopen terminal and re-run' }
}

# Git identity + remote
if (Has git) {
    if (-not (git config --global user.name))  { Todo 'Set git identity: git config --global user.name "Your Name"' }
    if (-not (git config --global user.email)) { Todo 'Set git identity: git config --global user.email "you@example.com"' }
    if (Test-Path "$root\.git") { Ok "Git repo, remote: $(git remote get-url origin 2>$null)" } else { Todo 'Not a git repo yet (run git init / clone)' }
}

# Project dependencies
if ((Test-Path "$root\package.json") -and (Has npm)) {
    Todo 'Running npm install...'; npm install
    Ok 'npm dependencies installed'
}

Write-Host "`nDone. If anything was just installed, close and reopen the terminal before building.`n"
