@echo off
REM Sun Plugin — Build the CEP extension and produce the .exe installer.
REM
REM Prerequisites:
REM   - Node.js 18+
REM   - Inno Setup 6 (https://jrsoftware.org/isinfo.php)
REM
REM Usage:
REM   build.bat             Build the extension and the .exe installer
REM   build.bat --install   Build and install directly (skip installer)

cd /d "%~dp0\.."

echo.
echo ========================================
echo   Sun Plugin — Build + Package
echo ========================================
echo.

REM Step 1: Build the CEP extension
echo [1/2] Building CEP extension...
node tools\build-cep.js
if errorlevel 1 (
    echo.
    echo ERROR: Build failed.
    pause
    exit /b 1
)

REM Step 2: Run Inno Setup
if "%1"=="--install" (
    echo [2/2] Installing directly...
    node tools\build-cep.js --install
) else (
    echo [2/2] Building installer with Inno Setup...
    node tools\build-cep.js --installer
)

if errorlevel 1 (
    echo.
    echo ERROR: Installer build failed.
    pause
    exit /b 1
)

echo.
echo ========================================
echo   Build complete!
echo ========================================
echo.
if not "%1"=="--install" (
    echo The installer is at: installer\Output\SunPluginSetup.exe
)
echo.
pause
