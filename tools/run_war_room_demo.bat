@echo off
setlocal EnableDelayedExpansion

:: ==============================================================================
:: CAELUS OS - War Room Cockpit, 4 Specialist Agents & Sidecar Airlock Launcher
::
:: Usage:
::   tools\run_war_room_demo.bat              (Default: 100%% Air-Gapped Aegean Pilot)
::   tools\run_war_room_demo.bat --offline    (Offline T1 08:10 -> T2 08:25 Replay Mode)
::   tools\run_war_room_demo.bat --live       (Live Open-Meteo Marine + OpenSky + AISStream Mode)
::   tools\run_war_room_demo.bat --verify     (Single-pass verification, exits cleanly)
:: ==============================================================================

set "ROOT=%~dp0.."
for %%I in ("%ROOT%") do set "ROOT=%%~fI"

set "MODE=--offline"
set "VERIFY_ONLY=0"
set "PORT=%CAELUS_WAR_ROOM_PORT%"
if not defined PORT set "PORT=47809"

for %%A in (%*) do (
    if /I "%%A"=="--live" set "MODE=--live"
    if /I "%%A"=="--offline" set "MODE=--offline"
    if /I "%%A"=="--verify" set "VERIFY_ONLY=1"
    if /I "%%A"=="--verify-only" set "VERIFY_ONLY=1"
)

set "PYTHON_CMD="
py -3 --version > nul 2>&1
if not errorlevel 1 set "PYTHON_CMD=py -3"
if not defined PYTHON_CMD set "PYTHON_CMD=python"

echo ==================================================================
echo   CAELUS OS // WAR ROOM - 4-Layer Command Cockpit Launcher
echo   Mode: !MODE! ^| Endpoint: http://127.0.0.1:!PORT! ^(WS /ws^)
echo ==================================================================

pushd "%ROOT%"

echo [1/4] Building Rust Sidecar Airlock and Audit Verifier...
cargo build --release --locked --bin caelus_sidecar_airlock --bin caelus_verify_audit
if errorlevel 1 (
    popd
    exit /b 1
)

echo [2/4] Verifying Aegean Ferry Pilot dataset and Manifest v2.0 seals...
if not exist "%ROOT%\configs\source_manifest.json" (
    "%ROOT%\target\release\caelus_sidecar_airlock.exe" build-aegean-pilot
    if errorlevel 1 (
        popd
        exit /b 1
    )
)

echo [3/4] Updating WASM core and Air-Gapped Standalone/PWA bundle...
cargo build --release --locked --manifest-path "%ROOT%\caelus_wasm\Cargo.toml" --target wasm32-unknown-unknown
if errorlevel 1 (
    popd
    exit /b 1
)
!PYTHON_CMD! -W error "%ROOT%\tools\build_standalone.py"
if errorlevel 1 (
    popd
    exit /b 1
)

if "!VERIFY_ONLY!"=="1" (
    echo [4/4] Running MCP 64-Bit and 4-Agent AG-UI War Room verification gates...
    node "%ROOT%\tools\caelus_mcp_server.mjs" --self-test
    if errorlevel 1 (
        popd
        exit /b 1
    )
    node --test "%ROOT%\tests\test_war_room_master_gates.mjs"
    set "EC=!errorlevel!"
    popd
    exit /b !EC!
)

echo [4/4] Starting AG-UI 4-Agent WebSocket and Cockpit Server ^(127.0.0.1:!PORT!^)...
echo       Open in browser: http://127.0.0.1:!PORT!
node "%ROOT%\tools\caelus_ag_ui_ws_server.mjs" !MODE! --port !PORT!
set "EC=!errorlevel!"
popd
exit /b !EC!
