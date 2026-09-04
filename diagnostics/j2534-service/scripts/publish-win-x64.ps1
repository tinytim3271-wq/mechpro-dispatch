param(
  [string]$Configuration = "Release"
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$PublishDir = Join-Path $Root "publish\win-x64"

dotnet publish (Join-Path $Root "src\J2534.Host\J2534.Host.csproj") `
  -c $Configuration `
  -r win-x64 `
  --self-contained true `
  -p:PublishSingleFile=true `
  -p:IncludeNativeLibrariesForSelfExtract=true `
  -o $PublishDir

Write-Host "Published J2534.Host.exe to $PublishDir"
Get-Item (Join-Path $PublishDir "J2534.Host.exe")
