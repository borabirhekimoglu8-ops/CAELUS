@echo off
setlocal EnableDelayedExpansion
chcp 65001 > nul 2>&1

REM =============================================================================
REM  CAELUS OS ------- Blackbox Build Automation Script (Windows)
REM  Air-Gapped ---- Offline-First ---- Single Static Executable
REM
REM  Asama 1: UI Varlik Karartma   -> ui_payload.h  (hex byte array)
REM  Asama 2: Rust Derlemesi       -> caelus_network.lib (LTO + opt-z)
REM  Asama 3: C++ Linkleme         -> caelus_os.exe (static + strip)
REM
REM  Env overrides:
REM    CAELUS_CXX=GCC / MSVC / g++ / cl.exe       C++ derleyici secimi
REM    CAELUS_RUST_TARGET=x86_64-pc-windows-gnu   Rust ABI target override
REM    CAELUS_USE_CMAKE=0 or 1                    CMake yolunu zorla/ac-kapat
REM    CAELUS_SKIP_CMAKE=1                        CMake yolunu atla
REM    CAELUS_DOCKER=1                            Container/non-interactive mod notu
REM    CAELUS_SKIP_UI_EMBED=1                     UI header uretimini atla
REM =============================================================================

set "ROOT=%~dp0"
set "ROOT=%ROOT:~0,-1%"
set "PAYLOAD_H=%ROOT%\include\ui_payload.h"
:: RUST_TARGET / RUST_LIB are selected AFTER C++ compiler detection so the Rust
:: ABI matches the linker. Mixing a MSVC-ABI Rust lib with MinGW g++ (or vice
:: versa) causes undefined references like __CxxFrameHandler3 / __chkstk ------- this
:: was the real bug that the old "-Wl,--allow-multiple-definition" hack masked.
set "RUST_TARGET="
set "RUST_LIB=%ROOT%\target\release\caelus_network.lib"
set "OUT_EXE=%ROOT%\dist\caelus_os.exe"
set "BUILD_DIR=%ROOT%\build_cmake"
set "CXX_CMD="
set "EMBED_UI=1"
set "EMBED_DEFINE=-DCAELUS_EMBEDDED_UI=1"
set "CMAKE_UI_FLAG=-DCAELUS_EMBEDDED_UI=ON"
set "GNU_LINKER_HINT=0"
set "GCC_AVAILABLE=0"
set "MSVC_AVAILABLE=0"
set "GNU_LINKER_AVAILABLE=0"
set "CXX_OVERRIDE_EXPLICIT=0"
set "RUST_TARGET_EXPLICIT=0"

if /I "%CAELUS_SKIP_UI_EMBED%"=="1" (
    set "EMBED_UI=0"
    set "EMBED_DEFINE="
    set "CMAKE_UI_FLAG=-DCAELUS_EMBEDDED_UI=OFF"
)

:: Detect CPU cores for parallel build using native Windows environment variable.
set "CORES=%NUMBER_OF_PROCESSORS%"
if not defined CORES set "CORES=4"

echo.
echo ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
echo --------    CAELUS OS ------- Blackbox Build System v1.0.0              --------
echo --------    Air-Gapped ---- Offline-First ---- Target: ^<50 MB EXE      --------
echo -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
echo.

:: -----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
:: -----n Kontrol: Kritik ara----lar----n varl------------n---- do----rula
:: -----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
echo [PREFLIGHT] Ara---- ba--------ml----l----klar---- kontrol ediliyor...

cargo --version > nul 2>&1
if errorlevel 1 (
    echo [HATA] 'cargo' bulunamad----. Rust toolchain kurulumu gerekli.
    exit /b 1
)
echo [OK] cargo: mevcut

if "%EMBED_UI%"=="1" (
    powershell -NoProfile -Command "$PSVersionTable.PSVersion.ToString()" > nul 2>&1
    if errorlevel 1 (
        echo [HATA] PowerShell bulunamadi ^(UI asset embedding icin gerekli^).
        exit /b 1
    )
)

:: Check tool availability first. g++ alone is not enough for Rust GNU ABI:
:: cargo's x86_64-pc-windows-gnu target normally needs x86_64-w64-mingw32-gcc.
set "CXX_TOOL="
where g++ > nul 2>&1
if not errorlevel 1 set "GCC_AVAILABLE=1"
where cl.exe > nul 2>&1
if not errorlevel 1 set "MSVC_AVAILABLE=1"
where x86_64-w64-mingw32-gcc > nul 2>&1
if not errorlevel 1 (
    set "GNU_LINKER_AVAILABLE=1"
) else (
    :: MSYS2/native MinGW-w64 kurulumlarinda cross-prefix alias bulunmaz; gcc'nin
    :: kendisi x86_64-w64-mingw32 hedefliyse GNU linker olarak kabul et ve
    :: cargo'nun windows-gnu bin linkleri icin linker'i acikca gcc'ye yonlendir.
    for /f "delims=" %%m in ('gcc -dumpmachine 2^>nul') do (
        if /I "%%m"=="x86_64-w64-mingw32" (
            set "GNU_LINKER_AVAILABLE=1"
            set "CARGO_TARGET_X86_64_PC_WINDOWS_GNU_LINKER=gcc"
            echo [INFO] x86_64-w64-mingw32-gcc alias yok; native MinGW-w64 gcc GNU linker kabul edildi.
        )
    )
)

if defined CAELUS_CXX (
    set "CXX_OVERRIDE_EXPLICIT=1"
    if /I "%CAELUS_CXX%"=="GCC" (
        if not "%GCC_AVAILABLE%"=="1" (
            echo [HATA] CAELUS_CXX=GCC istendi ama g++ bulunamadi.
            exit /b 1
        )
        set "CXX_TOOL=GCC"
        set "CXX_CMD=g++"
    ) else if /I "%CAELUS_CXX%"=="MSVC" (
        if not "%MSVC_AVAILABLE%"=="1" (
            echo [HATA] CAELUS_CXX=MSVC istendi ama cl.exe bulunamadi.
            echo        Visual Studio Developer Command Prompt veya vcvars64.bat ortaminda deneyin.
            exit /b 1
        )
        set "CXX_TOOL=MSVC"
        set "CXX_CMD=cl.exe"
    ) else (
        set "CXX_CMD=%CAELUS_CXX%"
        echo "%CAELUS_CXX%" | findstr /I "cl" > nul 2>&1
        if not errorlevel 1 (
            set "CXX_TOOL=MSVC"
            where "%CAELUS_CXX%" > nul 2>&1
            if errorlevel 1 if not exist "%CAELUS_CXX%" (
                echo [HATA] CAELUS_CXX bulunamadi: %CAELUS_CXX%
                exit /b 1
            )
        ) else (
            set "CXX_TOOL=GCC"
            "%CAELUS_CXX%" --version > nul 2>&1
            if errorlevel 1 (
                echo [HATA] CAELUS_CXX calistirilamadi: %CAELUS_CXX%
                exit /b 1
            )
        )
    )
) else if defined CAELUS_RUST_TARGET (
    echo "%CAELUS_RUST_TARGET%" | findstr /I "windows-msvc" > nul 2>&1
    if not errorlevel 1 (
        if "%MSVC_AVAILABLE%"=="1" (
            set "CXX_TOOL=MSVC"
            set "CXX_CMD=cl.exe"
        )
    ) else (
        if "%GCC_AVAILABLE%"=="1" (
            set "CXX_TOOL=GCC"
            set "CXX_CMD=g++"
        )
    )
) else (
    if "%GCC_AVAILABLE%"=="1" (
        if "%GNU_LINKER_AVAILABLE%"=="1" (
            set "CXX_TOOL=GCC"
            set "CXX_CMD=g++"
        ) else if "%MSVC_AVAILABLE%"=="1" (
            echo [INFO] g++ bulundu ancak x86_64-w64-mingw32-gcc yok; MSVC ABI fallback seciliyor.
            set "CXX_TOOL=MSVC"
            set "CXX_CMD=cl.exe"
        ) else (
            set "CXX_TOOL=GCC"
            set "CXX_CMD=g++"
        )
    ) else if "%MSVC_AVAILABLE%"=="1" (
        set "CXX_TOOL=MSVC"
        set "CXX_CMD=cl.exe"
    )
)

if not defined CXX_TOOL (
    echo [HATA] Ne kullanilabilir g++ ne de cl.exe bulundu.
    echo        MinGW-w64 veya Visual Studio Build Tools kurulu olmali.
    echo        Override: CAELUS_CXX=GCC, CAELUS_CXX=MSVC veya tam derleyici yolu.
    exit /b 1
)

if defined CAELUS_RUST_TARGET (
    set "RUST_TARGET_EXPLICIT=1"
    set "RUST_TARGET=%CAELUS_RUST_TARGET%"
) else if "%CXX_TOOL%"=="GCC" (
    set "RUST_TARGET=x86_64-pc-windows-gnu"
) else (
    set "RUST_TARGET=x86_64-pc-windows-msvc"
)

:rust_target_preflight
set "GNU_TARGET=0"
set "MSVC_TARGET=0"
set "RUST_TARGET_OK=1"
echo "%RUST_TARGET%" | findstr /I "windows-gnu" > nul 2>&1
if not errorlevel 1 set "GNU_TARGET=1"
echo "%RUST_TARGET%" | findstr /I "windows-msvc" > nul 2>&1
if not errorlevel 1 set "MSVC_TARGET=1"

if "%GNU_TARGET%"=="1" (
    set "RUST_LIB=%ROOT%\target\%RUST_TARGET%\release\libcaelus_network.a"
    if not "%CXX_TOOL%"=="GCC" (
        echo [HATA] Rust GNU target, MSVC C++ linker ile eslesmez: %RUST_TARGET%
        echo        CAELUS_CXX=GCC kullanin veya CAELUS_RUST_TARGET=x86_64-pc-windows-msvc secin.
        exit /b 1
    )
    if not "%GNU_LINKER_AVAILABLE%"=="1" (
        set "GNU_LINKER_HINT=1"
        set "RUST_TARGET_OK=0"
        echo [UYARI] x86_64-w64-mingw32-gcc bulunamadi.
    )
) else (
    set "RUST_LIB=%ROOT%\target\%RUST_TARGET%\release\caelus_network.lib"
    if "%MSVC_TARGET%"=="1" (
        if not "%CXX_TOOL%"=="MSVC" (
            echo [HATA] Rust MSVC target, g++ linker ile eslesmez: %RUST_TARGET%
            echo        CAELUS_CXX=MSVC kullanin veya CAELUS_RUST_TARGET=x86_64-pc-windows-gnu secin.
            exit /b 1
        )
    )
)

rustc --print target-libdir --target "%RUST_TARGET%" > nul 2>&1
if errorlevel 1 set "RUST_TARGET_OK=0"

if "%RUST_TARGET_OK%"=="0" (
    if "%GNU_TARGET%"=="1" (
        if "%MSVC_AVAILABLE%"=="1" (
            if "%RUST_TARGET_EXPLICIT%"=="0" (
                if "%CXX_OVERRIDE_EXPLICIT%"=="0" (
                    echo [INFO] Rust GNU target/linker preflight basarisiz; MSVC toolchain'e fallback yapiliyor.
                    set "CXX_TOOL=MSVC"
                    set "CXX_CMD=cl.exe"
                    set "RUST_TARGET=x86_64-pc-windows-msvc"
                    set "GNU_LINKER_HINT=0"
                    goto :rust_target_preflight
                )
            )
        )
    )
    echo [HATA] Rust target preflight basarisiz: %RUST_TARGET%
    if "%GNU_TARGET%"=="1" echo        x86_64-w64-mingw32-gcc veya Rust GNU target kurulumu eksik olabilir.
    if "%MSVC_TARGET%"=="1" echo        Rust MSVC target veya Visual Studio Build Tools ortam---- eksik olabilir.
    exit /b 1
)

echo [OK] C++ derleyici: %CXX_CMD% ^(%CXX_TOOL%^) ^| Rust target: %RUST_TARGET%

cmake --version > nul 2>&1
if errorlevel 1 (
    echo [UYARI] cmake bulunamad----. Do----rudan g++/cl.exe ile derleme yap----lacak.
    set "USE_CMAKE=0"
) else (
    echo [OK] cmake: mevcut
    set "USE_CMAKE=1"
)
if defined CAELUS_USE_CMAKE (
    set "USE_CMAKE=%CAELUS_USE_CMAKE%"
    echo [INFO] CAELUS_USE_CMAKE=%CAELUS_USE_CMAKE% override uygulandi.
)
if /I "%CAELUS_SKIP_CMAKE%"=="1" (
    set "USE_CMAKE=0"
    echo [INFO] CAELUS_SKIP_CMAKE=1 ------- CMake yolu atlandi.
)

:: CAELUS_PRODUCTION=1 -------- dev/demo kapilari derleme-disi (-DCAELUS_PRODUCTION).
:: CMake yolu atlanir: makro dogrudan derleme satirina garantili uygulanir
:: (CMakeLists.txt bu bayragi henuz tasimiyor; yarim-kapili binary riski sifirlanir).
set "PROD_DEFINE_GCC="
set "PROD_DEFINE_MSVC="
set "CMAKE_PROD_FLAG=-DCAELUS_PRODUCTION=OFF"
if /I "%CAELUS_PRODUCTION%"=="1" (
    set "PROD_DEFINE_GCC=-DCAELUS_PRODUCTION=1"
    set "PROD_DEFINE_MSVC=/DCAELUS_PRODUCTION=1"
    set "CMAKE_PROD_FLAG=-DCAELUS_PRODUCTION=ON"
    if not defined CAELUS_USE_CMAKE set "USE_CMAKE=0"
    echo [INFO] CAELUS_PRODUCTION=1 ------- dev/demo kapilari derleme-disi birakilacak.
)

:: Verify UI source files exist
if "%EMBED_UI%"=="1" (
    if not exist "%ROOT%\ui\index.html" (
        echo [HATA] ui\index.html bulunamad----.
        exit /b 1
    )
    if not exist "%ROOT%\ui\app.js" (
        echo [HATA] ui\app.js bulunamad----.
        exit /b 1
    )
    if not exist "%ROOT%\ui\scenario_compiler.js" (
        echo [HATA] ui\scenario_compiler.js bulunamad----.
        exit /b 1
    )
    echo [OK] UI kaynak dosyalar----: mevcut
) else (
    echo [INFO] CAELUS_SKIP_UI_EMBED=1 ------- UI header uretimi ve embed define atlandi.
)
echo.

:: Create output directories
if not exist "%ROOT%\include" mkdir "%ROOT%\include"
if not exist "%ROOT%\dist"    mkdir "%ROOT%\dist"

:: =============================================================================
:: A----AMA 1 ------- UI Varl----k Karartma (Asset Obfuscation & Embedding)
:: ui/index.html + ui/scenario_compiler.js + ui/app.js -------- include/ui_payload.h
:: =============================================================================
echo ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
echo [A----AMA 1/3] UI Gomme (Asset Embedding ------- gizleme/sifreleme DEGIL)
echo ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

:: Eski payload silinerek baslanir: dosya kilitliyse (es zamanli converter/build)
:: sessizce APPEND edip cift-tanim ureten eski davranis yerine SERT HATA verilir.
if not "%EMBED_UI%"=="1" (
    echo [A----AMA 1] Atland---- ------- CAELUS_SKIP_UI_EMBED=1
    goto :after_ui_embed
)
if exist "%PAYLOAD_H%" (
    del /f "%PAYLOAD_H%" 2>nul
    if exist "%PAYLOAD_H%" (
        echo [HATA] ui_payload.h kilitli ------- es zamanli bir build/converter calisiyor olabilir.
        exit /b 1
    )
)
echo [1/3] UI kaynaklari tek geciste deterministik UTF-8 LF hex dizisine gomuluyor...
set "CAELUS_BUILD_ROOT=%ROOT%"
set "CAELUS_PAYLOAD_OUT=%PAYLOAD_H%"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; $nl=[string][char]10; $sb=[System.Text.StringBuilder]::new(4194304); [void]$sb.Append('// AUTO-GENERATED - DO NOT EDIT'+$nl+'// CAELUS OS - UI Payload Header'+$nl+'// Generated by build.bat'+$nl+'#pragma once'+$nl+'#include <cstddef>'+$nl+$nl); $items=@(@{Rel='ui/index.html';Sym='CAELUS_UI_HTML';Len='CAELUS_UI_HTML_LEN'},@{Rel='ui/scenario_compiler.js';Sym='CAELUS_SCENARIO_COMPILER_JS';Len='CAELUS_SCENARIO_COMPILER_JS_LEN'},@{Rel='ui/app.js';Sym='CAELUS_UI_JS';Len='CAELUS_UI_JS_LEN'}); foreach($it in $items){ $p=Join-Path $env:CAELUS_BUILD_ROOT ($it.Rel -replace '/','\'); $b=[System.IO.File]::ReadAllBytes($p); $hex=if($b.Length -gt 0){'0x'+([System.BitConverter]::ToString($b).ToLowerInvariant() -replace '-',', 0x')+', 0x00'}else{'0x00'}; [void]$sb.Append('// Embedded: '+$it.Rel+'  ('+$b.Length+' bytes)'+$nl+'static const unsigned char '+$it.Sym+'[] = {'+$hex+'};'+$nl+'static const std::size_t   '+$it.Len+' = '+$b.Length+';'+$nl+$nl) }; [System.IO.File]::WriteAllText($env:CAELUS_PAYLOAD_OUT,$sb.ToString(),[System.Text.UTF8Encoding]::new($false))"
if errorlevel 1 (
    echo [HATA] UI varliklari ui_payload.h dosyasina gomulemedi.
    exit /b 1
)
echo [A----AMA 1] Tamamland---- -------- %PAYLOAD_H%
:after_ui_embed
echo.

:: =============================================================================
:: A----AMA 2 ------- Rust Shadow-Mesh Derlemesi (Size Optimization)
:: cargo build --release -------- target/release/caelus_network.lib
:: =============================================================================
echo ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
echo [A----AMA 2/3] Rust Shadow-Mesh Derlemesi (LTO + opt-z)
echo ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

:: Hedef ABI belirtilmisse staticlib --lib ile derlenir: [[bin]] signer CLI'si o
:: a----amada DERLENMEZ, cunku bazi MinGW dagitimlari (orn. scoop gcc) Rust
:: windows-gnu bin linkinin bekledigi libgcc_eh.a arsivini icermez. Signer,
:: lib basarili olursa host ABI'sinde ayrica derlenir; exe ABI'den bagimsizdir.
pushd "%ROOT%"
set "DO_SKIP_RUST=0"
if /I "%CAELUS_SKIP_RUST%"=="1" (
    if exist "%RUST_LIB%" set "DO_SKIP_RUST=1"
)
if "!DO_SKIP_RUST!"=="1" (
    echo [INFO] CAELUS_SKIP_RUST=1 ------- mevcut %RUST_LIB% yeniden kullaniliyor.
) else (
    if defined RUST_TARGET (
        echo [INFO] cargo build --release --locked --target !RUST_TARGET! --lib
        cargo build --release --locked --target !RUST_TARGET! --lib
    ) else (
        cargo build --release --locked
    )
    if not errorlevel 1 if defined RUST_TARGET (
        echo [INFO] cargo build --release --locked --bin caelus_sign_scenario --bin caelus_sign_model --bin caelus_verify_audit --bin caelus_sidecar_airlock  ^(host ABI^)
        cargo build --release --locked --bin caelus_sign_scenario --bin caelus_sign_model --bin caelus_verify_audit --bin caelus_sidecar_airlock
    )
)
if errorlevel 1 (
    echo [HATA] Rust derlemesi ba----ar----s----z. Yukar----daki hata --------kt----s----n---- inceleyin.
    if "!CXX_TOOL!"=="GCC" (
        echo        GNU ABI secildi: !RUST_TARGET!
        if "!GNU_LINKER_HINT!"=="1" (
            echo        x86_64-w64-mingw32-gcc PATH icinde yok. MinGW-w64 gcc/g++ kurulumunu
            echo        veya .cargo/config.toml linker ayarini kontrol edin.
        )
    )
    if "!CXX_TOOL!"=="MSVC" (
        echo        MSVC ABI secildi: !RUST_TARGET!
        echo        Visual Studio Developer Command Prompt veya vcvars64.bat ortaminda deneyin.
    )
    popd
    exit /b 1
)
popd

if not exist "%RUST_LIB%" (
    echo [HATA] Beklenen statik k----t----phane bulunamad----: %RUST_LIB%
    exit /b 1
)
echo [A----AMA 2] Tamamland---- -------- %RUST_LIB%

:: Report Rust lib size
for %%F in ("%RUST_LIB%") do (
    set /a "RUST_SIZE_KB=%%~zF/1024"
    echo [INFO] caelus_network.lib boyutu: !RUST_SIZE_KB! KB
)
echo.

:: =============================================================================
:: A----AMA 3 ------- C++ Linkleme ve M----h----rleme (Static Link + Strip)
:: =============================================================================
echo ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
echo [A----AMA 3/3] C++ Linkleme ve M----h----rleme
echo ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

set "CPP_SOURCES=%ROOT%\core_engine.cpp %ROOT%\src\intel_core.cpp"
set "INCLUDE_FLAGS=-I"%ROOT%" -I"%ROOT%\include" -I"%ROOT%\src""

set "BUILD_OK=0"

:: Try CMake first (best-effort). If no usable generator (make/ninja) is present,
:: fall through to a direct compiler invocation instead of failing the whole build.
if "%USE_CMAKE%"=="1" (
    echo [3/3] CMake ile derleme deneniyor...
    if not exist "%BUILD_DIR%" mkdir "%BUILD_DIR%"
    pushd "%BUILD_DIR%"
    if "%CXX_TOOL%"=="GCC" (
        cmake .. %CMAKE_UI_FLAG% %CMAKE_PROD_FLAG% -DRUST_LIB_PATH="%RUST_LIB%" -G "MinGW Makefiles" 2>nul || (del /f /q CMakeCache.txt 2>nul & cmake .. %CMAKE_UI_FLAG% %CMAKE_PROD_FLAG% -DRUST_LIB_PATH="%RUST_LIB%" 2>nul)
    ) else (
        cmake .. %CMAKE_UI_FLAG% %CMAKE_PROD_FLAG% -DRUST_LIB_PATH="%RUST_LIB%" 2>nul || (del /f /q CMakeCache.txt 2>nul & cmake .. %CMAKE_UI_FLAG% %CMAKE_PROD_FLAG% -DRUST_LIB_PATH="%RUST_LIB%" 2>nul)
    )
    if not errorlevel 1 (
        cmake --build . --config Release --parallel %CORES%
        if not errorlevel 1 set "BUILD_OK=1"
    )
    popd
    if "!BUILD_OK!"=="1" (
        copy /Y "%BUILD_DIR%\caelus_os.exe" "%OUT_EXE%" > nul 2>&1
        copy /Y "%BUILD_DIR%\Release\caelus_os.exe" "%OUT_EXE%" > nul 2>&1
        :: Multi-config generatorler (Visual Studio) CMakeLists'in dist/ hedefini
        :: dist\Release\ altina yazar; bu kopya olmadan eski dist exe sessizce
        :: "build ciktisi" saniliyordu (Windows CI'da bayat-binary olarak yakalandi).
        if exist "%ROOT%\dist\Release\caelus_os.exe" copy /Y "%ROOT%\dist\Release\caelus_os.exe" "%OUT_EXE%" > nul
    ) else (
        echo [UYARI] CMake kullanilamadi ^(generator/make yok?^) ------- dogrudan derlemeye geciliyor.
    )
)

:: Direct GCC build (also produces the BLACKBOX / embedded-UI binary).
:: NOTE: no "-Wl,--allow-multiple-definition" ------- with the ABI-matched gnu Rust lib
:: there are no duplicate symbols to suppress. ws2_32 is required by the UDP
:: multicast discovery loops.
if not "!BUILD_OK!"=="1" if "%CXX_TOOL%"=="GCC" (
    echo [3/3] g++ ile dogrudan derleme...
    "%CXX_CMD%" -std=c++17 -O3 -flto %EMBED_DEFINE% %PROD_DEFINE_GCC% %INCLUDE_FLAGS% %CPP_SOURCES% -o "%OUT_EXE%" -static "%RUST_LIB%" -lws2_32 -ladvapi32 -luserenv -lbcrypt -lntdll -lcrypt32
    if errorlevel 1 (
        echo [HATA] g++ linkleme basarisiz.
        if "!GNU_LINKER_HINT!"=="1" echo        x86_64-w64-mingw32-gcc yok; MinGW-w64 linker/PATH kurulumunu kontrol edin.
        exit /b 1
    )
    set "BUILD_OK=1"
)

:: Direct MSVC build.
if not "!BUILD_OK!"=="1" if "%CXX_TOOL%"=="MSVC" (
    echo [3/3] MSVC cl.exe ile derleme...
    "%CXX_CMD%" /nologo /std:c++17 /O2 /GL /EHsc /utf-8 /W4 /DNOMINMAX /DWIN32_LEAN_AND_MEAN /D_CRT_SECURE_NO_WARNINGS /DNDEBUG %EMBED_DEFINE:-D=/D% %PROD_DEFINE_MSVC% %INCLUDE_FLAGS% %CPP_SOURCES% /Fe:"%OUT_EXE%" /link /LTCG /INCREMENTAL:NO /OPT:REF /OPT:ICF "%RUST_LIB%" advapi32.lib ws2_32.lib userenv.lib bcrypt.lib ntdll.lib crypt32.lib
    if errorlevel 1 ( echo [HATA] MSVC cl.exe derleme basarisiz. & exit /b 1 )
    del /q "%ROOT%\core_engine.obj" "%ROOT%\intel_core.obj" > nul 2>&1
    set "BUILD_OK=1"
)

if not exist "%OUT_EXE%" (
    echo [HATA] ---------kt---- dosyas---- olu----turulamad----: %OUT_EXE%
    exit /b 1
)

:: -------------- Strip debug symbols (tersine m----hendislik engellemesi) ---------------------------------------------------------------------------------------------------------------------------------------------------
echo [3/3] Debug sembolleri siliniyor (strip)...
strip.exe --strip-all "%OUT_EXE%" > nul 2>&1
if errorlevel 1 (
    :: strip.exe not available or MSVC binary ------- try llvm-strip or accept no-strip
    llvm-strip.exe --strip-all "%OUT_EXE%" > nul 2>&1
    if errorlevel 1 (
        echo [UYARI] 'strip' arac---- bulunamad----. Debug sembolleri silinmedi.
        echo          MSVC: dumpbin /PDBPATH ile PDB ayr---- tutulmu---- olabilir.
    ) else (
        echo [OK] llvm-strip ile debug sembolleri silindi.
    )
) else (
    echo [OK] strip --strip-all tamamland----.
)

:: -------------- Final binary report + <50 MB HARD size guard (MSVC & MinGW) --------------------------------------------------------------------------------------------------
:: Toolchain-agnostic: this runs after strip on whichever leg produced OUT_EXE
:: (CMake/g++/cl.exe), so the SAME <50 MB ceiling is enforced for both the MSVC
:: and the MinGW/GCC matrix legs. A breach is a HARD build failure (exit /b 1),
:: not just a warning ------- T-22 requires a guaranteed sub-50 MB single static binary.
set "MAX_BYTES=52428800"
set "EXE_BYTES=0"
for %%F in ("%OUT_EXE%") do (
    set "EXE_BYTES=%%~zF"
    set /a "EXE_SIZE_KB=%%~zF/1024"
    set /a "EXE_SIZE_MB=%%~zF/1048576"
)
echo.
echo ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
echo [TAMAMLANDI] CAELUS OS Blackbox Binary ----retildi
echo ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
echo ---------kt----     : %OUT_EXE%
echo Boyut     : ~!EXE_SIZE_KB! KB  (~!EXE_SIZE_MB! MB)  [!EXE_BYTES! bayt]
echo Toolchain : %CXX_TOOL%  ^|  Rust target: %RUST_TARGET%
if /I "%CAELUS_PRODUCTION%"=="1" echo PRODUCTION GATES: COMPILED-OUT  ^(CAELUS_PRODUCTION — SELF_SIGNED_DEV / plugin dev-bypass / pin-bypass derleme-disi^)
if !EXE_BYTES! GEQ %MAX_BYTES% (
    echo Hedef     : ^<50 MB ✗  AŞILDI  ^(!EXE_BYTES! ^> %MAX_BYTES% bayt^)
    echo.
    echo [HATA] Statik binary 50 MB sinirini asti ------- build BASARISIZ.
    echo        Boyut dusurme onerileri:
    echo          - MSVC : /O1 + /OPT:REF /OPT:ICF + statik CRT /MT
    echo          - MinGW: -Os -s ^(strip^) + gereksiz bagimliliklari ayikla
    echo          - Son care: UPX ile sikistirma.
    exit /b 1
)
echo Hedef     : ^<50 MB -------  BA----ARILI
echo.
echo [NOT] UI varliklari binary'ye gomuldu (hex bayt dizisi). Bu bir SIFRELEME
echo        ya da gizleme DEGILDIR: 'strings' benzeri araclarla HTML/JS aynen
echo        geri cikarilabilir. Gercek koruma gerekiyorsa varliklari AES ile
echo        sifreleyip calisma aninda cozun.
echo [NOT] 'strip' yalnizca sembolleri temizler; gomulu UI metnini gizlemez.
echo.

endlocal
exit /b 0
