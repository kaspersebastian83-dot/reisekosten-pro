@echo off
setlocal
title Reisekosten Pro
cd /d "%~dp0"

rem npm-Zwischenspeicher ausserhalb des entpackten Programmordners ablegen.
set "npm_config_cache=%LOCALAPPDATA%\Reisekosten-Pro\npm-cache"
set "npm_config_fetch_retries=5"
set "npm_config_fetch_retry_mintimeout=3000"
set "npm_config_fetch_retry_maxtimeout=20000"
set "npm_config_fetch_timeout=120000"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 22 oder neuer ist nicht installiert.
  echo Bitte installieren Sie Node.js von https://nodejs.org und starten Sie diese Datei erneut.
  pause
  exit /b 1
)
if exist "node_modules\.bin\vite.cmd" goto start_app

echo.
echo Die einmalige Installation wird vorbereitet.
if exist node_modules (
  echo Eine unvollstaendige Installation wird repariert...
  rmdir /s /q node_modules 2>nul
  if exist node_modules (
    echo.
    echo Windows verwendet noch Dateien aus dem Ordner node_modules.
    echo Bitte schliessen Sie alle Terminal- und Reisekosten-Fenster,
    echo starten Sie Windows neu und doppelklicken Sie danach erneut auf
    echo START-WINDOWS.bat.
    pause
    exit /b 1
  )
)

for /L %%A in (1,1,3) do (
  echo Installationsversuch %%A von 3...
  call npm ci --prefer-offline --no-audit --no-fund
  if exist "node_modules\.bin\vite.cmd" goto install_ok
  echo Die Verbindung wurde unterbrochen. Neuer Versuch in 5 Sekunden...
  timeout /t 5 /nobreak >nul
)

echo.
echo Die Programmpakete konnten nicht vollstaendig geladen werden.
echo Bitte pruefen Sie die Internetverbindung und versuchen Sie es spaeter erneut.
echo Ein Firmen-VPN oder Sicherheitsprogramm kann registry.npmjs.org blockieren.
pause
exit /b 1

:install_ok
echo Installation erfolgreich.

:start_app
echo Reisekosten Pro startet. Das Fenster bitte geoeffnet lassen.
start "" cmd /c "timeout /t 4 /nobreak >nul & start http://localhost:5173"
call npm run dev
pause
