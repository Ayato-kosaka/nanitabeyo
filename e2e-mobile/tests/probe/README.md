# `tests/probe/` — 「修正が入るまで落ちるのが正しい」spec 置き場（`@probe`）

仕組み（`RUN_PROBE` / `jest.config.js` の除外 / `describeProbe` / `test:probe:*` scripts /
`e2e-mobile-test.yml` の `scope=probe`）は、既定スコープから外したまま明示実行できるようにしてあります。

現在ここにある spec:

| spec                                                                             | 何を確定させるためのものか                                                                                                                                                                                          |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`onboarding-permission-dialog.test.ts`](./onboarding-permission-dialog.test.ts) | #1736。位置情報の権限を `pm revoke` して**本物の OS ダイアログを出し**、その背後に説明画面が描かれているかを実機の絵で見る。Detox は権限を付与済みでインストールするため、通常の spec ではこの瞬間が 1 度も撮れない |

## この層は何のためにあるか

不具合の存在を **エミュレータ上の客観的な数値** で示すための spec を置く場所です。
通常のテストと違い **修正が入るまで赤いまま維持される**のが正しい振る舞いなので、
夜間 CI の既定スコープ（tier1-2）へ混ぜると常時赤くなり、本物の回帰が埋もれます。
そのため Tier 3（`@mutation`）と同じ二重ガードで既定の探索から外しています。

- 設定段（主防御）: `jest.config.js` の `testPathIgnorePatterns` が `tests/probe/` を探索から外す
- コード段（二重ガード）: `fixtures/e2e.ts` の `describeProbe` が `RUN_PROBE !== "1"` なら skip する

`test:android` / `test:all:*` のいずれにも含まれません。実行するときは明示します:

```bash
pnpm --filter e2e-mobile test:probe:android    # CI 相当は test:ci:probe:android
```

## どういうときに使うか

「native では動いていないはずだ」という **疑いはあるが、既存のテストでは緑にしかならない**ときです。
典型的には、アプリ側に観測点（testID を持つカウンタ等）を足して数値を露出させ、
その数値を待つ spec をここへ置きます。使い方:

1. アプリ側へ E2E ビルド限定の観測点を足す（`app-expo/lib/e2e/*` + `metro.config.js` の noop 差し替え
   + `scripts/assert-no-e2e-hook.mjs` への sentinel 登録。本番混入ガードは既存フックと同一方式）
2. `describeProbe("... @probe", ...)` でこのディレクトリへ spec を置き、
   **失敗メッセージに実測値を必ず載せる**（数値が出ないなら probe の意味がない）
3. `scope=probe` で CI を回し、赤い実測値をもって不具合を確定させる
4. **修正が入ったら spec を tier1-2 の適切なディレクトリへ昇格させ、`describeProbe` を `describe` へ戻す**
   （タイムアウトも「落ちる前提の長め」から、修正後の実測に見合う値へ縮めること）

## 前例

`#1087` の先読み画像プローブ。「先読みブロックが 0×0 のため native では 1 枚もロードされていない」
という疑いを `loaded=0/8` という数値で確定させ、修正後は
[`tests/search/preload-images.test.ts`](../search/preload-images.test.ts) の
恒久的な回帰テストへ昇格しました（観測点は `app-expo/lib/e2e/preloadProbe.tsx` に残っています）。
