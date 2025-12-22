# Location Address 仕様変更（#533）

## 概要

位置情報の `address` 生成ロジックを、従来の表示用文字列（`"Kyoto, Japan"`）から、**type-based な正規化形式**（`"country:JP, locality:Kyoto"`）へ対応を追加。

### 変更内容

- **後方互換性を維持**：既存の `address` フィールド（表示用文字列）はそのまま維持
- **新フィールド追加**：`addressComponents` フィールドを追加し、type-based な正規化形式を提供
- **レコメンド対応**：料理カテゴリ推奨 API（#533）向けに正規化形式を使用

## 仕様

### API レスポンス形式

#### LocationDetailsResponse / LocationReverseGeocodingResponse

```typescript
{
  location: {
    latitude: number;
    longitude: number;
  },
  viewport: { ... },

  // 表示用住所（後方互換性のため維持）
  address: string;  // 例: "Kyoto, Kyoto Prefecture, Japan"

  // type-based 正規化形式（#533 レコメンド用）
  addressComponents: {
    country?: string;                    // 例: "JP"
    administrative_area_level_1?: string; // 例: "Kyoto"
    locality?: string;                    // 例: "Kyoto"
    sublocality?: string;
    postal_code?: string;
    // ... その他の type
  },

  localLanguageCode: string;
}
```

### 正規化ロジック

#### API 側（LocationsService.buildNormalizedAddressComponents）

Google Places API の `addressComponents` を以下のルールで正規化：

1. **type 優先順位**：
   - `country` > `administrative_area_level_1` > `locality` > `sublocality` > `postal_code` > ...
2. **値の選択**：
   - `shortText` を優先（例：国コード `"JP"`）
   - `shortText` がない場合は `longText` にフォールバック
3. **複数 type の処理**：
   - component が複数の type を持つ場合、優先順位が最も高い type を採用
   - 例：`["country", "political"]` → `country` を採用

4. **重複の防止**：
   - 同じ type が複数出現した場合、最初のものを採用

#### フロントエンド側（formatNormalizedAddress）

正規化された `addressComponents` を文字列に変換：

```typescript
// Input
{
  country: "JP",
  administrative_area_level_1: "Kyoto",
  locality: "Kyoto"
}

// Output
"country:JP, administrative_area_level_1:Kyoto, locality:Kyoto"
```

### 利用箇所

#### 表示用（address フィールド）

- UI での住所表示
- ログ・分析での可読性が必要な箇所

#### 正規化形式（addressComponents フィールド）

- **料理カテゴリ推奨 API**（`/v1/dish-categories/recommendations`）
  - Claude API への入力として使用
  - 地域ベースのレコメンド生成に利用

## 実装例

### API 実装

```typescript
// LocationsService.ts
private buildNormalizedAddressComponents(
  addressComponents: IAddressComponent[]
): Record<string, string> {
  const normalized: Record<string, string> = {};

  const typePriority = [
    'country',
    'administrative_area_level_1',
    'locality',
    'sublocality',
    'postal_code',
    // ...
  ];

  for (const component of addressComponents) {
    const value = component.shortText || component.longText;
    if (!value) continue;

    // 優先順位が最も高い type を選択
    let selectedType = null;
    let highestPriority = Infinity;

    for (const type of component.types) {
      const priority = typePriority.indexOf(type);
      if (priority !== -1 && priority < highestPriority) {
        highestPriority = priority;
        selectedType = type;
      }
    }

    if (selectedType && !normalized[selectedType]) {
      normalized[selectedType] = value;
    }
  }

  return normalized;
}
```

### フロントエンド実装

```typescript
// useTopicSearch.ts
import { formatNormalizedAddress } from "@/utils/addressNormalization";

const topicsResponse = await callBackend<QueryDishCategoryRecommendationsDto, QueryDishCategoryRecommendationsResponse>(
	"v1/dish-categories/recommendations",
	{
		method: "GET",
		requestPayload: {
			// addressComponents を type:value 形式に変換
			address: params.addressComponents ? formatNormalizedAddress(params.addressComponents) : params.address, // フォールバック
			timeSlot: params.timeSlot,
			// ...
		},
	},
);
```

## テスト

### API 単体テスト

`api/src/v1/locations/locations.service.spec.ts` に以下をテスト：

- 日本の住所で `country: "JP"` が取得できること
- `shortText` 優先、`longText` へのフォールバック
- 複数 type を持つ component の優先順位選択
- `postal_code` がない場合の処理
- 空の配列や無効な component の処理
- 統合テスト（`getLocationDetails` / `getReverseGeocoding`）

### 動作確認

以下のロケーションで動作確認を推奨：

- **日本（Kyoto/Tokyo）**：`country: "JP"` の確認
- **英語圏（US）**：`country: "US"` の確認
- **住所が細かい場所**：複数階層の確認
- **postal_code がない場所**：フォールバック確認

## マイグレーション

### 既存コードへの影響

- **破壊的変更なし**：既存の `address` フィールドはそのまま維持
- **新フィールド追加**：`addressComponents` は optional として追加
- **後方互換性**：古いクライアントは `addressComponents` を無視可能

### 推奨移行手順

1. API をデプロイ（新旧両フィールドを返す）
2. フロントエンドで `addressComponents` 利用開始
3. 一定期間後、`address` フィールドの利用状況を確認
4. 必要に応じて `address` の生成ロジック簡素化（将来的な最適化）

## 関連リンク

- Issue: #533（レコメンド実装）
- Google Places API: [Address Components](https://developers.google.com/maps/documentation/places/web-service/place-data-fields#address_components)
- ISO 3166-2: [国・地域コード](https://en.wikipedia.org/wiki/ISO_3166-2)

## 補足

### Claude API への入力形式

レコメンド生成時、Claude API には以下の形式で送信：

```
Address: country:JP, administrative_area_level_1:Kyoto, locality:Kyoto
Time slot: lunch
Scene: date
```

この形式により、地域に特化した料理カテゴリ推奨が可能になる。

### ログ・分析での利用

- **表示用ログ**：`address` フィールド（可読性重視）
- **集計・分析**：`addressComponents.country` など（正規化重視）
