# Lanyu 同步脚本
# 用法：  powershell -File sync.ps1 "本次改了什么"
#        省略说明时自动用时间戳
#
# 做的事：把当前改动提交并推送到 GitHub（ssh 地址见 $Remote）

param([string]$Message = "")

$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Remote = 'origin'
$Branch = 'main'

# Git 装好之后 PATH 里可能还没有，这里补一下
$env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' +
            [Environment]::GetEnvironmentVariable('Path','User')

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    Write-Host "找不到 git，请先安装 Git for Windows" -ForegroundColor Red
    exit 1
}

if (-not $Message) {
    $Message = "update " + (Get-Date -Format 'yyyy-MM-dd HH:mm')
}

Set-Location $root

# 有改动才提交
$changes = git status --porcelain
if ($changes) {
    git add -A
    git commit -q -m $Message
    if ($LASTEXITCODE -ne 0) { Write-Host "提交失败" -ForegroundColor Red; exit 1 }
    Write-Host "已提交：$Message" -ForegroundColor Green
} else {
    Write-Host "没有需要提交的改动" -ForegroundColor DarkGray
}

git push $Remote $Branch 2>&1 | ForEach-Object { Write-Host $_ }
if ($LASTEXITCODE -ne 0) {
    Write-Host "推送失败（多半是 SSH 密钥没加到 GitHub）" -ForegroundColor Red
    exit 1
}
Write-Host "已推送到 GitHub" -ForegroundColor Green
