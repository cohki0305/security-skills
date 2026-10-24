const { test, expect, describe } = require("bun:test");
const fs = require("fs");
const path = require("path");

const DIR = path.join(__dirname, "..", "security-checkup");
const text = fs.readFileSync(path.join(DIR, "SKILL.md"), "utf8");

function parseFrontmatter(src) {
  const m = src.match(/^---\n([\s\S]*?)\n---\n/);
  if (!m) throw new Error("frontmatter がない");
  const out = {};
  let key = null;
  for (const line of m[1].split("\n")) {
    const item = line.match(/^\s+-\s+(.*)$/);
    if (item && key) { out[key].push(item[1].trim()); continue; }
    const kv = line.match(/^([A-Za-z-]+):\s*(.*)$/);
    if (kv) { key = kv[1]; out[key] = kv[2] === "" ? [] : kv[2].trim(); }
  }
  return out;
}

const fm = parseFrontmatter(text);
const body = text.replace(/^---\n[\s\S]*?\n---\n/, "");
const WIN = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File ${CLAUDE_SKILL_DIR}/checks/windows/run.ps1 *";
const MAC = "bash ${CLAUDE_SKILL_DIR}/checks/mac/run.sh *";

describe("SKILL.md", () => {
  test("frontmatter が読めて name と description がある", () => {
    expect(fm.name).toBe("security-checkup");
    expect(typeof fm.description).toBe("string");
    expect(fm.description).toMatch(/セキュリティ診断/);
    expect(fm.description).toMatch(/自社のセキュリティ/);
    expect(fm.description).toMatch(/PC の診断/);
  });

  test("allowed-tools は実行スクリプトの 3 つの規則と Read・Write・AskUserQuestion だけ", () => {
    const tools = fm["allowed-tools"];
    expect(Array.isArray(tools)).toBe(true);
    expect([...tools].sort()).toEqual(
      [`Bash(${MAC})`, `Bash(${WIN})`, `PowerShell(${WIN})`, "Read", "Write", "AskUserQuestion"].sort()
    );
  });

  test("Bash( と PowerShell( は実行スクリプトのものだけで、先頭に * がない", () => {
    for (const t of fm["allowed-tools"]) {
      const m = t.match(/^(Bash|PowerShell)\((.*)\)$/);
      if (!m) continue;
      expect(m[2]).toMatch(/^(bash \$\{CLAUDE_SKILL_DIR\}\/checks\/mac\/run\.sh|powershell\.exe -NoProfile -ExecutionPolicy Bypass -File \$\{CLAUDE_SKILL_DIR\}\/checks\/windows\/run\.ps1) \*$/);
    }
  });

  test("本文が参照するファイルはすべて実在する", () => {
    const refs = new Set();
    for (const m of body.matchAll(/\$\{CLAUDE_SKILL_DIR\}\/([A-Za-z0-9_./-]+)/g)) refs.add(m[1].replace(/[.,]+$/, ""));
    expect(refs.size).toBeGreaterThan(0);
    for (const r of refs) expect(fs.existsSync(path.join(DIR, r)), r).toBe(true);
  });

  test("本文のコマンド行は許可の規則に合う単純なコマンド", () => {
    const cmds = body.split("\n").filter((l) => /^(bash |powershell\.exe )/.test(l));
    expect(cmds.length).toBeGreaterThanOrEqual(6);
    for (const c of cmds) {
      const bare = c.replace(/<[^>]*>/g, "");
      expect(bare).not.toMatch(/&&|\||;|>|\bcd\b/);
      const ok = c.startsWith("bash ${CLAUDE_SKILL_DIR}/checks/mac/run.sh ") ||
        c.startsWith("powershell.exe -NoProfile -ExecutionPolicy Bypass -File ${CLAUDE_SKILL_DIR}/checks/windows/run.ps1 ");
      expect(ok, c).toBe(true);
    }
  });

  test("禁止事項の 4 つが本文にある", () => {
    expect(body).toMatch(/実行スクリプト以外のコマンドを実行しない/);
    expect(body).toMatch(/設定を変える手順を Claude が実行しない/);
    expect(body).toMatch(/レベルや各場面の状態を自分で決めない/);
    expect(body).toMatch(/個人名を書かない/);
  });

  test("必要な流れが書いてある", () => {
    for (const re of [/paths/, /selectsChecks/, /textEasy/, /unknown/, /later/, /スクリーンショット/, /社員PC結果|employeeResults/, /diagnosis\.json/, /目安で、安全を保証するものではない/, /ラベル/]) {
      expect(body).toMatch(re);
    }
  });

  test("ホームの絶対パスを含まない", () => {
    expect(text).not.toMatch(/\/home\/|C:\\Users|\/Users\//);
  });
});
