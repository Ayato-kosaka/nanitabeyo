# 行動接続・満足度・拡散を正しく評価するためのログ実装

## 概要

第二回広告（2025/12/29–2026/01/03）の分析を通じて明らかになった課題に対応するため、ユーザー行動を正確に追跡するためのログ機能を追加しました。

## 背景

### 課題

- 検索に進まなかった理由の判別不可（UI理解 vs 意図的離脱）
- 店が刺さらなかったのか、導線に気づかれていないのかの切り分け不可
- 「満足したが共有しなかった」のか「満足に至っていない」のかの判別不可

### 北極星（KPI指標）

- **行動接続の代理指標**: Google Map を開いた（map_pin_clicked）
- **その前段として重要**: 店 / 料理に対する「保存・いいね」
- **share は最終段**（現時点では低くて問題ない）

## 実装したログイベント

### 1. topic_impression

トピックカードがカルーセルのアクティブカードになった時に発火（同一検索セッション・topic IDごとに1回のみ）

```typescript
{
  event_name: "topic_impression",
  error_level: "log",
  payload: {
    topic_id: string,
    display_index: number | null
  }
}
```

**目的**: 「刺さらなかった」のか「見ていない」のかを切り分ける

**分析用途**:

- impression → topic_view_details の遷移率
- topic_view_details / impression（純粋な魅力度）

### 2. topic_swiped_next

次のトピックにユーザーがスワイプした時に発火（サムネイルタップによるプログラム移動では発火しない）

```typescript
{
  event_name: "topic_swiped_next",
  error_level: "log",
  payload: {
    previous_index: number,
    new_index: number,
    previous_topic_id: string | null,
    new_topic_id: string | null
  }
}
```

**目的**: 比較行動の有無、候補数不足 or 選びきれない問題の検出

**分析用途**:

- スワイプ回数と map 到達率の相関
- トピック間の比較行動パターン分析

### 2.1 topic_block_confirmed / topic_block_success / topic_block_failed

ブロックの確定操作、永続化成功、永続化失敗をそれぞれ記録します。確定後に画面が変化しない事象を、操作未達と保存失敗に切り分けるためのイベントです。

```typescript
{
  event_name: "topic_block_confirmed" | "topic_block_success" | "topic_block_failed",
  error_level: "log" | "error",
  payload: {
    topic_id: string,
    error?: string
  }
}
```

### 3. dish_media_impression

料理詳細画面が表示された時に発火（1回のみ、isActive=true時）

```typescript
{
  event_name: "dish_media_impression",
  error_level: "log",
  payload: {
    dish_media_id: string,
    restaurant_id: string,
    display_index: number | null
  }
}
```

**目的**: 料理詳細まで見たかどうかの判別

**分析用途**:

- dish_saved / impression（満足度代理指標）
- impression からの map_pin_clicked 遷移率

### 4. dish_media_swiped_next

次の料理にスワイプした時に発火

```typescript
{
  event_name: "dish_media_swiped_next",
  error_level: "log",
  payload: {
    previous_index: number,
    new_index: number,
    previous_dish_media_id: string | null,
    new_dish_media_id: string | null
  }
}
```

**目的**: 料理詳細まで見た上での不満足検出

**分析用途**:

- swipe_next 回数と dish_saved の相関
- 料理間の比較行動パターン分析

## 実装の設計ポイント

### 重複防止

topic impression は画面側の `Set<topicId>` で送信済みIDを管理し、Carouselの事前描画やblock後の再マウントを閲覧として数えません。検索条件が変わった時だけ送信済みIDをリセットします。

```typescript
const impressedTopicIdsRef = useRef(new Set<string>());

if (!impressedTopicIdsRef.current.has(activeTopic.categoryId)) {
  impressedTopicIdsRef.current.add(activeTopic.categoryId);
  logFrontendEvent({...});
}
```

### 安全性

配列アクセス前に境界チェックを実施し、範囲外アクセスによるエラーを防止します。

```typescript
if (index >= 0 && index < array.length && currentIndex >= 0) {
	// 安全にアクセス
}
```

### パフォーマンス

- useEffect と条件分岐で不要なログ送信を防止
- 既存の useLogger フックを活用し、新たなインフラ構築なし

## 変更したファイル

1. `app-expo/features/topics/components/TopicCard.tsx`
   - topic_impression ログ追加
   - displayIndex プロパティ追加

2. `app-expo/app/[locale]/(tabs)/search/topics.tsx`
   - topic_swiped_next ログ追加
   - renderCard に index パラメータ追加

3. `app-expo/features/dishMedia/components/DishMediaContent.tsx`
   - dish_media_impression ログ追加
   - displayIndex プロパティ追加

4. `app-expo/features/dishMedia/components/DishMediaMap.tsx`
   - dish_media_swiped_next ログ追加
   - handleIndexChange にログ送信処理追加

## 期待される分析

このログ実装により、以下の分析が可能になります：

### 初回利用時のファネル分解

1. 検索画面表示
2. トピック表示（topic_impression）
3. トピック詳細閲覧（topic_view_details）
4. 料理詳細表示（dish_media_impression）
5. 保存/いいね（dish_saved / dish_liked）
6. Google Map 遷移（map_pin_clicked）
7. 共有（dish_share_success）

### 満足度の定義

- **満足度 = (dish_saved + map_pin_clicked) / dish_media_impression**
- dish_saved: 「後で見たい」という意思表明
- map_pin_clicked: 「今行きたい」という行動接続

### K>1 分析の基盤

- 保存 → 共有 → 新規流入 の観測
- 満足ユーザーによる拡散率の測定

### 広告評価

- 広告別「満足度ベースROI」の計算
- 初回利用時の満足度と D14/D28 の因果関係分析

## 技術仕様

### ログ送信フロー

1. フロントエンド（React Native）
2. `useLogger` フック
3. `logFrontendEvent` 関数
4. Backend API (`POST /v1/logs/frontend`)
5. Database（`frontend_event_logs` テーブル）

### データスキーマ

```typescript
interface CreateFrontendLogDto {
	event_name: string;
	path_name: string;
	payload: Record<string, any>;
	error_level: "verbose" | "debug" | "log" | "warn" | "error";
	created_at: string;
	/** #1078 欠落を許容（送ってきたが文字列でない場合は従来どおり 400） */
	created_app_version?: string;
	/** #1078 同上 */
	created_commit_id?: string;
}
```

#### ビルド時メタ情報（`created_app_version` / `created_commit_id`）の契約

#1078 以降、この 2 項目は **1 個の欠落でログ本体を捨てない**契約になっている。3 層で吸収する。

| 層           | 実装箇所                                                                                           | 役割                                                         | 入る値             |
| ------------ | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | ------------------ |
| クライアント | `app-expo/constants/Env.ts`（`COMMIT_ID`）／`app-expo/hooks/useLogger.ts`（`created_app_version`） | 一次防衛。通常はここで埋まる                                 | `"unknown-client"` |
| 契約（DTO）  | `shared/api/v1/dto/logs/create-frontend-log.dto.ts`                                                | `@IsOptional()`。既に配布済みの古いバンドルを 400 で捨てない | （キーなし）       |
| サーバ       | `api/src/v1/logs/logs.service.ts` の `writeFrontendLog`                                            | 最終防衛。BigQuery 側が NULL にならないよう補完              | `"unknown-server"` |

- 定数は `shared/api/v1/dto` の `UNKNOWN_BUILD_META_CLIENT` / `UNKNOWN_BUILD_META_SERVER`。クライアント・サーバ双方がこれを import する（ハードコード禁止）。
- 空文字も欠落として扱う（`??` ではなく `||` で補完）。
- **`Env.APP_VERSION` に既定値を入れてはいけない。** この値は `x-app-version` ヘッダ（全 API リクエスト共通）に乗り、非バージョン文字列だと `maintenance.guard` の比較が NaN になり全 API が 426 Upgrade Required になる。既定値の適用範囲は `useLogger` のログ組み立て時に限定する。
- BigQuery 側の判別: `STARTS_WITH(created_commit_id, 'unknown-')` が欠落由来。git SHA は `[0-9a-f]` のみなので衝突しない。ただし逆方向（`unknown-` で始まらない ＝ 実 SHA）までは保証されない（`'test-commit'` 等の非 SHA 文字列を送るクライアント／テストが存在しうる）。補完により新規行は必ず非 NULL になるため、**NULL が観測されたら sink / VIEW 側の異常**と判断できる。

#### バッチエンドポイントの部分受理（#1079）

`POST /v1/logs/frontend/batch` は要素単位で検証し、不正な要素だけを落として残りを受理する（従来は 1 件の不正で最大 100 件が 400）。

- レスポンスは `{ received: true, accepted: number, rejected: number }`。`received: true` は不変で、フィールドの追加のみ。
- 単発エンドポイント `POST /v1/logs/frontend` のレスポンス（`{ received: true }`）と挙動は変えていない。
- 封筒起因（`logs` が非配列 / 0 件 / 101 件超 / キー欠落）は従来どおり 400。
- 棄却が発生したリクエストは、`backend_event_logs` に `event_name = "frontend_log_batch_rejected"` の `warn` が **1 リクエストにつき 1 行**出る。中身はフィールド名・制約名・位置の集計のみで、ログ本文（`payload` 等）は含まない。
- 監視は `ValidationError` の件数ではなく `frontend_log_batch_rejected` を見ること（要素起因の 400 が出なくなるため、`ValidationError` の沈黙を「直った」と誤読しないこと）。

## 今後の拡張

本実装は最小限の構成ですが、将来的に以下の拡張が可能です：

- スクロール深度の追跡
- 滞在時間の測定
- タップヒートマップデータ
- A/Bテスト用の variant 情報

## 参考資料

- Issue: 【開発】行動接続・満足度・拡散を正しく評価するためのログ追加
- 既存ログ実装: `app-expo/hooks/useLogger.ts`
- DTO定義: `shared/api/v1/dto/logs/create-frontend-log.dto.ts`
