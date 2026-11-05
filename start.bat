@echo off
REM Starts AI Caption Studio at http://127.0.0.1:8000 (backend serves the built frontend).
cd /d "%~dp0backend"
if not exist .venv\Scripts\python.exe (echo Run setup.bat first. & pause & exit /b 1)
start "" http://127.0.0.1:8000
.venv\Scripts\python.exe run.py
