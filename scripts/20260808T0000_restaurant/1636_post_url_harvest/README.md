# #1636 SNS 検索ページからの投稿 URL 収集 — 速さの実測

**投稿 URL を何秒で何件集められるかだけを測る。** 集めた URL を自社 DB へどう入れるか
（店の特定・料理カテゴリ・純増率・`add-record` の人力秒数）は**この測定の対象外**で、
あとの PoC で最適化する。

判断に使う数字は Issue [#1636](https://github.com/Ayato-kosaka/nanitabeyo/issues/1636) に置く。
ここにあるのは**再実行の手順と、再現できない実測データ**である。

## なぜ CSV をコミットするのか

SNS のフィードは日々変わるため、**このスクリプトを回し直しても同じ URL は二度と取れない**。
#1273 の運用規律（目視ラベルを `out/*_labels*.json` にコミットする）と同じ理由で、
実測データそのものをリポジトリに残す。

## 収集の手順

`.claude/skills/ec2-chrome-operate` の EC2（実 Chrome）で回す。ローカルのサンドボックスからは
SNS のホストへ出られない（egress proxy が 403 を返す）ので、この経路以外では再現できない。

1. `.claude/skills/ec2-chrome-operate/remote-run.local.sh` を作る（`.gitignore` 済み）。
   検索語・スクロール回数・待ち時間・URL の正規表現はこのファイルの中のプロンプトに書く
2. `bash .claude/skills/ec2-chrome-operate/ec2_exec.sh .claude/skills/ec2-chrome-operate/remote-run.local.sh`
   を **`run_in_background: true`** で起動する（第 2 引数を渡すと権限クラシファイアに落とされる）
3. 標準出力に出た provider ごとの JSON を `harvest/<provider>.json` として保存する

## 時刻の測り方（ここを間違えると数字が無意味になる）

所要時間は**ページ内で実行する JavaScript の `Date.now()`** で取る。
`claude --chrome` の往復時間で測ってはいけない。**LLM の思考時間が入り、
本番の収集器（LLM を挟まない）の見積もりとして過大になる**ため。

各スクロールのあと 3 秒待つ。遅延読み込みを待つ必要があるので
**5 スクロール = 15 秒が下限**であり、総所要のうち動かせない部分としてそのまま読む。

## CSV 化と集計

```bash
python3 build_harvest_csv.py harvest/*.json --collected-at 2026-08-27T10:00:00Z
python3 -m unittest -v test_build_harvest_csv.py
```

`out/post_urls.csv` の列:

| 列 | 中身 |
| --- | --- |
| `provider` | `tiktok` / `instagram` |
| `search_keyword` | 検索語（例: `焼き鳥`） |
| `search_url` | 実際に開いた検索ページの URL |
| `scroll_index` | **その URL が何スクロール目で現れたか**（0 = 初期表示） |
| `post_url` | 投稿 URL |
| `collected_at` | 収集日時 |
