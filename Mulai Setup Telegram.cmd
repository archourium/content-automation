@echo off
setlocal
cd /d "%~dp0"
set "probe="
if /i "%~1"=="--check" set "probe=--check"
title Sambungkan Telegram
echo.
echo   SAMBUNGKAN TELEGRAM
echo   Siapkan token bot dari BotFather. Chat tujuan akan dicari otomatis.
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
echo Komponen setup perlu dipasang dari daftar paket proyek.
choice /c YT /n /m "Pasang sekarang? [Y/T] "
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
echo Unduh Node.js versi LTS 22.18 atau lebih baru, pasang, lalu buka file ini lagi.
if not defined probe start "" "https://nodejs.org/en/download"
goto failed

:need_gh
echo Pasang GitHub CLI agar setup dapat menyimpan koneksi Telegram di akun GitHub Anda.
echo Setelah terpasang, buka file ini lagi.
if not defined probe start "" "https://cli.github.com/"
goto failed

:missing
echo File setup belum ditemukan. Ekstrak seluruh ZIP atau buka launcher dari folder proyek.
goto failed

:cancelled
echo Setup dibatalkan.
:failed
if not defined probe pause
exit /b 1
