---
name: security-checkup
description: 会社のセキュリティ診断と、PC の設定チェックをするスキル。「セキュリティ診断をしたい」「自社のセキュリティをチェックして」「PC の診断をして」「社員の PC を確認したい」と言われたときに使う。質問に選んで答えるだけで、事故の場面ごとのレポートが出る。PC の設定は読むだけで、変更しない。
allowed-tools:
  - Bash(bash ${CLAUDE_SKILL_DIR}/checks/mac/run.sh *)
  - Bash(powershell.exe -NoProfile -ExecutionPolicy Bypass -File ${CLAUDE_SKILL_DIR}/checks/windows/run.ps1 *)
  - PowerShell(powershell.exe -NoProfile -ExecutionPolicy Bypass -File ${CLAUDE_SKILL_DIR}/checks/windows/run.ps1 *)
  - Read
  - Write
  - AskUserQuestion
---

# セキュリティ診断

中小企業の担当者・経営者・社員が、自分たちのセキュリティの現状と次にやることを知るためのスキル。使う人は IT の専門家ではない。説明は平易な日本語で、「業務で何が変わるか」で書く。専門用語、自明な操作説明（「押すと進みます」など）。誰かを責めない。「わからない」「未対応」は会社として直す対象として扱う。

## 守ること（禁止事項）

1. 下で示す実行スクリプト以外のコマンドを実行しない。その場でコマンドを考えない。
2. 設定を変える手順を Claude が実行しない。手順の説明はしてよい。
3. レベルや各場面の状態を自分で決めない。計算はレポートに任せる。チャットに書く内容も、レポートが出した結果を言い換えるだけにする。
4. 会社のレポートや `diagnosis.json` に個人名を書かない。

ほかに、個人のファイル、閲覧履歴、メールの中身は読まない。診断中にネットワークへ出ない。

## 実行スクリプトの呼び出し方

`${CLAUDE_SKILL_DIR}` はこのスキルのフォルダ。次の形をそのまま使う。1 回の実行は 1 つの単純なコマンドにする。`&&`、`|`、`;`、リダイレクト、`cd` は付けない（付けると許可の判定から外れて確認画面が出る）。パスは `/` 区切りで、空白や日本語を含むものは `"` で囲む。

Windows（Bash ツールでも PowerShell ツールでも、必ず `powershell.exe -File` 経由で呼ぶ）:

```
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ${CLAUDE_SKILL_DIR}/checks/windows/run.ps1 paths
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ${CLAUDE_SKILL_DIR}/checks/windows/run.ps1 check -Label "<ラベル>" -Checks "<id,id,...>" -Out "<出力ファイル>"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ${CLAUDE_SKILL_DIR}/checks/windows/run.ps1 report -Data "<diagnosis.json>" -OutDir "<出力フォルダ>"
```

Mac:

```
bash ${CLAUDE_SKILL_DIR}/checks/mac/run.sh paths
bash ${CLAUDE_SKILL_DIR}/checks/mac/run.sh check --label "<ラベル>" --checks "<id,id,...>" --out "<出力ファイル>"
bash ${CLAUDE_SKILL_DIR}/checks/mac/run.sh report --data "<diagnosis.json>" --outdir "<出力フォルダ>"
```

- `paths` は `{"outputRoot": "...", "employeeResults": "..."}` を返す。この値は置き場所を決めるためだけに使い、`diagnosis.json` やチャットの説明にパスをそのまま写さない（ホームのフォルダ名が入っている）。
- `check` は PC 1 台の結果ファイル（PcResult）を `-Out` / `--out` に書く。
- `report` は `diagnosis.json` から HTML を出力フォルダに作り、ブラウザで開く。
- 許可の確認画面が出たら、一言だけ「これはこのスキルに同梱した、設定を読むだけのチェックです。許可して大丈夫です」と伝える。許可はこの診断の途中だけ有効で、メッセージを送り直すと再び確認が出ることがある。そのため、質問は AskUserQuestion で続け、途中で会話を終えない。
- Mac で書類フォルダやクラウドの保存先を読むとき、macOS が許可を聞くことがある。「許可して大丈夫です。許可しなくても進められますが、その項目は『わからない』と表示されます」と短く伝える。

## 手順

### 1. 準備

1. OS を判定する（Windows か Mac）。どちらでもなければ、対応していないことを伝えて終える。
2. `paths` を実行し、`outputRoot`（診断の置き場）と `employeeResults`（社員 PC 結果フォルダ）を得る。今日の日付 `YYYY-MM-DD` を決め、出力先を `<outputRoot>/<今日の日付>` とする。
3. AskUserQuestion で聞く（1 回にまとめてよい）。
   - 立場：経営者／総務・情シス担当／一般社員（`role` は `manager` / `admin` / `employee`）
   - IT の詳しさ：1 ほとんどわからない／2 ふつうに使える／3 設定を触れる（`literacy` は 1〜3）
4. 一般社員なら「5. 自分の PC の診断」へ進む。それ以外は、「会社の診断」か「自分の PC だけ」かを聞く。PC だけなら 5 へ。

### 2. 会社診断の準備

- 会社名と PC の台数を聞く（`company.name`、`company.pcCount`）。自由入力でよい。台数が不明なら 0 とし、レポートに任せる。
- 前回の `diagnosis.json` が `outputRoot` の下の日付フォルダにあれば、Read して「前回の答えを使いますか」と聞いてよい。使うなら、答えを引き継ぐ。

### 3. 会社への質問

`${CLAUDE_SKILL_DIR}/questions/company.json` を Read する。`questions` を上から順に処理する。

- 絞り込み：`roles` に自分の立場が入る質問だけ聞く。`when` があれば、そこに書かれた質問の回答がその配列のどれかと一致するときだけ聞く（前に出てくる質問が対象）。
- 文面：詳しさが 1 なら `textEasy`、2 以上なら `text` を使う。
- 聞き方：AskUserQuestion で、1 回に最大 4 問まとめて聞く。ただし `when` の元になる質問と、その質問に依存する質問は同じ回に入れず、回答を受けてから聞く。選択肢の `label` をそのまま出す（`multiSelect` が true なら複数選択）。AskUserQuestion の選択肢は 2〜4 個なので、`options` は全部そのまま出せる。
- 記録：回答は選んだ選択肢の `id` で `answers` に入れる（複数選択は `id` の配列）。「わからない」は `unknown`、「あとで確認」は `later`。
- 「Other」の自由入力：近い選択肢の `id` に寄せない。回答は `unknown` とし、書かれた内容は会話中のメモに残す（`diagnosis.json` に個人名は書かない）。
- 深掘りはしない。質問ファイルにある分岐だけ聞く。答えられないときは `unknown` で進める。

#### スクリーンショット（任意）

次の質問は、重大な場面（バックアップ、退職者アカウント、メール、外からのアクセス）に効く。これらを聞くとき、各場面につき 1 回だけ「管理画面のスクリーンショットを貼れるなら貼ってください（なくても進めます）」と頼む。

- `backup_exists` ほかバックアップの質問、`departed_accounts_*` と `shared_accounts`、`mfa_enabled` と `mfa_coverage`、`vpn_used` と `remote_desktop`

画像が貼られたら読み、その画面から読み取れる範囲で回答の `id` を決める材料にする。読み取れない、迷うときは本人に確認するか `unknown` にする。画像に写った氏名やメールアドレスは記録しない。件数など数だけを使う。貼られなければ何も言わずに進める。

#### 使う部品を選ぶ

基本の 8 個は常に実行する: `antivirus`、`disk_encryption`、`os_update`、`os_support`、`firewall`、`screen_lock`、`local_admin`、`remote_access`。

残りは、選ばれた回答の `selectsChecks`（例: `{"yes": ["vpn_client"]}`）に載っている部品だけを足す。回答の `id` が `selectsChecks` のキーに一致したときに、その値の部品を足す。`cloud_sync`、`browser` などを自分の判断で足さない。

### 4. 会社診断の実行

1. 担当者自身の PC を診断する。ラベルは、PC の名前か役割（例: 「総務の PC」）にする。社員の氏名は使わない。
   - `check` を実行し、出力を `<employeeResults>/PC診断_<ラベル>_<今日の日付>.json` に書く。部品は上で選んだもの。
2. 社員の結果を集める。`employeeResults` の中の `.json` をすべて Read し、PcResult（`version` と `checks` を持つもの）だけを集めて `pcs` に入れる。読めないファイルや形の違うファイルは飛ばし、飛ばした数を最後に伝える。同じラベルが複数あっても、まとめるのはレポートに任せる（ここで消さない）。
3. 結果が 1 台もなければ、`pcs` は空配列にする。レポートが「未確認 N 台」と案内を出す。
4. `diagnosis.json` を Write で `<出力先>/diagnosis.json` に書く。形は `${CLAUDE_SKILL_DIR}/docs/data-format.md` のとおり。

```json
{
  "version": 1,
  "createdAt": "<今日>",
  "mode": "company",
  "role": "admin",
  "literacy": 2,
  "company": { "name": "<会社名>", "pcCount": 38 },
  "answers": { "<質問 id>": "<選択肢 id>" },
  "pcs": [ "<PcResult をそのまま>" ]
}
```

   書く前に、`answers` と `company` に個人名が入っていないか確かめる。
5. `report` を実行する（`<出力先>/diagnosis.json` と `<出力先>`）。ブラウザでレポートが開く。
6. 結果をチャットにも書く（下の「最後の伝え方」）。

### 5. 自分の PC の診断

社員が自分の PC を調べる流れ。専門用語を使わず、短く進める。

1. 最初に伝える（1 回だけ、簡潔に）: 読むのは PC の設定だけで、設定は変えない。個人のファイルや閲覧履歴は見ない。結果は担当者への報告に使うもので、評価のためではない。
2. ラベルを聞く。「PC の名前か、使っている部署・役割（例: 「営業 1」）」を聞く。フルネームは使わないよう頼む。
3. `check` を実行する。部品は基本の 8 個に、必要なら `vpn_client`、`cloud_sync`、`browser` を足す（会社の指示がなければ基本の 8 個だけ）。出力は `<employeeResults>/PC診断_<ラベル>_<今日の日付>.json`。
4. `diagnosis.json` を Write で `<出力先>/diagnosis.json` に書く（`mode` は `"pc"`、`role` は聞いた立場、`company` は `{"name": "", "pcCount": 1}`、`answers` は `{}`、`pcs` は今の結果 1 件）。`report` を実行する。本人向けの短い結果（自分の PC の場面だけ）が開く。
5. チャットで結果を短く伝え、最後に場所を示す: 「担当者に渡すファイルは <employeeResults の場所をフォルダ名で説明> の `PC診断_<ラベル>_<日付>.json` です。メールやチャットで担当者に送ってください。」ファイルのフルパスは書かず、「書類」の中の「セキュリティ診断」「社員PC結果」フォルダと説明する。
6. 「管理者権限が必要」で読めなかった項目があっても、本人に権限の操作を求めない。「その項目は担当者が確認します」と伝える。

### 6. あとで確認の質問

会社診断の最後に、`later` にした質問を一覧で示す（質問文と、レポートの「聞くことリスト」に載ること）。答えがわかったら、その質問だけ答え直せると伝える。

答え直しのとき: 前回の `diagnosis.json` を Read し、該当の回答だけ差し替えて Write し直し、`report` を再実行する。ほかの回答と `pcs` は変えない。

## 最後の伝え方（会社診断）

レポートが出たら、レポートのデータ（`diagnosis.json` と、レポートに表示されたレベル・場面）を見て、チャットに次の 3 点を書く。レベルと状態は、レポートに出ているものをそのまま使う。

1. 全体のレベル（A〜E）。必ず「目安で、安全を保証するものではない」と添える。
2. 危ない場面の上位 3 つ。「危ない」を先に、次に「一部危ない」。重大な場面（ランサムウェア、退職者、メール、外からの侵入）を優先する。
3. 次にやること 1 つ（レポートのカードに書かれたもの）。

立場に合わせる。

- 経営者（`manager`）: 場面の名前と、業務・お金・信用への影響を短く。設定の手順は書かない。「担当者や業者に頼むこと」で終える。
- 総務・情シス担当（`admin`）: どこを開いてどう確認するか、手順まで書いてよい。ただし実行はしない。
- 詳しさ 1 の人には、用語を使わず、例えで説明する。詳しさ 3 の人には、略さず具体的に。

PC がまだ集まっていなければ、「社員に PC 診断を頼むと、PC の場面が確かになります」と案内する。レポートの場所は、フォルダ名で伝える。

## 困ったとき

- 実行スクリプトが失敗した: エラーを一言で伝え、別のコマンドで代わりに調べようとしない。担当者に確認する項目として `unknown` のまま進める。
- 質問に答えられない人: 「わからない」で進めてよいと伝える。それ自体が結果になる。
- 診断の対象外（Claude Code を使っていない社員の PC）: 台数に数えるだけにする。代わりの手段は作らない。
