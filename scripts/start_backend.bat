@echo off
cd /d "%~dp0..\backend"
set "PY=E:\Miniconda\miniconda3\envs\DT\python.exe"
if not exist "%PY%" set "PY=python"
echo Starting Digital Twin Backend...
echo Using: %PY%
echo.
echo WebSocket  : ws://localhost:8300
echo 数据源     : host.docker.internal:30000（数据源为 TCP 服务端）
echo.
echo Press Ctrl+C to stop
echo ========================================
"%PY%" -m src.main
echo.
echo Backend process exited.
pause
