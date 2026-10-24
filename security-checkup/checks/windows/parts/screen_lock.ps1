$ErrorActionPreference = "Stop"
$facts = [ordered]@{}
$unavailable = $null
function Get-Day($d) { if ($null -eq $d) { return $null }; try { return ([datetime]$d).ToString("yyyy-MM-dd", [Globalization.CultureInfo]::InvariantCulture) } catch { return $null } }
function Test-Denied($e) { return ($e.Exception -is [UnauthorizedAccessException]) -or ($e.Exception -is [System.Security.SecurityException]) -or ($e.Exception.InnerException -is [UnauthorizedAccessException]) -or ($e.Exception.Message -match "0x80070005|Access is denied|Access denied") }
function Get-Installed() {
  $paths = @("HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*", "HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*", "HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*")
  $list = @()
  foreach ($p in $paths) {
    foreach ($k in @(Get-ItemProperty -Path $p -ErrorAction SilentlyContinue)) {
      if ($k.DisplayName) { $list += [pscustomobject]@{ Name = [string]$k.DisplayName; Version = [string]$k.DisplayVersion } }
    }
  }
  return $list
}
try {
  function Get-RegValue($path, $name) {
    try { $item = Get-ItemProperty -Path $path -Name $name -ErrorAction Stop; return $item.$name } catch { return $null }
  }
  function Get-PowerIndex($sub, $setting, $kind) {
    try {
      $o = & powercfg.exe ("/get" + $kind + "valueindex") SCHEME_CURRENT $sub $setting 2>$null
      foreach ($line in @($o)) { if ("$line" -match "0x([0-9a-fA-F]+)\s*$") { return [Convert]::ToInt64($Matches[1], 16) } }
    } catch { }
    return $null
  }
  $cands = @()
  # screen saver (user setting, then the policy copy which wins when present)
  $pol = "HKCU:\Software\Policies\Microsoft\Windows\Control Panel\Desktop"
  $usr = "HKCU:\Control Panel\Desktop"
  $active = Get-RegValue $pol "ScreenSaveActive"; if ($null -eq $active) { $active = Get-RegValue $usr "ScreenSaveActive" }
  $secs = Get-RegValue $pol "ScreenSaveTimeOut"; if ($null -eq $secs) { $secs = Get-RegValue $usr "ScreenSaveTimeOut" }
  $secure = Get-RegValue $pol "ScreenSaverIsSecure"; if ($null -eq $secure) { $secure = Get-RegValue $usr "ScreenSaverIsSecure" }
  if ("$active" -eq "1" -and "$secs" -match "^\d+$" -and [int]$secs -gt 0) {
    $cands += [pscustomobject]@{ Minutes = [Math]::Ceiling([int]$secs / 60.0); Password = ("$secure" -eq "1") }
  }
  # device policy: lock after inactivity (always asks for the password)
  $ina = Get-RegValue "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System" "InactivityTimeoutSecs"
  if ($null -ne $ina -and [int64]$ina -gt 0) {
    $cands += [pscustomobject]@{ Minutes = [Math]::Ceiling([int64]$ina / 60.0); Password = $true }
  }
  # screen turns off + sign-in required on wake (power plan, readable without admin)
  $lockMin = $null
  foreach ($kind in @("ac", "dc")) {
    $idle = Get-PowerIndex "SUB_VIDEO" "VIDEOIDLE" $kind
    $lock = Get-PowerIndex "SUB_NONE" "CONSOLELOCK" $kind
    if ($null -ne $idle -and $idle -gt 0 -and $lock -eq 1) {
      $m = [Math]::Ceiling($idle / 60.0)
      if ($null -eq $lockMin -or $m -lt $lockMin) { $lockMin = $m }
    }
  }
  if ($null -ne $lockMin) { $cands += [pscustomobject]@{ Minutes = $lockMin; Password = $true } }
  $withPw = @($cands | Where-Object { $_.Password })
  if ($withPw.Count -gt 0) {
    $facts["timeoutMinutes"] = [int](($withPw | Sort-Object Minutes)[0].Minutes)
    $facts["requiresPassword"] = $true
  } elseif ($cands.Count -gt 0) {
    $facts["timeoutMinutes"] = [int](($cands | Sort-Object Minutes)[0].Minutes)
    $facts["requiresPassword"] = $false
  } else {
    $facts["timeoutMinutes"] = $null
    $facts["requiresPassword"] = $false
  }
} catch {
  $facts = [ordered]@{}
  if (Test-Denied $_) { $unavailable = "needs_admin" } else { $unavailable = "error" }
}
$json = ConvertTo-Json -InputObject ([ordered]@{ facts = $facts; unavailable = $unavailable }) -Depth 6 -Compress
Write-Output ([regex]::Replace($json, "[^\x00-\x7e]", { param($m) "\u{0:x4}" -f [int][char]$m.Value }))
