# Dish Category Manual Image Supply Screen

## 概要

料理カテゴリ（dish_categories）の画像をユーザー協力で改善するための単体画面。

## 実装場所

`app-expo/app/[locale]/contribution-tasks/dish-category-manual-image-supply.tsx`

## 主な機能

1. **チュートリアルモーダル**
   - 初回表示時にモーダル表示
   - AsyncStorageでフラグ管理
   - 右上の「？」アイコンからいつでも再表示可能

2. **グリッド表示**
   - 3列固定レイアウト
   - カード比率 9:16
   - 背景に候補画像表示
   - 下部にカテゴリ名をオーバーレイ表示

3. **画像アップロード**
   - `selectMedia` で画像選択
   - `uploadFile` で即座にアップロード
   - 状態バッジで進行状況表示
     - 準備中…（アップロード中）
     - OK！（成功）
     - もう一度！（失敗）

4. **送信処理**
   - 1件ずつPOST `/v1/contribution-tasks`
   - 部分成功許容（失敗分は残して再送可能）

5. **サンクス画面**
   - 未対応候補が残っている場合：「まだ協力できる料理を見る」
   - すべて完了の場合：「画面を閉じる」

## データソース

### CDN JSON

URL: `https://${CDN_PUBLIC_HOST}/tickets/703/dish_category_manual_image_supply_v1.latest.json`

**スキーマ例:**

```json
{
  "items": [
    {
      "targetId": "Q164606",
      "category": "カレー",
      "imageUrl": "https://upload.wikimedia.org/wikipedia/commons/1/1e/Indiandishes.jpg",
      "topicTitle": "カレー",
      "reason": "スパイシーで美味しそうな画像を選んでください"
    }
  ]
}
```

### 完了済み除外API

`GET /v1/contribution-tasks/completed-target-ids`

**クエリパラメータ:**
- `taskKey=dish_category_manual_image_supply_v1`
- `targetType=dish_categories`
- `type=image_feedback`
- `minCount=1`
- `limit=1000`

## ログイベント

以下のイベントが記録されます：

- `dish_manual_image_supply_tutorial_shown` - チュートリアル表示
- `dish_manual_image_supply_help_opened` - ヘルプボタン押下
- `dish_manual_image_supply_item_opened` - カード選択
- `dish_manual_image_supply_upload_started` - アップロード開始
- `dish_manual_image_supply_upload_succeeded` - アップロード成功
- `dish_manual_image_supply_upload_failed` - アップロード失敗
- `dish_manual_image_supply_submit_started` - 送信開始
- `dish_manual_image_supply_submit_result` - 送信結果
- `dish_manual_image_supply_thanks_continue_clicked` - サンクス画面から継続

## テスト方法

1. **開発環境でのテスト:**

```bash
cd app-expo
pnpm start
```

2. **CDN JSONの配置:**

CDN上に以下のパスでJSONファイルを配置：
`tickets/703/dish_category_manual_image_supply_v1.latest.json`

3. **テストデータ例:**

```json
{
  "items": [
    {
      "targetId": "Q164606",
      "category": "カレー",
      "imageUrl": "https://upload.wikimedia.org/wikipedia/commons/1/1e/Indiandishes.jpg",
      "topicTitle": "カレー",
      "reason": "スパイシーで美味しそうな画像を選んでください"
    },
    {
      "targetId": "Q13393",
      "category": "おにぎり",
      "imageUrl": "https://upload.wikimedia.org/wikipedia/commons/2/22/Japanese_rice_balls_%28onigiri%29.jpg",
      "topicTitle": "おにぎり",
      "reason": "ふっくらとした美味しそうなおにぎりの画像を選んでください"
    }
  ]
}
```

4. **手動テストシナリオ:**

   - [ ] 画面を開いたときにチュートリアルモーダルが表示される
   - [ ] チュートリアルを閉じられる
   - [ ] グリッドが3列で表示される
   - [ ] カードをタップすると詳細モーダルが開く
   - [ ] 「画像を選ぶ」をタップして画像を選択できる
   - [ ] アップロード中に「準備中…」バッジが表示される
   - [ ] アップロード成功後に「OK！」バッジが表示される
   - [ ] 送信ボタンが画像セット済み時に有効化される
   - [ ] 送信ボタンを押すと送信処理が開始される
   - [ ] サンクス画面が表示される
   - [ ] 右上の「？」ボタンでチュートリアルを再表示できる

## 技術的な詳細

### 使用コンポーネント

- `useBlurModal` - モーダル表示用フック
- `useLogger` - ログ記録用フック
- `useAPICall` - API呼び出し用フック
- `useFileUploader` - ファイルアップロード用フック
- `selectMedia` - 画像選択用関数
- `PrimaryButton` - プライマリボタンコンポーネント

### 状態管理

ローカルステート管理（Zustandなどのグローバルストアは不要）：

- `items` - 候補アイテムリスト
- `itemStates` - アイテムごとのアップロード状態
- `isLoadingCandidates` - 候補読み込み中フラグ
- `isSubmitting` - 送信中フラグ
- `showTutorial` - チュートリアル表示フラグ
- `showThanks` - サンクス画面表示フラグ
- `selectedItem` - 選択中のアイテム

### エラーハンドリング

- CDN取得失敗 → リトライ導線表示
- completed-target-ids取得失敗 → 除外なしで暫定表示
- アップロード失敗 → 該当カードに「もう一度！」バッジ表示
- 送信失敗 → 失敗分を残して再送可能

## API連携

### POST /v1/contribution-tasks

**リクエスト例:**

```json
{
  "type": "image_feedback",
  "taskKey": "dish_category_manual_image_supply_v1",
  "targetType": "dish_categories",
  "targetId": "Q164606",
  "payload": {
    "category": "カレー",
    "topicTitle": "カレー",
    "reason": "スパイシーで美味しそうな画像を選んでください",
    "sourceImageUrl": "https://upload.wikimedia.org/wikipedia/commons/1/1e/Indiandishes.jpg",
    "cdn": {
      "path": "tickets/703/dish_category_manual_image_supply_v1.latest.json"
    }
  },
  "result": {
    "originalPath": "gs://bucket/uploads/user123/original.jpg"
  }
}
```

## 注意事項

- すべての文言は日本語固定（i18n不要）
- チュートリアル表示フラグはAsyncStorageに保存
- アップロード済みの孤児ファイルはサーバー側Lifecycleで回収
- 送信は1件ずつ順番に実行（部分成功許容）
