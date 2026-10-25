# 发 GitHub Release（用法：$env:GH_TOKEN='xxx'; powershell -File tools\release.ps1 -Tag v6.6 -Name "MarkEdit 6.6" -File "F:\MarkDownEdit\dist\MarkEdit-6.6-win64.zip" -Notes "F:\MarkDownEdit\tools\release-notes.md"）

param(
    [Parameter(Mandatory = $true)][string]$Tag,
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][string]$File,
    [string]$Notes = ""
)

$ErrorActionPreference = 'Stop'
$Repo = 'MayALLtheBeautyBeBlessed/MarkDownEdit'
$Token = $env:GH_TOKEN
if (-not $Token) { Write-Host "缺少 GH_TOKEN" -ForegroundColor Red; exit 1 }
if (-not (Test-Path $File)) { Write-Host "找不到要上传的文件：$File" -ForegroundColor Red; exit 1 }

$Headers = @{
    'Authorization'        = "Bearer $Token"
    'Accept'               = 'application/vnd.github+json'
    'User-Agent'           = 'MarkEdit-release'
    'X-GitHub-Api-Version' = '2022-11-28'
}

$Body = @{
    tag_name         = $Tag
    target_commitish = 'main'
    name             = $Name
    draft            = $false
    prerelease       = $false
} 
if ($Notes -and (Test-Path $Notes)) {
    $Body.body = Get-Content $Notes -Raw -Encoding UTF8
}

Write-Host "创建 Release $Tag ..."
$json = $Body | ConvertTo-Json -Depth 5
$rel = Invoke-RestMethod -Method Post -Uri "https://api.github.com/repos/$Repo/releases" `
    -Headers $Headers -Body ([Text.Encoding]::UTF8.GetBytes($json)) -ContentType 'application/json; charset=utf-8'

Write-Host "Release 已建：$($rel.html_url)" -ForegroundColor Green

$assetName = Split-Path $File -Leaf
$uploadUrl = $rel.upload_url -replace '\{.*\}$', "?name=$assetName"
Write-Host "上传 $assetName ..."
$bin = [IO.File]::ReadAllBytes($File)
$asset = Invoke-RestMethod -Method Post -Uri $uploadUrl -Headers @{
    'Authorization' = "Bearer $Token"
    'User-Agent'    = 'MarkEdit-release'
    'Content-Type'  = 'application/zip'
} -Body $bin

Write-Host "已上传：$($asset.browser_download_url)" -ForegroundColor Green
Write-Host ""
Write-Host "页面：$($rel.html_url)"
