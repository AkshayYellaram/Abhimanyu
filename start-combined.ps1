$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$starterProject = Join-Path $root "abhedya-chakra-starter"
$backendProject = Join-Path $starterProject "backend"
$frontendProject = Join-Path $starterProject "frontend"

if (-not (Test-Path $starterProject)) {
    throw "Starter project not found: $starterProject"
}

$backendVenv = Join-Path $backendProject ".venv"
$frontendNodeModules = Join-Path $frontendProject "node_modules"

if (-not (Test-Path $backendVenv)) {
    Write-Host "[warn] Backend virtual environment not found in $backendProject. Run .\scripts\run_backend.ps1 first."
}

if (-not (Test-Path $frontendNodeModules)) {
    throw "Frontend dependencies are not installed. Run 'npm install' in $frontendProject."
}

Write-Host "Starting Abhimanyu investigation platform with the integrated 3D globe..."
Write-Host "Frontend: $frontendProject"
Write-Host "Backend: $backendProject"
Write-Host "Abhimanyu reference UI: $root\siyakafile\Abhimanyu\Abhimanyu"

function Test-ListeningPort([int]$Port) {
    return [bool](Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
}

if (Test-ListeningPort 8000) {
    $backendListener = Get-NetTCPConnection -LocalPort 8000 -State Listen | Select-Object -First 1
    $backendProcess = Get-CimInstance Win32_Process -Filter "ProcessId=$($backendListener.OwningProcess)"
    if ($backendProcess.CommandLine -notlike "*$backendProject*") {
        throw "Port 8000 is occupied by another project. Stop its API process, then rerun this launcher."
    }

    try {
        $health = Invoke-RestMethod -Uri "http://127.0.0.1:8000/health" -TimeoutSec 3
    } catch {
        throw "Port 8000 is occupied by a service that failed its health check: $($_.Exception.Message)"
    }

    if ($health.service -ne "abhimanyu") {
        throw "Port 8000 is serving a different API. Stop that service, then rerun this launcher."
    }
    Write-Host "Backend is already responding on port 8000."
} else {
    $backendCommand = @(
        "-NoExit",
        "-Command",
        "Set-Location '$backendProject'; & '.\.venv\Scripts\python.exe' -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload"
    )
    Start-Process powershell -ArgumentList $backendCommand
}

if (Test-ListeningPort 5173) {
    $frontendListener = Get-NetTCPConnection -LocalPort 5173 -State Listen | Select-Object -First 1
    $frontendProcess = Get-CimInstance Win32_Process -Filter "ProcessId=$($frontendListener.OwningProcess)"
    if ($frontendProcess.CommandLine -notlike "*$frontendProject*") {
        throw "Port 5173 is occupied by another project. Stop its frontend process, then rerun this launcher."
    }

    try {
        $appModule = Invoke-WebRequest -Uri "http://127.0.0.1:5173/src/App.jsx" -UseBasicParsing -TimeoutSec 5
    } catch {
        throw "Port 5173 is occupied by a different frontend. Stop that service, then rerun this launcher."
    }

    if ($appModule.StatusCode -ne 200 -or -not $appModule.Content.Contains("Global trace globe")) {
        throw "The frontend on port 5173 did not serve the integrated globe. Stop it, then rerun this launcher."
    }
    Write-Host "Frontend with the integrated globe is already responding on port 5173."
} else {
    $frontendCommand = @(
        "-NoExit",
        "-Command",
        "Set-Location '$frontendProject'; npm run dev -- --host 127.0.0.1 --port 5173 --strictPort"
    )
    Start-Process powershell -ArgumentList $frontendCommand
}

Write-Host "Open http://127.0.0.1:5173"
Write-Host "API docs: http://127.0.0.1:8000/docs"
Write-Host "Benchmarks and evaluation scripts are in $starterProject\scripts"
