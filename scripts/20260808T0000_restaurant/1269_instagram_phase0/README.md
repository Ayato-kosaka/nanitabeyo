# #1269 Phase 0 — Meta API / 権利・技術成立性の確認

Issue: https://github.com/Ayato-kosaka/nanitabeyo/issues/1269

サンドボックスからは `developers.facebook.com` も `instagram.com` も proxy に 403 で塞がれているため、
一次資料の取得と Instagram プロフィールの目視は **`.claude/skills/ec2-chrome-operate`（EC2 上の
`claude --chrome`）経由**で行った。再現するときも同じ経路を使う。

## 中身

| パス | 何か |
| --- | --- |
| `out/docs/*.md` | developers.facebook.com の一次資料。**原文の逐語引用＋日本語1行**の形で保存してある |
| `out/handles_labeled.json` | プロアカウント率を測るための標本 31 件。帰属ラベル（店固有 / チェーン / 別主体）付き |
| `out/prof_raw.txt` | EC2 上の `claude --chrome` が実際に吐いた `PROF:` 行（生ログ） |
| `out/professional_rate.json` | 上を集計したもの。`parse_prof.py` の出力 |
| `out/instagram_capability_matrix.json` | Issue 本文が Phase 0 の成果物として指定している capability matrix |

## 集計しなおす

```bash
python3 scripts/20260808T0000_restaurant/1269_instagram_phase0/parse_prof.py \
  scripts/20260808T0000_restaurant/1269_instagram_phase0/out/prof_raw.txt
```

## 数字を読むときの注意

`professional_rate.json` の値は **下限**である。デスクトップ Web の Instagram は連絡先ボタンを描画せず、
カテゴリ表記もアカウント側で非表示にできるため、プロアカウントを「非プロ」と誤判定する向きにしか外れない。
確定値は API（`business_discovery` が何も返さない＝非プロ）でしか取れない。
