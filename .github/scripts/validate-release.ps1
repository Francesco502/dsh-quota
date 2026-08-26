param(
    [Parameter(Mandatory = $true)]
    [string]$Tag
)

$ErrorActionPreference = "Stop"
$repositoryRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)

Push-Location $repositoryRoot
try {
    # 1. 验证 Tag 格式
    if ($Tag -notmatch '^v(?<version>\d+\.\d+\.\d+)$') {
        throw "Release tag '$Tag' must match vMAJOR.MINOR.PATCH (e.g., v0.1.0)."
    }
    $tagVersion = $Matches['version']

    # 2. 验证 package.json 版本
    $packageJsonPath = "package.json"
    if (-not (Test-Path -LiteralPath $packageJsonPath)) {
        throw "package.json was not found in $repositoryRoot."
    }
    $pkg = Get-Content -Raw -LiteralPath $packageJsonPath -Encoding utf8 | ConvertFrom-Json
    if ($pkg.version -ne $tagVersion) {
        throw "Git tag $Tag ($tagVersion) does not match package.json version ($($pkg.version))."
    }

    # 3. 验证 CHANGELOG.md 结构与对应版本标题
    $changelogPath = "CHANGELOG.md"
    if (-not (Test-Path -LiteralPath $changelogPath)) {
        throw "CHANGELOG.md was not found in $repositoryRoot."
    }
    $changelog = Get-Content -Raw -LiteralPath $changelogPath -Encoding utf8
    $escapedVersion = [regex]::Escape($tagVersion)
    $changelogHeading = "(?m)^## \[${escapedVersion}\] - \d{4}-\d{2}-\d{2}\s*$"
    if ($changelog -notmatch $changelogHeading) {
        throw "CHANGELOG.md is missing a dated release heading for version $tagVersion (expected '## [$tagVersion] - YYYY-MM-DD')."
    }
    if ($changelog -notmatch '(?m)^## \[Unreleased\]\s*$') {
        throw "CHANGELOG.md must retain an '## [Unreleased]' section."
    }

    # 4. 验证构建产物 (lib/index.js, lib/client.js)
    $hostBundle = "lib/index.js"
    $clientBundle = "lib/client.js"
    if (-not (Test-Path -LiteralPath $hostBundle) -or (Get-Item -LiteralPath $hostBundle).Length -eq 0) {
        throw "Host bundle '$hostBundle' is missing or empty. Please run 'npm run build' first."
    }
    if (-not (Test-Path -LiteralPath $clientBundle) -or (Get-Item -LiteralPath $clientBundle).Length -eq 0) {
        throw "Client bundle '$clientBundle' is missing or empty. Please run 'npm run build' first."
    }

    Write-Output "Release metadata and build validation passed: $Tag (Version: $($pkg.version))"
}
finally {
    Pop-Location
}
