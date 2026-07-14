param(
    [string]$DestinationRoot = $(if ($env:CODEX_HOME) { Join-Path $env:CODEX_HOME 'skills' } else { Join-Path $HOME '.codex\skills' })
)

$ErrorActionPreference = 'Stop'
$repositoryRoot = Split-Path -Parent $PSScriptRoot
$source = Join-Path $repositoryRoot 'execution'
$resolvedDestinationRoot = [System.IO.Path]::GetFullPath($DestinationRoot)
$destination = Join-Path $resolvedDestinationRoot 'cua-midscene'
$allowedPrefix = $resolvedDestinationRoot.TrimEnd([System.IO.Path]::DirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar

if (-not (Test-Path -LiteralPath (Join-Path $source 'SKILL.md'))) {
    throw "Skill source not found: $source"
}

if (-not $destination.StartsWith($allowedPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Skill destination must stay under DestinationRoot: $destination"
}

$trackedFiles = @(git -C $repositoryRoot ls-files -- execution)
if ($LASTEXITCODE -ne 0 -or $trackedFiles.Count -eq 0) {
    throw 'Unable to read tracked execution files from Git'
}

if (Test-Path -LiteralPath $destination) {
    Remove-Item -LiteralPath $destination -Recurse -Force
}
New-Item -ItemType Directory -Path $destination -Force | Out-Null

foreach ($trackedFile in $trackedFiles) {
    if (-not $trackedFile.StartsWith('execution/')) {
        throw "Unexpected package file: $trackedFile"
    }
    $relativePath = $trackedFile.Substring('execution/'.Length)
    $sourcePath = Join-Path $repositoryRoot ($trackedFile.Replace('/', [System.IO.Path]::DirectorySeparatorChar))
    $destinationPath = Join-Path $destination ($relativePath.Replace('/', [System.IO.Path]::DirectorySeparatorChar))
    $destinationDirectory = Split-Path -Parent $destinationPath
    New-Item -ItemType Directory -Path $destinationDirectory -Force | Out-Null
    Copy-Item -LiteralPath $sourcePath -Destination $destinationPath -Force
}

Write-Output "Installed cua-midscene Skill package: $destination ($($trackedFiles.Count) files)"
