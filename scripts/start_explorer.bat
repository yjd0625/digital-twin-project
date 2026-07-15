@echo off
chcp 65001 >nul
title InfluxDB3 Explorer launcher

REM ===== load single config source (same as launcher) =====
call "D:\influxdb3\influxdb3_config.bat"
if not defined PORT (
    echo [error] config not loaded: D:\influxdb3\influxdb3_config.bat
    pause
    exit /b
)

echo ==========================================
echo    InfluxDB 3 Explorer launcher
echo ==========================================
echo.

REM check InfluxDB is up
powershell -NoProfile -Command "$p=%PORT%; $c=New-Object System.Net.Sockets.TcpClient; try { $ar=$c.BeginConnect('127.0.0.1',$p,$null,$null); if($ar.AsyncWaitHandle.WaitOne(2000) -and $c.Connected){ $c.EndConnect($ar); $c.Close(); exit 0 } else { try{ $c.EndConnect($ar) }catch{}; exit 1 } } catch { exit 1 }" >nul 2>&1
if errorlevel 1 (
    echo [warn] InfluxDB not running on port %PORT%.
    echo [warn] Start it first: double-click start_influxdb3.bat
    pause
    exit /b
)

REM read token from single source
set "TOK="
if exist "%TOKEN_FILE%" for /f "usebackq delims=" %%x in ("%TOKEN_FILE%") do set "TOK=%%x"
if not defined TOK (
    echo [warn] token.txt not found. Start InfluxDB first to generate it.
    pause
    exit /b
)

REM write Explorer connection config (browser issues the requests, so localhost)
if not exist "D:\influxdb3\explorer\config" mkdir "D:\influxdb3\explorer\config" 2>nul
powershell -NoProfile -Command "$cfg=@{DEFAULT_INFLUX_SERVER='http://host.docker.internal:%PORT%';DEFAULT_INFLUX_DATABASE='';DEFAULT_API_TOKEN='%TOK%';DEFAULT_SERVER_NAME='Local InfluxDB 3'}; [System.IO.File]::WriteAllText('D:\influxdb3\explorer\config\config.json', ($cfg | ConvertTo-Json -Compress))"
echo [ok] Explorer config written, server=http://host.docker.internal:%PORT%

REM ensure session db directory exists (Explorer stores SQLite sessions at /db)
if not exist "D:\influxdb3\explorer\db" mkdir "D:\influxdb3\explorer\db" 2>nul

REM remove any stale container with the same name (prevents "name already in use" exit)
docker rm -f influxdb3-explorer >nul 2>&1

REM start Explorer via docker
echo.
echo === starting Explorer (docker, first run pulls image) ===
echo === when ready, open: http://localhost:8888 ===
docker run --rm --name influxdb3-explorer -p 8888:8080 -v D:/influxdb3/explorer/config:/app-root/config:ro -v D:/influxdb3/explorer/db:/db:rw -e SESSION_SECRET_KEY=9f2a7c4e1b8d6a3f5c0e7b2d4a9f1c6e3b8d5a2f7c4e1b8d6a3f5c0e7b2d4a9f -e DEFAULT_API_TOKEN=%TOK% -e DEFAULT_INFLUX_SERVER=http://host.docker.internal:%PORT% -e "DEFAULT_SERVER_NAME=Local InfluxDB 3" -e DEFAULT_INFLUX_DATABASE= influxdata/influxdb3-ui:1.9.0 --mode=admin

echo.
echo [info] Explorer container has stopped. Review any error above.
pause
