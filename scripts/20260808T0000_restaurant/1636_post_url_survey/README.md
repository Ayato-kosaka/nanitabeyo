# #1636 SNS の検索ページに何件の投稿が並ぶかを数える

**人が SNS で「焼き鳥」を検索して画面を下へ送ったとき、投稿の URL がどれだけ並ぶか・
何秒かかるかを数えただけの記録である。** 数えた URL を自社 DB へどう入れるか
（店の特定・料理カテゴリ・純増率・`add-record` の操作時間）は**この記録の対象外**で、
あとの PoC で扱う。

判断に使う数字は Issue [#1636](https://github.com/Ayato-kosaka/nanitabeyo/issues/1636) に置く。
ここにあるのは**やり直すときの手順と、やり直しても同じにはならない実測データ**である。

## なぜ CSV をコミットするのか

SNS の検索結果は日々変わるため、**同じ手順を踏んでも同じ URL は二度と並ばない**。
#1273 の運用規律（目視ラベルを `out/*_labels*.json` にコミットする）と同じ理由で、
そのとき画面に出ていたものをリポジトリに残す。

## やり方

`.claude/skills/ec2-chrome-operate` の EC2 上の Chrome で、**人が開くのと同じ公開ページを開く**。
ローカルのサンドボックスからは SNS のホストへ出られない（egress proxy が 403 を返す）ので、
この経路以外では追試できない。

1. `.claude/skills/ec2-chrome-operate/remote-run.local.sh` を用意する（`.gitignore` 済み）。
   検索語・画面を送る回数・待ち時間・URL の正規表現はこのファイルの中の指示文に書く
2. `bash .claude/skills/ec2-chrome-operate/ec2_exec.sh .claude/skills/ec2-chrome-operate/remote-run.local.sh`
   を **`run_in_background: true`** で起動する（第 2 引数を渡すと権限クラシファイアに落とされる）
3. 標準出力に出た provider ごとの JSON を `raw/<provider>.json` として保存する

### 開くページ

| provider | ページ | 備考 |
| --- | --- | --- |
| TikTok | `tiktok.com/tag/<語>` | タグページ。`tiktok.com/search/video?q=` は毎回 "Something went wrong" のエラー画面になり、TikTok 自身も `robots.txt` でこの経路を案内していない |
| Instagram | `instagram.com/explore/search/keyword/?q=<語>` | ログイン済みのプロフィールで開いた。**ログイン操作はしない** |

## つまずいた点（次にやる人が同じところで止まらないように）

| 現象 | 原因 | 対処 |
| --- | --- | --- |
| Instagram で画面を送っても 1 件も増えない | **`window.scrollTo` が効かない**。`scrollTop` が 1 回動いたきり固まり、`scrollHeight` も伸びない | ブラウザの画面操作（scroll / End キー）で送る。実測で 24 件 → 177 件まで並んだ |
| 結果の JSON が途中で切れる | SSM の標準出力は約 24,000 文字が上限 | ブラウザ側で `window.__h` に貯め、`slice(0,100)` ずつ取り出す。それでも切れたら `raw/repair_truncated.py` で**落ちた件数を明記して**閉じ直す（黙って件数を減らさない） |

**画面が送れたかは必ず数字で確認する。** `steps[].moved` と `scrollHeight` が動いていないのに
`cumulative` が横ばいなのを「そのサイトはそれ以上並べない」と読むと、実際には
こちらの操作が効いていないだけ、ということが起きた（Instagram の 1 回目がこれ）。

## 時刻の測り方（ここを間違えると数字が無意味になる）

所要時間は**ページ内で実行する JavaScript の `Date.now()`** で取る。
`claude --chrome` の往復時間で測ってはいけない。**LLM の思考時間が入り、
画面を送るのにかかった実時間より大きく出る**ため。

画面を送るたびに 3 秒待つ。遅れて描画されるのを待つ必要があるので
**5 回送れば 15 秒が下限**であり、総所要のうち動かせない部分としてそのまま読む。

## CSV 化と集計

```bash
python3 build_post_url_csv.py raw/*_run2.json --collected-at 2026-08-27T10:50:00Z
python3 -m unittest -v test_build_post_url_csv.py
```

`out/post_urls.csv` の列:

| 列 | 中身 |
| --- | --- |
| `provider` | `tiktok` / `instagram` |
| `search_keyword` | 検索語（例: `焼き鳥`） |
| `search_url` | 実際に開いた検索ページの URL |
| `scroll_index` | **その URL が何回目に画面を送ったところで現れたか**（0 = 初期表示） |
| `post_url` | 投稿 URL |
| `collected_at` | 数えた日時 |
