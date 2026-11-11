@echo off
setlocal EnableDelayedExpansion
chcp 65001 > nul 2>&1

:: ----------------------------------------------------------------------------
::  CAELUS OS - Yerel ve GitHub Actions MSVC/GCC CI Betigi (ci.bat)
::
::  Yedi zorunlu kapi (0 Hata / 0 Uyari / Fail-Closed):
::    1. Rust calisma alani kapisi (no_std core check + tum workspace testleri)
::    2. C++ birim testleri (/W4 /WX, utf-8, NOMINMAX, ws2_32)
::    3. Connector smoke (MQTT + Zapier + FIELD-IDENTITY v1/v2) + pure Blake3
::    4. CAELUS_PRODUCTION=1 derleme + <50 MB siniri + dev-bypass bayt taramasi
::    5. Izole (%TEMP%\caelus_ci_audit) determinizm cift-kosumu + caelus_verify_audit
::       zincir/SEAL pini + negatif UNTRUSTED_SEAL_SIGNER kapisi
::    6. Negatif senaryo imzasi kapisi (SIGNATURE_MISMATCH -> blank slate 1.000000)
::    7. C++ golden + caelus_core_repl canli diferansiyel golden + Verus/Z3 ispatlari
:: ----------------------------------------------------------------------------

set "ROOT=%~dp0"
set "ROOT=%ROOT:~0,-1%"
set "EXE=%ROOT%\dist\caelus_os.exe"
set "VERIFY_BIN=%ROOT%\target\release\caelus_verify_audit.exe"
set "AIRLOCK_BIN=%ROOT%\target\release\caelus_sidecar_airlock.exe"
set "REPL_BIN=%ROOT%\target\release\caelus_core_repl.exe"
set "TEST_EXE=%ROOT%\build_tests\caelus_cpp_tests.exe"
set "DET_SIGNER_PUBKEY=acdcc8494d458f44a7aaac1d6a84ec624daee88436db2ae26e67ba645a106228"
set "SAMPLE_SIGNER_PUBKEY=2dd8b43ecba8eff73b1aa25250de676f4f8a0be072b1f96a7eda7355648ca0d1"
set "CXX_TOOL="
set "PYTHON_CMD="

set "SKIP_BUILD=0"
set "ONLY_DET=0"
set "SKIP_CONNECTOR_SMOKE=%CAELUS_SKIP_CONNECTOR_SMOKE%"
if not defined SKIP_CONNECTOR_SMOKE set "SKIP_CONNECTOR_SMOKE=0"
for %%A in (%*) do (
    if "%%A"=="--skip-build" set "SKIP_BUILD=1"
    if "%%A"=="--only-det"   set "ONLY_DET=1"
)

set "CI_PASS=0"
set "STEP_FAIL="

echo.
echo ------------------------------------------------------------
echo    CAELUS OS - Windows CI ve Determinizm Dogrulama Betigi
echo    Air-Gapped - Fail-Closed - Tek Statik Binary
echo ------------------------------------------------------------
echo.

:: ----------------------------------------------------------------------------
:: ADIM 0: On kontroller (etkilesimsiz - cl.exe /? pager KULLANILMAZ)
:: ----------------------------------------------------------------------------
echo [CI] On kontrol: araclar...

cargo --version > nul 2>&1
if errorlevel 1 (
    echo [CI HATA] 'cargo' bulunamadi. Rust toolchain kurulumu gerekli.
    exit /b 1
)
echo [CI OK] cargo: mevcut

py -3 --version > nul 2>&1
if not errorlevel 1 set "PYTHON_CMD=py -3"
if not defined PYTHON_CMD (
    python --version > nul 2>&1
    if not errorlevel 1 set "PYTHON_CMD=python"
)
if not defined PYTHON_CMD (
    echo [CI HATA] Python 3 bulunamadi ^(py -3 veya python gerekli^).
    exit /b 1
)
echo [CI OK] Python: !PYTHON_CMD!

if "%ONLY_DET%"=="0" (
    set "GCC_OK=0"
    set "MSVC_OK=0"
    set "GNU_LD_OK=0"
    where g++ > nul 2>&1
    if not errorlevel 1 set "GCC_OK=1"
    where cl.exe > nul 2>&1
    if not errorlevel 1 set "MSVC_OK=1"
    where x86_64-w64-mingw32-gcc > nul 2>&1
    if not errorlevel 1 set "GNU_LD_OK=1"

    if defined CAELUS_CXX (
        if /I "%CAELUS_CXX%"=="MSVC" (
            if not "!MSVC_OK!"=="1" (
                echo [CI HATA] CAELUS_CXX=MSVC istendi ama cl.exe PATH icinde yok.
                exit /b 1
            )
            set "CXX_TOOL=MSVC"
        ) else if /I "%CAELUS_CXX%"=="GCC" (
            if not "!GCC_OK!"=="1" (
                echo [CI HATA] CAELUS_CXX=GCC istendi ama g++ PATH icinde yok.
                exit /b 1
            )
            set "CXX_TOOL=GCC"
        ) else (
            echo "%CAELUS_CXX%" | findstr /I "cl" > nul 2>&1
            if not errorlevel 1 (set "CXX_TOOL=MSVC") else (set "CXX_TOOL=GCC")
        )
    ) else (
        if "!GCC_OK!"=="1" if "!GNU_LD_OK!"=="1" set "CXX_TOOL=GCC"
        if not defined CXX_TOOL if "!MSVC_OK!"=="1" set "CXX_TOOL=MSVC"
        if not defined CXX_TOOL if "!GCC_OK!"=="1" set "CXX_TOOL=GCC"
    )
    if not defined CXX_TOOL (
        echo [CI HATA] Kullanilabilir C++ derleyici bulunamadi ^(cl.exe veya g++ gerekli^).
        exit /b 1
    )
    echo [CI OK] C++ derleyici: !CXX_TOOL!
)

certutil -? > nul 2>&1
if errorlevel 1 (
    echo [CI HATA] 'certutil' bulunamadi.
    exit /b 1
)
echo.

:: ----------------------------------------------------------------------------
:: ADIM 1: Rust no_std kontrolu ve tum calisma alani birim/mulkiyet testleri
:: ----------------------------------------------------------------------------
if "%ONLY_DET%"=="0" (
    echo ------------------------------------------------------------
    echo [CI] ADIM 1/7 - Rust no_std Check + Workspace Testleri
    echo ------------------------------------------------------------
    pushd "%ROOT%"
    cargo check -p caelus_core --no-default-features
    set "RUST_NOSTD_EC=!errorlevel!"
    if "!RUST_NOSTD_EC!"=="0" (
        !PYTHON_CMD! -c "import subprocess,sys; r=subprocess.run(['cargo','tree','-p','caelus_core','--no-default-features','--edges','normal'],capture_output=True,text=True); ls=[x.strip() for x in r.stdout.splitlines() if x.strip()]; ok=(r.returncode==0 and len(ls)==1 and ls[0].startswith('caelus_core ')); print('[CI OK] caelus_core sifir dis bagimlilik dogrulandi:', ls[0] if ls else '') if ok else print('[CI FAIL] caelus_core bagimlilik agaci beklenmeyen:', r.stdout, r.stderr, file=sys.stderr); sys.exit(0 if ok else 1)"
        set "RUST_NOSTD_EC=!errorlevel!"
    )
    if "!RUST_NOSTD_EC!"=="0" (
        cargo test --workspace --all-targets
        set "RUST_EC=!errorlevel!"
    ) else (
        set "RUST_EC=!RUST_NOSTD_EC!"
    )
    popd
    if "!RUST_EC!" NEQ "0" (
        echo [CI FAIL] Rust workspace/no_std kapisi BASARISIZ ^(exit=!RUST_EC!^)
        set "CI_PASS=1"
        set "STEP_FAIL=!STEP_FAIL! RUST_TESTS"
    ) else (
        echo [CI OK] Rust no_std + workspace testleri gecti
    )
    echo.
)

:: ----------------------------------------------------------------------------
:: ADIM 2: C++ birim testleri (/W4 /WX)
:: ----------------------------------------------------------------------------
if "%ONLY_DET%"=="0" (
    echo ------------------------------------------------------------
    echo [CI] ADIM 2/7 - C++ Unit Tests ^(doctest-minimal^)
    echo ------------------------------------------------------------
    if not exist "%ROOT%\build_tests" mkdir "%ROOT%\build_tests"
    if "!CXX_TOOL!"=="GCC" (
        g++ -std=c++17 -O2 -Wall -Wextra -DCAELUS_CPP_UNIT_TEST=1 -I"%ROOT%" -I"%ROOT%\include" -I"%ROOT%\src" -I"%ROOT%\tests" "%ROOT%\tests\test_causal_engine.cpp" -o "%TEST_EXE%" -lws2_32
    ) else (
        cl.exe /nologo /std:c++17 /O2 /EHsc /utf-8 /W4 /WX /DNOMINMAX /DWIN32_LEAN_AND_MEAN /D_CRT_SECURE_NO_WARNINGS /DCAELUS_CPP_UNIT_TEST=1 /I"%ROOT%" /I"%ROOT%\include" /I"%ROOT%\src" /I"%ROOT%\tests" "%ROOT%\tests\test_causal_engine.cpp" /Fo:"%ROOT%\build_tests\\" /Fe:"%TEST_EXE%" /link /INCREMENTAL:NO ws2_32.lib
    )
    set "CPP_BUILD_EC=!errorlevel!"
    if "!CPP_BUILD_EC!" NEQ "0" (
        echo [CI FAIL] C++ test derlemesi BASARISIZ ^(exit=!CPP_BUILD_EC!^)
        set "CI_PASS=1"
        set "STEP_FAIL=!STEP_FAIL! CPP_TEST_BUILD"
    ) else (
        "%TEST_EXE%"
        set "CPP_TEST_EC=!errorlevel!"
        if "!CPP_TEST_EC!" NEQ "0" (
            echo [CI FAIL] C++ birim testleri BASARISIZ ^(exit=!CPP_TEST_EC!^)
            set "CI_PASS=1"
            set "STEP_FAIL=!STEP_FAIL! CPP_TESTS"
        ) else (
            echo [CI OK] C++ birim testleri gecti
        )
    )
    echo.
)

:: ----------------------------------------------------------------------------
:: ADIM 3: Connector entegrasyon smoke (v1 + OB-2 FIELD-IDENTITY v2) + Blake3
:: ----------------------------------------------------------------------------
if "%ONLY_DET%"=="0" (
    echo ------------------------------------------------------------
    echo [CI] ADIM 3/7 - Connector Smoke + Pure Blake3 Denkligi
    echo ------------------------------------------------------------
    if "!SKIP_CONNECTOR_SMOKE!"=="1" (
        echo [CI UYARI] Connector smoke atlandi: CAELUS_SKIP_CONNECTOR_SMOKE=1
    ) else (
        set "OLD_CAELUS_CXX=%CAELUS_CXX%"
        set "CAELUS_CXX=!CXX_TOOL!"
        !PYTHON_CMD! "%ROOT%\tests\connector_smoke.py"
        set "CONNECTOR_SMOKE_EC=!errorlevel!"
        if defined OLD_CAELUS_CXX (set "CAELUS_CXX=!OLD_CAELUS_CXX!") else (set "CAELUS_CXX=")
        if "!CONNECTOR_SMOKE_EC!" NEQ "0" (
            echo [CI FAIL] Connector smoke BASARISIZ ^(exit=!CONNECTOR_SMOKE_EC!^)
            set "CI_PASS=1"
            set "STEP_FAIL=!STEP_FAIL! CONNECTOR_SMOKE"
        ) else (
            echo [CI OK] Connector smoke testleri gecti
        )
    )
    !PYTHON_CMD! "%ROOT%\tests\test_pure_blake3.py"
    if errorlevel 1 (
        echo [CI FAIL] test_pure_blake3.py BASARISIZ
        set "CI_PASS=1"
        set "STEP_FAIL=!STEP_FAIL! PURE_BLAKE3"
    ) else (
        echo [CI OK] pure-Python Blake3 denkligi dogrulandi
    )
    echo.
)

:: ----------------------------------------------------------------------------
:: ADIM 4: Taze CAELUS_PRODUCTION=1 derlemesi + <50 MB + Bypass String Scan
:: ----------------------------------------------------------------------------
if "%ONLY_DET%"=="0" (
    echo ------------------------------------------------------------
    echo [CI] ADIM 4/7 - Uretim Derlemesi ^(CAELUS_PRODUCTION=1^) + Guvenlik Taramasi
    echo ------------------------------------------------------------
    if "%SKIP_BUILD%"=="0" (
        set "OLD_PROD=%CAELUS_PRODUCTION%"
        set "OLD_CXX=%CAELUS_CXX%"
        set "CAELUS_PRODUCTION=1"
        set "CAELUS_CXX=!CXX_TOOL!"
        call "%ROOT%\build.bat"
        set "BUILD_EC=!errorlevel!"
        if defined OLD_PROD (set "CAELUS_PRODUCTION=!OLD_PROD!") else (set "CAELUS_PRODUCTION=")
        if defined OLD_CXX (set "CAELUS_CXX=!OLD_CXX!") else (set "CAELUS_CXX=")
        if "!BUILD_EC!" NEQ "0" (
            echo [CI FAIL] CAELUS_PRODUCTION=1 derlemesi BASARISIZ ^(exit=!BUILD_EC!^)
            set "CI_PASS=1"
            set "STEP_FAIL=!STEP_FAIL! PROD_BUILD"
            goto :report
        )
    ) else if not exist "%EXE%" (
        echo [CI FAIL] --skip-build ayarli ancak %EXE% mevcut degil.
        set "CI_PASS=1"
        set "STEP_FAIL=!STEP_FAIL! MISSING_PROD_BIN"
        goto :report
    )

    !PYTHON_CMD! -c "import pathlib,sys; p=pathlib.Path(sys.argv[1]); b=p.read_bytes(); sz=len(b); print(f'[CI] Binary boyutu: {sz//1024} KB ({sz} bayt)'); sys.exit(1 if sz >= 50*1024*1024 else 0)" "%EXE%"
    if errorlevel 1 (
        echo [CI FAIL] Binary 50 MB sinirini asti!
        set "CI_PASS=1"
        set "STEP_FAIL=!STEP_FAIL! BINARY_SIZE"
    ) else (
        echo [CI OK] Boyut hedefi karsilandi ^(^< 50 MB^)
    )

    !PYTHON_CMD! -c "import pathlib,sys; b=pathlib.Path(sys.argv[1]).read_bytes(); bad=[s.decode() for s in (b'CAELUS_ALLOW_DEV_SCENARIOS',b'CAELUS_TRUST_ANY_PUBKEY',b'CAELUS_PLUGIN_ALLOW_UNVERIFIED') if s in b]; print('[CI FAIL] Dev bypass dizgeleri bulundu:', bad) if bad else print('[CI OK] Uretim ikilisinde sifir dev-bypass dizgesi dogrulandi'); sys.exit(1 if bad else 0)" "%EXE%"
    if errorlevel 1 (
        set "CI_PASS=1"
        set "STEP_FAIL=!STEP_FAIL! PROD_BYPASS_SCAN"
    )
    echo.
)

:: Ensure standalone Rust audit verifier & Sidecar Airlock CLI exist (for --skip-build / --only-det)
if not exist "%VERIFY_BIN%" (
    pushd "%ROOT%"
    cargo build --release -p caelus_network --bin caelus_verify_audit
    popd
    if errorlevel 1 (
        echo [CI FAIL] caelus_verify_audit derlenemedi.
        set "CI_PASS=1"
        set "STEP_FAIL=!STEP_FAIL! VERIFY_BIN_BUILD"
        goto :report
    )
)
if not exist "%AIRLOCK_BIN%" (
    pushd "%ROOT%"
    cargo build --release -p caelus_network --bin caelus_sidecar_airlock
    popd
    if errorlevel 1 (
        echo [CI FAIL] caelus_sidecar_airlock derlenemedi.
        set "CI_PASS=1"
        set "STEP_FAIL=!STEP_FAIL! AIRLOCK_BIN_BUILD"
        goto :report
    )
)

if "%ONLY_DET%"=="0" (
    echo ------------------------------------------------------------
    echo [CI] Sidecar Airlock PR-1 Izolasyon, Ege Feribot Pilotu ve MCP 64-Bit Kapisi
    echo ------------------------------------------------------------
    !PYTHON_CMD! -W error "%ROOT%\tests\test_airlock_ferry_pilot.py"
    if errorlevel 1 (
        echo [CI FAIL] Sidecar Airlock pilot testleri BASARISIZ!
        set "CI_PASS=1"
        set "STEP_FAIL=!STEP_FAIL! AIRLOCK_PILOT"
    ) else (
        echo [CI OK] Sidecar Airlock PR-1 pilot ve izolasyon testleri gecti
    )
    where node > nul 2>&1
    if not errorlevel 1 (
        node --test "%ROOT%\tests\test_war_room_master_gates.mjs"
        if errorlevel 1 (
            echo [CI FAIL] War Room 4-Ajan AG-UI ve Hava Bosluklu Kokpit kapilari BASARISIZ!
            set "CI_PASS=1"
            set "STEP_FAIL=!STEP_FAIL! WAR_ROOM_GATES"
        ) else (
            echo [CI OK] War Room 4-Ajan AG-UI ve Hava Bosluklu Kokpit kapilari gecti
        )
    )
    echo.
)

:: ----------------------------------------------------------------------------
:: ADIM 5: Izole Deterministik Cift-Kosum + Adli Muhur + UNTRUSTED_SEAL_SIGNER
:: ----------------------------------------------------------------------------
echo ------------------------------------------------------------
echo [CI] ADIM 5/7 - Deterministik Cikti ve Adli Muhur Dogrulamasi
echo ------------------------------------------------------------

if not exist "%EXE%" (
    echo [CI FAIL] Binary bulunamadi: %EXE%
    set "CI_PASS=1"
    set "STEP_FAIL=!STEP_FAIL! DET_MISSING_BIN"
    goto :report
)

set "CAELUS_DET_SEED=0xCAE105DEADBEEF00"
set "CAELUS_ENCLAVE_KEY=cae1cae1cae1cae1cae1cae1cae1cae1cae1cae1cae1cae1cae1cae1cae1cae1"

set "AUDIT_DIR=%TEMP%\caelus_ci_audit"
if exist "%AUDIT_DIR%" rd /s /q "%AUDIT_DIR%" > nul 2>&1
mkdir "%AUDIT_DIR%" > nul 2>&1
set "OUT1=%AUDIT_DIR%\run1.out"
set "OUT2=%AUDIT_DIR%\run2.out"
set "BLK1=%AUDIT_DIR%\blk1.txt"
set "BLK2=%AUDIT_DIR%\blk2.txt"
set "AUD1=%AUDIT_DIR%\audit_run1.log"
set "AUD2=%AUDIT_DIR%\caelus_audit_0000000000000000.log"

pushd "%AUDIT_DIR%"
"%EXE%" --scenario UNIVERSAL_BASELINE --det-mode > "%OUT1%" 2>&1
set "EC1=!errorlevel!"
if exist "caelus_audit_0000000000000000.log" move /Y "caelus_audit_0000000000000000.log" "%AUD1%" > nul
"%EXE%" --scenario UNIVERSAL_BASELINE --det-mode > "%OUT2%" 2>&1
set "EC2=!errorlevel!"
popd

if "!EC1!" NEQ "0" (
    echo [CI FAIL] Determinizm Kosum 1 basarisiz ^(exit=!EC1!^)
    type "%OUT1%"
    set "CI_PASS=1"
    set "STEP_FAIL=!STEP_FAIL! DET_RUN1"
    goto :cleanup_step5
)
if "!EC2!" NEQ "0" (
    echo [CI FAIL] Determinizm Kosum 2 basarisiz ^(exit=!EC2!^)
    type "%OUT2%"
    set "CI_PASS=1"
    set "STEP_FAIL=!STEP_FAIL! DET_RUN2"
    goto :cleanup_step5
)

!PYTHON_CMD! -c "import pathlib,sys; l1=[l for l in pathlib.Path(sys.argv[1]).read_text(encoding='utf-8',errors='replace').splitlines() if l.startswith('CDET:')]; l2=[l for l in pathlib.Path(sys.argv[2]).read_text(encoding='utf-8',errors='replace').splitlines() if l.startswith('CDET:')]; pathlib.Path(sys.argv[3]).write_bytes(('\n'.join(l1)+'\n').encode('utf-8')); pathlib.Path(sys.argv[4]).write_bytes(('\n'.join(l2)+'\n').encode('utf-8')); a1=pathlib.Path(sys.argv[5]).read_bytes(); a2=pathlib.Path(sys.argv[6]).read_bytes(); ok=bool(l1) and (l1==l2) and (a1==a2); sys.exit(0 if ok else 1)" "%OUT1%" "%OUT2%" "%BLK1%" "%BLK2%" "%AUD1%" "%AUD2%"
if errorlevel 1 (
    echo [CI FAIL] CDET bloklari veya denetim gunlukleri eslesmedi!
    set "CI_PASS=1"
    set "STEP_FAIL=!STEP_FAIL! DETERMINISM"
) else (
    echo [CI OK] CDET cift-kosum ve adli denetim gunlukleri bit-bit esit:
    type "%BLK1%"
)

echo.
echo [CI] Bagimsiz Rust adli dogrulayicisi ^(caelus_verify_audit^) calisiyor...
"%VERIFY_BIN%" --expect-signer "%DET_SIGNER_PUBKEY%" "%AUD2%"
if errorlevel 1 (
    echo [CI FAIL] caelus_verify_audit canli log dogrulamasi BASARISIZ.
    set "CI_PASS=1"
    set "STEP_FAIL=!STEP_FAIL! AUDIT_VERIFY_RUST"
) else (
    echo [CI OK] caelus_verify_audit canli log + pin dogrulamasi gecti
)

"%VERIFY_BIN%" --expect-signer "%SAMPLE_SIGNER_PUBKEY%" "%ROOT%\tests\fixtures\caelus_audit_sample.log"
if errorlevel 1 (
    echo [CI FAIL] caelus_audit_sample.log fixture dogrulamasi BASARISIZ.
    set "CI_PASS=1"
    set "STEP_FAIL=!STEP_FAIL! AUDIT_SAMPLE_FIXTURE"
)

set "PRINTED_SIGNER="
set "SIGNER_TMP=%AUDIT_DIR%\printed_signer.txt"
"%VERIFY_BIN%" --print-signer "%AUD2%" > "%SIGNER_TMP%" 2>nul
if exist "%SIGNER_TMP%" set /p PRINTED_SIGNER=<"%SIGNER_TMP%"
if /I not "!PRINTED_SIGNER!"=="%DET_SIGNER_PUBKEY%" (
    echo [CI FAIL] --print-signer beklenen anahtari dondurmedi: !PRINTED_SIGNER!
    set "CI_PASS=1"
    set "STEP_FAIL=!STEP_FAIL! AUDIT_PRINT_SIGNER"
)

:: Negatif pin testi: farkli guven capasi verildiginde UNTRUSTED_SEAL_SIGNER + sifir-disi cikis ZORUNLU
set "NEG_PIN_OUT=%AUDIT_DIR%\neg_pin.out"
"%VERIFY_BIN%" --expect-signer "%ROOT%\tools\caelus_trusted_pubkey.txt" "%AUD2%" > "%NEG_PIN_OUT%" 2>&1
set "NEG_PIN_EC=!errorlevel!"
if "!NEG_PIN_EC!"=="0" (
    echo [CI FAIL] Yanlis imzalayici pini reddedilmedi ^(exit=0^)!
    set "CI_PASS=1"
    set "STEP_FAIL=!STEP_FAIL! AUDIT_NEG_PIN_EXIT"
) else (
    findstr /C:"UNTRUSTED_SEAL_SIGNER" "%NEG_PIN_OUT%" > nul 2>&1
    if errorlevel 1 (
        echo [CI FAIL] Yanlis pin ciktisinda UNTRUSTED_SEAL_SIGNER bulunamadi!
        type "%NEG_PIN_OUT%"
        set "CI_PASS=1"
        set "STEP_FAIL=!STEP_FAIL! AUDIT_NEG_PIN_MSG"
    ) else (
        echo [CI OK] Negatif muhur pini dogrulandi ^(UNTRUSTED_SEAL_SIGNER reddedildi^)
    )
)

!PYTHON_CMD! "%ROOT%\tools\verify_audit_log.py" --expect-signer "%DET_SIGNER_PUBKEY%" "%AUD2%"
if errorlevel 1 (
    echo [CI FAIL] verify_audit_log.py capraz dogrulamasi BASARISIZ.
    set "CI_PASS=1"
    set "STEP_FAIL=!STEP_FAIL! AUDIT_VERIFY_PY"
)

:cleanup_step5
if exist "%AUDIT_DIR%" rd /s /q "%AUDIT_DIR%" > nul 2>&1
echo.

:: ----------------------------------------------------------------------------
:: ADIM 6: Negatif senaryo imzasi dogrulama (SIG-CI)
:: ----------------------------------------------------------------------------
echo ------------------------------------------------------------
echo [CI] ADIM 6/7 - Negatif Senaryo Imza Dogrulama ^(SIG-CI^)
echo ------------------------------------------------------------

set "SIG_DIR=%TEMP%\caelus_ci_signeg"
set "SIG_OUT=%SIG_DIR%\sig_negative.txt"
set "OLD_CAELUS_ALLOW_DEV_SCENARIOS=%CAELUS_ALLOW_DEV_SCENARIOS%"
set "CAELUS_ALLOW_DEV_SCENARIOS=0"

if exist "%SIG_DIR%" rd /s /q "%SIG_DIR%" > nul 2>&1
mkdir "%SIG_DIR%\scenarios" > nul 2>&1
!PYTHON_CMD! "%ROOT%\tests\make_negative_scenario.py" "%ROOT%\scenarios\BS-01_SAHTE_UFUK.json" "%SIG_DIR%\scenarios\BS-01_SAHTE_UFUK.json"
if errorlevel 1 (
    echo [CI FAIL] SIG-CI negatif fixture uretilemedi.
    set "CI_PASS=1"
    set "STEP_FAIL=!STEP_FAIL! SIG_CI_FIXTURE"
)

pushd "%SIG_DIR%"
"%EXE%" --scenario BS-01_SAHTE_UFUK --det-mode > "%SIG_OUT%" 2>&1
set "SIG_EC=!errorlevel!"
popd

if defined OLD_CAELUS_ALLOW_DEV_SCENARIOS (
    set "CAELUS_ALLOW_DEV_SCENARIOS=!OLD_CAELUS_ALLOW_DEV_SCENARIOS!"
) else (
    set "CAELUS_ALLOW_DEV_SCENARIOS="
)

set "SIG_STEP_FAIL=0"
if "!SIG_EC!" NEQ "0" (
    set "SIG_STEP_FAIL=1"
    set "STEP_FAIL=!STEP_FAIL! SIG_CI_EXIT"
)
findstr /C:"SIGNATURE_MISMATCH" "%SIG_OUT%" > nul 2>&1
if errorlevel 1 (
    set "SIG_STEP_FAIL=1"
    set "STEP_FAIL=!STEP_FAIL! SIG_CI_NO_SIGNATURE_MISMATCH"
)
findstr /C:"AWAITING_SCENARIO_INJECTION" "%SIG_OUT%" > nul 2>&1
if errorlevel 1 (
    set "SIG_STEP_FAIL=1"
    set "STEP_FAIL=!STEP_FAIL! SIG_CI_NO_AWAITING"
)
findstr /C:"CDET: raw_friction=1.000000" "%SIG_OUT%" > nul 2>&1
if errorlevel 1 (
    set "SIG_STEP_FAIL=1"
    set "STEP_FAIL=!STEP_FAIL! SIG_CI_NO_NEUTRAL_RAW"
)
findstr /C:"CDET: final_friction=1.000000" "%SIG_OUT%" > nul 2>&1
if errorlevel 1 (
    set "SIG_STEP_FAIL=1"
    set "STEP_FAIL=!STEP_FAIL! SIG_CI_NO_NEUTRAL_FINAL"
)

if "!SIG_STEP_FAIL!"=="0" (
    echo [CI OK] SIG-CI dogrulandi: bozuk ed25519 imzali paket reddedildi, motor blank slate'e dustu.
) else (
    type "%SIG_OUT%"
    set "CI_PASS=1"
)
if exist "%SIG_DIR%" rd /s /q "%SIG_DIR%" > nul 2>&1
echo.

:: ----------------------------------------------------------------------------
:: ADIM 7: C++ Golden + caelus_core_repl Canli Diferansiyel Golden + Verus/Z3
:: ----------------------------------------------------------------------------
echo ------------------------------------------------------------
echo [CI] ADIM 7/7 - C++/Rust Diferansiyel Golden + Verus Z3 Ispatlari
echo ------------------------------------------------------------

if /I "%CAELUS_SKIP_CORE_DIFF%"=="1" (
    echo [CI] CAELUS_SKIP_CORE_DIFF=1 - diferansiyel adim atlandi.
    goto :report
)

echo [CI] C++ motoru BS-01/BS-02/BS-03 golden kontrolu...
!PYTHON_CMD! "%ROOT%\tests\run_bs_exec_golden.py" --binary "%EXE%"
if errorlevel 1 (
    echo [CI FAIL] C++ BS-EXEC golden BASARISIZ.
    set "CI_PASS=1"
    set "STEP_FAIL=!STEP_FAIL! CPP_GOLDEN"
)

echo [CI] caelus_core_repl release derlemesi...
pushd "%ROOT%"
cargo build --release -p caelus_core --features std --bin caelus_core_repl --quiet
set "REPL_BUILD_EC=!errorlevel!"
popd
if "!REPL_BUILD_EC!" NEQ "0" (
    echo [CI FAIL] caelus_core_repl derlenemedi.
    set "CI_PASS=1"
    set "STEP_FAIL=!STEP_FAIL! CORE_HARNESS_BUILD"
    goto :cleanup_root_logs
)

echo [CI] Canli diferansiyel golden: Rust caelus_core_repl == C++ caelus_os...
!PYTHON_CMD! "%ROOT%\tests\run_bs_exec_golden.py" --binary "%REPL_BIN%" --reference-binary "%EXE%"
if errorlevel 1 (
    echo [CI FAIL] Diferansiyel golden FAIL - Rust cekirdegi C++ motorundan sapti.
    set "CI_PASS=1"
    set "STEP_FAIL=!STEP_FAIL! CORE_DIFFERENTIAL"
) else (
    echo [CI OK] Diferansiyel golden: Rust cekirdek == C++ motoru ^(BS-01/02/03 bit-esit^)
)

set "VERUS_EXE=%ROOT%\tools\verus\verus-x86-win\verus.exe"
if exist "%VERUS_EXE%" (
    set "VERUS_FAIL=0"
    for %%V in ("%ROOT%\caelus_core\verify\*.rs") do (
        echo [CI] Verus/Z3: %%~nxV ...
        "%VERUS_EXE%" --crate-type=lib "%%~fV"
        if errorlevel 1 (
            echo [CI FAIL] Verus ispati BASARISIZ: %%~nxV
            set "VERUS_FAIL=1"
        )
    )
    if "!VERUS_FAIL!"=="1" (
        set "CI_PASS=1"
        set "STEP_FAIL=!STEP_FAIL! VERUS_PROOFS"
    ) else (
        echo [CI OK] Verus/Z3 ispatlari dogrulandi
    )
) else (
    echo [CI UYARI] Verus bulunamadi ^(tools\verus^) - ispat adimi atlandi.
)

:cleanup_root_logs
del /q "%ROOT%\caelus_audit_0000000000000000.log" > nul 2>&1

:report
echo.
echo ------------------------------------------------------------
if "!CI_PASS!"=="0" (
    echo [CI] TUM TESTLER BASARILI
    echo ------------------------------------------------------------
    exit /b 0
) else (
    echo [CI] BASARISIZ ADIMLAR:!STEP_FAIL!
    echo ------------------------------------------------------------
    exit /b 1
)
