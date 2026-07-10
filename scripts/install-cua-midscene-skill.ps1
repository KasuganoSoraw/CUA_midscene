param(
    [string]$DestinationRoot = $(if ($env:CODEX_HOME) { Join-Path $env:CODEX_HOME 'skills' } else { Join-Path $HOME '.codex\skills' })
)

$ErrorActionPreference = 'Stop'
$repositoryRoot = Split-Path -Parent $PSScriptRoot
$source = Join-Path $repositoryRoot 'skills\cua-midscene'
$destination = Join-Path ([System.IO.Path]::GetFullPath($DestinationRoot)) 'cua-midscene'

if (-not (Test-Path -LiteralPath (Join-Path $source 'SKILL.md'))) {
    throw "Skill source not found: $source"
}

New-Item -ItemType Directory -Path $destination -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $source 'SKILL.md') -Destination $destination -Force

foreach ($directory in @('agents', 'references')) {
    $sourceDirectory = Join-Path $source $directory
    if (Test-Path -LiteralPath $sourceDirectory) {
        Copy-Item -LiteralPath $sourceDirectory -Destination $destination -Recurse -Force
    }
}

Write-Output "Installed cua-midscene Skill: $destination"
