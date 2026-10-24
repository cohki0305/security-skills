/**
 * 判定エンジン。ブラウザ（クラシックスクリプト）と bun の両方で動く。
 * 同じ入力と同じ today なら同じ出力。Date.now() は使わず、日数の差は UTC の日付で計算する。
 *
 * 状態は "ok" | "warn" | "bad" | "unknown"。reason は短い機械用の文字列
 * （needs_admin / not_supported / error / missing / unknown_check / no_product / definitions_unknown /
 *  definitions_stale / scan_stale / past_end_of_support / support_ending / no_baseline / below_min / no_policy ほか）。
 * 日本語にするのは scenes.js 側。
 *
 * evaluateCheck の ctx: { baseline, today, answers, os?, osVersion?, allowedCloud? }
 *   os            "windows" | "mac"。os_support の照合に使う（aggregatePcs は各 PC の os を入れる）。
 *   allowedCloud  回答で認めたクラウド同期サービス名の配列（小文字比較）。未指定なら cloud_sync は unknown。
 */
const SC_ENGINE = (function () {
  const CHECK_IDS = ["antivirus", "disk_encryption", "os_update", "os_support", "firewall", "screen_lock", "local_admin", "remote_access", "vpn_client", "cloud_sync", "browser"];

  function dayNumber(s) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(typeof s === "string" ? s : "");
    if (!m) return null;
    return Math.floor(Date.UTC(+m[1], +m[2] - 1, +m[3]) / 86400000);
  }
  // from から to までの日数（to が後なら正）。読めなければ null
  function daysBetween(from, to) {
    const a = dayNumber(from), b = dayNumber(to);
    return a === null || b === null ? null : b - a;
  }
  function parts(v) {
    return String(v == null ? "" : v).split(".").map((x) => parseInt(x, 10)).map((n) => (Number.isNaN(n) ? 0 : n));
  }
  function cmpVersion(a, b) {
    const pa = parts(a), pb = parts(b);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const d = (pa[i] || 0) - (pb[i] || 0);
      if (d !== 0) return d < 0 ? -1 : 1;
    }
    return 0;
  }
  const r = (status, reason) => ({ status, reason: reason || null });

  function antivirus(f, c) {
    const t = c.baseline.thresholds;
    const enabled = (f.products || []).filter((p) => p && p.enabled);
    if (enabled.length === 0) return r("bad", "no_product");
    const age = daysBetween(f.definitionsUpdatedAt, c.today);
    if (age === null) return r("unknown", "definitions_unknown");
    let status, reason = null;
    if (age <= t.avDefinitionsOkDays) status = "ok";
    else if (age <= t.avDefinitionsWarnDays) { status = "warn"; reason = "definitions_stale"; }
    else { status = "bad"; reason = "definitions_stale"; }
    if (status === "ok") {
      const scan = daysBetween(f.lastScanAt, c.today);
      if (scan !== null && scan > t.avLastScanWarnDays) return r("warn", "scan_stale");
    }
    return r(status, reason);
  }

  function osUpdate(f, c) {
    const t = c.baseline.thresholds;
    const age = daysBetween(f.lastInstalledAt, c.today);
    if (age === null) return r("unknown", "update_unknown");
    if (age <= t.osUpdateOkDays) return r("ok");
    if (age <= t.osUpdateWarnDays) return r("warn", "update_stale");
    return r("bad", "update_stale");
  }

  function windowsBuild(v) {
    const p = String(v == null ? "" : v).split(".");
    const n = parseInt(p.length >= 3 ? p[2] : p[0], 10);
    return Number.isNaN(n) ? null : n;
  }
  function macMajor(v) {
    const n = parseInt(String(v == null ? "" : v).split(".")[0], 10);
    return Number.isNaN(n) ? null : n;
  }
  function osSupport(f, c) {
    const os = c.os || (/mac/i.test(String(f.name || "")) ? "mac" : "windows");
    let key = null;
    if (os === "windows") key = windowsBuild(f.build != null ? f.build : c.osVersion);
    else key = macMajor(f.version != null ? f.version : c.osVersion);
    if (key === null) return r("unknown", "os_unknown");
    const kind = os === "windows" ? "windowsBuild" : "macMajor";
    const row = (c.baseline.osSupport || []).find((e) => e.os === os && e.match && e.match.kind === kind && key >= e.match.min && key <= e.match.max);
    if (!row) return r("unknown", "os_not_in_baseline");
    if (row.endOfSupport == null) return r("ok");
    const left = daysBetween(c.today, row.endOfSupport);
    if (left === null) return r("unknown", "os_unknown");
    if (left <= 0) return r("bad", "past_end_of_support");
    if (left <= c.baseline.thresholds.osSupportWarnDays) return r("warn", "support_ending");
    return r("ok");
  }

  function screenLock(f, c) {
    const t = c.baseline.thresholds;
    if (f.requiresPassword === false) return r("bad", "no_password");
    if (typeof f.timeoutMinutes !== "number" || f.requiresPassword == null) return r("unknown", "lock_unknown");
    if (f.timeoutMinutes <= t.screenLockOkMinutes) return r("ok");
    if (f.timeoutMinutes <= t.screenLockWarnMinutes) return r("warn", "timeout_long");
    return r("bad", "timeout_long");
  }

  function remoteAccess(f) {
    const vals = [f.rdpEnabled, f.sshEnabled, f.screenSharingEnabled];
    if (vals.some((v) => v === true)) return r("warn", "remote_enabled");
    if (vals.every((v) => v == null)) return r("unknown", "remote_unknown");
    return r("ok");
  }

  function lookup(map, name) {
    const n = String(name || "").toLowerCase();
    for (const k of Object.keys(map || {})) if (k.toLowerCase() === n) return map[k];
    return undefined;
  }
  function vpnClient(f, c) {
    const products = f.products || [];
    if (products.length === 0) return r("unknown", "no_product");
    let anyBaseline = false;
    for (const p of products) {
      const min = lookup(c.baseline.vpnMinVersion, p.name);
      if (min === undefined) continue;
      anyBaseline = true;
      if (cmpVersion(p.version, min) < 0) return r("warn", "below_min");
    }
    return anyBaseline ? r("ok") : r("ok", "no_baseline");
  }

  function cloudSync(f, c) {
    if (!Array.isArray(c.allowedCloud)) return r("unknown", "no_policy");
    const allowed = c.allowedCloud.map((x) => String(x).toLowerCase());
    const extra = (f.products || []).some((p) => allowed.indexOf(String(p).toLowerCase()) < 0);
    return extra ? r("warn", "unapproved_service") : r("ok");
  }

  function browserKey(name) {
    const n = String(name || "").toLowerCase();
    if (n.indexOf("edge") >= 0) return "edge";
    if (n.indexOf("chrome") >= 0) return "chrome";
    if (n.indexOf("firefox") >= 0) return "firefox";
    if (n.indexOf("safari") >= 0) return "safari";
    return null;
  }
  function browser(f, c) {
    let seen = 0;
    let old = false;
    for (const b of f.browsers || []) {
      const key = browserKey(b.name);
      const min = key && c.baseline.browserMinMajor ? c.baseline.browserMinMajor[key] : undefined;
      if (min === undefined) continue;
      seen++;
      const major = parseInt(String(b.version == null ? "" : b.version).split(".")[0], 10);
      if (Number.isNaN(major)) return r("unknown", "browser_unknown");
      if (major < min) old = true;
    }
    if (seen === 0) return r("unknown", "no_product");
    return old ? r("warn", "below_min") : r("ok");
  }

  const EVALUATORS = {
    antivirus,
    disk_encryption: (f) => (f.encrypted === true ? r("ok") : f.encrypted === false ? r("bad", "not_encrypted") : r("unknown", "encryption_unknown")),
    os_update: osUpdate,
    os_support: osSupport,
    firewall: (f) => (f.enabled === true ? r("ok") : f.enabled === false ? r("warn", "firewall_off") : r("unknown", "firewall_unknown")),
    screen_lock: screenLock,
    local_admin: (f) => (f.isAdmin === false ? r("ok") : f.isAdmin === true ? r("warn", "is_admin") : r("unknown", "admin_unknown")),
    remote_access: remoteAccess,
    vpn_client: vpnClient,
    cloud_sync: cloudSync,
    browser,
  };

  function evaluateCheck(checkId, result, ctx) {
    if (!result) return r("unknown", "missing");
    if (result.unavailable != null) return r("unknown", result.unavailable);
    const fn = EVALUATORS[checkId];
    if (!fn) return r("unknown", "unknown_check");
    return fn(result.facts || {}, ctx || {});
  }

  function latestPcs(pcs) {
    const byLabel = new Map();
    const order = [];
    (Array.isArray(pcs) ? pcs : []).forEach((pc, i) => {
      if (!pc) return;
      const key = pc.label == null ? "\u0000" + i : String(pc.label);
      const prev = byLabel.get(key);
      if (!prev) { byLabel.set(key, pc); order.push(key); }
      else if (String(pc.checkedAt || "") > String(prev.checkedAt || "")) byLabel.set(key, pc);
    });
    return order.map((k) => byLabel.get(k));
  }

  function pcCheck(pc, checkId, ctx) {
    const result = pc && pc.checks ? pc.checks[checkId] : undefined;
    return evaluateCheck(checkId, result, Object.assign({}, ctx, { os: pc && pc.os, osVersion: pc && pc.osVersion }));
  }

  function aggregatePcs(pcs, checkId, ctx) {
    const list = Array.isArray(pcs) ? pcs : [];
    const counts = { ok: 0, warn: 0, bad: 0, unknown: 0 };
    list.forEach((pc) => { counts[pcCheck(pc, checkId, ctx).status]++; });
    const n = list.length;
    let status;
    if (n === 0) status = "unknown";
    else if (counts.bad * 2 >= n) status = "bad";
    else if (counts.bad > 0 || counts.warn > 0) status = "warn";
    else if (counts.ok === n) status = "ok";
    else status = "unknown";
    return { status, counts, checked: n };
  }

  function answerStatus(answers, questionId, map) {
    const v = answers ? answers[questionId] : undefined;
    if (v === undefined || v === null) return "unknown";
    const vals = Array.isArray(v) ? v : [v];
    if (vals.length === 0) return "unknown";
    const sts = vals.map((x) => (x === "unknown" || x === "later" ? "unknown" : (map && Object.prototype.hasOwnProperty.call(map, x) ? map[x] : "unknown")));
    return combine(sts);
  }

  function combine(statuses) {
    if (!statuses || statuses.length === 0) return "unknown";
    if (statuses.indexOf("bad") >= 0) return "bad";
    if (statuses.indexOf("unknown") >= 0) return "unknown";
    if (statuses.indexOf("warn") >= 0) return "warn";
    return "ok";
  }

  function computeLevel(sceneResults) {
    const all = sceneResults || [];
    const crit = all.filter((s) => s.critical);
    const critBad = crit.filter((s) => s.status === "bad").length;
    if (critBad >= 2) return "E";
    if (critBad === 1) return "D";
    const anyBad = all.some((s) => s.status === "bad");
    const critSoft = crit.filter((s) => s.status === "warn" || s.status === "unknown").length;
    if (anyBad || critSoft >= 2) return "C";
    const soft = all.filter((s) => s.status === "warn" || s.status === "unknown").length;
    if (soft === 0) return "A";
    return soft <= 2 ? "B" : "C";
  }

  function pcSummary(pcs, diagnosis, ctx) {
    const checked = pcs.length;
    let ok = 0, needsAction = 0;
    pcs.forEach((pc) => {
      // 「VPN 製品なし」「クラウド同期の方針なし」は PC の不備ではないので、PC 単位の集計では除く
      const sts = CHECK_IDS.map((id) => pcCheck(pc, id, ctx))
        .filter((x) => x.reason !== "no_policy" && !(x.reason === "no_product" && x.status === "unknown"))
        .map((x) => x.status);
      if (sts.indexOf("bad") >= 0 || sts.indexOf("warn") >= 0) needsAction++;
      else if (sts.every((s) => s === "ok")) ok++;
    });
    const count = diagnosis.company && typeof diagnosis.company.pcCount === "number" ? diagnosis.company.pcCount : checked;
    return { total: count, checked, unchecked: Math.max(0, count - checked), ok, needsAction };
  }

  function buildReport(diagnosis, scenes, baseline, today, questions) {
    const pcs = latestPcs(diagnosis.pcs);
    const answers = diagnosis.answers || {};
    const ctx = { baseline, today, answers, pcs };
    const engine = api;
    const used = (scenes || []).filter((s) => diagnosis.mode !== "pc" || s.pcScene);
    const evaluated = used.map((s) => {
      const out = s.evaluate(diagnosis, ctx, engine);
      const facts = out.facts || {};
      const pick = (tbl, status) => {
        const f = tbl && tbl[status];
        return typeof f === "function" ? f(facts) : "";
      };
      const byRole = s.text && (s.text[diagnosis.role] || s.text.manager || s.text.admin);
      return { critical: !!s.critical, row: { id: s.id, title: s.title, status: out.status, text: pick(byRole, out.status), next: pick(s.next, out.status) } };
    });
    const qs = Array.isArray(questions) ? questions : [];
    const asklist = [];
    Object.keys(answers).forEach((id) => {
      const v = answers[id];
      const vals = Array.isArray(v) ? v : [v];
      if (!vals.some((x) => x === "unknown" || x === "later")) return;
      const q = qs.find((x) => x.id === id);
      if (q) asklist.push({ questionId: id, text: q.text, howToAsk: q.howToAsk });
    });
    return {
      level: computeLevel(evaluated.map((e) => ({ critical: e.critical, status: e.row.status }))),
      scenes: evaluated.map((e) => e.row),
      pcSummary: pcSummary(pcs, diagnosis, ctx),
      asklist,
      baselineAsOf: baseline.asOf,
    };
  }

  // ---- HTML 描画（文字列を返す。値はすべてエスケープする）----
  const STATUS_LABEL = { bad: "危ない", warn: "一部危ない", unknown: "わからない", ok: "守れている" };
  const STATUS_CLASS = { bad: "bad", warn: "warn", unknown: "unk", ok: "ok" };
  const LEVEL_TEXT = {
    A: "大きな事故につながる穴は見つかりませんでした。",
    B: "大きな穴はありませんが、直したほうがよい所がいくつかあります。",
    C: "大きな事故が 1 つ起きると、業務が止まるおそれがあります。",
    D: "重大な場面に危ない所があり、事故が起きると業務への影響が大きくなります。",
    E: "重大な場面に危ない所が複数あり、早めの対応が必要です。",
  };
  const CHECK_NAME = {
    antivirus: "ウイルス対策", disk_encryption: "ディスクの暗号化", os_update: "OS の更新", os_support: "OS のサポート期限",
    firewall: "ファイアウォール", screen_lock: "画面ロック", local_admin: "管理者権限での利用", remote_access: "遠隔操作の入口",
    vpn_client: "VPN", cloud_sync: "クラウド同期", browser: "ブラウザの版",
  };
  const REASON_TEXT = {
    needs_admin: "管理者権限が必要", not_supported: "この PC では確認できません", error: "確認中にエラーが出ました", missing: "結果がありません",
    unknown_check: "確認できません", no_product: "対象の製品が見つかりません", definitions_unknown: "定義ファイルの更新日がわかりません",
    definitions_stale: "定義ファイルが古い", scan_stale: "しばらくスキャンされていません", past_end_of_support: "サポートが終了しています",
    support_ending: "サポートがまもなく終わります", os_not_in_baseline: "基準表にない OS です", os_unknown: "OS の版がわかりません",
    below_min: "版が古い", not_encrypted: "暗号化されていません", encryption_unknown: "暗号化の状態がわかりません",
    update_stale: "更新が止まっています", update_unknown: "更新日がわかりません", firewall_off: "オフになっています", firewall_unknown: "状態がわかりません",
    timeout_long: "ロックまでの時間が長い", no_password: "ロック解除にパスワードが要りません", lock_unknown: "設定がわかりません",
    is_admin: "普段から管理者の権限で使っています", admin_unknown: "権限がわかりません", remote_enabled: "遠隔操作が有効です", remote_unknown: "状態がわかりません",
    unapproved_service: "認めていないサービスが使われています", no_policy: "会社として認めたサービスが未確認です", browser_unknown: "版がわかりません",
  };

  function esc(v) {
    return String(v == null ? "" : v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function pill(status) {
    const st = STATUS_LABEL[status] ? status : "unknown";
    return '<span class="pill ' + STATUS_CLASS[st] + '">' + STATUS_LABEL[st] + "</span>";
  }
  function dateJa(s) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(typeof s === "string" ? s : "");
    return m ? m[1] + "年" + +m[2] + "月" + +m[3] + "日" : esc(s);
  }
  function navLinks(current, mode) {
    const items = [["report.html", "レポート"], ["asklist.html", "聞くことリスト"]];
    if (mode !== "pc") items.push(["pcs.html", "PC ごとの結果（担当者向け）"]);
    return '<nav class="nav">' + items.map((it) => (it[0] === current ? '<span aria-current="page">' + it[1] + "</span>" : '<a href="' + it[0] + '">' + it[1] + "</a>")).join("") + "</nav>";
  }

  // meta: { name, date, mode } 省略可
  function renderReport(report, role, meta) {
    const m = meta || {};
    const pcMode = m.mode === "pc";
    const sm = report.pcSummary || {};
    const title = pcMode ? "あなたの PC のセキュリティ診断" : (m.name ? esc(m.name) + " セキュリティ診断" : "セキュリティ診断");
    const metaLines = [];
    if (m.date) metaLines.push(dateJa(m.date) + " 診断");
    if (!pcMode && typeof sm.total === "number") metaLines.push("PC " + sm.total + " 台中 " + sm.checked + " 台を確認");
    const cards = (report.scenes || []).map((s) => {
      const st = STATUS_LABEL[s.status] ? s.status : "unknown";
      return '<div class="scene s-' + STATUS_CLASS[st] + '"><h3>' + esc(s.title) + " " + pill(st) + "</h3>" +
        (s.text ? "<p>" + esc(s.text) + "</p>" : "") + (s.next ? '<div class="next">→ ' + esc(s.next) + "</div>" : "") + "</div>";
    }).join("");
    const notes = [];
    if (role === "manager") notes.push("担当者に確認してもらった内容があれば、答えを足して、より詳しく確かめ直せます。この結果は経営者への質問だけで出した目安です。");
    let foot = "";
    if (!pcMode && (sm.unchecked > 0 || sm.checked === 0)) {
      foot = '<div class="foot">' + (sm.checked === 0 ? "PC は 1 台も確認できていません（未確認 " + sm.total + " 台）。" : "未確認の PC が " + sm.unchecked + " 台あります。") +
        "社員に「自分の PC の診断」を回してもらい、できた結果ファイルを「社員PC結果」フォルダに入れてもらうと、次の診断でこの結果に足されます。</div>";
    }
    return '<div class="paper"><div class="head"><h2>' + title + '</h2><div class="meta">' + metaLines.map(esc).join("<br>") + "</div></div>" +
      navLinks("report.html", m.mode) +
      '<div class="level"><div class="grade">' + esc(report.level) + '</div><p><b>' + esc(LEVEL_TEXT[report.level] || "") +
      "</b><small>レベルは A〜E の目安です。目安で、安全を保証するものではありません。" +
      "基準表：" + esc(report.baselineAsOf) + " 時点</small></p></div>" +
      notes.map((n) => '<p class="note">' + esc(n) + "</p>").join("") +
      '<div class="scenes">' + cards + "</div>" + foot + "</div>";
  }

  function renderAsklist(report, meta) {
    const m = meta || {};
    const list = report.asklist || [];
    const body = list.length === 0
      ? "<p>いま、業者や担当者に確認が必要な項目はありません。</p>"
      : '<ol class="todo">' + list.map((a) => "<li><b>" + esc(a.text) + "</b><span>" + esc(a.howToAsk) + "</span></li>").join("") + "</ol>";
    return '<div class="paper"><div class="head"><h2>業者・担当者に聞くことリスト</h2><div class="meta">基準表：' + esc(report.baselineAsOf) + " 時点</div></div>" +
      navLinks("asklist.html", m.mode) +
      "<p>診断で「わからない」「あとで確認」と答えた項目です。そのまま読み上げるか、メールに貼って聞いてください。</p>" + body + "</div>";
  }

  function renderPcs(diagnosis, ctx) {
    const pcs = latestPcs(diagnosis.pcs);
    const c = Object.assign({ answers: diagnosis.answers || {} }, ctx);
    const cards = pcs.map((pc) => {
      const rows = CHECK_IDS.map((id) => {
        const res = pcCheck(pc, id, c);
        const why = res.reason ? (REASON_TEXT[res.reason] || "") : "";
        return "<tr><td>" + esc(CHECK_NAME[id]) + "</td><td>" + pill(res.status) + "</td><td>" + esc(why) + "</td></tr>";
      }).join("");
      const osName = pc.os === "mac" ? "Mac" : pc.os === "windows" ? "Windows" : "";
      return '<section class="pc"><h3>' + esc(pc.label == null ? "（名前なし）" : pc.label) + '<span class="sub">' + esc(osName) +
        (pc.checkedAt ? " ・ " + dateJa(pc.checkedAt) + " 確認" : "") + '</span></h3><div class="tablewrap"><table><thead><tr><th>項目</th><th>状態</th><th>理由</th></tr></thead><tbody>' + rows + "</tbody></table></div></section>";
    }).join("");
    return '<div class="paper"><div class="head"><h2>PC ごとの結果（担当者向け）</h2><div class="meta">確認できた PC ' + pcs.length + " 台</div></div>" +
      navLinks("pcs.html", "company") +
      '<p class="note">担当者向けのページです。社員の名前が出ているので、経営者や社員に見せたり、共有したりするときは注意してください。</p>' +
      (pcs.length === 0 ? "<p>確認できた PC はまだありません。</p>" : cards) + "</div>";
  }

  const api = { evaluateCheck, latestPcs, aggregatePcs, answerStatus, combine, computeLevel, buildReport, CHECK_IDS, renderReport, renderAsklist, renderPcs };
  return api;
})();

if (typeof module !== "undefined") module.exports = SC_ENGINE;
else window.SC_ENGINE = SC_ENGINE;
