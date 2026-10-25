# Lanyu 打包脚本
# 用法： powershell -File tools\package.ps1 -Version 6.7
# 产物： dist\Lanyu-<版本>\  和  dist\Lanyu-<版本>-win64.zip

param(
    [Parameter(Mandatory = $true)][string]$Version
)

$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$dist = Join-Path $root "dist\Lanyu-$Version"

Write-Host "== 1/4 停止正在运行的 Lanyu ==" -ForegroundColor Cyan
Get-Process Lanyu -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Milliseconds 400

Write-Host "== 2/4 准备目录 ==" -ForegroundColor Cyan
if (Test-Path (Join-Path $root 'dist')) { Remove-Item (Join-Path $root 'dist') -Recurse -Force }
New-Item -ItemType Directory -Force -Path "$dist\web", "$dist\sample\assets" | Out-Null

Copy-Item "$root\web\*" "$dist\web\" -Recurse -Force
Copy-Item "$root\build\Lanyu.exe" $dist -Force
foreach ($d in 'Microsoft.Web.WebView2.Core.dll','Microsoft.Web.WebView2.WinForms.dll','WebView2Loader.dll') {
    Copy-Item (Join-Path $root "build\$d") $dist -Force
}

# 文档与许可（必须随包分发）
Copy-Item "$root\sample.md" "$dist\sample\示例.md" -Force
Copy-Item "$root\assets\demo.png" "$dist\sample\assets\demo.png" -Force
Copy-Item "$root\README.md" $dist -Force
Copy-Item "$root\LICENSE" $dist -Force
Copy-Item "$root\THIRD-PARTY-NOTICES.md" $dist -Force

Write-Host "== 3/4 检查许可文件 ==" -ForegroundColor Cyan
$need = @('LICENSE','THIRD-PARTY-NOTICES.md','web\vendor\KaTeX-LICENSE.txt')
foreach ($f in $need) {
    if (Test-Path (Join-Path $dist $f)) { Write-Host "  ok  $f" -ForegroundColor Green }
    else { Write-Host "  缺失 $f" -ForegroundColor Red; exit 1 }
}

Write-Host "== 4/4 压缩 ==" -ForegroundColor Cyan
$zip = Join-Path $root "dist\Lanyu-$Version-win64.zip"
Compress-Archive -Path $dist -DestinationPath $zip -CompressionLevel Optimal
$size = (Get-Item $zip).Length / 1KB
Write-Host ("完成：{0}（{1:N0} KB）" -f $zip, $size) -ForegroundColor Green
