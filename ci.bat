@echo off
setlocal EnableDelayedExpansion
chcp 65001 > nul

:: ----------------------------------------------------------------------------
::  CAELUS OS - Yerel CI / Determinizm Test Betig-i  (ci.bat)
::
::  Yedi adim:
::    1. Rust birim testleri  (cargo test)
::    2. C++ unit tests
::    3. Connector entegrasyon smoke (MQTT + Zapier, loopback ag- AKTI-F)
::         network -> pull_intel -> registry inject_intel -> CausalEngine graf
::         du-g-u-mu-. Bu adim --det-mode DIS-INDADIR: det-mode ag-i atladig-indan
::         connector sinyali ancak ag- ac-ikken graf du-g-u-mlerine ulas-ir.
::         --only-det bu adimi atlar; CAELUS_SKIP_CONNECTOR_SMOKE=1 kac-is- kapisi.
::    4. Binary boyut kontrolu-  (< 50 MB)
::    5. Deterministik c-ikti dog-rulama  (--det-mode)
::         Ayni senaryo iki kez kos-ulur - CDET: bloklari c-ikartilir -
::         SHA-256 o-zetleri kars-ilas-tirilir - es-les-irse PASS.
::    6. Negatif imza dog-rulama (SIG-CI)  (--det-mode)
::         I-mzasi kasitli bozulmus- senaryo kopyasi dev kapisi kapaliyken
::         reddedilir - motor c-o-kmeden UNIVERSAL_BASELINE blank slate'e du-s-er.
::    7. caelus_core diferansiyel golden (F1 - c-ift motor es-itlig-i)
::         no_std Rust c-ekirdeg-i (caelus_core/) u-c- BS senaryosunda C++ motoruyla
::         AYNI snapshot hash'lerini u-retmek zorundadir.
::         CAELUS_SKIP_CORE_DIFF=1 kac-is- kapisi.
::
::  Kullanim:
::    ci.bat                    (tam CI)
::    ci.bat --skip-build       (sadece test, yeniden derleme yok)
::    ci.bat --only-det         (sadece determinizm testi)
::
::  C-ikis- kodu: 0 = TU-M TESTLER BAS-ARILI / 1 = EN AZ BI-R TEST BAS-ARISIZ
:: ----------------------------------------------------------------------------

set "ROOT=%~dp0"
set "ROOT=%ROOT:~0,-1%"
set "EXE=%ROOT%\dist\caelus_os.exe"
set "TEST_EXE=%ROOT%\build_tests\caelus_cpp_tests.exe"
set "NEURAL_CPP_EXE=%ROOT%\build_tests\neural_cpp_reference.exe"
set "NEURAL_RUST_EXE=%ROOT%\tests\neural_reference\target\release\caelus_neural_reference.exe"
set "MODEL_SIGNER=%ROOT%\target\release\caelus_sign_model.exe"
set "CXX_TOOL="
set "PYTHON_CMD="
set "GCC_AVAILABLE=0"
set "MSVC_AVAILABLE=0"
set "GNU_LINKER_AVAILABLE=0"
set "GNU_RUST_TARGET_AVAILABLE=1"
set "CI_RUST_TARGET="

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

:: -- Renk yardimcilari (ANSI destekleniyorsa) ---------------------------------
:: Windows 10+ konsolu ANSI destekler; eski su-ru-mlerde yoksayilir.
set "G=[92m"
set "R=[91m"
set "Y=[93m"
set "C=[96m"
set "N=[0m"

echo.
echo %C%------------------------------------------------------------%N%
echo %C%   CAELUS OS - Yerel CI Betig-i%N%
echo %C%   Air-Gapped - Deterministik - Tek Statik Binary%N%
echo %C%------------------------------------------------------------%N%
echo.

:: ----------------------------------------------------------------------------
:: ADIM 0: O-n kontroller
:: ----------------------------------------------------------------------------
echo %C%[CI] O-n kontrol: arac-lar...%N%

cargo --version > nul 2>&1
if errorlevel 1 (
    echo %R%[CI HATA] 'cargo' bulunamadi. Rust toolchain kurulumu gerekli.%N%
    exit /b 1
)
echo %G%[CI OK] cargo: mevcut%N%

py -3 --version > nul 2>&1
if not errorlevel 1 set "PYTHON_CMD=py -3"
if not defined PYTHON_CMD (
    python --version > nul 2>&1
    if not errorlevel 1 set "PYTHON_CMD=python"
)
if not defined PYTHON_CMD (
    echo %R%[CI HATA] Python bulunamadı ^(py -3 veya python gerekli^).%N%
    exit /b 1
)
echo %G%[CI OK] Python: !PYTHON_CMD!%N%
!PYTHON_CMD! -c "import importlib.util,sys; sys.exit(0 if (importlib.util.find_spec('cryptography') or importlib.util.find_spec('nacl')) else 1)"
if errorlevel 1 (
    echo %R%[CI HATA] Python Ed25519 dogrulayicisi eksik ^(cryptography veya PyNaCl gerekli^).%N%
    exit /b 1
)

powershell -NoProfile -Command "$PSVersionTable.PSVersion.ToString()" > nul 2>&1
if errorlevel 1 (
    echo %R%[CI HATA] PowerShell bulunamadi ^(UI gomme ve bypass taramasi icin gerekli^).%N%
    exit /b 1
)

if "%ONLY_DET%"=="0" (
    g++ --version > nul 2>&1
    if not errorlevel 1 (
        set "GCC_AVAILABLE=1"
        set "CXX_TOOL=GCC"
    )
    cl.exe /? > nul 2>&1
    if not errorlevel 1 set "MSVC_AVAILABLE=1"
    if "!GCC_AVAILABLE!"=="1" (
        where x86_64-w64-mingw32-gcc > nul 2>&1
        if not errorlevel 1 set "GNU_LINKER_AVAILABLE=1"
        if "!GNU_LINKER_AVAILABLE!"=="0" (
            for /f "delims=" %%m in ('gcc -dumpmachine 2^>nul') do (
                if /I "%%m"=="x86_64-w64-mingw32" set "GNU_LINKER_AVAILABLE=1"
            )
        )
        rustc --print target-libdir --target x86_64-pc-windows-gnu > nul 2>&1
        if errorlevel 1 set "GNU_RUST_TARGET_AVAILABLE=0"
        if "!GNU_LINKER_AVAILABLE!"=="0" set "CXX_TOOL="
        if "!GNU_RUST_TARGET_AVAILABLE!"=="0" set "CXX_TOOL="
        if not defined CXX_TOOL if "!MSVC_AVAILABLE!"=="1" (
            echo %Y%[CI UYARI] GNU ABI preflight eksik; MSVC ABI seçiliyor.%N%
            set "CXX_TOOL=MSVC"
        )
    )
    if not defined CXX_TOOL (
        if "!MSVC_AVAILABLE!"=="1" (
            set "CXX_TOOL=MSVC"
        ) else (
            echo %R%[CI HATA] C++ derleyici bulunamadi ^(g++ veya cl.exe gerekli^).%N%
            exit /b 1
        )
    )
    if "!CXX_TOOL!"=="GCC" (
        set "CI_RUST_TARGET=x86_64-pc-windows-gnu"
    ) else (
        set "CI_RUST_TARGET=x86_64-pc-windows-msvc"
    )
    echo %G%[CI OK] C++ derleyici: !CXX_TOOL! ^| Rust target: !CI_RUST_TARGET!%N%
    if "!SKIP_CONNECTOR_SMOKE!"=="1" (
        echo %Y%[CI UYARI] Connector smoke atlanacak: CAELUS_SKIP_CONNECTOR_SMOKE=1%N%
    )
)

    echo %G%[CI OK] C++ derleyici: !CXX_TOOL!%N%
    if not "!SKIP_CONNECTOR_SMOKE!"=="1" (
        py -3 --version > nul 2>&1
        if not errorlevel 1 set "PYTHON_CMD=py -3"
        if not defined PYTHON_CMD (
            python --version > nul 2>&1
            if not errorlevel 1 set "PYTHON_CMD=python"
        )
        if not defined PYTHON_CMD (
            echo %R%[CI HATA] Python bulunamadi ^(connector smoke ic-in py -3 veya python gerekli^).%N%
            echo          Atlamak ic-in CAELUS_SKIP_CONNECTOR_SMOKE=1 ayarlayin.
            exit /b 1
        )
        echo %G%[CI OK] Python: !PYTHON_CMD!%N%
    )

certutil -? > nul 2>&1
if errorlevel 1 (
    echo %R%[CI HATA] 'certutil' bulunamadi ^(Windows yerles-ik, SHA-256 ic-in gerekli^).%N%
    exit /b 1
)
echo %G%[CI OK] certutil: mevcut%N%
echo.

:: ----------------------------------------------------------------------------
:: ADIM 1: Rust birim testleri
:: ----------------------------------------------------------------------------
if "%ONLY_DET%"=="0" (
    echo %C%------------------------------------------------------------%N%
    echo %C%[CI] ADIM 1/7 - Rust Birim Testleri ^(cargo test^)%N%
    echo %C%------------------------------------------------------------%N%
    echo.
    pushd "%ROOT%"
    cargo test --locked 2>&1
    set "RUST_EC=!errorlevel!"
    popd
    if "!RUST_EC!" NEQ "0" (
        echo.
        echo %R%[CI FAIL] Rust birim testleri BAS-ARISIZ ^(c-ikis- kodu: !RUST_EC!^)%N%
        set "CI_PASS=1"
        set "STEP_FAIL=!STEP_FAIL! RUST_TESTS"
    ) else (
        echo.
        echo %G%[CI OK] Rust birim testleri gec-ti%N%
    )
    echo.

    echo %C%[CI] Python neural/audit/UI/training-tool testleri...%N%
    !PYTHON_CMD! -m unittest -v tests.test_caelus_blake3 tests.test_verify_audit_neural tests.test_neural_war_room_contract caelus_ml.test_pipeline
    set "PY_TEST_EC=!errorlevel!"
    if "!PY_TEST_EC!" NEQ "0" (
        echo %R%[CI FAIL] Python neural/tooling testleri başarısız.%N%
        set "CI_PASS=1"
        set "STEP_FAIL=!STEP_FAIL! PYTHON_NEURAL_TESTS"
    ) else (
        echo %G%[CI OK] Python neural/tooling testleri geçti%N%
    )
    echo.
)

:: ----------------------------------------------------------------------------
::: ADIM 2: C++ unit tests
::: --------------------------------------------------------------------------
if "%ONLY_DET%"=="0" (
    echo %C%[CI] ADIM 2/7 - C++ Unit Tests ^(doctest-minimal^)%N%
    echo.
    if not exist %ROOT%\build_tests mkdir %ROOT%\build_tests
    if "!CXX_TOOL!"=="GCC" (
        g++ -std=c++17 -O2 -DCAELUS_CPP_UNIT_TEST=1 -I"%ROOT%" -I"%ROOT%\include" -I"%ROOT%\src" -I"%ROOT%\tests" "%ROOT%\tests\test_causal_engine.cpp" -o "%TEST_EXE%"
    ) else (
        cl.exe /nologo /std:c++17 /O2 /EHsc /DCAELUS_CPP_UNIT_TEST=1 /I"%ROOT%" /I"%ROOT%\include" /I"%ROOT%\src" /I"%ROOT%\tests" "%ROOT%\tests\test_causal_engine.cpp" /Fe:"%TEST_EXE%" /link /INCREMENTAL:NO
    )
    set "CPP_BUILD_EC=!errorlevel!"
    if "!CPP_BUILD_EC!" NEQ "0" (
        echo.
        echo %R%[CI FAIL] C++ test binary build failed ^(exit code: !CPP_BUILD_EC!^)%N%
        set "CI_PASS=1"
        set "STEP_FAIL=!STEP_FAIL! CPP_TEST_BUILD"
    ) else (
        %TEST_EXE%
        set "CPP_TEST_EC=!errorlevel!"
        if "!CPP_TEST_EC!" NEQ "0" (
            echo.
            echo %R%[CI FAIL] C++ unit tests failed ^(exit code: !CPP_TEST_EC!^)%N%
            set "CI_PASS=1"
            set "STEP_FAIL=!STEP_FAIL! CPP_TESTS"
        ) else (
            echo.
            echo %G%[CI OK] C++ unit tests passed%N%
        )
    )
    echo.
)

:: ----------------------------------------------------------------------------
:: ADIM 3: Connector entegrasyon smoke (--det-mode DIS-I, loopback ag- aktif)
::   network -> pull_intel -> registry inject_intel -> CausalEngine graf du-g-u-mu-.
::   det-mode ag-i atladig-indan bu adim det bloklarindan AYRIDIR; --only-det atlar.
:: ----------------------------------------------------------------------------
if "%ONLY_DET%"=="0" (
    echo %C%------------------------------------------------------------%N%
    echo %C%[CI] ADIM 3/7 - Connector Entegrasyon Smoke ^(MQTT + Zapier, ag aktif^)%N%
    echo %C%------------------------------------------------------------%N%
    echo.
    if "!SKIP_CONNECTOR_SMOKE!"=="1" (
        echo %Y%[CI UYARI] Connector smoke atlandi: CAELUS_SKIP_CONNECTOR_SMOKE=1%N%
    ) else if not exist "%ROOT%\tests\connector_smoke.py" (
        echo %R%[CI FAIL] Connector smoke betig-i bulunamadi: %ROOT%\tests\connector_smoke.py%N%
        set "CI_PASS=1"
        set "STEP_FAIL=!STEP_FAIL! CONNECTOR_SMOKE_MISSING"
    ) else (
        !PYTHON_CMD! "%ROOT%\tests\connector_smoke.py"
        set "CONNECTOR_SMOKE_EC=!errorlevel!"
        if "!CONNECTOR_SMOKE_EC!" NEQ "0" (
            echo.
            echo %R%[CI FAIL] Connector smoke testleri BAS-ARISIZ ^(c-ikis- kodu: !CONNECTOR_SMOKE_EC!^)%N%
            set "CI_PASS=1"
            set "STEP_FAIL=!STEP_FAIL! CONNECTOR_SMOKE"
        ) else (
            echo.
            echo %G%[CI OK] Connector smoke testleri gec-ti%N%
        )
    )
    echo.
)

if "%ONLY_DET%"=="0" (
    echo %C%[CI] Offline dataset/export/sign/verify smoke...%N%
    cargo build --release --locked --bin caelus_sign_model
    if errorlevel 1 (
        echo %R%[CI FAIL] Neural model signer derlenemedi.%N%
        set "CI_PASS=1"
        set "STEP_FAIL=!STEP_FAIL! NEURAL_SIGNER_BUILD"
    ) else (
        !PYTHON_CMD! "%ROOT%\tests\run_neural_toolchain_smoke.py" --signer-binary "%MODEL_SIGNER%"
        if errorlevel 1 (
            echo %R%[CI FAIL] Offline dataset/export/sign/verify smoke başarısız.%N%
            set "CI_PASS=1"
            set "STEP_FAIL=!STEP_FAIL! NEURAL_TOOLCHAIN"
        ) else (
            echo %G%[CI OK] Offline dataset/export/sign/verify smoke geçti%N%
        )
    )
    echo.
)

:: ════════════════════════════════════════════════════════════════════════════
:: ADIM 4: Binary boyut kontrolü (< 50 MB)
:: ════════════════════════════════════════════════════════════════════════════
if "%ONLY_DET%"=="0" (
    echo %C%------------------------------------------------------------%N%
    echo %C%[CI] ADIM 4/7 - Binary Boyut Kontrolu-%N%
    echo %C%------------------------------------------------------------%N%
    echo.
    if "%SKIP_BUILD%"=="0" (
        echo %C%[CI] CAELUS_PRODUCTION=1 ile build.bat derleniyor...%N%
        set "OLD_CAELUS_PRODUCTION=!CAELUS_PRODUCTION!"
        set "OLD_CAELUS_CXX=!CAELUS_CXX!"
        set "OLD_CAELUS_RUST_TARGET=!CAELUS_RUST_TARGET!"
        set "CAELUS_PRODUCTION=1"
        set "CAELUS_CXX=!CXX_TOOL!"
        set "CAELUS_RUST_TARGET=!CI_RUST_TARGET!"
        call "%ROOT%\build.bat"
        set "BUILD_EC=!errorlevel!"
        set "CAELUS_PRODUCTION=!OLD_CAELUS_PRODUCTION!"
        set "CAELUS_CXX=!OLD_CAELUS_CXX!"
        set "CAELUS_RUST_TARGET=!OLD_CAELUS_RUST_TARGET!"
        if "!BUILD_EC!" NEQ "0" (
            echo %R%[CI FAIL] Üretim derlemesi başarısız.%N%
            set "CI_PASS=1"
            set "STEP_FAIL=!STEP_FAIL! BUILD"
            goto :step4
        )
    ) else if not exist "%EXE%" (
        echo %R%[CI FAIL] --skip-build ayarlı ama binary yok. Önce build.bat çalıştırın.%N%
        set "CI_PASS=1"
        set "STEP_FAIL=!STEP_FAIL! BUILD"
        goto :step4
    )
    for %%F in ("%EXE%") do (
        set /a "EXE_BYTES=%%~zF"
        set /a "EXE_KB=%%~zF/1024"
        set /a "EXE_MB=%%~zF/1048576"
    )
    echo [CI] Binary boyutu: !EXE_KB! KB  ^(~!EXE_MB! MB^)
    if !EXE_BYTES! LSS 52428800 (
        echo %G%[CI OK] Boyut hedefi karşılandı ^(^< 50 MB^)%N%
    ) else (
        echo %R%[CI FAIL] Binary boyutu hedefi as-ti ^(!EXE_MB! MB ^>= 50 MB^)%N%
        set "CI_PASS=1"
        set "STEP_FAIL=!STEP_FAIL! BINARY_SIZE"
    )
    echo.
)

if "%ONLY_DET%"=="0" (
    echo %C%[CI] Neural V1 referans derlemeleri ve diferansiyel golden...%N%
    if not exist "%ROOT%\build_tests" mkdir "%ROOT%\build_tests"
    set "NEURAL_RUST_LIB="

    if "!CXX_TOOL!"=="GCC" (
        set "NEURAL_RUST_LIB=%ROOT%\target\!CI_RUST_TARGET!\release\libcaelus_network.a"
    ) else (
        set "NEURAL_RUST_LIB=%ROOT%\target\!CI_RUST_TARGET!\release\caelus_network.lib"
    )
    if not exist "!NEURAL_RUST_LIB!" (
        echo %R%[CI FAIL] Neural C++ referansı için ABI-uyumlu Rust staticlib bulunamadı: !NEURAL_RUST_LIB!%N%
        set "CI_PASS=1"
        set "STEP_FAIL=!STEP_FAIL! NEURAL_RUST_LIB"
        goto :step4
    )

    if "!CXX_TOOL!"=="GCC" (
        g++ -std=c++17 -O2 -I"%ROOT%" -I"%ROOT%\include" -I"%ROOT%\src" "%ROOT%\tests\neural_cpp_reference.cpp" -o "%NEURAL_CPP_EXE%" "!NEURAL_RUST_LIB!" -static -lws2_32 -ladvapi32 -luserenv -lbcrypt -lntdll -lcrypt32
    ) else (
        cl.exe /nologo /std:c++17 /O2 /EHsc /I"%ROOT%" /I"%ROOT%\include" /I"%ROOT%\src" "%ROOT%\tests\neural_cpp_reference.cpp" /Fe:"%NEURAL_CPP_EXE%" /link /INCREMENTAL:NO "!NEURAL_RUST_LIB!" advapi32.lib ws2_32.lib userenv.lib bcrypt.lib ntdll.lib crypt32.lib
    )
    if errorlevel 1 (
        echo %R%[CI FAIL] Neural C++ referans binary derlenemedi.%N%
        set "CI_PASS=1"
        set "STEP_FAIL=!STEP_FAIL! NEURAL_CPP_REFERENCE"
        goto :step4
    )

    cargo build --release --locked --manifest-path "%ROOT%\tests\neural_reference\Cargo.toml"
    if errorlevel 1 (
        echo %R%[CI FAIL] Neural Rust referans binary derlenemedi.%N%
        set "CI_PASS=1"
        set "STEP_FAIL=!STEP_FAIL! NEURAL_RUST_REFERENCE"
        goto :step4
    )

    !PYTHON_CMD! "%ROOT%\tests\run_neural_differential.py" --cpp-binary "%NEURAL_CPP_EXE%" --rust-binary "%NEURAL_RUST_EXE%" --model-dir "%ROOT%\models\assurance_v1" --golden "%ROOT%\tests\golden\neural_v1_differential.json"
    if errorlevel 1 (
        echo %R%[CI FAIL] Neural C++/Rust exact diferansiyel başarısız.%N%
        set "CI_PASS=1"
        set "STEP_FAIL=!STEP_FAIL! NEURAL_DIFFERENTIAL"
    ) else (
        echo %G%[CI OK] Neural C++/Rust exact diferansiyel geçti%N%
    )

    !PYTHON_CMD! "%ROOT%\tests\run_bs01_neural_demo.py" --binary "%EXE%" --model-dir "%ROOT%\models\assurance_v1"
    if errorlevel 1 (
        echo %R%[CI FAIL] BS-01 neural assurance/negative güvenlik demosu başarısız.%N%
        set "CI_PASS=1"
        set "STEP_FAIL=!STEP_FAIL! BS01_NEURAL_DEMO"
    ) else (
        echo %G%[CI OK] BS-01 neural assurance ve fail-closed negatifleri geçti%N%
    )

    echo %C%[CI] Production bypass dize taraması...%N%
    set "CAELUS_SCAN_EXE=%EXE%"
    powershell -NoProfile -ExecutionPolicy Bypass -Command ^
        "$text = [Text.Encoding]::ASCII.GetString([IO.File]::ReadAllBytes($env:CAELUS_SCAN_EXE));" ^
        "$bad = @('CAELUS_ALLOW_DEV_SCENARIOS','CAELUS_TRUST_ANY_PUBKEY','CAELUS_PLUGIN_ALLOW_UNVERIFIED');" ^
        "foreach ($item in $bad) { if ($text.Contains($item)) { Write-Error ('bypass string found: ' + $item); exit 1 } }"
    set "CAELUS_SCAN_EXE="
    if errorlevel 1 (
        echo %R%[CI FAIL] Production binary geliştirme bypass dizesi içeriyor.%N%
        set "CI_PASS=1"
        set "STEP_FAIL=!STEP_FAIL! PRODUCTION_BYPASS_SCAN"
    ) else (
        echo %G%[CI OK] Production bypass dize taraması geçti%N%
    )
    echo.
)

:step4
:: ----------------------------------------------------------------------------
:: ADIM 4: Deterministik c-ikti dog-rulama
::   Ayni senaryo 2 kez kos-ulur; CDET: satirlari c-ikartilir; SHA-256 kars-ilas-tirilir.
::   Bas-ari: o-zetler es-les-iyor - motor deterministik.
:: ----------------------------------------------------------------------------
echo %C%------------------------------------------------------------%N%
echo %C%[CI] ADIM 5/7 - Deterministik C-ikti Dog-rulama%N%
echo %C%------------------------------------------------------------%N%
echo.

if not exist "%EXE%" (
    echo %R%[CI FAIL] Binary bulunamadi: %EXE%%N%
    echo          O-nce build.bat c-alis-tirin.
    set "CI_PASS=1"
    set "STEP_FAIL=!STEP_FAIL! DET_MISSING_BIN"
    goto :report
)

:: -- Sabit CI ortami - tu-m rastgelelig-i kilitler -----------------------------
:: Bu deg-erler gerc-ek sir deg-ildir; sadece test vekto-rleridir.
set "CAELUS_DET_SEED=0xCAE105DEADBEEF00"
set "CAELUS_ENCLAVE_KEY=cae1cae1cae1cae1cae1cae1cae1cae1cae1cae1cae1cae1cae1cae1cae1cae1"

:: Gec-ici dosyalar
set "OUT1=%TEMP%\caelus_ci_run1.txt"
set "OUT2=%TEMP%\caelus_ci_run2.txt"
set "BLK1=%TEMP%\caelus_ci_blk1.txt"
set "BLK2=%TEMP%\caelus_ci_blk2.txt"
set "HSH1=%TEMP%\caelus_ci_h1.txt"
set "HSH2=%TEMP%\caelus_ci_h2.txt"
del /q "%ROOT%\caelus_audit_0000000000000000.log" > nul 2>&1

:: ── Koşum 1 ─────────────────────────────────────────────────────────────────
echo %C%[CI] Koşum 1/2 başlıyor...%N%
del /q "%ROOT%\caelus_audit_0000000000000000.log" > nul 2>&1
"%EXE%" --scenario UNIVERSAL_BASELINE --det-mode > "%OUT1%" 2>&1
set "EC1=!errorlevel!"
if "!EC1!" NEQ "0" (
    echo %R%[CI FAIL] Kos-um 1 bas-arisiz ^(c-ikis- kodu: !EC1!^)%N%
    echo.
    echo --- Kos-um 1 c-iktisi ---
    type "%OUT1%"
    set "CI_PASS=1"
    set "STEP_FAIL=!STEP_FAIL! DET_RUN1"
    goto :report
)
echo %G%[CI OK] Kos-um 1 tamamlandi%N%

:: ── Koşum 2 ─────────────────────────────────────────────────────────────────
echo %C%[CI] Koşum 2/2 başlıyor...%N%
del /q "%ROOT%\caelus_audit_0000000000000000.log" > nul 2>&1
"%EXE%" --scenario UNIVERSAL_BASELINE --det-mode > "%OUT2%" 2>&1
set "EC2=!errorlevel!"
if "!EC2!" NEQ "0" (
    echo %R%[CI FAIL] Kos-um 2 bas-arisiz ^(c-ikis- kodu: !EC2!^)%N%
    echo.
    echo --- Kos-um 2 c-iktisi ---
    type "%OUT2%"
    set "CI_PASS=1"
    set "STEP_FAIL=!STEP_FAIL! DET_RUN2"
    goto :report
)
echo %G%[CI OK] Kos-um 2 tamamlandi%N%

:: -- CDET: blog-unu c-ikart -----------------------------------------------------
findstr "CDET:" "%OUT1%" > "%BLK1%" 2>nul
findstr "CDET:" "%OUT2%" > "%BLK2%" 2>nul

:: Blok bos- mu?
for %%F in ("%BLK1%") do set /a "BLK1_SZ=%%~zF"
if "!BLK1_SZ!"=="0" (
    echo %R%[CI FAIL] Kos-um 1 c-iktisinda CDET: blog-u bulunamadi.%N%
    echo          '--det-mode' c-alis-iyor mu? Tam c-ikti:
    type "%OUT1%"
    set "CI_PASS=1"
    set "STEP_FAIL=!STEP_FAIL! DET_NO_BLOCK"
    goto :report
)

:: -- SHA-256 hesapla ve kars-ilas-tir --------------------------------------------
certutil -hashfile "%BLK1%" SHA256 > "%HSH1%" 2>nul
certutil -hashfile "%BLK2%" SHA256 > "%HSH2%" 2>nul

:: certutil c-iktisi 3 satir; 2. satir hash deg-eridir.
set "HASH1="
set "HASH2="
set "LINE_N=0"
for /f "usebackq delims=" %%L in ("%HSH1%") do (
    set /a "LINE_N+=1"
    if "!LINE_N!"=="2" set "HASH1=%%L"
)
set "LINE_N=0"
for /f "usebackq delims=" %%L in ("%HSH2%") do (
    set /a "LINE_N+=1"
    if "!LINE_N!"=="2" set "HASH2=%%L"
)

echo.
echo [CI] CDET blog-u SHA-256:
echo      Kos-um 1: !HASH1!
echo      Kos-um 2: !HASH2!
echo.

if "!HASH1!"=="!HASH2!" (
    echo %G%[CI OK] DETERMI-NI-ZM DOG-RULANDI - her iki o-zet es-les-iyor.%N%
    echo.
    echo      Dog-rulanan CDET blog-u:
    type "%BLK1%"
) else (
    echo %R%[CI FAIL] DETERMI-NI-ZM HATASI - o-zetler farkli!%N%
    echo.
    echo --- Kos-um 1 CDET blog-u ---
    type "%BLK1%"
    echo --- Kos-um 2 CDET blog-u ---
    type "%BLK2%"
    set "CI_PASS=1"
    set "STEP_FAIL=!STEP_FAIL! DETERMINISM"
)

:: -- Gec-ici dosyalari temizle --------------------------------------------------
del /q "%OUT1%" "%OUT2%" "%BLK1%" "%BLK2%" "%HSH1%" "%HSH2%" > nul 2>&1

echo.
echo %C%[CI] Audit zincir + SEAL doğrulaması ^(det-mode imzalayıcıya pinli^)...%N%
if not defined PYTHON_CMD (
    py -3 --version > nul 2>&1
    if not errorlevel 1 (set "PYTHON_CMD=py -3") else (set "PYTHON_CMD=python")
)
:: Det-mode sabit kimlik seed kullanir; SEAL pubkey deterministiktir ve pinlenir.
:: Pin, "kim muhurledi?" sorusunu da denetler (saldirganin yeniden muhurlemesini engeller).
set "DET_SEAL_PUBKEY=acdcc8494d458f44a7aaac1d6a84ec624daee88436db2ae26e67ba645a106228"
!PYTHON_CMD! "%ROOT%\tools\verify_audit_log.py" "%ROOT%\caelus_audit_0000000000000000.log" --trusted-pubkey-hex "!DET_SEAL_PUBKEY!"
if errorlevel 1 (
    echo %R%[CI FAIL] Audit doğrulaması başarısız.%N%
    set "CI_PASS=1"
    set "STEP_FAIL=!STEP_FAIL! AUDIT_VERIFY"
) else (
    echo %G%[CI OK] Audit zinciri ve SEAL doğrulandı ^(pinli pubkey^)%N%
)

echo %C%[CI] Negatif güvenlik süiti ^(tamper / dev-signed / audit forgery fail-closed^)...%N%
!PYTHON_CMD! "%ROOT%\tests\run_security_negative.py" --binary "%EXE%"
if errorlevel 1 (
    echo %R%[CI FAIL] Negatif güvenlik süiti başarısız.%N%
    set "CI_PASS=1"
    set "STEP_FAIL=!STEP_FAIL! NEGATIVE_SECURITY"
) else (
    echo %G%[CI OK] Negatif güvenlik süiti geçti%N%
)

:step5
:: ════════════════════════════════════════════════════════════════════════════
:: ADIM 6: Negatif imza doğrulama (SIG-CI / SIGNED-CI)
::   İmzası kasıtlı bozulmuş senaryo kopyası dev kapısı kapalıyken reddedilmeli
::   (gerçek ed25519 doğrulama hatası). Motor crash etmeden UNIVERSAL_BASELINE
::   blank slate + AWAITING_SCENARIO_INJECTION durumuna düşmeli.
:: ════════════════════════════════════════════════════════════════════════════
echo.
echo %C%[CI] Audit zincir + SEAL dog-rulamasi...%N%
if not defined PYTHON_CMD (
    py -3 --version > nul 2>&1
    if not errorlevel 1 (set "PYTHON_CMD=py -3") else (set "PYTHON_CMD=python")
)
!PYTHON_CMD! "%ROOT%\tools\verify_audit_log.py" "%ROOT%\caelus_audit_0000000000000000.log"
if errorlevel 1 (
    echo %R%[CI FAIL] Audit dog-rulamasi bas-arisiz.%N%
    set "CI_PASS=1"
    set "STEP_FAIL=!STEP_FAIL! AUDIT_VERIFY"
) else (
    echo %G%[CI OK] Audit zinciri ve SEAL dog-rulandi%N%
)

:step5
:: ----------------------------------------------------------------------------
:: ADIM 6: Negatif imza dog-rulama (SIG-CI / SIGNED-CI)
::   I-mzasi kasitli bozulmus- senaryo kopyasi dev kapisi kapaliyken reddedilmeli
::   (gerc-ek ed25519 dog-rulama hatasi). Motor crash etmeden UNIVERSAL_BASELINE
::   blank slate + AWAITING_SCENARIO_INJECTION durumuna du-s-meli.
:: ----------------------------------------------------------------------------
echo.
echo %C%------------------------------------------------------------%N%
echo %C%[CI] ADIM 6/7 - Negatif I-mza Dog-rulama ^(SIG-CI^)%N%
echo %C%------------------------------------------------------------%N%
echo.

set "SIG_OUT=%TEMP%\caelus_ci_sig_negative.txt"
set "SIG_DIR=%TEMP%\caelus_ci_signeg"
set "OLD_CAELUS_ALLOW_DEV_SCENARIOS=%CAELUS_ALLOW_DEV_SCENARIOS%"
set "CAELUS_ALLOW_DEV_SCENARIOS=0"

:: SIGNED-CI: Uretim senaryolari artik pinli capayla eslesen GERCEK ed25519
:: imzalari tasidigi icin negatif test depodaki dosyaya degil, imzasi kasitli
:: bozulmus gecici bir kopyaya karsi kosulur. Format korunur (ed25519:pub:sig),
:: yalniz imza hex'i bozulur -> motor gercek ed25519 dogrulama hatasi vermeli.
if not defined PYTHON_CMD (
    py -3 --version > nul 2>&1
    if not errorlevel 1 (set "PYTHON_CMD=py -3") else (set "PYTHON_CMD=python")
)
if exist "%SIG_DIR%" rd /s /q "%SIG_DIR%" > nul 2>&1
mkdir "%SIG_DIR%\scenarios" > nul 2>&1
!PYTHON_CMD! "%ROOT%\tests\make_negative_scenario.py" "%ROOT%\scenarios\BS-01_SAHTE_UFUK.json" "%SIG_DIR%\scenarios\BS-01_SAHTE_UFUK.json"
if errorlevel 1 (
    echo %R%[CI FAIL] SIG-CI negatif fixture uretilemedi ^(asagidaki kosum bos dizine karsi yapilacak ve adim FAIL edecek^).%N%
    set "CI_PASS=1"
    set "STEP_FAIL=!STEP_FAIL! SIG_CI_FIXTURE"
    goto :report
)

echo %C%[CI] Bozuk-imzali senaryo kopyasi dev kapisi kapaliyken calistiriliyor...%N%
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
    echo %R%[CI FAIL] SIG-CI kos-umu c-o-kmeden tamamlanmadi ^(c-ikis- kodu: !SIG_EC!^).%N%
    set "SIG_STEP_FAIL=1"
    set "STEP_FAIL=!STEP_FAIL! SIG_CI_EXIT"
)

findstr /C:"SIGNATURE_MISMATCH" "%SIG_OUT%" > nul 2>&1
if errorlevel 1 (
    echo %R%[CI FAIL] SIG-CI c-iktisinda SIGNATURE_MISMATCH bulunamadi.%N%
    set "SIG_STEP_FAIL=1"
    set "STEP_FAIL=!STEP_FAIL! SIG_CI_NO_SIGNATURE_MISMATCH"
)

findstr /C:"UNIVERSAL_BASELINE" "%SIG_OUT%" > nul 2>&1
if errorlevel 1 (
    findstr /C:"AWAITING_SCENARIO_INJECTION" "%SIG_OUT%" > nul 2>&1
    if errorlevel 1 (
        echo %R%[CI FAIL] SIG-CI c-iktisinda UNIVERSAL_BASELINE/AWAITING fallback marker bulunamadi.%N%
        set "SIG_STEP_FAIL=1"
        set "STEP_FAIL=!STEP_FAIL! SIG_CI_NO_BASELINE_MARKER"
    )
)

findstr /C:"AWAITING_SCENARIO_INJECTION" "%SIG_OUT%" > nul 2>&1
if errorlevel 1 (
    echo %R%[CI FAIL] SIG-CI c-iktisinda AWAITING_SCENARIO_INJECTION bulunamadi.%N%
    set "SIG_STEP_FAIL=1"
    set "STEP_FAIL=!STEP_FAIL! SIG_CI_NO_AWAITING"
)

findstr /C:"CDET: raw_friction=1.000000" "%SIG_OUT%" > nul 2>&1
if errorlevel 1 (
    echo %R%[CI FAIL] SIG-CI c-iktisinda blank slate raw_friction=1.000000 kaniti bulunamadi.%N%
    set "SIG_STEP_FAIL=1"
    set "STEP_FAIL=!STEP_FAIL! SIG_CI_NO_NEUTRAL_RAW"
)

findstr /C:"CDET: final_friction=1.000000" "%SIG_OUT%" > nul 2>&1
if errorlevel 1 (
    echo %R%[CI FAIL] SIG-CI c-iktisinda blank slate final_friction=1.000000 kaniti bulunamadi.%N%
    set "SIG_STEP_FAIL=1"
    set "STEP_FAIL=!STEP_FAIL! SIG_CI_NO_NEUTRAL_FINAL"
)

if "!SIG_STEP_FAIL!"=="0" (
    echo %G%[CI OK] SIG-CI dog-rulandi: bozuk ed25519 imzali paket reddedildi, motor blank slate'e du-s-tu-.%N%
) else (
    echo.
    echo --- SIG-CI c-iktisi ---
    type "%SIG_OUT%"
    set "CI_PASS=1"
)

del /q "%SIG_OUT%" > nul 2>&1

:step7
:: ----------------------------------------------------------------------------
:: ADIM 7: caelus_core diferansiyel golden (F1 - c-ift motor es-itlig-i)
::   no_std Rust c-ekirdeg-i (caelus_core/) C++ motoruyla AYNI snapshot
::   hash'lerini u-retmek zorundadir. Sapma = motor portunda semantik kayma.
::   CAELUS_SKIP_CORE_DIFF=1 ile atlanabilir.
:: ----------------------------------------------------------------------------
echo.
echo %C%------------------------------------------------------------%N%
echo %C%[CI] ADIM 7/7 - caelus_core Diferansiyel Golden ^(Rust - C++^)%N%
echo %C%------------------------------------------------------------%N%
echo.

if /I "%CAELUS_SKIP_CORE_DIFF%"=="1" (
    echo %C%[CI] CAELUS_SKIP_CORE_DIFF=1 - diferansiyel adim atlandi.%N%
    goto :report
)

if not defined PYTHON_CMD (
    py -3 --version > nul 2>&1
    if not errorlevel 1 (set "PYTHON_CMD=py -3") else (set "PYTHON_CMD=python")
)

echo %C%[CI] caelus_core birim testleri...%N%
cargo test --locked --manifest-path "%ROOT%\caelus_core\Cargo.toml" --features std --quiet
if errorlevel 1 (
    echo %R%[CI FAIL] caelus_core birim testleri basarisiz.%N%
    set "CI_PASS=1"
    set "STEP_FAIL=!STEP_FAIL! CORE_UNIT_TESTS"
    goto :report
)
echo %G%[CI OK] caelus_core birim testleri gecti%N%

echo %C%[CI] caelus_core_repl release derlemesi...%N%
cargo build --release --locked --manifest-path "%ROOT%\caelus_core\Cargo.toml" --features std --bin caelus_core_repl --quiet
if errorlevel 1 (
    echo %R%[CI FAIL] caelus_core_repl derlenemedi.%N%
    set "CI_PASS=1"
    set "STEP_FAIL=!STEP_FAIL! CORE_HARNESS_BUILD"
    goto :report
)

echo %C%[CI] C++ senaryo golden doğrulaması...%N%
!PYTHON_CMD! "%ROOT%\tests\run_bs_exec_golden.py" --binary "%EXE%"
if errorlevel 1 (
    echo %R%[CI FAIL] C++ senaryo golden başarısız.%N%
    set "CI_PASS=1"
    set "STEP_FAIL=!STEP_FAIL! CPP_SCENARIO_GOLDEN"
    goto :report
)

echo %C%[CI] Diferansiyel golden: Rust cekirdek, canlı C++ referansına karşı...%N%
!PYTHON_CMD! "%ROOT%\tests\run_bs_exec_golden.py" --binary "%ROOT%\caelus_core\target\release\caelus_core_repl.exe" --reference-binary "%EXE%"
if errorlevel 1 (
    echo %R%[CI FAIL] Diferansiyel golden FAIL - Rust cekirdegi C++ motorundan sapti.%N%
    set "CI_PASS=1"
    set "STEP_FAIL=!STEP_FAIL! CORE_DIFFERENTIAL"
) else (
    echo %G%[CI OK] Diferansiyel golden: Rust cekirdek = C++ motoru ^(3 senaryo, hash esit^)%N%
)

:: -- F2-4: Verus/Z3 makine-denetimli ispatlar (arac varsa zorunlu, yoksa atla) -
:: caelus_core\verify\ altindaki HER .rs dosyasi bagimsiz dogrulanir:
::   fp_proofs.rs       - P-1/P-4 tam sozlesmeler + aralik korunumu
::   mul_div_safety.rs  - P-2a evrensel guvenlik (sonuc <= cap, tum u64)
::   latch_machine.rs   - P-5a/P-5b latch iz teoremleri (T-20 evrensel)
set "VERUS_EXE=%ROOT%\tools\verus\verus-x86-win\verus.exe"
if exist "%VERUS_EXE%" (
    set "VERUS_FAIL=0"
    for %%V in ("%ROOT%\caelus_core\verify\*.rs") do (
        echo %C%[CI] Verus/Z3: %%~nxV ...%N%
        "%VERUS_EXE%" --crate-type=lib "%%~fV"
        if errorlevel 1 (
            echo %R%[CI FAIL] Verus ispati BASARISIZ: %%~nxV%N%
            set "VERUS_FAIL=1"
        )
    )
    if "!VERUS_FAIL!"=="1" (
        set "CI_PASS=1"
        set "STEP_FAIL=!STEP_FAIL! VERUS_PROOFS"
    ) else (
        echo %G%[CI OK] Verus ispatlari dogrulandi ^(P-1, P-2a, P-4, P-5a/b; Z3^)%N%
    )
) else (
    echo %Y%[CI UYARI] Verus bulunamadi ^(tools\verus^) - ispat adimi atlandi.%N%
)

:report
:: ----------------------------------------------------------------------------
:: SONUC-
:: ----------------------------------------------------------------------------
echo.
echo %C%------------------------------------------------------------%N%
if "!CI_PASS!"=="0" (
    echo %G%[CI] TU-M TESTLER BAS-ARILI%N%
    echo %C%------------------------------------------------------------%N%
    echo.
    exit /b 0
) else (
    echo %R%[CI] BAS-ARISIZ ADIMLAR: !STEP_FAIL!%N%
    echo %C%------------------------------------------------------------%N%
    echo.
    exit /b 1
)

endlocal
