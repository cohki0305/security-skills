# 指示書: Mac にセキュリティ診断スキルの最新版を入れる

Mac で動く Claude Code に渡す指示書です。読み手は、このリポジトリについて何も知らない前提で書いています。

## 背景

このリポジトリの `security-checkup/` フォルダが、Claude Code のスキル本体です。`~/.claude/skills/security-checkup` に置くと、Claude Code に「セキュリティ診断をしたい」と話しかけたときに使われます。

この作業では、GitHub にある最新の版をこの Mac に入れます。すでに古い版が入っていれば、入れ替えます。

- リポジトリ: GitHub の private リポジトリ（名前は、この指示書を渡すときに利用者が伝える。main ブランチが最新）
- 置き場所: リポジトリは `~/security-skills`、スキルは `~/.claude/skills/security-checkup`
- 作業量の目安: 5〜10 分

## 作業ルール

1. **Mac の設定を変えない。** `sudo` を使わない。管理者のパスワードを求められたら、入力せずに止めて利用者に知らせる。
2. **コードを直さない。commit も push もしない。** 入れるだけにする。
3. **消す前に利用者に聞く。** 古いスキルのフォルダは消さずにゴミ箱へ移す。`~/Documents/セキュリティ診断`（これまでの診断結果）には触らない。
4. 利用者への説明は日本語で、専門用語を避けて書く。ユーザー名やホームフォルダのパスを報告に書かない。

---

## Task 1【必須】GitHub に入れるか確かめる

```
gh auth status
```

- `Logged in to github.com` と出れば次へ進む。
- `gh` がない、またはログインしていないと出たら、止めて利用者に知らせる。ログインは利用者が自分で `gh auth login` を実行する。パスワードやトークンを代わりに入力しない。

**検証**: `gh auth status` がログイン済みと出ること。

## Task 2【必須】リポジトリを最新にする

`~/security-skills` があるかで分ける。

**ない場合**は、利用者から伝えられたリポジトリ名で取ってくる。

```
gh repo clone 〔リポジトリ名〕 ~/security-skills
```

**ある場合**は、まず手元で書き換えた跡がないか見る。

```
git -C ~/security-skills status --short
```

何か出たら、止めて利用者に見せる。手元の変更を消すコマンド（`git reset --hard`、`git checkout .`、`git clean` など）は使わない。何も出なければ、main を最新にする。

```
git -C ~/security-skills switch main
git -C ~/security-skills pull --ff-only
```

`pull --ff-only` が失敗したら、止めて出力を利用者に見せる。

最後に、いまの版を控える。

```
git -C ~/security-skills log --oneline -1
```

**検証**: `git -C ~/security-skills status -sb` の 1 行目が `## main...origin/main` だけで、`ahead` も `behind` も付いていないこと。

## Task 3【必須】スキルを入れ替える

古い版があるか見る。

```
ls -la ~/.claude/skills/
```

`security-checkup` があれば、ゴミ箱へ移してよいか利用者に聞く。よいと言われたら移す。

```
mv ~/.claude/skills/security-checkup ~/.Trash/security-checkup-old-$(date +%Y%m%d%H%M%S)
```

上書きコピーで済ませない理由：`cp -R` は、古い版にだけあったファイルを残したまま新しい版を重ねる。消えたはずのファイルが残ると、どの版で動いているのかわからなくなる。また、控えを `~/.claude/skills/` の中に置くと、同じ名前のスキルが 2 つ読み込まれる。だから控えはゴミ箱へ移す。

`security-checkup` が symlink（`ls -la` で `->` が付いている）なら、移さずに利用者に知らせて止める。どこかのフォルダを直接使う設定になっているため、入れ替え方を利用者が決める。

新しい版を置く。

```
mkdir -p ~/.claude/skills
cp -R ~/security-skills/security-checkup ~/.claude/skills/
```

**検証**: 次の 2 つを実行する。

```
diff -r ~/security-skills/security-checkup ~/.claude/skills/security-checkup && echo 同じ
ls -l ~/.claude/skills/security-checkup/checks/mac/run.sh
```

1 つ目で `同じ` だけが出ること。2 つ目で、先頭が `-rwx` のように `x`（実行してよい印）が付いていること。

## Task 4【必須】利用者に伝える

次のことを、利用者に日本語で伝える。

1. 入れた版（Task 2 で控えた 1 行。例：`c44bb62 Merge pull request #4 ...`）
2. 古い版をゴミ箱へ移したかどうか
3. **新しいターミナルで Claude Code を起動し直すこと。** 今のセッションには古い版（または何もない状態）が読み込まれたままになっている
4. 起動し直したら「PC の診断をしたい」または「会社のセキュリティ診断をしたい」と話しかければ始まること
5. これまでの診断結果（`書類` の中の `セキュリティ診断` フォルダ）は消していないこと

**検証**: 上の 5 点を伝えたこと。

## スコープ外（この作業ではやらない）

- 診断を実際に走らせること: 確かめ方は `docs/mac-claude-instructions.md` にある。頼まれたらそちらに進む
- テスト（`bun test`）の実行: Linux で通っている。Mac に bun を入れる必要はない
- コードや手順書の修正、commit、push: 直す担当者は別にいる
- `~/Documents/セキュリティ診断` の整理や削除

## 完了条件

```
git -C ~/security-skills status -sb
diff -r ~/security-skills/security-checkup ~/.claude/skills/security-checkup && echo 同じ
```

- 1 つ目が `## main...origin/main` だけ、2 つ目が `同じ`
- `~/.claude/skills/` の中に `security-checkup` が 1 つだけある（古い版の控えが中に残っていない）
- 利用者に Task 4 の 5 点を伝えた
