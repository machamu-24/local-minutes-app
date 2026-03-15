@echo off
chcp 65001 >nul
echo ========================================
echo   AI議事録アプリ セットアップ (Windows)
echo ========================================
echo.

:: Python確認
echo ▶ Pythonの確認...
python --version >nul 2>&1
if errorlevel 1 (
    echo ❌ Python が見つかりません
    echo    https://www.python.org からインストールしてください
    pause
    exit /b 1
)
for /f "tokens=*" %%i in ('python --version') do echo ✅ %%i

:: faster-whisperのインストール
echo.
echo ▶ faster-whisper のインストール...
python -c "import faster_whisper" >nul 2>&1
if errorlevel 1 (
    echo    インストール中...
    pip install faster-whisper
    echo ✅ faster-whisper のインストール完了
) else (
    echo ✅ faster-whisper は既にインストール済みです
)

:: Ollamaの確認
echo.
echo ▶ Ollama の確認...
ollama --version >nul 2>&1
if errorlevel 1 (
    echo ❌ Ollama が見つかりません
    echo    https://ollama.ai からダウンロードしてください
    echo.
    echo    インストール後:
    echo    ollama pull llama3.2
    echo    ollama serve
) else (
    echo ✅ Ollama はインストール済みです
)

:: Whisperスクリプトのコピー
echo.
echo ▶ Whisperスクリプトのセットアップ...
set SCRIPT_DIR=%APPDATA%\minutes-app-local\scripts
if not exist "%SCRIPT_DIR%" mkdir "%SCRIPT_DIR%"
set SCRIPT_SRC=%~dp0whisper_transcribe.py
if exist "%SCRIPT_SRC%" (
    copy "%SCRIPT_SRC%" "%SCRIPT_DIR%\" >nul
    echo ✅ スクリプトをコピーしました: %SCRIPT_DIR%\whisper_transcribe.py
) else (
    echo ⚠️  スクリプトが見つかりません: %SCRIPT_SRC%
)

echo.
echo ========================================
echo   セットアップ完了
echo ========================================
echo.
echo アプリを起動する前に Ollama を起動してください:
echo   ollama serve
echo.
pause
