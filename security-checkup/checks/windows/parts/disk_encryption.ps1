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
  $v = $null
  $shell = New-Object -ComObject Shell.Application
  $drive = $env:SystemDrive
  if (-not $drive) { $drive = "C:" }
  $ns = $shell.NameSpace($drive + "\")
  if ($null -ne $ns) { $v = $ns.Self.ExtendedProperty("System.Volume.BitLockerProtection") }
  if ($null -eq $v) {
    $facts["encrypted"] = $null
    $unavailable = "needs_admin"
  } else {
    $n = [int]$v
    if ($n -eq 1 -or $n -eq 3 -or $n -eq 5) { $facts["encrypted"] = $true }
    elseif ($n -eq 0 -or $n -eq 2 -or $n -eq 4 -or $n -eq 6) { $facts["encrypted"] = $false }
    else { $facts["encrypted"] = $null }
  }
} catch {
  $facts = [ordered]@{}
  if (Test-Denied $_) { $unavailable = "needs_admin" } else { $unavailable = "error" }
}
$json = ConvertTo-Json -InputObject ([ordered]@{ facts = $facts; unavailable = $unavailable }) -Depth 6 -Compress
Write-Output ([regex]::Replace($json, "[^\x00-\x7e]", { param($m) "\u{0:x4}" -f [int][char]$m.Value }))
