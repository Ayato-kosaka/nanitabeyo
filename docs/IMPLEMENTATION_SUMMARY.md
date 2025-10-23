# Google Places 通貨マッピング実装

この実装では、`restaurants` テーブルに Google Places の `address_components` と `plus_code` を保存し、クライアント側で通貨コードを判定できるようにした。

## データベースの変更

### スキーマ更新

- `restaurants` テーブルに `address_components`（jsonb）列を追加
- `restaurants` テーブルに `plus_code`（jsonb）列を追加
- Supabase のデータ型を新フィールドに対応
- Prisma 変換処理を更新し、新フィールドを取り扱い可能に

## APIの変更

### Google Places 連携

- `locations.service.ts` のフィールドマスクに `places.addressComponents` を追加
- `dishes.service.ts` の `bulkImportFromGoogle` を更新し以下を保存:
  - `place.addressComponents` → `restaurant.address_components`
  - `place.plusCode` → `restaurant.plus_code`

## クライアント側の通貨マッピング

### コアライブラリ (`app-expo/lib/googlePlaces.ts`)

以下の通貨マッピング機能を提供。

- **`extractCountryCode(addressComponents)`** — Google Placesのaddress componentsからISO2国コードを抽出
- **`getCurrencyCodeFromCountry(countryCode)`** — 国コードからISO 4217通貨コードを取得
- **`getCurrencyCodeFromAddressComponents(addressComponents)`** — address componentsから通貨コードを判定するメイン関数
- **`getCurrencyCodeFromRestaurant(restaurant)`** — レストランオブジェクトから簡易に通貨を取得するヘルパー

### 対応国/通貨

50以上の国をサポート。

- 主要通貨: USD, EUR, JPY, GBP, CNY, CAD, AUD など
- 地域通貨: KRW, SGD, HKD, TWD, THB など
- EU加盟国は自動的にEURへマッピング
- 未知の国コードは安全側に倒して `null` を返す

### 使用例

```typescript
import { getCurrencyCodeFromRestaurant } from "@/lib/googlePlaces";

const restaurant = {
        address_components: [{ shortText: "JP", types: ["country", "political"] }],
};

const currency = getCurrencyCodeFromRestaurant(restaurant);
// Returns: "JPY"
```

## 主な特徴

1. **データ保持**: Google Places の `address_components` と `plus_code` を完全に保存
2. **保守的なマッピング**: 不明な国コードはマッピングしないことで誤判定を防止
3. **型安全性**: TypeScript で型定義を提供
4. **拡張性**: 対応国を容易に追加可能
5. **エラーハンドリング**: 欠損や不正データでも安全に処理

## 影響

この実装により以下が可能になる。

- レビュー表示で一貫した通貨表記を実現
- レストラン所在地に基づく通貨コードの自動判定
- レストラン位置情報の将来的な分析に活用可能
- 国際的なレビューでも適切な通貨フォーマットをサポート

すべての変更は後方互換性を維持しつつ、新機能を追加している。
