@echo off
setlocal EnableExtensions EnableDelayedExpansion
chcp 65001 > nul

for %%I in ("%~dp0..") do set "ROOT=%%~fI"
set "EXE=%ROOT%\dist\caelus_os.exe"
set "OUTDIR=%ROOT%\tests\golden\out"

if not exist "%EXE%" (
    echo [SKIP] Binary bulunamadi: %EXE%
    echo        Once build.bat calistirin veya dist\caelus_os.exe uretin.
    exit /b 2
)

if not exist "%OUTDIR%" mkdir "%OUTDIR%"

rem Senaryolar pinli guven capasiyla eslesen gercek ed25519 imzalari tasiyor;
rem dev bypass GEREKMEZ ve ortamdan sizmasi da engellenir (SIGNED-CI yolu).
set "CAELUS_ALLOW_DEV_SCENARIOS="

call :run_case bs01 BS-01_SAHTE_UFUK || exit /b 1
call :run_case bs02 BS-02_GOLGE_ARSIV || exit /b 1
call :run_case bs03 BS-03_KUM_SAATI || exit /b 1

echo [OK] BS-EXEC golden REPL suite tamamlandi.
echo      Ciktilar: %OUTDIR%
exit /b 0

:run_case
set "CASE=%~1"
set "SCENARIO=%~2"
set "CMDS=%ROOT%\tests\golden\%CASE%_repl.commands"
set "EXPECTED=%ROOT%\tests\golden\%CASE%_expected.json"
set "LOG=%OUTDIR%\%CASE%_repl.out"

echo [RUN] %CASE% -- %SCENARIO%
"%EXE%" --scenario "%SCENARIO%" --repl --det-mode < "%CMDS%" > "%LOG%" 2>&1
if errorlevel 1 (
    echo [FAIL] %CASE% REPL kosumu basarisiz. Log: %LOG%
    exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$exp = Get-Content -Raw -LiteralPath '%EXPECTED%' | ConvertFrom-Json; " ^
  "$out = Get-Content -Raw -LiteralPath '%LOG%'; " ^
  "$missing = @(); " ^
  "foreach ($needle in $exp.runner_assertions.must_contain) { if ($out -notlike ('*' + $needle + '*')) { $missing += $needle } } " ^
  "if ($missing.Count -gt 0) { Write-Host '[FAIL] %CASE% eksik golden izleri:'; $missing | ForEach-Object { Write-Host ('  - ' + $_) }; exit 1 } " ^
  "Write-Host '[OK] %CASE% golden izleri dogrulandi.'"
if errorlevel 1 exit /b 1

exit /b 0
