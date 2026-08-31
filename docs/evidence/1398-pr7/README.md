# #1398 (PR7/7) 食べたライフサイクル E2E の証跡

`e2e-web` を `api-development`（Cloud Run）に対して実行したときのスクリーンショット。
撮影は各 spec の `captureEvidence()`（`e2e-web/utils/eatenLifecycle.ts`）で、
`E2E_EVIDENCE_DIR` を指定して実行すると再取得できる。

```bash
pnpm --filter app-expo build:web
cd e2e-web && RUN_MUTATION=1 E2E_EVIDENCE_DIR=/tmp/claude-artifacts \
  npx playwright test tests/authenticated/review-no-photo.spec.ts \
                      tests/authenticated/feed-record-eaten.spec.ts \
                      tests/authenticated/my-dishes-want-to-eaten.spec.ts \
                      --project=desktop-chrome-authenticated
```

## なぜリポジトリに置いているか

証跡は本来 `evidence-collect.yml` が公開バケット（`nanitabeyo-public`）へ上げるが、
このワークフローは Artifact を持つ workflow run を入力にとる。ローカル実行の
スクリーンショットを **PR 本文へ Markdown 画像として貼る**には URL が要るため、
ここへ置いて `raw.githubusercontent.com` から参照している。

| ファイル                           | 何の証跡か                                                                                                                             | 実行状況                                                                                                             |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `no-photo-form.png`                | ピッカーをキャンセルしても画面が閉じず、「写真を追加 / 写真なしでも記録できます」のプレースホルダ付きでフォームに留まる（Q2・②の前半） | 実 API で成功                                                                                                        |
| `no-photo-back-exit.png`           | その状態から `ScreenHeader` の戻るで店舗詳細へ退出できる（Q2 の必須条件）                                                              | 実 API で成功                                                                                                        |
| `feed-eaten-review-from-media.png` | 全画面 Feed の「食べた」→ `review-from-media`（料理カテゴリは確定済みで行が disabled）                                                 | 実 API で成功                                                                                                        |
| `feed-eaten-posted.png`            | 投稿成功のスナックバーと `/post/[id]` への遷移                                                                                         | 実 API で成功                                                                                                        |
| `want-card-cta-mocked.png`         | 一覧の「食べたい」カードにだけ「食べたを記録」CTA が出る（「食べた」カードには出ない）                                                 | **`GET /v1/users/me/dishes` をモックした確認**。同 API が api-development へ未デプロイのため実データでは撮れていない |
| `want-to-eaten-after-mocked.png`   | 記録した料理が「食べた」になり CTA が消え、もう 1 品の「食べたい」だけが CTA を持つ（①の見え方）                                       | 同上（`GET /v1/users/me/dishes` のみモック。レビュー投稿自体は実 API）                                               |

末尾 2 枚だけは実データではない。理由と再開手順は PR 本文を参照。
