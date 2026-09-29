# Run on the Windows computer hosting the browser (no administrator required).
$ErrorActionPreference = 'Stop'

$chatgptApps = @(Get-StartApps | Where-Object {
    $_.Name -eq 'ChatGPT' -and $_.AppID -match '^OpenAI\.[A-Za-z0-9.-]+_[A-Za-z0-9]+![A-Za-z0-9.-]+$'
})
if ($chatgptApps.Count -ne 1) {
    throw 'Expected one installed OpenAI ChatGPT app. Install ChatGPT or resolve duplicate installations first.'
}

$protocolKey = 'HKCU:\Software\Classes\octop-chatgpt'
$commandKey = "$protocolKey\shell\open\command"
$explorerPath = Join-Path $env:WINDIR 'explorer.exe'
# Fixed target only: deliberately do not forward the URI (%1) or any arguments.
$launchCommand = '"{0}" "shell:AppsFolder\{1}"' -f $explorerPath, $chatgptApps[0].AppID
if (Test-Path -LiteralPath $protocolKey) {
    $existingCommand = (Get-Item -LiteralPath $commandKey -ErrorAction Stop).GetValue('')
    if ($existingCommand -ne $launchCommand) {
        throw 'octop-chatgpt is already registered with a different command; no changes made.'
    }
}

New-Item -Path $commandKey -Force | Out-Null
Set-Item -LiteralPath $protocolKey -Value 'URL:Octop ChatGPT Launcher'
New-ItemProperty -LiteralPath $protocolKey -Name 'URL Protocol' -Value '' -PropertyType String -Force | Out-Null
Set-Item -LiteralPath $commandKey -Value $launchCommand

if ((Get-Item -LiteralPath $commandKey).GetValue('') -ne $launchCommand) {
    throw 'Launcher registration verification failed.'
}
Write-Output "Registered octop-chatgpt://open for $($chatgptApps[0].AppID) (current user only)."
