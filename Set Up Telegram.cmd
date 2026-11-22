@echo off
setlocal
cd /d "%~dp0"
set "probe="
if /i "%~1"=="--check" set "probe=--check"
title Set Up Telegram
echo.
echo   SET UP TELEGRAM
echo   Get your bot token from BotFather. Setup will find your chat automatically.
echo.
node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>22 || a===22 && b>=18 ? 0 : 1)" >nul 2>&1
if errorlevel 1 goto need_node
where gh.exe >nul 2>&1
if errorlevel 1 goto need_gh

set "wizard=node_modules\content-automation\scripts\connect-telegram.mjs"
if exist "%wizard%" goto run
set "wizard=scripts\connect-telegram.mjs"
if exist "%wizard%" goto run
set "wizard=node_modules\content-automation\scripts\connect-telegram.mjs"
if not exist "package-lock.json" goto missing
if defined probe goto missing
echo Setup needs to install dependencies from your project manifest.
choice /c YN /n /m "Install now? [Y/N] "
if errorlevel 2 goto cancelled
call npm.cmd install --include=dev --no-audit --no-fund
if errorlevel 1 goto failed
if not exist "%wizard%" goto missing

:run
node "%wizard%" %probe%
if errorlevel 1 goto failed
if not defined probe pause
exit /b 0

:need_node
echo Install Node.js 22.18 or later, then open this file again.
if not defined probe start "" "https://nodejs.org/en/download"
goto failed

:need_gh
echo Install GitHub CLI so setup can save the Telegram connection to your GitHub account.
echo After installation, open this file again.
if not defined probe start "" "https://cli.github.com/"
goto failed

:missing
echo Setup files are missing. Extract the entire ZIP or open this launcher from the project folder.
goto failed

:cancelled
echo Setup cancelled.
:failed
if not defined probe pause
exit /b 1
