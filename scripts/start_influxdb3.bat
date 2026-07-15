@echo off
chcp 65001 >nul
title InfluxDB3 launcher
set "RUN_LOG=D:\influxdb3\logs\startup.log"
if not exist "D:\influxdb3\logs" mkdir "D:\influxdb3\logs" 2>nul

REM helper: append one line to the run log, flush every call
call :log "===== script start ====="

REM ===== load single config source =====
call "D:\influxdb3\influxdb3_config.bat"
if not defined NODE_ID (
    echo [error] config not loaded: D:\influxdb3\influxdb3_config.bat
    goto :FAIL
)

REM auto-elevate when not admin (double-click works)
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo [info] need admin rights, launching elevated window
    call :log "elevating"
    powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    echo.
    echo running in a new admin window, this window can be closed.
    pause
    exit /b
)
call :log "running as admin"

echo ==========================================
echo    InfluxDB 3 launcher (config-driven)
echo ==========================================
echo.

REM [1/6] dir checks
if not exist "%DATA_DIR%" mkdir "%DATA_DIR%" 2>nul
if not exist "%LOG_DIR%" mkdir "%LOG_DIR%" 2>nul
if not exist "%PLUGIN_DIR%" mkdir "%PLUGIN_DIR%" 2>nul
echo [1/6] dir checks done
call :log "[1/6] dir checks done"

REM exe exists?
if not exist "%INFLUX_DIR%\influxdb3.exe" (
    echo [error] influxdb3.exe not found: %INFLUX_DIR%
    call :log "[error] exe not found"
    goto :FAIL
)

REM [2/6] free ports: kill orphans and wait until ports are truly free.
REM Get-NetTCPConnection sees Listen/TIME_WAIT/Established. netstat hangs on Docker; active-connect probe misses TIME_WAIT.
echo [2/6] freeing ports %PORT% and %RECOVERY_PORT% ...
call :log "[2/6] freeing ports"
set "FREE_TRIES=0"
:free_loop
call :free_port %PORT%
if not errorlevel 1 call :free_port %RECOVERY_PORT%
if not errorlevel 1 goto :ports_free
set /a FREE_TRIES+=1
if %FREE_TRIES% geq 20 (
    echo [error] cannot free port %PORT% - held by another app or in a Windows
    echo [error] reserved range (Docker/Hyper-V). Check: netsh interface ipv4 show excludedportrange protocol=tcp
    call :log "[error] port busy"
    goto :FAIL
)
powershell -NoProfile -Command "Start-Sleep -Seconds 2" >nul
goto :free_loop
:ports_free
echo [2/6] ports free
call :log "[2/6] ports free"

REM [3/6] version check (correct flag is --version, not version)
echo [3/6] checking influxdb3.exe ...
"%INFLUX_DIR%\influxdb3.exe" --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [error] influxdb3.exe --version failed. missing VC++ Redist.
    echo [error] install: https://aka.ms/vs/17/release/vc_redist.x64.exe
    call :log "[error] version failed"
    goto :FAIL
)
"%INFLUX_DIR%\influxdb3.exe" --version
echo [3/6] influxdb3.exe OK
set "INFLUXDB3_PYTHON_EXECUTABLE=%INFLUX_DIR%\python\python.exe"
echo [3/6] bundled python: %INFLUXDB3_PYTHON_EXECUTABLE%
call :log "[3/6] version ok"

REM [4/6] start service (single-line start to avoid continuation issues)
echo [4/6] starting InfluxDB 3 ...
echo        node-id : %NODE_ID%
echo        data    : %DATA_DIR%
echo        bind    : 127.0.0.1:%PORT%
echo        recovery: 127.0.0.1:%RECOVERY_PORT%
echo.
call :log "[4/6] issuing start"
cd /d "%INFLUX_DIR%"
start /B "" "influxdb3.exe" serve --node-id="%NODE_ID%" --object-store=file --data-dir="%DATA_DIR%" --plugin-dir="%PLUGIN_DIR%" --http-bind="0.0.0.0:%PORT%" --admin-token-recovery-http-bind="127.0.0.1:%RECOVERY_PORT%" > "%LOG_DIR%\influxdb3.log" 2>&1

REM get PID (retry, up to 15s)
set "INFLUX_PID="
set "TRY=0"
:pid_loop
for /f "tokens=2" %%a in ('tasklist 2^>nul ^| findstr "influxdb3.exe"') do ( set "INFLUX_PID=%%a" & goto :got_pid )
set /a TRY+=1
if %TRY% geq 15 goto :no_pid
powershell -NoProfile -Command "Start-Sleep -Seconds 2" >nul
goto :pid_loop
:no_pid
echo [error] cannot get PID, see log: %LOG_DIR%\influxdb3.log
if exist "%LOG_DIR%\influxdb3.log" type "%LOG_DIR%\influxdb3.log"
call :log "[error] no PID"
goto :FAIL
:got_pid
echo [4/6] started, PID=%INFLUX_PID%
call :log "[4/6] started PID=%INFLUX_PID%"

REM wait for port (up to 30s); fail fast if the server process dies (bind failure)
set "WAIT=0"
:wait_loop
tasklist 2>nul | findstr /i "influxdb3.exe" >nul
if errorlevel 1 goto :server_crashed
call :port_listening %PORT%
if not errorlevel 1 goto :ready
set /a WAIT+=1
if %WAIT% geq 30 goto :ready_timeout
powershell -NoProfile -Command "Start-Sleep -Seconds 2" >nul
goto :wait_loop
:server_crashed
echo [error] InfluxDB process exited before binding - port likely still held. log:
if exist "%LOG_DIR%\influxdb3.log" type "%LOG_DIR%\influxdb3.log"
call :log "[error] server crashed before bind"
goto :FAIL
:ready_timeout
echo [error] port %PORT% not listening in 30s, log follows:
if exist "%LOG_DIR%\influxdb3.log" type "%LOG_DIR%\influxdb3.log"
call :log "[error] not listening"
goto :FAIL
:ready
echo [4/6] service up on 127.0.0.1:%PORT%
call :log "service up PID=%INFLUX_PID% port=%PORT%"

REM [5/6] token: reuse if valid, else create/regenerate once (fixed token)
echo.
echo [5/6] ensuring admin token ...
call :log "[5/6] token"
set "NEW_TOKEN="
set "CUR="
set "CODE="

if exist "%TOKEN_FILE%" (
    for /f "usebackq delims=" %%x in ("%TOKEN_FILE%") do set "CUR=%%x"
)
if defined CUR (
    for /f "delims=" %%c in ('curl -s -o /dev/null -w "%%{http_code}" -H "Authorization: Bearer %CUR%" "http://127.0.0.1:%PORT%/api/v3/configure/database?format=json"') do set "CODE=%%c"
)
if "%CODE%"=="200" (
    set "NEW_TOKEN=%CUR%"
    echo [5/6] token in file is valid, reusing, no change
    call :log "[5/6] token reused"
    goto :token_persist
)

echo [5/6] token missing or invalid, creating new one ...
for /f "tokens=2" %%t in ('"%INFLUX_DIR%\influxdb3.exe" create token --admin --host=http://127.0.0.1:%PORT% 2^>^&1 ^| findstr "Token:"') do set "NEW_TOKEN=%%t"
if not defined NEW_TOKEN (
    for /f "tokens=2" %%t in ('echo yes ^| "%INFLUX_DIR%\influxdb3.exe" create token --admin --regenerate --host=http://127.0.0.1:%RECOVERY_PORT% 2^>^&1 ^| findstr "Token:"') do set "NEW_TOKEN=%%t"
)
if not defined NEW_TOKEN (
    echo [warn] token creation failed, see: %LOG_DIR%\influxdb3.log
    echo [warn] service is running, create manually:
    echo         influxdb3 create token --admin --regenerate --host=http://127.0.0.1:%RECOVERY_PORT%
    call :log "[5/6] token creation failed"
    goto :token_done
)

:token_persist
> "%TOKEN_FILE%" echo %NEW_TOKEN%
setx INFLUXDB3_TOKEN "%NEW_TOKEN%" /M >nul 2>&1
if errorlevel 1 setx INFLUXDB3_TOKEN "%NEW_TOKEN%" >nul 2>&1
echo [5/6] admin token saved to: %TOKEN_FILE%
echo [5/6] env INFLUXDB3_TOKEN updated (new terminal reads it)
call :log "[5/6] token persisted"

:token_done

REM FINISH
echo.
echo ==========================================
echo   InfluxDB 3 running
echo   URL: http://127.0.0.1:%PORT%
echo   Token file: %TOKEN_FILE%
echo   Press any key to stop and exit
echo ==========================================
pause >nul
for /f "tokens=2" %%p in ('tasklist 2^>nul ^| findstr "influxdb3.exe"') do taskkill /F /PID %%p >nul 2>&1
echo service stopped.
call :log "script end (service stopped)"
goto :EOF

:FAIL
echo.
echo [fail] script aborted, see: %RUN_LOG%
echo [fail] also check: %LOG_DIR%\influxdb3.log
echo Press any key to close...
pause
exit /b 1

:log
echo [%date% %time%] %* >> "%RUN_LOG%"
goto :EOF

REM port_listening <port> -> exit 0 if the port is accepting TCP connections, 1 if free.
REM Uses a single TcpClient connect with a 1s hard timeout. Avoids netstat (hangs on Docker hosts).
:port_listening
powershell -NoProfile -Command "$c=New-Object System.Net.Sockets.TcpClient; $ar=$c.BeginConnect('127.0.0.1',%1,$null,$null); if($ar.AsyncWaitHandle.WaitOne(1000) -and $c.Connected){ $c.EndConnect($ar); $c.Close(); exit 0 } else { try{ $c.EndConnect($ar) }catch{}; exit 1 }" >nul 2>&1
goto :EOF

REM free_port <port> -> kill any process holding the port (Listen/Established/TIME_WAIT),
REM exit 1 if the port was occupied (caller should wait), 0 if free. Uses Get-NetTCPConnection (no netstat).
:free_port
powershell -NoProfile -Command "$port=%1; try { taskkill /F /IM influxdb3.exe >$null 2>&1 } catch {}; try { $cs=Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue; foreach($c in $cs){ $p=$c.OwningProcess; if($p -and $p -ne 0){ try{ Stop-Process -Id $p -Force -ErrorAction SilentlyContinue }catch{} } } } catch {}; Start-Sleep -Milliseconds 500; try { $l=New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback,$port); $l.ExclusiveAddressUse=$true; $l.Start(); $l.Stop(); exit 0 } catch { exit 1 }" >nul 2>&1
goto :EOF
