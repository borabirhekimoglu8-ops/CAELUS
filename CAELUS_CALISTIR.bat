@echo off
chcp 65001 > nul
setlocal
set "ROOT=%~dp0"
set "EXE=%ROOT%dist\caelus_os.exe"
echo.
echo  CAELUS OS baslatiliyor...
echo.
if not exist "%EXE%" (
    echo  [BILGI] dist\caelus_os.exe bulunamadi — once derleniyor ^(build.bat^)...
    call "%ROOT%build.bat" || (
        echo  [HATA] Derleme basarisiz. build.bat ciktisini inceleyin.
        pause > nul
        exit /b 1
    )
)
"%EXE%"
echo.
echo ════════════════════════════════════════
echo  Cikis icin bir tusa basin...
echo ════════════════════════════════════════
pause > nul
