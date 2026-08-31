# Dish Category Manual Image Supply

## 目的

`dish_categories` の画像を、人手で用意した縦長画像に差し替えるための運用画面と、本番反映手順をまとめる。

この画面の責務は「候補カテゴリを表示し、ユーザーが選んだ画像の originalPath を `contribution_tasks` に保存する」ことまで。画像リサイズ、public bucket へのコピー、`wikidata_food_graph.dish_category_images` への反映は、別途本番反映手順で行う。

## 実装場所

`app-expo/app/[locale]/contribution-tasks/dish-category-manual-image-supply.tsx`

## URL パラメータ

未指定時は既存運用を壊さないため v2 を読む。

- `taskVersion`: `v3` または `3` のように指定する。`taskKey` と `cdnJsonPath` が未指定なら、この値から自動生成する。
- `taskKey`: 完全な task key を直接指定する。例: `dish_category_manual_image_supply_v3`
- `cdnJsonPath`: CDN JSON の path を直接指定する。例: `tickets/703/dish_category_manual_image_supply_v3.latest.json`

例:

```text
/ja/contribution-tasks/dish-category-manual-image-supply?taskVersion=v3
```

この指定は以下と等価。

```text
taskKey=dish_category_manual_image_supply_v3
cdnJsonPath=tickets/703/dish_category_manual_image_supply_v3.latest.json
```

## CDN JSON

配置先:

```text
gs://nanitabeyo-public/tickets/703/dish_category_manual_image_supply_vX.latest.json
https://cdn-public.nanitabeyo.net/tickets/703/dish_category_manual_image_supply_vX.latest.json
```

スキーマは direct array。古い `{ "items": [...] }` 形式ではない。

```json
[
	{
		"category_id": "Q164606",
		"category": "カレー",
		"imageUrl": "https://upload.wikimedia.org/wikipedia/commons/1/1e/Indiandishes.jpg",
		"topicTitle": "カレー",
		"reason": "カレーらしさが伝わる、縦長で美味しそうな画像を選んでください"
	}
]
```

各項目の責務:

- `category_id`: `dish_categories.id` / Wikidata QID。送信時の `targetId` になる。
- `category`: グリッド表示名。
- `imageUrl`: 参考画像。手動アップロード対象を示すための表示用で、本番反映される画像 URL ではない。
- `topicTitle`: モーダル表示用タイトル。なければ `category` と同じでよい。
- `reason`: 画像選定の補助文。なければ同系統の候補から自然な文を生成する。

## v3 ファイル作成

ローカル作業用の配置先:

```text
tmp/tickets/703/dish_category_manual_image_supply_v3.latest.json
```

bucket 配置は手動で行う。

```bash
gsutil cp tmp/tickets/703/dish_category_manual_image_supply_v3.latest.json \
  gs://nanitabeyo-public/tickets/703/dish_category_manual_image_supply_v3.latest.json
```

## 手動アップロード手順

この手順の責務は、Canva などで作った画像を private bucket に置き、`contribution_tasks` に「どのカテゴリにどの originalPath を使うか」を登録すること。

### 1. Canva ダウンロード画像のリネーム

`manual_uploaded_category_names` と `target_categories` をブラウザ console などで使い、ダウンロード順の `1.jpg`, `2.jpg` ... を QID 付きファイル名に変換する。

```js
manual_uploaded_category_names
	.map((name) => target_categories.find((y) => y.category === name))
	.filter(Boolean)
	.map((x, i) => `mv ${i + 1}.jpg dish_category_manual_image_supply_t703_${x.category_id}.jpg`)
	.join("\n");
```

### 2. private bucket へ配置

ファイルは以下の prefix に置く。

```text
tickets/703/ayato_manual_uploads/
```

### 3. contribution_tasks へ登録

`TASK_KEY` と `CDN_JSON_PATH` は対象 version に合わせる。v3 なら以下。

```js
const TASK_KEY = "dish_category_manual_image_supply_v3";
const CDN_JSON_PATH = "tickets/703/dish_category_manual_image_supply_v3.latest.json";

manual_uploaded_category_names
	.map((name) => target_categories.find((y) => y.category === name))
	.filter(Boolean)
	.map(
		(x) =>
			`curl -s -X POST \
-H "authorization:Bearer YOUR_TOKEN_HERE" \
-H "Content-Type:application/json" \
-d '{
  "type":"image_feedback",
  "taskKey":"${TASK_KEY}",
  "targetType":"dish_categories",
  "targetId":"${x.category_id}",
  "payload":{
    "cdn":{"path":"${CDN_JSON_PATH}"},
    "reason":"${x.reason}",
    "category":"${x.category}",
    "topicTitle":"${x.topicTitle}",
    "sourceImageUrl":"${x.imageUrl}",
    "source":"ayato_manual_uploads"
  },
  "result":{
    "originalPath":"tickets/703/ayato_manual_uploads/dish_category_manual_image_supply_t703_${x.category_id}.jpg"
  }
}' \
https://api.nanitabeyo.net/v1/contribution-tasks`,
	)
	.join("\n");
```

## 本番反映手順

この手順の責務は、`contribution_tasks.result.originalPath` を起点にして、リサイズ済み public 画像を生成し、BigQuery の `dish_category_images` に CDN URL を登録すること。v ごとに `params.task_key` と `params.public_file_prefix` を変える。

### 1. リサイズ Cloud Tasks を作る

```sql
WITH params AS (
  SELECT
    'dish_category_manual_image_supply_v3' AS task_key,
    1024 AS image_size,
    0.5625 AS aspect_ratio
)
SELECT
  FORMAT(
    '''%s''',
    CONCAT(
      'gcloud tasks create-http-task ',
      'image-resize-', ct.target_id, ' ',
      '--project=food-scroll ',
      '--location=asia-northeast1 ',
      '--queue=image-resize-queue ',
      '--url=https://api.nanitabeyo.net/internal/resize-image ',
      '--method=POST ',
      '--header=Content-Type:application/json ',
      '--oidc-service-account-email=tasks-invoker@food-scroll.iam.gserviceaccount.com ',
      '--oidc-token-audience=https://api.nanitabeyo.net ',
      '--body-content=',
      TO_JSON_STRING(STRUCT(
        'dish_categories' AS `table`,
        'image_url' AS `column`,
        ct.target_id AS recordId,
        params.image_size AS size,
        params.aspect_ratio AS aspectRatio,
        JSON_VALUE(ct.result, '$.originalPath') AS originalPath
      ))
    )
  ) AS command
FROM `food-scroll.nanitabeyo_logs_prod.contribution_tasks` ct
CROSS JOIN params
WHERE ct.task_key = params.task_key
  AND ct.target_type = 'dish_categories'
  AND ct.type = 'image_feedback'
  AND JSON_VALUE(ct.result, '$.originalPath') IS NOT NULL;
```

### 2. resized private から public bucket への copy コマンドを作る

```sql
WITH params AS (
  SELECT
    'dish_category_manual_image_supply_v3' AS task_key,
    'dish_category_manual_image_supply_v3' AS public_file_prefix
),
tasks AS (
  SELECT
    ct.target_id,
    JSON_VALUE(ct.result, '$.originalPath') AS original_path
  FROM `food-scroll.nanitabeyo_logs_prod.contribution_tasks` ct
  CROSS JOIN params
  WHERE ct.task_key = params.task_key
    AND ct.target_type = 'dish_categories'
    AND ct.type = 'image_feedback'
    AND JSON_VALUE(ct.result, '$.originalPath') IS NOT NULL
)
SELECT
  CONCAT(
    'gsutil cp ',
    'gs://nanitabeyo-private/production/resized-image/dish_categories/image_url/',
    target_id,
    '/',
    REGEXP_REPLACE(REGEXP_EXTRACT(original_path, r'([^/]+)$'), r'\.[^.]+$', ''),
    '/1024.webp ',
    'gs://nanitabeyo-public/dish_categories/image_url/',
    target_id,
    '/',
    params.public_file_prefix,
    '-1024.webp'
  ) AS command
FROM tasks
CROSS JOIN params
ORDER BY target_id;
```

### 3. BigQuery `dish_category_images` 反映 SQL を作る

```sql
WITH params AS (
  SELECT
    'dish_category_manual_image_supply_v3' AS task_key,
    'dish_category_manual_image_supply_v3' AS public_file_prefix
),
source_rows AS (
  SELECT
    ct.target_id AS dish_category_id,
    CONCAT(
      'https://cdn-public.nanitabeyo.net/dish_categories/image_url/',
      ct.target_id,
      '/',
      params.public_file_prefix,
      '-1024.webp'
    ) AS image_url,
    'manual' AS source_type,
    CAST(ct.id AS STRING) AS source_ref
  FROM `food-scroll.nanitabeyo_logs_prod.contribution_tasks` ct
  CROSS JOIN params
  WHERE ct.task_key = params.task_key
    AND ct.target_type = 'dish_categories'
    AND ct.type = 'image_feedback'
    AND JSON_VALUE(ct.result, '$.originalPath') IS NOT NULL
)
MERGE `food-scroll.wikidata_food_graph.dish_category_images` T
USING source_rows S
ON T.dish_category_id = S.dish_category_id
   AND T.image_url = S.image_url
WHEN NOT MATCHED THEN
  INSERT (dish_category_id, image_url, source_type, source_ref, score, created_at)
  VALUES (S.dish_category_id, S.image_url, S.source_type, S.source_ref, NULL, CURRENT_TIMESTAMP());
```

## 画面の送信 payload

```json
{
	"type": "image_feedback",
	"taskKey": "dish_category_manual_image_supply_v3",
	"targetType": "dish_categories",
	"targetId": "Q164606",
	"payload": {
		"category": "カレー",
		"topicTitle": "カレー",
		"reason": "カレーらしさが伝わる、縦長で美味しそうな画像を選んでください",
		"sourceImageUrl": "https://upload.wikimedia.org/wikipedia/commons/1/1e/Indiandishes.jpg",
		"cdn": {
			"path": "tickets/703/dish_category_manual_image_supply_v3.latest.json"
		}
	},
	"result": {
		"originalPath": "tickets/703/ayato_manual_uploads/dish_category_manual_image_supply_t703_Q164606.jpg"
	}
}
```

## 注意事項

- `Q1193068`（居酒屋）や `Q30022`（カフェ）のような業態・場所寄りの項目を進める場合も、task key と CDN path を対象 version に揃える。
- この画面で public CDN URL は確定しない。最終 URL は本番反映手順の copy 先と BigQuery MERGE で決まる。
- `taskVersion` だけでなく `taskKey` / `cdnJsonPath` を直接指定できるため、検証時は意図しない version を混ぜないよう URL を確認する。
- `contribution_tasks` は部分成功を許容する。再送時は completed-target-ids によって、同じ `taskKey` で完了済みの `targetId` が候補から除外される。
