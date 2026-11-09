@echo off
chcp 65001 >nul 2>&1
title CAELUS Enterprise - Operasyonel Risk ve Karar Analitigi Platformu
cd /d "%~dp0"

set "EXE=%~dp0dist\caelus_os.exe"

if not exist "%EXE%" (
    echo [CAELUS] Dagitim ikilisi bulunamadi, derleme baslatiliyor...
    call "%~dp0build.bat"
    if errorlevel 1 (
        echo [HATA] Derleme basarisiz oldu.
        pause
        exit /b 1
    )
)

echo ============================================================================
echo   CAELUS ENTERPRISE - Operasyonel Risk, Sureklilik ve Karar Analitigi
echo   Web Arayuzu : http://127.0.0.1:47809/  (Tarayicida otomatik aciliyor)
echo   Motor Modu  : Canli Nedensel Cekirdek (BS-01_SAHTE_UFUK / OPS-LOG-01)
echo ============================================================================
echo.

start "" /b cmd /c "ping 127.0.0.1 -n 2 >nul & start "" "http://127.0.0.1:47809/""
"%EXE%" --scenario BS-01_SAHTE_UFUK --repl
echo.
pause
