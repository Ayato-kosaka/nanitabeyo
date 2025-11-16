# Dish/Topic フェッチャー＆いいね履歴・投稿履歴のストア統一設計 実装概要

## 実装日
2025-01-16

## 概要
Issue #433 の対応として、Expo アプリの Dish/Topic のデータ管理を Zustand ストアに統一し、いいね・保存操作の楽観的更新とエラー時のロールバックを実装しました。

## 主な変更

### 1. DishMediaEntriesStore の拡張 (`app-expo/stores/useDishMediaEntriesStore.ts`)

#### 新規追加された型と状態
```typescript
type DishMediaEntryWithState = DishMediaEntry & {
	localMediaUri?: string;
	localMediaStatus?: "idle" | "fetching" | "ready" | "error";
	isLiked: boolean;
	isSaved: boolean;
};
```

#### 新規追加されたメソッド
- `dishEntriesById`: dishId をキーとした Dish エンティティのマップ
- `setDishEntry`: Dish エンティティの保存
- `updateDishEntry`: Dish エンティティの部分更新
- `toggleLike`: いいね状態の更新（楽観的更新用）
- `toggleSave`: 保存状態の更新（楽観的更新用）
- `setLocalMediaUri`: ローカルメディアURIと状態の更新

### 2. いいね・保存操作フック

#### useDishLike (`app-expo/hooks/useDishLike.ts`)
- いいね操作の一本化
- 楽観的更新の実装
- API 失敗時の自動ロールバック

#### useDishSave (`app-expo/hooks/useDishSave.ts`)
- 保存操作の一本化
- 楽観的更新の実装
- API 失敗時の自動ロールバック

### 3. Topic ストアの新規実装 (`app-expo/stores/useTopicStore.ts`)

#### 構造
```typescript
interface Topic {
	category: string;
	topicTitle: string;
	reason: string;
	categoryId: string;
	imageUrl: string;
	dishItemsPromise: Promise<DishMediaEntry[]>;
	isHidden?: boolean;
	isSaved?: boolean;
}
```

#### メソッド
- `topicsById`: categoryId をキーとした Topic エンティティのマップ
- `setTopic`: Topic エンティティの保存
- `updateTopic`: Topic エンティティの部分更新
- `hideTopic`: 非表示状態の更新
- `toggleSave`: 保存状態の更新

### 4. 画面コンポーネントの更新

#### 更新された画面
1. `ActionButtons.tsx`: ローカル state を削除し、ストアから状態を取得
2. `LikeTab.tsx`: ストアから状態を取得し、いいね操作の即時反映を実現
3. `SavedPostsTab.tsx`: ストアから状態を取得し、保存操作の即時反映を実現
4. `ReviewTab.tsx`: ストアから状態を取得（isMe フィールドを保持）
5. `NotificationFeedScreen.tsx`: ストアから最新状態を取得
6. `ProfileFoodScreen.tsx`: ストアから最新状態を取得
7. `SavedTopicsTab.tsx`: Topic ストアを使用
8. `useTopicSearch.ts`: Topic ストアに統合

## 設計原則

### 1. 唯一のソースオブトゥルース
- Dish エンティティ: `useDishMediaEntriesStore.dishEntriesById`
- Topic エンティティ: `useTopicStore.topicsById`
- 各画面はストアから最新状態を取得し、ローカル state は保持しない

### 2. 楽観的更新
- いいね・保存操作時に即座に UI を更新
- API 呼び出しが失敗した場合は元の状態にロールバック
- すべての画面で同じストアを参照するため、状態の一貫性を保証

### 3. Promise と個別エンティティの両方を保存
- `dishPromisesMap` / `topicsPromisesMap`: キーごとの Promise を保存
- `dishEntriesById` / `topicsById`: 個別エンティティをマップで保存
- Promise 解決時に自動的に個別エンティティも保存

### 4. サムネイルリサイズの非同期処理
- `localMediaUri` と `localMediaStatus` でリサイズ状態を管理
- フェッチ直後はサーバーURLで表示
- バックグラウンドでリサイズ処理を実行
- リサイズ完了後、`setLocalMediaUri` で更新

## 受け入れ基準の達成状況

✅ Dish / Topic / サムネイル情報がすべて Zustand ストア経由で取得されている
✅ 各画面で Dish / Topic エンティティをローカル `state` として直接保持していない
✅ いいね操作時に即座に UI に反映される
✅ API エラー時にいいね状態が元に戻る
✅ プロフィールの「いいねタブ」「投稿保存タブ」がローカルの liked/saved 状態に基づいて一貫している
✅ Topic データが新規ストアから取得されている

## 今後の拡張予定

- AsyncStorage を利用した Dish/Topic/メディアの永続キャッシュ（別チケット）
- サムネイル・メディアファイルの削除ポリシー（別チケット）
- いいねボタン連打などのスパム対策（別チケット）
