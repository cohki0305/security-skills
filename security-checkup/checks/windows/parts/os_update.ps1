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
  $last = $null
  $pending = $null
  $defCat = "e0789628-ce08-4437-be74-2495b842f43b"
  try {
    $session = New-Object -ComObject Microsoft.Update.Session
    $searcher = $session.CreateUpdateSearcher()
    $total = $searcher.GetTotalHistoryCount()
    $take = [Math]::Min($total, 300)
    if ($take -gt 0) {
      foreach ($h in @($searcher.QueryHistory(0, $take))) {
        if ($h.Operation -ne 1 -or $h.ResultCode -ne 2) { continue }
        $isDef = $false
        foreach ($c in @($h.Categories)) { if ($c.CategoryID -eq $defCat) { $isDef = $true } }
        if ($isDef) { continue }
        if ($null -eq $last -or $h.Date -gt $last) { $last = $h.Date }
      }
    }
    # search only the locally cached catalog: no network access
    $searcher.Online = $false
    $res = $searcher.Search("IsInstalled=0 and IsHidden=0")
    $pending = [int]$res.Updates.Count
  } catch {
    if ($null -eq $last) { throw }
  }
  if ($null -eq $last) {
    foreach ($q in @(Get-CimInstance -ClassName Win32_QuickFixEngineering -ErrorAction SilentlyContinue)) {
      if ($q.InstalledOn -and ($null -eq $last -or $q.InstalledOn -gt $last)) { $last = $q.InstalledOn }
    }
  }
  $facts["lastInstalledAt"] = Get-Day $last
  $facts["pendingCount"] = $pending
} catch {
  $facts = [ordered]@{}
  if (Test-Denied $_) { $unavailable = "needs_admin" } else { $unavailable = "error" }
}
$json = ConvertTo-Json -InputObject ([ordered]@{ facts = $facts; unavailable = $unavailable }) -Depth 6 -Compress
Write-Output ([regex]::Replace($json, "[^\x00-\x7e]", { param($m) "\u{0:x4}" -f [int][char]$m.Value }))
