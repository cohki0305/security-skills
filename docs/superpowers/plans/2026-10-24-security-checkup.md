# セキュリティ診断スキル 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 中小企業が Claude Code で動かすと、質問への回答と PC の設定の読み取りから、「事故の場面ごと」の診断レポートが出るスキル `security-checkup` を作る。

**Architecture:** 判定はすべて決まった JavaScript（`engine.js` / `scenes.js` / `baseline.js`）で行い、ブラウザで開く HTML レポートの中で計算する。Claude の役目は 3 つだけ。質問して回答を `diagnosis.json` に書くこと、同梱の実行スクリプト（Windows は `run.ps1`、Mac は `run.sh`）を呼ぶこと、結果を言葉で説明すること。PC の読み取りは項目ごとの読み取り専用スクリプト（部品）で行い、実行スクリプトがそれを束ねる。

**Tech Stack:** Windows PowerShell 5.1、bash 3.2（macOS 標準）、素の JavaScript（ブラウザの classic script。モジュールは使わない）、開発時のテストは bun test。配布物は実行時に何もインストールしない。

**Spec:** `docs/superpowers/specs/2026-10-24-security-checkup-design.md`

## Global Constraints

- **依頼者を特定できる情報を一切書かない。** 本名、ユーザー名、会社名、メール、ホームのパスなど。コミット前に `grep -rnEf ~/.config/security-checkup/identity-patterns.txt --exclude-dir=.git --exclude-dir=node_modules --exclude-dir=.superpowers .` が何も返さないこと（パターンの一覧はリポジトリの外に置く）
- PC の設定は**読むだけ**。書き込み、設定変更、レジストリの書き込み、`sudo`、管理者権限の要求はしない
- 診断中にネットワークへ出ない（部品・実行スクリプト・レポートのすべて）。外部 CDN やフォントも使わない
- 個人のファイル、閲覧履歴、メールの中身は読まない。部品の出力にユーザー名、ホスト名、個人のファイルパスを含めない
- Windows の部品は PowerShell 5.1 で動くこと。表示言語に左右されないよう、ローカライズされた文字列はパースせず、CIM・レジストリ・COM の値を読む
- Mac の部品は bash 3.2 で動くこと（連想配列、`mapfile`、`${var,,}` は使わない）
- 管理者権限がないと読めない項目は `"unavailable": "needs_admin"` を返して終了コード 0。部品は例外で止まらない
- 同じ入力なら同じ判定（`engine.js` は今日の日付を引数で受け取る）
- 文言：専門用語を避け、業務で何が変わるかで書く。自明な操作説明は書かない。社員を責めない。レベルには「目安で、安全を保証するものではない」を必ず添える
- 状態は 4 つ：`ok`（守れている）／`warn`（一部危ない）／`bad`（危ない）／`unknown`（わからない）
- 出力先：`<ドキュメント>/セキュリティ診断/<YYYY-MM-DD>/`。社員の結果ファイルを置く場所は `<ドキュメント>/セキュリティ診断/社員PC結果/`

## Review Focus

1. **日本語版 Windows・OneDrive に移されたドキュメントフォルダ。** 出力先のパスに日本語や空白が入っても動くこと → Task 6 と Task 8 のテストで、日本語と空白を含む出力先を使う
2. **管理者権限なし。** BitLocker などで例外を出さず `needs_admin` を返し、レポートでは「わからない（管理者権限が必要）」と出ること → Task 6 と Task 7 にテストを置く
3. **他社製ウイルス対策が入っていて Defender が無効。** この場合は `ok` と判定すること → Task 3 にテストを置く
4. **社員の結果ファイルが重複している、または古い形式。** 同じラベルなら新しい日付だけを使う。欠けた項目は `unknown` にする → Task 3 にテストを置く
5. **PC の結果が 1 台もない会社診断。** PC 系の場面は `unknown` になり、レポートは「未確認 N 台」と案内を出すこと → Task 3 と Task 5 にテストを置く

---

## ファイル構成

```
README.md                          # 入れ方・読むもの/読まないもの・注意書き（Task 9）
package.json                       # 開発用（bun test）。配布物には不要
tests/                             # 開発用テスト
  fixtures/                        # diagnosis.json と PcResult の見本
security-checkup/                  # ← ~/.claude/skills/ に入れる単位
  SKILL.md                         # 進め方（Task 8）
  docs/data-format.md              # diagnosis.json の形（Task 1）
  docs/employee-notice.md          # 社員への案内文のひな型（Task 9）
  questions/company.json           # 会社への質問（Task 4）
  report/baseline.js               # 基準表（Task 2）
  report/engine.js                 # 判定（Task 3）
  report/scenes.js                 # 場面の定義と文言（Task 4）
  report/report.html               # レポート A 案（Task 5）
  report/asklist.html              # 業者・担当者に聞くことリスト（Task 5）
  report/pcs.html                  # PC ごとの結果（担当者向け）（Task 5）
  checks/windows/run.ps1           # 実行スクリプト（Task 6）
  checks/windows/parts/*.ps1       # 部品（Task 6）
  checks/mac/run.sh                # 実行スクリプト（Task 7）
  checks/mac/parts/*.sh            # 部品（Task 7）
```

## データの形（全タスク共通）

`PcResult`（実行スクリプトの出力。社員が担当者に渡すファイルの中身もこれ）

```json
{
  "version": 1,
  "label": "山田",
  "checkedAt": "2026-10-24",
  "os": "windows",
  "osVersion": "10.0.26100",
  "checks": {
    "antivirus": { "facts": { "...": "..." }, "unavailable": null }
  }
}
```

`unavailable` は `null` / `"needs_admin"` / `"not_supported"` / `"error"` のどれか。

`diagnosis.json`（Claude が Write ツールで書く）

```json
{
  "version": 1,
  "createdAt": "2026-10-24",
  "mode": "company",
  "role": "admin",
  "literacy": 2,
  "company": { "name": "サンプル商事", "pcCount": 38 },
  "answers": { "backup_exists": "yes", "backup_restore_tested": "later" },
  "pcs": [ "PcResult..." ]
}
```

- `mode` は `"company"` か `"pc"`、`role` は `"manager"` / `"admin"` / `"employee"`、`literacy` は 1〜3
- 回答の値は選択肢の id。複数選択は配列。予約 id は `"unknown"`（わからない）と `"later"`（あとで確認）

### 部品の id と facts（Windows・Mac 共通の形）

| id | facts | 判定（Task 3 で実装。しきい値は baseline.js） |
|---|---|---|
| `antivirus` | `products: [{name, enabled, upToDate}]`, `definitionsUpdatedAt`, `lastScanAt` | 有効な製品なし → bad。定義が 7 日以内 → ok、30 日以内 → warn、それより古い → bad。最終スキャンが 30 日より前 → warn に下げる |
| `disk_encryption` | `encrypted: bool\|null` | true → ok、false → bad |
| `os_update` | `lastInstalledAt`, `pendingCount` | 30 日以内 → ok、60 日以内 → warn、それより前 → bad |
| `os_support` | `name`, `version`, `build` | 基準表のサポート終了日を過ぎている → bad、90 日以内 → warn |
| `firewall` | `enabled: bool` | true → ok、false → warn |
| `screen_lock` | `timeoutMinutes`, `requiresPassword` | 10 分以内かつパスワードあり → ok、30 分以内 → warn、それ以外 → bad |
| `local_admin` | `isAdmin: bool` | false → ok、true → warn |
| `remote_access` | `rdpEnabled`, `sshEnabled`, `screenSharingEnabled`（ない項目は null） | すべて false → ok、どれか true → warn |
| `vpn_client` | `products: [{name, version}]` | 基準表の最低版以上 → ok、未満 → warn、製品なし → unknown |
| `cloud_sync` | `products: [name]` | 回答で認めたサービス以外がある → warn、それ以外 → ok |
| `browser` | `browsers: [{name, version}]` | すべて基準表の最低メジャー版以上 → ok、それ以外 → warn |

日付はすべて `YYYY-MM-DD` の文字列。読めない値は `null`。

---

### Task 1: 土台・データ形式・見本データ

**Files:**
- Create: `package.json`, `.gitignore`, `security-checkup/docs/data-format.md`
- Create: `tests/fixtures/pc-windows-ok.json`, `tests/fixtures/pc-mac-mixed.json`, `tests/fixtures/diagnosis-company.json`, `tests/fixtures/diagnosis-pc.json`
- Test: `tests/fixtures.test.js`

**Interfaces:**
- Produces: 上の「データの形」。見本データは以降のタスクのテストで使う

- [ ] **Step 1: テストを書く** — `tests/fixtures.test.js`：各見本データが JSON として読めること、`version === 1`、`PcResult` に `label` / `checkedAt` / `os` / `checks` があること、`checks` の各値に `facts` と `unavailable` があること
- [ ] **Step 2: 失敗を確認** — Run: `bun test tests/fixtures.test.js` Expected: FAIL（ファイルがない）
- [ ] **Step 3: 実装** — `package.json`（`"test": "bun test"`。依存なし）、`.gitignore`（`node_modules`）、見本データ 4 つ、`data-format.md`（上の「データの形」と部品の表を、Claude が読む前提で書く）。`pc-mac-mixed.json` には `disk_encryption` が false、`antivirus` が `unavailable: "needs_admin"` の PC を入れる
- [ ] **Step 4: 通過を確認** — Run: `bun test` Expected: PASS
- [ ] **Step 5: コミット** — `git commit -m "chore: 土台とデータ形式・見本データを追加"`

### Task 2: 基準表

**Files:**
- Create: `security-checkup/report/baseline.js`
- Test: `tests/baseline.test.js`

**Interfaces:**
- Produces: グローバル `SC_BASELINE`（bun では `require` で同じオブジェクト）。
  `{ asOf: "YYYY-MM-DD", thresholds: { avDefinitionsOkDays: 7, avDefinitionsWarnDays: 30, avLastScanWarnDays: 30, osUpdateOkDays: 30, osUpdateWarnDays: 60, osSupportWarnDays: 90, screenLockOkMinutes: 10, screenLockWarnMinutes: 30 }, osSupport: [{ os, match, name, endOfSupport }], browserMinMajor: { chrome, edge, safari, firefox }, vpnMinVersion: { "<製品名>": "x.y" } }`

- [ ] **Step 1: テストを書く** — `asOf` が日付形式であること、しきい値が上の値と一致すること、`osSupport` に Windows 10（2025-10-14 終了）と Windows 11 の現行版、macOS の直近 3 世代が入っていること
- [ ] **Step 2: 失敗を確認** — Run: `bun test tests/baseline.test.js` Expected: FAIL
- [ ] **Step 3: 実装** — 末尾を `if (typeof module !== "undefined") module.exports = X; else window.SC_BASELINE = X;` にする（以下の JS ファイルも同じ書き方）。値は実装時点の公開情報で埋め、`asOf` に作成日を入れる
- [ ] **Step 4: 通過を確認** — Run: `bun test` Expected: PASS
- [ ] **Step 5: コミット**

### Task 3: 判定エンジン

**Files:**
- Create: `security-checkup/report/engine.js`
- Test: `tests/engine.test.js`

**Interfaces:**
- Consumes: Task 1 のデータ形式、Task 2 の `SC_BASELINE`
- Produces: グローバル `SC_ENGINE`
  - `evaluateCheck(checkId: string, result: {facts, unavailable}, ctx: {baseline, today, answers}) -> {status, reason}`。`unavailable` が null でなければ `{status: "unknown", reason: unavailable}`
  - `latestPcs(pcs: PcResult[]) -> PcResult[]`：同じ `label` は `checkedAt` が新しい 1 件だけ残す
  - `aggregatePcs(pcs, checkId, ctx) -> {status, counts: {ok, warn, bad, unknown}, checked}`：0 台 → unknown。半数以上が bad → bad。bad か warn が 1 台でもある → warn。全台 ok → ok。それ以外 → unknown
  - `answerStatus(answers, questionId, map: {[optionId]: status}) -> status`：`unknown` と `later` は常に `"unknown"`。未回答も `"unknown"`
  - `combine(statuses: string[]) -> status`：bad があれば bad、次に unknown、次に warn、すべて ok なら ok
  - `computeLevel(sceneResults: [{critical: bool, status}]) -> "A"|"B"|"C"|"D"|"E"`
  - `buildReport(diagnosis, scenes, baseline, today) -> {level, scenes: [{id, title, status, text, next}], pcSummary: {total, checked, unchecked, ok, needsAction}, asklist: [{questionId, text, howToAsk}], baselineAsOf}`

`computeLevel` のルール：
- E：重大な場面のうち 2 つ以上が bad
- D：重大な場面のうち 1 つが bad
- C：重大な場面に bad はないが、何かの場面が bad、または重大な場面に warn / unknown が 2 つ以上
- B：bad はなく、warn と unknown の合計が 2 つ以下
- A：すべて ok

- [ ] **Step 1: テストを書く**（各 1 つ以上）
  - `evaluateCheck("antivirus", …)`：Defender 無効・他社製が有効で定義 3 日前 → ok（Review Focus 3）／製品なし → bad／定義 20 日前 → warn
  - `evaluateCheck("disk_encryption", {facts:{}, unavailable:"needs_admin"})` → `{status:"unknown", reason:"needs_admin"}`（Review Focus 2）
  - `latestPcs`：同じラベルの 10-01 と 10-24 → 10-24 だけ残る。`checks` に項目がない古いファイルでも落ちない（Review Focus 4）
  - `aggregatePcs`：pcs が空 → unknown・checked 0（Review Focus 5）／31 台中 6 台 bad → warn
  - `answerStatus`：`"later"` → unknown
  - `computeLevel`：上の 5 つのルールをそれぞれ満たす入力で A〜E
  - `buildReport`：同じ入力と同じ today なら `JSON.stringify` が一致する。`pcSummary.unchecked = company.pcCount - checked`
- [ ] **Step 2: 失敗を確認** — Run: `bun test tests/engine.test.js` Expected: FAIL
- [ ] **Step 3: 実装** — `Date.now()` は使わず `today` 引数だけを見る。日数の差は UTC の日付で計算する
- [ ] **Step 4: 通過を確認** — Run: `bun test` Expected: PASS
- [ ] **Step 5: コミット**

### Task 4: 質問と場面

**Files:**
- Create: `security-checkup/questions/company.json`, `security-checkup/report/scenes.js`
- Test: `tests/questions.test.js`, `tests/scenes.test.js`

**Interfaces:**
- Consumes: Task 3 の `answerStatus` / `aggregatePcs` / `combine`
- Produces:
  - `company.json`：`{ questions: [{ id, domain, roles: ["manager"|"admin"], text, textEasy, multiSelect, options: [{id, label}], when?: {questionId: [optionId]}, followupOf?: questionId, howToAsk, selectsChecks?: {[optionId]: [checkId]} }] }`
  - グローバル `SC_SCENES`：`[{ id, title, critical, evaluate(diagnosis, ctx, engine) -> {status, facts}, text: {manager, admin, employee}: {[status]: (facts) => string}, next: {[status]: (facts) => string|null} }]`

決まり：
- どの質問も `options` は 2〜4 個（Claude Code の選択式の上限）。そのうち `{id:"unknown", label:"わからない"}` と `{id:"later", label:"あとで確認"}` を必ず含む。選択肢が多い質問は分ける
- 深掘りの質問は `followupOf` と `when` を持ち、親の回答が「している」のときだけ聞く。深掘りがあるのは重大な場面に効く質問だけ
- `howToAsk` は「業者や担当者に聞くことリスト」にそのまま載る聞き方の文面
- `textEasy` は IT に詳しくない人向けの言い換え
- 氏名が写りやすい項目（退職者アカウント）は件数で答える選択肢にする（0 件／1〜2 件／3 件以上 など）
- 質問の元ネタは IPA の「中小企業の情報セキュリティ対策ガイドライン」と「5 分でできる！情報セキュリティ自社診断」。範囲は設計書 5 章の 8 領域。経営者向けは 10 問程度、担当者向けは深掘りを含めて 35 問以内
- 場面は 9 つ。`critical: true` は ★ の付いたもの
  - ★ `ransomware`（バックアップの回答、`antivirus`、`os_update`）
  - ★ `departed_accounts`（回答）
  - ★ `email_takeover`（2 段階認証などの回答）
  - ★ `remote_intrusion`（VPN・リモートの回答、`remote_access`、`firewall`）
  - `pc_loss`（`disk_encryption`、`screen_lock`）
  - `antivirus`（`antivirus`）
  - `os_update`（`os_update`、`os_support`、`browser`）
  - `office_network`（Wi-Fi・NAS の回答、`cloud_sync`）
  - `incident_response`（連絡先・手順・教育の回答）
- 場面の文言は、見本 A 案（https://claude.ai/artifact/3p37w4B9EqrhSirBzm9XEG）の書き方に合わせる。unknown の文言は「把握している人がいませんでした」の形にし、責めない

- [ ] **Step 1: テストを書く**
  - `questions.test.js`：id が重複しない／全問に `unknown` と `later` がある／選択肢は 2〜4 個／`when` と `followupOf` が実在する id を指す／`selectsChecks` の値が部品の表の id だけ／`howToAsk` と `textEasy` が空でない／`roles` に manager を含む問が 12 問以下、admin を含む問が 35 問以下
  - `scenes.test.js`：9 場面がそろい、critical は 4 つ／全場面・全役割・全状態で `text` が文字列を返す／bad と warn と unknown の `next` が文字列を返す／`tests/fixtures/diagnosis-company.json` で全場面の `evaluate` が 4 状態のどれかを返す／回答がすべて `later` なら、回答だけを見る場面は unknown
- [ ] **Step 2: 失敗を確認** — Run: `bun test tests/questions.test.js tests/scenes.test.js` Expected: FAIL
- [ ] **Step 3: 実装** — 質問の文面と場面の文言を書いたら、natural-japanese スキルで文面を見直す
- [ ] **Step 4: 通過を確認** — Run: `bun test` Expected: PASS
- [ ] **Step 5: コミット**

### Task 5: レポート HTML

**Files:**
- Create: `security-checkup/report/report.html`, `security-checkup/report/asklist.html`, `security-checkup/report/pcs.html`
- Test: `tests/report.test.js`

**Interfaces:**
- Consumes: 同じフォルダに置かれた `baseline.js`、`engine.js`、`scenes.js`、`data.js`（`window.SC_DATA = <diagnosis.json の中身>;`）。読み込みは classic `<script src>` だけ（file:// で開くため）
- Produces: ブラウザで開くだけで表示されるページ。今日の日付は `SC_DATA.createdAt` を使う

- [ ] **Step 1: テストを書く** — `report.test.js`：happy-dom などは使わず、bun で `engine.js`・`scenes.js`・`baseline.js` と見本データから `buildReport` を呼んだ結果に対して、HTML の描画関数 `renderReport(report, role) -> string`（`report.html` の中ではなく `engine.js` に置く）が次を満たすこと
  - レベルの文字と「目安で、安全を保証するものではありません」を含む
  - 9 場面のカードが出て、状態ごとに `危ない／一部危ない／わからない／守れている` のラベルが付く
  - `pcSummary.checked === 0` のとき「未確認」と社員への案内文を含む（Review Focus 5）
  - `role === "manager"` で個人名（見本データの PC ラベル）を含まない
  - `diagnosis-pc.json`（`mode: "pc"`）では、PC で判定できる場面（`pc_loss`、`antivirus`、`os_update`）だけが出て、回答に頼る場面は出ない
  - `unavailable: "needs_admin"` の項目は、場面の文言に「管理者権限が必要」と出る
  - 外部 URL（`http`）を含まない
- [ ] **Step 2: 失敗を確認** — Run: `bun test tests/report.test.js` Expected: FAIL
- [ ] **Step 3: 実装** — `renderReport`・`renderAsklist(report) -> string`・`renderPcs(diagnosis, ctx) -> string` を `engine.js` に足す。HTML 3 枚は CSS と、描画関数を呼んで `innerHTML` に入れる数行だけを持つ。見た目は A 案に合わせ、ライト／ダークの両方に対応する。フォントはシステムフォントのみ。`pcs.html` だけが個人ラベルを表示する
- [ ] **Step 4: 通過を確認** — Run: `bun test` Expected: PASS
- [ ] **Step 5: 目で確認** — 見本データで `data.js` を作り、3 枚をブラウザで開いてスクリーンショットを撮る（agent-browser）。A 案のモックと並べて違和感がないこと
- [ ] **Step 6: コミット**

### Task 6: Windows の部品と実行スクリプト

**Files:**
- Create: `security-checkup/checks/windows/run.ps1`、`security-checkup/checks/windows/parts/<checkId>.ps1`（部品の表の 11 個）
- Test: `tests/windows.test.js`（`/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe` がないときは skip）

**Interfaces:**
- Consumes: 部品の表の facts
- Produces:
  - 各部品：引数なしで実行すると、`{"facts": {...}, "unavailable": null|"needs_admin"|"not_supported"|"error"}` を 1 行の JSON で標準出力に出し、終了コード 0
  - `run.ps1 check -Label <名前> -Checks <id,id,...> -Out <ファイル>`：部品を順に呼び、PcResult を UTF-8（BOM なし）で書く
  - `run.ps1 report -Data <diagnosis.json> -OutDir <フォルダ>`：`report/` の HTML 3 枚と JS 3 本を `OutDir` にコピーし、`data.js` を作り、`report.html` を既定のブラウザで開く
  - `run.ps1 paths`：出力先（ドキュメント配下の `セキュリティ診断`）と `社員PC結果` の絶対パスを JSON で出す。フォルダがなければ作る

読み方の指定（管理者権限なしで読めるもの）：
- `antivirus`：`root/SecurityCenter2` の `AntiVirusProduct`（`productState` を分解）と `Get-MpComputerStatus`
- `disk_encryption`：`Shell.Application` の `System.Volume.BitLockerProtection`（C ドライブ）
- `os_update`：`Microsoft.Update.Session` の更新履歴
- `screen_lock`：`HKCU:\Control Panel\Desktop` のスクリーンセーバー設定と、ポリシーの `InactivityTimeoutSecs`
- `local_admin`：現在のトークンが S-1-5-32-544 を含むか
- `remote_access`：`fDenyTSConnections`
- `vpn_client` / `cloud_sync` / `browser`：Uninstall レジストリ（HKLM / HKCU）の表示名と版
- `firewall`：`Get-NetFirewallProfile`
- `os_support`：`Win32_OperatingSystem`

ドキュメントフォルダは `[Environment]::GetFolderPath('MyDocuments')` で取る（OneDrive に移されていても正しく取れる）。

- [ ] **Step 1: テストを書く** — `windows.test.js`：
  - 11 個の部品を `powershell.exe -NoProfile -ExecutionPolicy Bypass -File <path>` で実行し、JSON として読めて `facts` と `unavailable` があり、終了コードが 0
  - `run.ps1 check` を、日本語と空白を含む出力先（例：`%TEMP%\診断 テスト\結果.json`）で実行すると、PcResult の形のファイルができる（Review Focus 1）
  - `run.ps1 report` を同じく日本語と空白を含むフォルダで実行すると 7 ファイルができる（テストではブラウザを開かない `-NoOpen` を付ける）
  - 出力の中に、Windows のユーザー名（`$env:USERNAME`）とコンピューター名が含まれない
- [ ] **Step 2: 失敗を確認** — Run: `bun test tests/windows.test.js` Expected: FAIL
- [ ] **Step 3: 実装** — 部品はそれぞれ全体を `try { … } catch { unavailable = "error" }` で包む。権限エラーは `needs_admin` にする。WSL のパスは `wslpath -w` で変換して渡す
- [ ] **Step 4: 通過を確認** — Run: `bun test tests/windows.test.js` Expected: PASS（この PC の Windows 上で）
- [ ] **Step 5: コミット**

### Task 7: Mac の部品と実行スクリプト

**Files:**
- Create: `security-checkup/checks/mac/run.sh`、`security-checkup/checks/mac/parts/<checkId>.sh`（11 個）
- Create: `tests/mac-shims/<コマンド名>`（テスト用の偽コマンド）
- Test: `tests/mac.test.js`

**Interfaces:**
- Produces: Task 6 と同じ入出力。`run.sh check --label <名前> --checks <id,id,...> --out <ファイル>`、`run.sh report --data <json> --outdir <フォルダ> [--no-open]`、`run.sh paths`（ドキュメントは `~/Documents`）

読み方の指定（sudo なしで読めるもの）：
- `antivirus`：XProtect の更新日（`system_profiler SPInstallHistoryDataType -json`）と、`/Applications` 内の既知の対策ソフト
- `disk_encryption`：`fdesetup status`
- `os_update`：`system_profiler SPInstallHistoryDataType -json` の最新 macOS 更新
- `firewall`：`/usr/libexec/ApplicationFirewall/socketfilterfw --getglobalstate`
- `screen_lock`：`sysadminctl -screenLock status`
- `local_admin`：`id -Gn` に `admin` が含まれるか
- `remote_access`：`launchctl print-disabled system` の ssh と screensharing
- `os_support`：`sw_vers`
- `vpn_client` / `cloud_sync` / `browser`：`/Applications/*.app/Contents/Info.plist` を `defaults read` で読む

JSON の組み立ては `osascript -l JavaScript` を使わず、bash の printf と、値のエスケープを行う小さな関数 1 つで行う。

- [ ] **Step 1: テストを書く** — `mac.test.js`：`PATH` の先頭に `tests/mac-shims` を置いて Linux の bash で実行し、各部品の出力が JSON として読めること。偽コマンドは実際の macOS の出力の見本を返す
  - `fdesetup` が `FileVault is Off.` → `encrypted:false`
  - `sysadminctl` が権限エラー → `unavailable:"needs_admin"`（Review Focus 2）
  - `run.sh check --out "<tmp>/診断 テスト/結果.json"` でファイルができる（Review Focus 1）
  - `bash --posix` ではなく、bash 3.2 で使えない構文がないことを `grep -nE 'declare -A|mapfile|readarray|\$\{[a-z_]+,,\}'` で確認する
- [ ] **Step 2: 失敗を確認** — Run: `bun test tests/mac.test.js` Expected: FAIL
- [ ] **Step 3: 実装**
- [ ] **Step 4: 通過を確認** — Run: `bun test tests/mac.test.js` Expected: PASS
- [ ] **Step 5: Mac で試す手順書を書く** — `docs/mac-test-checklist.md`：依頼者が自分の Mac で `run.sh check` と `run.sh report` を動かす手順と、確認する所（11 項目それぞれが `unknown` だらけになっていないか、実際の設定と合っているか）
- [ ] **Step 6: コミット**

### Task 8: SKILL.md（進め方）

**Files:**
- Create: `security-checkup/SKILL.md`
- Test: `tests/skill.test.js`

**Interfaces:**
- Consumes: Task 1〜7 のすべて

SKILL.md に書くこと：
- frontmatter：`name: security-checkup`、日本語の `description`（「セキュリティ診断」「自社のセキュリティをチェック」「PC の診断」などで呼ばれる）、`allowed-tools` に実行スクリプトの呼び出しだけを入れる。Windows：`Bash(powershell.exe -NoProfile -ExecutionPolicy Bypass -File *security-checkup/checks/windows/run.ps1 *)`。Mac：`Bash(bash *security-checkup/checks/mac/run.sh *)`。加えて `Read`、`Write`、`AskUserQuestion`
- 最初に OS を判定し、`run paths` で出力先を得る
- 立場（経営者／総務・情シス担当／一般社員）と IT の詳しさ（3 段階）を、選択式で聞く。一般社員は PC 診断へ進む
- 会社診断：`company.json` を順に読み、`roles` と `when` で絞り、詳しさ 1 なら `textEasy` を使って AskUserQuestion で聞く。1 回に最大 4 問まとめて聞いてよい。回答は id で記録する。「Other」の自由入力は、近い選択肢の id に寄せずに `unknown` とし、内容をメモとして残す
- 重大な場面に効く質問では、「管理画面のスクリーンショットを貼れるなら貼ってください（なくても進めます）」と一度だけ頼む。貼られたら読み、回答の id を決める材料にする。氏名は記録しない
- 「あとで確認」にした質問は、最後に一覧で示し、答えがわかったらその質問だけ答え直せると伝える（前回の `diagnosis.json` を読み、該当の回答だけ差し替えて `run report` し直す）
- 部品の選び方：基本の 8 個（`antivirus`、`disk_encryption`、`os_update`、`os_support`、`firewall`、`screen_lock`、`local_admin`、`remote_access`）は常に実行する。残りは、回答の `selectsChecks` で選ばれたときだけ足す
- 担当者自身の PC も診断し、`社員PC結果` フォルダの PcResult をすべて Read して `pcs` に入れる
- PC 診断：名前（ラベル）を聞き、`run check` で結果ファイルを `社員PC結果` に作る。本人に短い結果を伝え、「このファイルを担当者に渡してください」と場所を示す
- `diagnosis.json` を Write で出力先に書き、`run report` を呼ぶ。最後に、レベルと危ない場面の上位 3 つを、立場に合わせた言葉でチャットにも書く
- **禁止事項**：実行スクリプト以外のコマンドを実行しない。設定を変える手順を Claude が実行しない（手順の説明はしてよい）。レベルや状態を自分で決めない（レポートの計算に任せる）。会社のレポートに個人名を書かない

- [ ] **Step 1: テストを書く** — `skill.test.js`：frontmatter が読めて `name` が `security-checkup`／`allowed-tools` に実行スクリプト以外の `Bash(` がない／SKILL.md が参照するファイルパスがすべて実在する／禁止事項の 4 つが本文にある
- [ ] **Step 2: 失敗を確認** — Run: `bun test tests/skill.test.js` Expected: FAIL
- [ ] **Step 3: 実装**
- [ ] **Step 4: 通過を確認** — Run: `bun test` Expected: PASS
- [ ] **Step 5: Windows で通しで動かす** — `security-checkup` を Windows 側の `%USERPROFILE%\.claude\skills\` に一時的に置き、Claude Code で「セキュリティ診断をしたい」から最後のレポートまで進める。次を確かめる
  - 実行スクリプトの呼び出しで確認画面が出ないこと（`allowed-tools` のパターンが効いていること。効かなければパターンを直し、直し方を README に書く）
  - 会社診断と PC 診断の両方でレポートが開くこと
  - 確かめ終わったら一時的に置いたスキルを消す
- [ ] **Step 6: コミット**

### Task 9: README・社員への案内文・公開前チェック

**Files:**
- Create: `README.md`、`security-checkup/docs/employee-notice.md`

- [ ] **Step 1: README を書く** — 入れ方（Windows / Mac。`security-checkup` フォルダを `~/.claude/skills/` に置く）、使い方（「セキュリティ診断をしたい」と話しかける）、読むもの・読まないもの、設定は変えないこと、読んだ内容は Claude（Anthropic）に送られること、会社で使うなら法人プランを推奨すること、診断は目安で安全を保証しないこと、基準表の日付と更新方法、Claude Code を使っていない社員の PC は対象外になること
- [ ] **Step 2: 社員への案内文のひな型を書く** — 何を読むか、何を読まないか、結果を誰が見るか（会社のレポートには個人名を出さず、担当者だけが PC ごとの結果を見ること）、所要時間
- [ ] **Step 3: 文面を見直す** — natural-japanese スキルで README と案内文を見直す
- [ ] **Step 4: 公開前チェック** — Run: `bun test` Expected: PASS。Run: Global Constraints の識別子 grep Expected: 出力なし。Run: `grep -rn 'http' security-checkup/report/` Expected: コメント以外の外部 URL なし
- [ ] **Step 5: コミットして push**
