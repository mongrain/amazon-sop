@echo off
setlocal EnableExtensions
chcp 65001 >nul
cd /d "%~dp0"

echo 已启动 public 自动同步，每 10 秒执行一次，按 Ctrl+C 停止。
echo 仓库目录: %CD%
echo.

:loop
echo [%date% %time%] 开始同步...

git add public

git diff --cached --quiet
if errorlevel 1 (
    git commit -m "更新 public"
    if errorlevel 1 (
        echo commit 失败，10 秒后重试...
        timeout /t 10 /nobreak >nul
        goto loop
    )
    echo 已提交 public 变更。
) else (
    echo public 无变更，跳过 commit。
)

git pull --rebase --autostash
if errorlevel 1 (
    echo pull 失败，10 秒后重试...
    timeout /t 10 /nobreak >nul
    goto loop
)

git push
if errorlevel 1 (
    echo push 失败，10 秒后重试...
) else (
    echo 已推送到远程。
)

echo 等待 10 秒...
timeout /t 10 /nobreak >nul
goto loop
