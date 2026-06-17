@echo off
set "ROOT=%~dp0.."
echo Starting backend with DT environment (conda run)...
conda run --cwd "%ROOT%\backend" -n DT python -m src.main
if %errorlevel% neq 0 (
    echo.
    echo Backend exited with code %errorlevel%.
    pause
)
