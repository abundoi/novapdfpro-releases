param(
    [switch]$SkipBuild,
    [switch]$SkipTests,
    [string]$SignCertThumbprint = "",
    [string]$TimestampUrl = "http://timestamp.digicert.com",
    [string]$PortalUrl = "",
    [string]$LicensePublicKeyPem = ""
)

function Invoke-AuthenticodeSign([string]$FilePath) {
    if ([string]::IsNullOrWhiteSpace($SignCertThumbprint)) { return }
    $signtool = Get-Command signtool.exe -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source
    if (-not $signtool) {
        $sdkBin = Get-ChildItem "${env:ProgramFiles(x86)}\Windows Kits\10\bin\*\x64\signtool.exe" -ErrorAction SilentlyContinue |
            Sort-Object FullName -Descending | Select-Object -First 1 -ExpandProperty FullName
        $signtool = $sdkBin
    }
    if (-not $signtool) {
        Write-Warning "signtool.exe not found; skipping Authenticode signature for $FilePath"
        return
    }
    Write-Host "   Signing $FilePath..." -ForegroundColor Cyan
    & $signtool sign /sha1 $SignCertThumbprint /fd SHA256 /tr $TimestampUrl /td SHA256 $FilePath
    if ($LASTEXITCODE -ne 0) { throw "Authenticode signing failed for $FilePath" }
}

$ErrorActionPreference = "Stop"
$csc = "C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
$installerDir = $PSScriptRoot
$root = Split-Path -Parent $installerDir
$workspaceRoot = Split-Path -Parent $root
$releaseDir = Join-Path $root "release"
$stagingDir = Join-Path $root "package-staging"
$appPackageZip = Join-Path $installerDir "app-package.zip"
$icoPath = Join-Path $installerDir "NovaPDFPro.ico"

if (-not (Test-Path $csc)) {
    throw "Microsoft C# Compiler not found at: $csc"
}

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "Building Consolidated Standalone Windows Installer" -ForegroundColor Cyan
Write-Host "Product: NovaPDFPro v01.31 (x64)" -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

# Stop any running processes that could lock release or staging files
Get-Process -Name "*NovaPDFPro*", "*EnterprisePDFPro*", "*Setup*" -ErrorAction SilentlyContinue |
    Stop-Process -Force -ErrorAction SilentlyContinue

# 0. Remove legacy / duplicate files from previous builds
Write-Host "0. Cleaning legacy & duplicate installer artifacts..." -ForegroundColor Yellow
$legacyPaths = @(
    (Join-Path $installerDir "EnterprisePDFPro-Portable.cs"),
    (Join-Path $installerDir "EnterprisePDFPro-Setup.cs"),
    (Join-Path $installerDir "Uninstall-EnterprisePDFPro.cs"),
    (Join-Path $installerDir "Uninstall-EnterprisePDFPro.exe"),
    (Join-Path $installerDir "EnterprisePDFPro.ico"),
    (Join-Path $installerDir "NovaPDFPro-Portable.cs"),
    (Join-Path $installerDir "package.ps1"),
    (Join-Path $root "native-launcher\EnterprisePDFPro.cs"),
    (Join-Path $root "EnterprisePDFPro.exe"),
    (Join-Path $root "EnterprisePDFPro-Setup-x64.exe"),
    (Join-Path $root "EnterprisePDFPro-Portable-x64.exe"),
    (Join-Path $root "NovaPDFPro.exe"),
    (Join-Path $root "NovaPDFPro-Setup-x64.exe"),
    (Join-Path $root "NovaPDFPro-Portable-x64.exe"),
    (Join-Path $root "portable.flag"),
    (Join-Path $releaseDir "EnterprisePDFPro-Setup-x64.exe"),
    (Join-Path $releaseDir "EnterprisePDFPro-Portable-x64.exe"),
    (Join-Path $releaseDir "NovaPDFPro-Portable-x64.exe"),
    (Join-Path $workspaceRoot "EnterprisePDFPro-Setup-x64.exe"),
    (Join-Path $workspaceRoot "EnterprisePDFPro-Portable-x64.exe"),
    (Join-Path $workspaceRoot "NovaPDFPro-Portable-x64.exe"),
    (Join-Path $workspaceRoot "portable.flag")
)
foreach ($p in $legacyPaths) {
    if (Test-Path $p) {
        Remove-Item $p -Force -ErrorAction SilentlyContinue
    }
}

if (-not (Test-Path $releaseDir)) {
    New-Item -ItemType Directory -Path $releaseDir -Force | Out-Null
}

# 1. Build Vite/TypeScript production bundle & verify unit tests
Push-Location $root
try {
    if (-not $SkipBuild) {
        Write-Host "1. Building production frontend (npm run build)..." -ForegroundColor Yellow
        & npm run build
        if ($LASTEXITCODE -ne 0) { throw "npm run build failed with exit code $LASTEXITCODE" }
    } else {
        Write-Host "1. Skipping frontend build (-SkipBuild)" -ForegroundColor DarkGray
    }

    if (-not $SkipTests) {
        Write-Host "2. Running automated core unit tests (npm test)..." -ForegroundColor Yellow
        & npm test
        if ($LASTEXITCODE -ne 0) { throw "npm test failed with exit code $LASTEXITCODE" }
    } else {
        Write-Host "2. Skipping unit tests (-SkipTests)" -ForegroundColor DarkGray
    }

    Write-Host "3. Generating application icon (NovaPDFPro.ico)..." -ForegroundColor Yellow
    & node (Join-Path $installerDir "generate-icon.mjs")
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path $icoPath)) {
        throw "Failed to generate NovaPDFPro.ico"
    }
} finally {
    Pop-Location
}

# 4. Prepare clean staging directory
Write-Host "4. Preparing clean staging workspace..." -ForegroundColor Yellow
if (Test-Path $stagingDir) {
    Remove-Item $stagingDir -Recurse -Force
}
New-Item -ItemType Directory -Path $stagingDir -Force | Out-Null

# 5. Compile Native Launcher & Uninstaller directly into staging
Write-Host "5. Compiling NovaPDFPro.exe & Uninstall-NovaPDFPro.exe..." -ForegroundColor Yellow
$launcherSource = Join-Path $root "native-launcher\NovaPDFPro.cs"
$launcherOut = Join-Path $stagingDir "NovaPDFPro.exe"
& $csc /nologo /platform:x64 /optimize+ /target:winexe /win32icon:$icoPath /out:$launcherOut `
    /r:System.Windows.Forms.dll /r:System.Drawing.dll $launcherSource
if ($LASTEXITCODE -ne 0) { throw "Failed to compile NovaPDFPro.exe" }

$uninstallSource = Join-Path $installerDir "Uninstall-NovaPDFPro.cs"
$uninstallOut = Join-Path $stagingDir "Uninstall-NovaPDFPro.exe"
& $csc /nologo /platform:x64 /optimize+ /target:winexe /win32icon:$icoPath /out:$uninstallOut `
    /r:System.Windows.Forms.dll /r:System.Drawing.dll $uninstallSource
if ($LASTEXITCODE -ne 0) { throw "Failed to compile Uninstall-NovaPDFPro.exe" }

Invoke-AuthenticodeSign $launcherOut
Invoke-AuthenticodeSign $uninstallOut

# 6. Copy Electron Runtime & Built App Payload into Staging
Write-Host "6. Staging Electron runtime, UI dist, tessdata OCR models, and workers..." -ForegroundColor Yellow
$electronDistSrc = Join-Path $root "node_modules\electron\dist"
if (-not (Test-Path (Join-Path $electronDistSrc "electron.exe"))) {
    throw "Electron binary not found at $electronDistSrc. Run npm install first."
}
$runtimeDest = Join-Path $stagingDir "runtime"
New-Item -ItemType Directory -Path $runtimeDest -Force | Out-Null
Copy-Item -Path (Join-Path $electronDistSrc "*") -Destination $runtimeDest -Recurse -Force
Copy-Item -Path (Join-Path $root "dist") -Destination $stagingDir -Recurse -Force
Copy-Item -Path (Join-Path $root "electron") -Destination $stagingDir -Recurse -Force
$buildCfg = @{
    productionRelease = $true
}
if (-not [string]::IsNullOrWhiteSpace($PortalUrl)) { $buildCfg.portalUrl = $PortalUrl.Trim().TrimEnd('/') }
if (-not [string]::IsNullOrWhiteSpace($LicensePublicKeyPem)) { $buildCfg.publicKeyPem = $LicensePublicKeyPem }
$buildCfgPath = Join-Path $stagingDir "electron\build-config.json"
($buildCfg | ConvertTo-Json -Compress) | Set-Content -Path $buildCfgPath -Encoding UTF8
Write-Host "   -> Baked locked production build-config.json into installer staging" -ForegroundColor Green
Copy-Item -Path (Join-Path $root "package.json") -Destination $stagingDir -Force
Copy-Item -Path $icoPath -Destination (Join-Path $stagingDir "NovaPDFPro.ico") -Force

# 7. Package Staging Directory into Embedded Archive
Write-Host "7. Compressing standalone payload archive..." -ForegroundColor Yellow
Add-Type -AssemblyName System.IO.Compression.FileSystem
if (Test-Path $appPackageZip) { Remove-Item $appPackageZip -Force }
[System.IO.Compression.ZipFile]::CreateFromDirectory(
    $stagingDir,
    $appPackageZip,
    [System.IO.Compression.CompressionLevel]::Optimal,
    $false
)
$zipSizeMb = [Math]::Round((Get-Item $appPackageZip).Length / 1MB, 2)
Write-Host "   -> Embedded payload archive: $zipSizeMb MB" -ForegroundColor Green

# 8. Compile Single-File Standalone Windows Installer
Write-Host "8. Compiling standalone NovaPDFPro-Setup-x64.exe..." -ForegroundColor Yellow
$setupSource = Join-Path $installerDir "NovaPDFPro-Setup.cs"
$setupOut = Join-Path $releaseDir "NovaPDFPro-Setup-x64.exe"
if (Test-Path $setupOut) { Remove-Item $setupOut -Force }

& $csc /nologo /platform:x64 /optimize+ /target:winexe /win32icon:$icoPath /out:$setupOut `
    /r:System.Windows.Forms.dll /r:System.Drawing.dll /r:System.IO.Compression.dll /r:System.IO.Compression.FileSystem.dll `
    /r:Microsoft.CSharp.dll `
    /resource:"$appPackageZip,AppPackage.zip" `
    /resource:"$icoPath,NovaPDFPro.ico" `
    $setupSource
if ($LASTEXITCODE -ne 0) { throw "Failed to compile NovaPDFPro-Setup-x64.exe" }

Invoke-AuthenticodeSign $setupOut

# Mirror consolidated installer to workspace root for easy access
$workspaceInstallerOut = Join-Path $workspaceRoot "NovaPDFPro-Setup-x64.exe"
Copy-Item -Path $setupOut -Destination $workspaceInstallerOut -Force

# 9. Clean up temporary staging artifacts
Write-Host "9. Cleaning temporary build artifacts..." -ForegroundColor Yellow
if (Test-Path $stagingDir) { Remove-Item $stagingDir -Recurse -Force -ErrorAction SilentlyContinue }
if (Test-Path $appPackageZip) { Remove-Item $appPackageZip -Force -ErrorAction SilentlyContinue }
$oldUninstallExe = Join-Path $installerDir "Uninstall-NovaPDFPro.exe"
if (Test-Path $oldUninstallExe) { Remove-Item $oldUninstallExe -Force -ErrorAction SilentlyContinue }

$setupInfo = Get-Item $setupOut
$setupSizeMb = [Math]::Round($setupInfo.Length / 1MB, 2)

Write-Host "==========================================================" -ForegroundColor Green
Write-Host "STANDALONE WINDOWS INSTALLER READY!" -ForegroundColor Green
Write-Host "Installer: $setupOut ($setupSizeMb MB)" -ForegroundColor White
Write-Host "Workspace Copy: $workspaceInstallerOut" -ForegroundColor White
Write-Host "==========================================================" -ForegroundColor Green
