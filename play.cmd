@echo off
rem ============================================================
rem  Agora one-click demo launcher (double-click to play)
rem  Default: LLM_PROVIDER=mock (free, works offline, no API key)
rem  Optional: play.cmd real  -> use real key from apps/api/.env
rem ============================================================
chcp 65001 >nul
title Agora demo
cd /d %~dp0apps\api

if /i "%1"=="real" (set LLM_PROVIDER=openai) else (set LLM_PROVIDER=mock)

rem --- already running? just open the browser ---
netstat -ano | findstr ":8787 " | findstr "LISTENING" >nul
if not errorlevel 1 (
  echo Agora is already running. Opening http://localhost:8787 ...
  start "" http://localhost:8787
  echo.
  echo If the page does not load, close this window and run this file again.
  pause
  exit /b 0
)

rem --- cold start ---
set NODE=C:\Users\Huawei\.workbuddy\binaries\node\versions\22.22.2-3\node.exe
if not exist "%NODE%" set NODE=node

echo Starting Agora in %LLM_PROVIDER% mode ...
start "agora-server" /min "%NODE%" "%~dp0apps\api\node_modules\tsx\dist\cli.mjs" src\index.ts

echo Waiting for the server (up to 15s) ...
powershell -NoProfile -Command "for($i=0;$i -lt 30;$i++){try{$null=Invoke-WebRequest -Uri 'http://127.0.0.1:8787/api/healthz' -TimeoutSec 2 -UseBasicParsing;exit 0}catch{Start-Sleep -Milliseconds 500}};exit 1"
if errorlevel 1 (
  echo.
  echo [FAILED] Server did not come up. Check the minimized "agora-server" window for errors.
  echo Common cause: port 8787 busy, or ^(for real mode^) LLM_API_KEY missing in apps\api\.env
  pause
  exit /b 1
)

echo Server is up. Opening http://localhost:8787 in your browser ...
start "" http://localhost:8787
echo.
echo ------------------------------------------------------------
echo  Demo is running at:  http://localhost:8787
echo  Mode: %LLM_PROVIDER%
echo.
echo  To STOP the server: close the minimized "agora-server" window,
echo  or press Ctrl+C in it. You can also just close this window
echo  and double-click play.cmd again later.
echo ------------------------------------------------------------
pause
