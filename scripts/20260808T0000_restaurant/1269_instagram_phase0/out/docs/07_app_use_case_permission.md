# `instagram_manage_insights` が Graph API Explorer の一覧に出てこなかった理由

調査日: 2026-08-28 / 実行: EC2 上の `claude --chrome`（オーナー本人のブラウザ、アプリ設定の閲覧と権限追加のみ）

## 結論

**アプリのユースケースに、その権限が「未追加」だっただけ。** 一覧には存在していて、「＋追加」ボタンが付いていた。

Graph API Explorer の Permissions 欄は、**アプリのユースケースに追加済みの権限しか出さない**。
`business_discovery` に必須の `instagram_manage_insights` が未追加だったため、Explorer の
ドロップダウンに 5 件（`business_management` / `pages_read_engagement` / `pages_show_list` /
`instagram_basic` / `instagram_content_publish`）しか並ばず、テキスト入力で打っても確定できなかった。

## 場所

```
アプリ 1605989120913742 (nanitabeyo-1273-sns-poc)
└ ユースケース
  └ 「Instagramでメッセージとコンテンツを管理」（use_case_enum=INSTAGRAM_BUSINESS）
    └ カスタマイズ → 「アクセス許可と機能」  ← 権限29件の一覧はここ
```

`instagram_manage_insights` に「追加」を押し、ステータスが **「テスト準備完了」** に変わったこと、
ページ再読み込み後も保持されていることを確認した。**他の権限の削除は一切していない。**

## ついでに分かったこと

- **Instagram 系の追加可能ユースケースは他に無い。** 「ユースケースを追加」ダイアログの全13件に
  Instagram 系は無く、既存の「Instagramでメッセージとコンテンツを管理」が Instagram API 全体を
  カバーしている。「InstagramログインによるAPI設定」と「FacebookログインによるAPI設定」は
  **別ユースケースではなく、このユースケースの中の一節**だった。
- アプリは**未公開（開発モード）**。したがってこの権限が効くのは
  **アプリの管理者・開発者・テスター本人のアカウントだけ**。これは
  [`03_access_review.md`](./03_access_review.md) の Standard Access の記述と一致しており、
  自分のトークンで自分のサーバから叩く今回の使い方では制約にならない。
- ユースケースの権限一覧（29件）には `instagram_business_*` 系（Instagram Login 版）も並んでいるが、
  今回追加したのは Facebook Login 版の `instagram_manage_insights`。`business_discovery` は
  Facebook Login 版専用なのでこちらが正しい（[`02_business_discovery.md`](./02_business_discovery.md) 注記）。

## 残っている手順

**トークンの再発行はオーナーの手で行う必要がある。** EC2 側の `claude` は、Graph API Explorer への
遷移そのものを自身の権限クラシファイアに拒否される（`select_browser` / `navigate` の両方）。
これは「トークンを発行させる」という内容ゆえの拒否で、迂回はしない。
