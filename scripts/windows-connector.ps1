param([ValidateSet('Setup','Run','Install','Remove')][string]$Action = 'Setup')
$ErrorActionPreference = 'Stop'
$packageRoot = Split-Path -Parent $PSScriptRoot
$connectorScript = Join-Path $packageRoot 'dist\src\index.js'
$identity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
$taskName = 'PARMTECH cPanel Connector ' + $identity.User.Value
try {
    if ($Action -eq 'Remove') {
        if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) { Unregister-ScheduledTask -TaskName $taskName -Confirm:$false }
        Write-Host 'Automatic startup removed. Saved connections are preserved.'
        exit 0
    }
    $nodeExecutable = (Get-Command node.exe -ErrorAction Stop).Source
    if (!(Test-Path -LiteralPath $connectorScript)) { throw 'Extract the complete ZIP first; the built connector is missing.' }
    $nodeVersion = [version]((& $nodeExecutable --version).TrimStart('v'))
    if ($nodeVersion -lt [version]'22.19.0') { throw 'Install Node.js 22.19 or newer (Windows x64), then retry.' }
    if ((& $nodeExecutable -p 'process.arch') -ne 'x64') { throw 'This ZIP requires Windows x64 Node.js.' }
    if ($Action -eq 'Install') {
        $taskAction = New-ScheduledTaskAction -Execute (Join-Path $PSHOME 'powershell.exe') -Argument ('-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $PSCommandPath + '" -Action Run') -WorkingDirectory $packageRoot
        $trigger = New-ScheduledTaskTrigger -AtLogOn -User $identity.Name
        $principal = New-ScheduledTaskPrincipal -UserId $identity.Name -LogonType Interactive -RunLevel Limited
        $settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
        Register-ScheduledTask -TaskName $taskName -Action $taskAction -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
        Start-ScheduledTask -TaskName $taskName
        Write-Host 'Automatic startup enabled after Windows sign-in. Keep the extracted folder in this location.'
        exit 0
    }
    $running = $false
    try { $health = Invoke-RestMethod 'http://127.0.0.1:3210/health' -TimeoutSec 2 } catch { $health = $null }
    if ($health) {
        if ($health.name -ne 'PARMTECH cPanel Connector' -or $health.status -ne 'ok') { throw 'Port 3210 is occupied by another application.' }
        $running = $true
    }
    if (!$running) {
        $logs = Join-Path $env:APPDATA 'PARMTECH-cPanel-Connector\logs'
        New-Item -ItemType Directory -Path $logs -Force | Out-Null
        $env:PORT = '3210'
        $connectorProcess = Start-Process -FilePath $nodeExecutable -ArgumentList @(('"' + $connectorScript + '"'), '--http') -WorkingDirectory $packageRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logs 'background.out.log') -RedirectStandardError (Join-Path $logs 'background.err.log') -PassThru
        for ($attempt = 0; $attempt -lt 20; $attempt++) {
            Start-Sleep -Milliseconds 400
            if ($connectorProcess.HasExited) { throw 'Connector stopped. Check background.err.log in your application data folder.' }
            try {
                $health = Invoke-RestMethod 'http://127.0.0.1:3210/health' -TimeoutSec 1
                if ($health.name -eq 'PARMTECH cPanel Connector' -and $health.status -eq 'ok') { $running = $true; break }
            } catch { }
        }
        if (!$running) { throw 'Connector did not become ready on port 3210.' }
        if ($Action -eq 'Run') { $connectorProcess.WaitForExit(); exit $connectorProcess.ExitCode }
    }
    if ($Action -eq 'Setup') { Start-Process 'http://127.0.0.1:3210/setup' }
    Write-Host 'Local connector is ready on this computer.'
} catch {
    Write-Host ('Setup failed: ' + $_.Exception.Message) -ForegroundColor Red
    exit 1
}
