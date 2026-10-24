import { describe, test, expect, beforeAll, afterAll, setDefaultTimeout } from "bun:test";
setDefaultTimeout(180000);
import { existsSync, mkdirSync, readFileSync, readdirSync, cpSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import vm from "node:vm";
import { writeFileSync } from "node:fs";

const PS = "/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe";
const HAS_PS = existsSync(PS);
const ROOT = resolve(import.meta.dir, "..");
const IDS = ["antivirus", "disk_encryption", "os_update", "os_support", "firewall", "screen_lock", "local_admin", "remote_access", "vpn_client", "cloud_sync", "browser"];
const FIXTURE = join(ROOT, "tests/fixtures/diagnosis-company.json");

function ps(args) {
  const r = spawnSync(PS, ["-NoProfile", "-ExecutionPolicy", "Bypass", ...args], { encoding: "utf8", timeout: 240000 });
  return { code: r.status, out: r.stdout || "", err: r.stderr || "" };
}
const win = (p) => spawnSync("wslpath", ["-w", p], { encoding: "utf8" }).stdout.trim();
const lin = (p) => spawnSync("wslpath", ["-u", p], { encoding: "utf8" }).stdout.trim();

const d = HAS_PS ? describe : describe.skip;

d("windows checks", () => {
  let tmpLin, tmpWin, skillWin, user, computer;
  beforeAll(() => {
    const t = ps(["-Command", "[Console]::OutputEncoding=[Text.Encoding]::UTF8; $env:TEMP; $env:USERNAME; $env:COMPUTERNAME"]).out.split(/\r?\n/);
    const base = t[0].trim();
    user = t[1].trim();
    computer = t[2].trim();
    tmpLin = join(lin(base), "sc-win-test-" + process.pid);
    mkdirSync(tmpLin, { recursive: true });
    tmpWin = win(tmpLin);
    cpSync(join(ROOT, "security-checkup"), join(tmpLin, "security-checkup"), { recursive: true });
    cpSync(FIXTURE, join(tmpLin, "diagnosis.json"));
    skillWin = tmpWin + "\\security-checkup";
  });
  afterAll(() => {
    if (tmpLin) rmSync(tmpLin, { recursive: true, force: true });
  });

  for (const id of IDS) {
    test("part " + id, () => {
      const r = ps(["-File", skillWin + "\\checks\\windows\\parts\\" + id + ".ps1"]);
      expect(r.code).toBe(0);
      const j = JSON.parse(r.out.trim());
      expect(j).toHaveProperty("facts");
      expect(j).toHaveProperty("unavailable");
      expect([null, "needs_admin", "not_supported", "error"]).toContain(j.unavailable);
      expect(r.out.trim().split(/\r?\n/).length).toBe(1);
      if (user) expect(r.out.toLowerCase()).not.toContain(user.toLowerCase());
      if (computer) expect(r.out.toLowerCase()).not.toContain(computer.toLowerCase());
    });
  }

  // Runs a snippet with the shared helpers loaded; returns the JSON printed by the snippet.
  function harness(code) {
    const r = ps(["-Command", ". '" + skillWin + "\\checks\\windows\\parts\\_common.ps1'; " + code]);
    return { code: r.code, json: JSON.parse(r.out.trim()) };
  }

  test("access denied becomes needs_admin with exit code 0 (UnauthorizedAccessException, HResult 0x80070005)", () => {
    const wrap = (thrown) => "try { throw " + thrown + " } catch { Write-Part ([ordered]@{}) (Get-Unavailable $_) }";
    for (const t of [
      "(New-Object UnauthorizedAccessException)",
      "(New-Object System.Security.SecurityException)",
      "(New-Object System.Runtime.InteropServices.COMException 'x', -2147024891)",
      "(New-Object System.InvalidOperationException 'outer', (New-Object UnauthorizedAccessException))",
    ]) {
      const r = harness(wrap(t));
      expect(r.code).toBe(0);
      expect(r.json.unavailable).toBe("needs_admin");
    }
    const other = harness(wrap("'boom'"));
    expect(other.code).toBe(0);
    expect(other.json.unavailable).toBe("error");
    // an English-looking message alone is not treated as a denial
    expect(harness(wrap("(New-Object Exception 'Access is denied')")).json.unavailable).toBe("error");
  });

  test("antivirus: third-party active + stale Defender -> no scan date from Defender", () => {
    const mp = "[pscustomobject]@{AntivirusSignatureLastUpdated=[datetime]'2026-01-01';QuickScanEndTime=[datetime]'2026-01-02';FullScanEndTime=$null}";
    const third = "@([pscustomobject]@{name='Other AV';enabled=$true;upToDate=$true},[pscustomobject]@{name='Windows Defender';enabled=$false;upToDate=$false})";
    const a = harness("ConvertTo-Json -Compress (Resolve-AvDates (" + third + ") (" + mp.slice(0) + ") '2026-10-24')");
    expect(a.json).toEqual({ definitionsUpdatedAt: "2026-10-24", lastScanAt: null });
    const def = "@([pscustomobject]@{name='Windows Defender';enabled=$true;upToDate=$true})";
    const b = harness("ConvertTo-Json -Compress (Resolve-AvDates (" + def + ") (" + mp + ") '2026-10-24')");
    expect(b.json).toEqual({ definitionsUpdatedAt: "2026-01-01", lastScanAt: "2026-01-02" });
  });

  test("BitLocker state mapping: 1,6 protected; 2,3,4,5,8 not; unknown -> null", () => {
    const r = harness("ConvertTo-Json -Compress @(1,2,3,4,5,6,8,7,0 | ForEach-Object { $x = Convert-BitLockerState $_; if ($null -eq $x) { 'null' } else { [string]$x } })");
    expect(r.json).toEqual(["True", "False", "False", "False", "False", "True", "False", "null", "null"]);
  });

  test("check writes a PcResult to a Japanese path with spaces", () => {
    const out = tmpWin + "\\診断 テスト\\結果.json";
    const r = ps(["-File", skillWin + "\\checks\\windows\\run.ps1", "check", "-Label", "テスト 太郎", "-Checks", IDS.join(","), "-Out", out]);
    expect(r.code).toBe(0);
    const file = join(tmpLin, "診断 テスト", "結果.json");
    expect(existsSync(file)).toBe(true);
    const buf = readFileSync(file);
    expect(buf[0]).not.toBe(0xef); // no BOM
    const j = JSON.parse(buf.toString("utf8"));
    expect(j.version).toBe(1);
    expect(j.label).toBe("テスト 太郎");
    expect(j.os).toBe("windows");
    expect(j.checkedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(typeof j.osVersion).toBe("string");
    expect(Object.keys(j.checks).sort()).toEqual([...IDS].sort());
    for (const id of IDS) {
      expect(j.checks[id]).toHaveProperty("facts");
      expect(j.checks[id]).toHaveProperty("unavailable");
    }
    const txt = buf.toString("utf8").toLowerCase();
    if (user) expect(txt).not.toContain(user.toLowerCase());
    if (computer) expect(txt).not.toContain(computer.toLowerCase());
  });

  test("report copies 8 files into a Japanese path with spaces", () => {
    const outDir = tmpWin + "\\診断 レポート";
    const r = ps(["-File", skillWin + "\\checks\\windows\\run.ps1", "report", "-Data", tmpWin + "\\diagnosis.json", "-OutDir", outDir, "-NoOpen"]);
    expect(r.code).toBe(0);
    const dir = join(tmpLin, "診断 レポート");
    expect(readdirSync(dir).sort()).toEqual(["asklist.html", "baseline.js", "data.js", "engine.js", "pcs.html", "questions.js", "report.html", "scenes.js"]);
    const data = readFileSync(join(dir, "data.js"), "utf8");
    expect(data.startsWith('window.SC_DATA = JSON.parse("')).toBe(true);
    const sandbox = { window: {} };
    const ctx = vm.createContext(sandbox);
    vm.runInContext(data, ctx);
    vm.runInContext(readFileSync(join(dir, "questions.js"), "utf8"), ctx);
    expect(sandbox.window.SC_DATA.mode).toBe("company");
    expect(sandbox.window.SC_DATA).toEqual(JSON.parse(readFileSync(FIXTURE, "utf8")));
    expect(Array.isArray(sandbox.window.SC_QUESTIONS.questions)).toBe(true);
    const q = readFileSync(join(dir, "questions.js"), "utf8");
    expect(q.startsWith("window.SC_QUESTIONS = JSON.parse(")).toBe(true);
    expect(readFileSync(join(dir, "engine.js"), "utf8")).toContain("SC_ENGINE");
  });

  test("report: data is only data (no code runs); non-JSON expressions are rejected", () => {
    const evil = '{"a":"x\\"});globalThis.pwned=1;//","b":"</script><script>globalThis.pwned=2</script>","d":"raw \u2028 \u2029 chars"}';
    writeFileSync(join(tmpLin, "evil.json"), evil, "utf8");
    const outDir = tmpWin + "\\evil out";
    const r = ps(["-File", skillWin + "\\checks\\windows\\run.ps1", "report", "-Data", tmpWin + "\\evil.json", "-OutDir", outDir, "-NoOpen"]);
    expect(r.code).toBe(0);
    const js = readFileSync(join(tmpLin, "evil out", "data.js"), "utf8");
    expect(js).not.toContain("<");
    expect(js).not.toContain("\u2028");
    const sandbox = { window: {} };
    const ctx = vm.createContext(sandbox);
    vm.runInContext(js, ctx);
    expect(sandbox.window.SC_DATA).toEqual(JSON.parse(evil));
    expect(vm.runInContext("typeof pwned", ctx)).toBe("undefined");
    for (const [i, bad] of ["1;globalThis.pwned=1", '"x"});alert(1)//'].entries()) {
      writeFileSync(join(tmpLin, "expr" + i + ".json"), bad, "utf8");
      const x = ps(["-File", skillWin + "\\checks\\windows\\run.ps1", "report", "-Data", tmpWin + "\\expr" + i + ".json", "-OutDir", tmpWin + "\\expr-out" + i, "-NoOpen"]);
      expect(x.code).not.toBe(0);
      expect(existsSync(join(tmpLin, "expr-out" + i, "data.js"))).toBe(false);
    }
  });

  test("paths prints JSON with the output and employee folders", () => {
    const r = ps(["-File", skillWin + "\\checks\\windows\\run.ps1", "paths", "-DocsRoot", tmpWin + "\\ドキュメント 仮"]);
    expect(r.code).toBe(0);
    const j = JSON.parse(r.out.trim());
    expect(j.outputRoot).toContain("セキュリティ診断");
    expect(j.employeeResults).toContain("社員PC結果");
    expect(existsSync(join(tmpLin, "ドキュメント 仮", "セキュリティ診断", "社員PC結果"))).toBe(true);
  });
});
