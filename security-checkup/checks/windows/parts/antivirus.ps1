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
  $today = Get-Day (Get-Date)
  $products = @()
  $sc = $null
  try { $sc = @(Get-CimInstance -Namespace "root/SecurityCenter2" -ClassName AntiVirusProduct -ErrorAction Stop) } catch { $sc = $null }
  $mp = $null
  try { $mp = Get-MpComputerStatus -ErrorAction Stop } catch { $mp = $null }
  if ($null -ne $sc) {
    foreach ($p in $sc) {
      $st = [int64]$p.productState
      $products += [ordered]@{ name = [string]$p.displayName; enabled = (($st -band 0xF000) -eq 0x1000); upToDate = (($st -band 0x00F0) -eq 0) }
    }
  } elseif ($null -ne $mp) {
    $products += [ordered]@{ name = "Windows Defender"; enabled = [bool]($mp.AMServiceEnabled -and $mp.RealTimeProtectionEnabled); upToDate = $null }
  } else {
    throw "no antivirus information"
  }
  $defenderOn = $false
  foreach ($p in $products) { if ($p.enabled -and $p.name -match "Defender") { $defenderOn = $true } }
  $defUpdated = $null
  if ($defenderOn -and $null -ne $mp) {
    $defUpdated = Get-Day $mp.AntivirusSignatureLastUpdated
  } else {
    # another vendor's product is the active one: Defender's dates say nothing about it, so use its own up-to-date flag
    foreach ($p in $products) { if ($p.enabled -and $p.upToDate -eq $true) { $defUpdated = $today } }
  }
  $scan = $null
  if ($null -ne $mp) {
    $dates = @()
    foreach ($n in @("QuickScanEndTime", "FullScanEndTime")) { if ($mp.$n) { $dates += [datetime]$mp.$n } }
    if ($dates.Count -gt 0) { $scan = Get-Day (($dates | Sort-Object -Descending)[0]) }
  }
  $facts["products"] = [object[]]$products
  $facts["definitionsUpdatedAt"] = $defUpdated
  $facts["lastScanAt"] = $scan
} catch {
  $facts = [ordered]@{}
  if (Test-Denied $_) { $unavailable = "needs_admin" } else { $unavailable = "error" }
}
$json = ConvertTo-Json -InputObject ([ordered]@{ facts = $facts; unavailable = $unavailable }) -Depth 6 -Compress
Write-Output ([regex]::Replace($json, "[^\x00-\x7e]", { param($m) "\u{0:x4}" -f [int][char]$m.Value }))
