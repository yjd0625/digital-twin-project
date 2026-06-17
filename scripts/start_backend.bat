@echo off
cd /d "%~dp0..\backend"
echo Starting PlantSimulation Digital Twin Backend...
echo.
echo WebSocket  : ws://localhost:8765
echo PlantSim   : 127.0.0.1:30000
echo.
echo Press Ctrl+C to stop
echo ========================================
"E:\Miniconda\miniconda3\envs\DT\python.exe" -m src.main
echo.
echo Backend process exited.
pause