@echo off
cd /d "%~dp0..\backend"
set "PY=E:\Miniconda\miniconda3\envs\DT\python.exe"
if not exist "%PY%" set "PY=python"
echo Starting PlantSimulation Digital Twin Backend...
echo Using: %PY%
echo.
echo WebSocket  : ws://localhost:8300
echo PlantSim   : 127.0.0.1:30000
echo.
echo Press Ctrl+C to stop
echo ========================================
"%PY%" -m src.main
echo.
echo Backend process exited.
pause
