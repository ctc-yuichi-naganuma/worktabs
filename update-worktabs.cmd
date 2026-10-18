@echo off
rem Double-click after closing Worktabs: copies the build in dist\win-unpacked (npm run pack)
rem to the folder below, where the Worktabs in everyday use lives, and starts it.
set "DEST=C:\Tools\worktabs"

node "%~dp0scripts\update-worktabs.js" "%DEST%"
if errorlevel 1 pause
