@echo off
cd /d "%~dp0..\backend"
echo Installing dependencies...
pip install -r requirements.txt
echo Starting backend server...
python -m src.main
pause
