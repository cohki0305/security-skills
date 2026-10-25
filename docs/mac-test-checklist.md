# Mac で試す手順書

自分の Mac で、診断の部品が正しく動くかを確かめる手順です。設定は何も変わりません（読むだけです）。所要時間は 10 分ほどです。

## 準備

1. このリポジトリを Mac に置く（ダウンロードでも clone でも構いません）。
2. 「ターミナル」を開き、リポジトリのフォルダに移動する。

   ```
   cd ~/security-skills
   ```

   フォルダの場所が違うときは、自分の置き場所に読み替えてください。
3. 動かすスクリプトの実行権限を確かめる。

   ```
   chmod +x security-checkup/checks/mac/run.sh security-checkup/checks/mac/parts/*.sh
   ```

管理者のパスワードは求められません。もし求められたら、入力せずに止めて知らせてください。

## 1. 保存先のフォルダを確かめる

```
bash security-checkup/checks/mac/run.sh paths
```

次のような 1 行が出れば合格です。

```
{"outputRoot":"/Users/…/Documents/セキュリティ診断","employeeResults":"/Users/…/Documents/セキュリティ診断/社員PC結果"}
```

Finder で「書類」を開くと「セキュリティ診断」フォルダができています。

## 2. 11 項目を調べる

```
bash security-checkup/checks/mac/run.sh check --label テスト --out "$HOME/Documents/セキュリティ診断/試し/mac-result.json"
```

何も表示されずに終われば成功です。「書類」の「セキュリティ診断」の中の「試し」フォルダに `mac-result.json` ができます。中身を見ます。

```
cat "$HOME/Documents/セキュリティ診断/試し/mac-result.json"
```

保存先は「セキュリティ診断」フォルダの中に限られます。外を指定すると `--out must be inside the output folder` と出て、何も書かれません。念のため、次のコマンドがこのエラーで止まり、デスクトップに何もできないことも確かめてください。

```
bash security-checkup/checks/mac/run.sh check --label テスト --out ~/Desktop/mac-result.json
```

## 3. 結果を確かめる

下の表の順に、結果と実際の設定を見比べてください。確かめ方の欄は、System Settings（システム設定）での場所です。

| 項目（id） | 結果の見方 | 実際の設定の確かめ方 |
|---|---|---|
| ディスクの暗号化（disk_encryption） | `encrypted` が、FileVault の入り切りと同じか | プライバシーとセキュリティ → FileVault |
| ファイアウォール（firewall） | `enabled` が、入り切りと同じか | ネットワーク → ファイアウォール |
| 画面ロック（screen_lock） | `timeoutMinutes` が、画面が消える（またはスクリーンセーバが始まる）までの分数＋「パスワードを要求」までの時間か。ロックしない設定なら `null` と `false` | ロック画面、およびディスプレイ設定 |
| 管理者（local_admin） | `isAdmin` が、自分のアカウントの種類（管理者か標準か）と同じか | ユーザとグループ |
| 外部から操作（remote_access） | `sshEnabled`（リモートログイン）と `screenSharingEnabled`（画面共有）が、共有の設定と同じか。`rdpEnabled` は Mac では常に `null` | 一般 → 共有 |
| OS のバージョン（os_support） | `version` が、「このMacについて」の表示と同じか | 一般 → 情報 |
| OS の更新（os_update） | `lastInstalledAt` が、最後に OS 更新を入れた日に近いか。`pendingCount` は `null`（ネットワークに出ないため） | 一般 → ソフトウェアアップデート → 更新履歴 |
| ウイルス対策（antivirus） | `products` に XProtect（Apple 標準）と、入れている対策ソフトが出るか。対策ソフトが入っているときは `definitionsUpdatedAt` が `null`（判定は「わからない」になります）。入っていないときの `definitionsUpdatedAt` は、システム情報アプリの「ソフトウェア → インストール」にある XProtect の最新の日付、または `system_profiler SPInstallHistoryDataType` の XProtect の日付と近いか、Finder の `/Library/Apple/System/Library/CoreServices/XProtect.bundle` の更新日と見比べる（新しい方が出ます） | アプリケーションフォルダ |
| VPN（vpn_client） | 入れている VPN アプリが出るか。入れていなければ空 | アプリケーションフォルダ |
| クラウド同期（cloud_sync） | **ログインして使っている**サービスだけが出るか。入れただけで使っていないものは出ない | Finder の左側にある場所、Apple ID → iCloud |
| ブラウザ（browser） | Chrome・Edge・Firefox・Safari のうち入っているものと、そのバージョン | 各アプリの「について」 |

### 「わからない」が多すぎないか

`"unavailable"` が `null` 以外の項目があれば、その項目名を控えてください。

- `"needs_admin"`: 管理者権限がないと読めない項目です。1〜2 個なら想定内です。
- `"error"`: 読めなかった項目です。ある場合は知らせてください。
- 11 項目のうち 3 つ以上が `null` 以外なら、部品に問題がある可能性があります。

### 個人情報が入っていないか

`mac-result.json` の中に、ユーザ名、Mac の名前、フォルダの場所が出ていないことを確かめてください。出ていたら知らせてください。

## 4. レポートを作る（見本のデータで）

```
bash security-checkup/checks/mac/run.sh report --data tests/fixtures/diagnosis-company.json --outdir "$HOME/Documents/セキュリティ診断/試し/mac-report"
```

ブラウザでレポートが開けば成功です。確かめること。

- 3 つの画面（レポート、業者・担当者に聞くこと、PC ごとの結果）が開く。
- 文字化けがない。
- 画像や文字が欠けていない（インターネットにつながっていなくても同じ）。

`{"report":"…/report.html"}` と表示されます。ブラウザを自動で開かせたくないときは、最後に `--no-open` を付けます。

## 5. 日本語と空白が入った保存先でも動くか

```
bash security-checkup/checks/mac/run.sh check --label "テスト 花子" --out "$HOME/Documents/セキュリティ診断/試し/診断 テスト/結果.json"
```

`診断 テスト` フォルダの中に `結果.json` ができれば合格です。

続けて、このフォルダを「社員PC結果」の代わりにして、レポートに取り込めるかも確かめます。

```
bash security-checkup/checks/mac/run.sh report --data tests/fixtures/diagnosis-company.json --outdir "$HOME/Documents/セキュリティ診断/試し/mac-report" --pcs-dir "$HOME/Documents/セキュリティ診断/試し/診断 テスト"
```

`mac-report` の中に `pcs.js` ができ、「PC ごとの結果」のページに、`テスト 花子` の PC が 1 台出れば合格です（見本のデータの PC と並んで出ます）。

## 6. 後片付け

「セキュリティ診断」の中の「試し」フォルダは、確認が終わったら捨てて構いません。「セキュリティ診断」フォルダそのものは、本番でも使うので残して構いません。
