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
  $local = $env:LOCALAPPDATA
  $out = @()
  # OneDrive: an account is configured
  $od = $false
  foreach ($k in @(Get-ChildItem "HKCU:\Software\Microsoft\OneDrive\Accounts" -ErrorAction SilentlyContinue)) {
    $p = Get-ItemProperty -Path $k.PSPath -ErrorAction SilentlyContinue
    if ($p -and ($p.UserEmail -or $p.ConfiguredTenantId)) { $od = $true }
  }
  if ($od) { $out += "OneDrive" }
  # Google Drive: a signed-in account has a numeric folder
  $gd = $false
  if ($local -and (Test-Path (Join-Path $local "Google\DriveFS"))) {
    foreach ($d in @(Get-ChildItem (Join-Path $local "Google\DriveFS") -Directory -ErrorAction SilentlyContinue)) { if ($d.Name -match "^\d+$") { $gd = $true } }
  }
  if ($gd) { $out += "Google Drive" }
  if ($local -and (Test-Path (Join-Path $local "Dropbox\info.json"))) { $out += "Dropbox" }
  if ($local -and (Test-Path (Join-Path $local "Box\Box\data"))) { $out += "Box" }
  $icloudApp = $false
  foreach ($a in Get-Installed) { if ($a.Name -match "^iCloud$") { $icloudApp = $true } }
  if ($icloudApp -and $env:USERPROFILE -and (Test-Path (Join-Path $env:USERPROFILE "iCloudDrive"))) { $out += "iCloud Drive" }
  $facts["products"] = [object[]]$out
} catch {
  $facts = [ordered]@{}
  if (Test-Denied $_) { $unavailable = "needs_admin" } else { $unavailable = "error" }
}
$json = ConvertTo-Json -InputObject ([ordered]@{ facts = $facts; unavailable = $unavailable }) -Depth 6 -Compress
Write-Output ([regex]::Replace($json, "[^\x00-\x7e]", { param($m) "\u{0:x4}" -f [int][char]$m.Value }))
