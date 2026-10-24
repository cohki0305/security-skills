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
      const bare = c.replace(/<[^<>]*>/g, "PLACEHOLDER");
      expect(bare, c).not.toMatch(/&&|\||;|[<>]|\bcd\b/);
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

  test("最後の伝え方はレベルや状態をチャットに書かせず、レポートの案内にする", () => {
    const m = body.match(/## 最後の伝え方\n([\s\S]*?)(\n## |$)/);
    expect(m).not.toBeNull();
    const sec = m[1];
    expect(sec).toMatch(/チャットに、全体のレベル、場面ごとの状態.*書かない/);
    expect(sec).toMatch(/report\.html/);
    expect(sec).toMatch(/あとで確認/);
    expect(sec).not.toMatch(/A〜E|全体のレベル(を|は)(書|伝)/);
    expect(body).toMatch(/チャットにも書かない/);
  });

  test("diagnosis.json の例は JSON として読め、data-format.md の最上位キーを持つ", () => {
    const blocks = [...body.matchAll(/```json\n([\s\S]*?)```/g)].map((x) => x[1]);
    expect(blocks.length).toBeGreaterThan(0);
    const fmt = fs.readFileSync(path.join(DIR, "docs", "data-format.md"), "utf8");
    const sample = JSON.parse(fmt.match(/## diagnosis\.json\s+```json\n([\s\S]*?)```/)[1].replace(/"PcResult\.\.\."/, "{}"));
    const ex = JSON.parse(blocks[0].replace(/"<[^"]*>"/g, '"x"').replace(/"pcs": \[[^\]]*\]/, '"pcs": []'));
    expect(Object.keys(ex).sort()).toEqual(Object.keys(sample).sort());
  });

  test("本文のフラグは実行スクリプトにある", () => {
    const ps = fs.readFileSync(path.join(DIR, "checks", "windows", "run.ps1"), "utf8");
    const sh = fs.readFileSync(path.join(DIR, "checks", "mac", "run.sh"), "utf8");
    const lines = body.split("\n");
    for (const l of lines.filter((x) => x.startsWith("powershell.exe "))) {
      for (const f of l.match(/ -(Label|Checks|Out|Data|OutDir)\b/g) || []) expect(ps, f).toMatch(new RegExp("\\$" + f.trim().slice(1) + "\\b"));
      const sub = l.match(/run\.ps1 (\w+)/)[1];
      expect(ps).toContain('"' + sub + '"');
    }
    for (const l of lines.filter((x) => x.startsWith("bash "))) {
      for (const f of l.match(/ --[a-z]+/g) || []) expect(sh, f).toContain(f.trim());
      expect(sh).toMatch(new RegExp("\\b" + l.match(/run\.sh (\w+)/)[1] + "\\)"));
    }
  });
});
