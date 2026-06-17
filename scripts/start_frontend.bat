@echo off
set "ROOT=%~dp0.."
if not exist "%ROOT%\frontend\node_modules\" (
    echo Installing frontend dependencies...
    cd /d "%ROOT%\frontend"
    call npm install
)
echo Starting frontend dev server...
cd /d "%ROOT%\frontend"
call npm run dev
if %errorlevel% neq 0 (
    echo.
    echo Frontend exited with code %errorlevel%.
    pause
)
