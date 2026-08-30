# メンテナンス / 強制アップデート

Remote Config で全 API を止める / 古いアプリを弾く仕組みの**運用契約**。
判定ロジックは `api/src/core/guards/maintenance.guard.ts`、
エンドポイントの使い分けは `api/src/health/health.controller.ts` の冒頭コメントを読むこと（そちらが正）。

## 運用者が触る値

Remote Config（スキーマの正は `shared/remoteConfig/remoteConfig.schema.ts`）。

| キー                        | 値                   | 効果                                          |
| --------------------------- | -------------------- | --------------------------------------------- |
| `is_maintenance`            | `"true"` / `"false"` | `"true"` の間、対象 API が **503** を返す     |
| `minimum_supported_version` | SemVer 文字列        | `X-App-Version` がこれ未満なら **426** を返す |

- **反映は即時ではない。** 静的マスターのキャッシュ TTL は 5 分（`static-master.service.ts` の `CACHE_TTL_MS`）
- **`X-App-Version` が無いリクエストは通す。** Web からの呼び出しを巻き込まないため
- **設定が読めないときはフェイルオープン**（通常どおり処理する）。Remote Config の障害で全 API を落とさない
- 除外パスは `/metrics` と `/livez` の 2 つだけ。`/health` は**除外していない**（メンテ中は 503 を返す側）

> **`Env.APP_VERSION` に既定値を入れてはいけない。** 既定値が `minimum_supported_version` を下回ると、
> 全 API が 426 になる。詳しくは [behavior-tracking-logs.md](./behavior-tracking-logs.md) の #1078 の項。

## クライアントへ返る形

```typescript
{ data: null, success: false,
  errorCode: 'SERVICE_MAINTENANCE' | 'UNSUPPORTED_VERSION',
  message: string }
```

受け口は `app-expo/components/HealthCheckInitializer.tsx`（起動時に非同期でチェックし、UI 描画は止めない）と
`app-expo/hooks/useAPICall.ts`（通常の API 呼び出しで 503 / 426 を拾う）。
表示文言は `Error.maintenanceMessage` / `Error.unsupportedVersion` / `Common.goStore` / `Common.ok`。

## 動作確認

```bash
curl -i $API/health                                  # 通常: 200
curl -i $API/health                                  # is_maintenance=true: 503
curl -i -H 'X-App-Version: 0.0.1' $API/v1/...        # 最低バージョン未満: 426
curl -i $API/v1/...                                  # ヘッダー無し: 200（許可される）
curl -i $API/livez                                   # 常に 200（除外パス）
```

設定変更から最大 5 分は古い判定が返る。急ぐ場合は Cloud Run のリビジョンを入れ替えてキャッシュを捨てる。
