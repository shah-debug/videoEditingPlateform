@echo off
REM One-time setup: Python virtual environment + backend deps + frontend build.
setlocal
cd /d "%~dp0"

where python >nul 2>nul || (echo [ERROR] Python 3.11+ not found. Install from https://www.python.org/downloads/ & exit /b 1)
where node >nul 2>nul || (echo [ERROR] Node.js 18+ not found. Install from https://nodejs.org/ & exit /b 1)
where ffmpeg >nul 2>nul || (echo [WARNING] FFmpeg not found on PATH. Install it: winget install Gyan.FFmpeg)

echo === Backend: creating virtual environment ===
if not exist backend\.venv python -m venv backend\.venv || exit /b 1
call backend\.venv\Scripts\python.exe -m pip install --upgrade pip
call backend\.venv\Scripts\pip.exe install -r backend\requirements.txt || exit /b 1

echo === Frontend: installing and building ===
pushd frontend
call npm install || exit /b 1
call npm run build || exit /b 1
popd

echo.
echo Setup complete. Run start.bat and open http://127.0.0.1:8000
endlocal
