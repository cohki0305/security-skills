const { test, expect, describe } = require("bun:test");
const E = require("../security-checkup/report/engine.js");
const B = require("../security-checkup/report/baseline.js");
const SCENES = require("../security-checkup/report/scenes.js");
const { questions } = require("../security-checkup/questions/company.json");
const fs = require("fs");
const path = require("path");

const TODAY = "2026-10-24";
const STATUSES = ["ok", "warn", "bad", "unknown"];
const ROLES = ["manager", "admin", "employee"];
const fx = (n) => JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", n), "utf8"));
const byId = Object.fromEntries(SCENES.map((s) => [s.id, s]));
const ctxOf = (d) => ({ baseline: B, today: TODAY, answers: d.answers || {}, pcs: E.latestPcs(d.pcs) });
const run = (id, d) => byId[id].evaluate(d, ctxOf(d), E);

const okPc = () => fx("pc-windows-ok.json");
const company = (answers, pcs) => ({ version: 1, createdAt: TODAY, mode: "company", role: "admin", literacy: 2, company: { name: "見本", pcCount: 10 }, answers, pcs: pcs || [] });

describe("場面の定義", () => {
  test("9 場面がそろい、critical は 4 つ、pcScene は 3 つ", () => {
    expect(SCENES.map((s) => s.id).sort()).toEqual(
      ["antivirus", "departed_accounts", "email_takeover", "incident_response", "office_network", "os_update", "pc_loss", "ransomware", "remote_intrusion"].sort()
    );
    expect(SCENES.filter((s) => s.critical).map((s) => s.id).sort()).toEqual(["departed_accounts", "email_takeover", "ransomware", "remote_intrusion"]);
    expect(SCENES.filter((s) => s.pcScene).map((s) => s.id).sort()).toEqual(["antivirus", "os_update", "pc_loss"]);
    for (const s of SCENES) expect(typeof s.title).toBe("string");
  });

  test("全場面・全役割・全状態で text が空でない文字列を返す（facts が空でも）", () => {
    const d = fx("diagnosis-company.json");
    for (const s of SCENES) {
      const real = s.evaluate(d, ctxOf(d), E).facts;
      for (const role of ROLES) for (const st of STATUSES) for (const facts of [{}, real]) {
        const t = s.text[role][st](facts);
        expect(typeof t, `${s.id}.${role}.${st}`).toBe("string");
        expect(t.length, `${s.id}.${role}.${st}`).toBeGreaterThan(0);
      }
    }
  });

  test("bad・warn・unknown の next は文字列、ok は null", () => {
    for (const s of SCENES) {
      for (const st of ["bad", "warn", "unknown"]) {
        expect(typeof s.next[st]({}), `${s.id}.${st}`).toBe("string");
        expect(s.next[st]({}).length).toBeGreaterThan(0);
      }
      expect(s.next.ok({})).toBeNull();
    }
  });

  test("diagnosis-company で全場面の evaluate が 4 状態のどれかを返す", () => {
    const d = fx("diagnosis-company.json");
    for (const s of SCENES) {
      const out = s.evaluate(d, ctxOf(d), E);
      expect(STATUSES, s.id).toContain(out.status);
      expect(typeof out.facts, s.id).toBe("object");
    }
  });

  test("回答がすべて later なら、回答だけを見る場面は unknown", () => {
    const answers = Object.fromEntries(questions.map((q) => [q.id, "later"]));
    const d = company(answers, [okPc()]);
    for (const id of ["departed_accounts", "email_takeover", "incident_response"]) {
      expect(run(id, d).status, id).toBe("unknown");
    }
  });

  test("場面が読む回答の id はすべて company.json にある", () => {
    const qids = new Set(questions.map((q) => q.id));
    for (const id of SCENES.flatMap((s) => s.answerIds || [])) expect(qids.has(id), id).toBe(true);
  });
});

describe("場面の判定", () => {
  test("ransomware：バックアップが同じ場所だけなら bad、別の場所で戻せるなら PC 次第で ok", () => {
    const bad = run("ransomware", company({ backup_exists: "yes", backup_location: "same", backup_generations: "multiple", backup_restore_tested: "yes" }, [okPc()]));
    expect(bad.status).toBe("bad");
    const ok = run("ransomware", company({ backup_exists: "yes", backup_location: "separate", backup_generations: "multiple", backup_restore_tested: "yes" }, [okPc()]));
    expect(ok.status).toBe("ok");
  });

  test("ransomware：バックアップなしなら深掘りの回答がなくても bad", () => {
    expect(run("ransomware", company({ backup_exists: "no" }, [okPc()])).status).toBe("bad");
  });

  test("departed_accounts：残りが 1 件以上なら bad、0 件で決まりありなら ok", () => {
    expect(run("departed_accounts", company({ departed_accounts_process: "yes", departed_accounts_days: "within_week", departed_accounts_count: "some" })).status).toBe("bad");
    expect(run("departed_accounts", company({ departed_accounts_process: "yes", departed_accounts_days: "within_week", departed_accounts_count: "zero", shared_accounts: "none", saas_list: "yes" })).status).toBe("ok");
  });

  test("email_takeover：2 段階認証が一部だけなら warn、していないなら bad", () => {
    const base = { email_misdelivery: "yes", saas_admin_known: "yes" };
    expect(run("email_takeover", company({ ...base, mfa_enabled: "yes", mfa_coverage: "some" })).status).toBe("warn");
    expect(run("email_takeover", company({ ...base, mfa_enabled: "no" })).status).toBe("bad");
    expect(run("email_takeover", company({ ...base, mfa_enabled: "yes", mfa_coverage: "all" })).status).toBe("ok");
  });

  test("office_network：回答からクラウドの許可リストを作り、cloud_sync に渡す", () => {
    const pc = okPc();
    pc.checks.cloud_sync = { facts: { products: ["OneDrive"] }, unavailable: null };
    const base = { wifi_guest_separated: "separated", wifi_password_changed: "yes", nas_exists: "no" };
    const okD = company({ ...base, mail_service: "microsoft", cloud_extra: "no" }, [pc]);
    expect(run("office_network", okD).status).toBe("ok");
    const warnD = company({ ...base, mail_service: "google", cloud_extra: "no" }, [pc]);
    const w = run("office_network", warnD);
    expect(w.status).toBe("warn");
    expect(byId.office_network.text.admin.warn(w.facts)).toContain("OneDrive");
    const extra = company({ ...base, mail_service: "google", cloud_extra: "yes", cloud_extra_which: ["dropbox"] }, [{ ...pc, checks: { ...pc.checks, cloud_sync: { facts: { products: ["Dropbox", "Google Drive"] }, unavailable: null } } }]);
    expect(run("office_network", extra).status).toBe("ok");
    expect(run("office_network", company({ ...base, mail_service: "later", cloud_extra: "no" }, [pc])).status).toBe("unknown");
  });

  test("remote_intrusion：VPN の部品は VPN ソフトがある PC だけで数え、VPN なしなら使わない", () => {
    const withVpn = okPc();
    withVpn.label = "A";
    withVpn.checks.vpn_client = { facts: { products: [{ name: "FortiClient", version: "7.2.4" }] }, unavailable: null };
    const noVpn = okPc();
    noVpn.label = "B";
    noVpn.checks.vpn_client = { facts: { products: [] }, unavailable: null };
    const base = { telework: "yes", vpn_updated: "yes", remote_desktop: "no" };
    const r = run("remote_intrusion", company({ ...base, vpn_used: "yes" }, [withVpn, noVpn]));
    expect(r.status).toBe("ok");
    const vpnSig = r.facts.signals.find((s) => s.key === "vpn_client");
    expect(vpnSig.checked).toBe(1);
    const r2 = run("remote_intrusion", company({ telework: "yes", vpn_used: "no", remote_desktop: "no" }, [withVpn, noVpn]));
    expect(r2.facts.signals.some((s) => s.key === "vpn_client")).toBe(false);
    expect(r2.status).toBe("ok");
  });

  test("PC 系の文言は「N 台中 M 台」で書き、PC のラベルを出さない", () => {
    const enc = (label, encrypted) => ({ ...okPc(), label, checks: { ...okPc().checks, disk_encryption: { facts: { encrypted }, unavailable: null } } });
    const pcs = [enc("佐藤", false), enc("鈴木", true), enc("高橋", true), enc("田中", true)];
    const d = company({}, pcs);
    const out = run("pc_loss", d);
    expect(out.status).toBe("warn");
    for (const role of ROLES) {
      const t = byId.pc_loss.text[role].warn(out.facts) + byId.pc_loss.next.warn(out.facts);
      expect(t).toContain("4 台中 1 台");
      for (const p of pcs) expect(t).not.toContain(p.label);
    }
  });

  test("PC の結果がないと PC 系の場面は unknown で、結果がないことを伝える", () => {
    const d = company({}, []);
    for (const id of ["pc_loss", "antivirus", "os_update"]) {
      const out = run(id, d);
      expect(out.status, id).toBe("unknown");
      expect(byId[id].text.admin.unknown(out.facts), id).toMatch(/PC の結果がまだ/);
    }
  });

  test("管理者権限が必要な項目は、その理由を日本語で伝える", () => {
    const pc = okPc();
    pc.checks.disk_encryption = { facts: {}, unavailable: "needs_admin" };
    const out = run("pc_loss", company({}, [pc]));
    expect(out.status).toBe("unknown");
    expect(byId.pc_loss.text.admin.unknown(out.facts)).toContain("管理者権限が必要");
  });

  test("unknown の文言は責めない形（把握している人がいない／確認できない）", () => {
    const d = company({ departed_accounts_process: "unknown", mfa_enabled: "unknown", incident_contact: "unknown" });
    for (const id of ["departed_accounts", "email_takeover", "incident_response"]) {
      const out = run(id, d);
      expect(out.status).toBe("unknown");
      for (const role of ["manager", "admin"]) {
        expect(byId[id].text[role].unknown(out.facts), `${id}.${role}`).toMatch(/把握している人がいませんでした|確認できませんでした/);
      }
    }
  });

  test("buildReport に通すと全場面の行ができる", () => {
    const d = fx("diagnosis-company.json");
    const r = E.buildReport(d, SCENES, B, TODAY, questions);
    expect(r.scenes.length).toBe(9);
    for (const row of r.scenes) expect(row.text.length, row.id).toBeGreaterThan(0);
    const p = E.buildReport(fx("diagnosis-pc.json"), SCENES, B, TODAY, questions);
    expect(p.scenes.map((s) => s.id).sort()).toEqual(["antivirus", "os_update", "pc_loss"]);
  });
});
