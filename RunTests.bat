@echo off
setlocal
node "%~dp0test\portVerifier.js"
exit /b %ERRORLEVEL%
