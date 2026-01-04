# Map Marker Bitmap Implementation

## 概要

このドキュメントは、Map ピン（AvatarBubbleMarker）を bitmap icon 方式へ移行した実装の詳細を記載しています。

## 問題の背景

### Android で発生していた問題

1. **円形崩れ** - 店舗ピン（アバター）が円形ではなく扇形や欠けた形で表示される
2. **ちらつき** - state/region 更新に連動して Marker がちらつく

### 原因

Google Maps（Android）での **View Marker（Marker children）→ Bitmap化** の過程で、`borderRadius` / `overflow: hidden` / alpha合成が端末/GPU依存で破綻し、円形クリップが欠ける。

## 解決策

### View Marker 廃止 → bitmap icon 方式

- `Marker` に children を渡さず、`icon` プロパティに **ローカル PNG（file://）** を渡す
- PNG は **オフスクリーンで1回生成 → キャッシュ**し、以降再利用
- アクティブ/非アクティブは「2種類の bitmap」で吸収

## 実装構成

### 1. BubblePinBitmap.tsx

オフスクリーン描画用のピンコンポーネント。

- RN標準 `Image` を使用（生成の安定性優先）
- 円形 + 枠 + tail の見た目を実装
- Map に直接載せず、`react-native-view-shot` でキャプチャされる

**Props:**

- `uri: string | undefined` - 画像URL
- `size?: number` - ピンサイズ（デフォルト: 48）
- `color?: string` - 枠色（デフォルト: "#FFF"）

### 2. useMarkerBitmap.ts

bitmap生成・キャッシュ管理Hook。

**機能:**

- `react-native-view-shot` で PNG 作成
- `FileSystem.cacheDirectory` 配下に保存（`marker-icons/<hash>.png`）
- キャッシュキー：`hash(uri|size|color)`
- LRU方式でキャッシュ管理

**キャッシュ制限:**

- 最大ファイル数: 200ファイル
- 最大容量: 20MB

**Props:**

```typescript
{
	uri: string | undefined;
	size: number;
	color: string;
}
```

**Returns:**

```typescript
{
	iconUri: string | undefined; // 生成済みPNG URI
	isReady: boolean; // 生成完了フラグ
	viewRef: React.RefObject<any>; // View参照
	generateIfNeeded: () => Promise<void>; // 生成トリガー
}
```

### 3. AvatarBubbleMarkerBitmap.tsx

bitmap icon使用Markerコンポーネント。

**特徴:**

- `Marker` children を持たず、`icon` プロパティに PNG を指定
- `tracksViewChanges={false}` でちらつき防止
- アクティブ/非アクティブの2種類の bitmap を事前生成
- Web環境では従来のView Marker方式を使用

**Props:**

```typescript
{
  uri: string | undefined;
  size?: number;
  color?: string;
  ...RNMarkerProps
}
```

## 使用方法

### 基本的な使用

```tsx
import { AvatarBubbleMarkerBitmap } from "@/components/AvatarBubbleMarkerBitmap";

<AvatarBubbleMarkerBitmap
	coordinate={{ latitude: 35.6762, longitude: 139.6503 }}
	uri="https://example.com/image.jpg"
	color={isActive ? "rgb(52, 119, 248)" : "#FFF"}
/>;
```

### DishMediaMap での使用例

```tsx
{
	restaurants.map((restaurant, index) => (
		<AvatarBubbleMarkerBitmap
			key={`marker-${index}`}
			coordinate={restaurant.coordinate}
			onPress={() => handleMarkerPress(index)}
			uri={restaurant.imageUrls?.sm}
			color={index === currentIndex ? "rgb(52, 119, 248)" : "#FFF"}
		/>
	));
}
```

## パフォーマンス最適化

### キャッシュ戦略

1. **初回生成**: 画像URLごとにアクティブ/非アクティブの2種類を生成
2. **キャッシュヒット**: 同一の `uri|size|color` の組み合わせは再利用
3. **LRU削除**: 上限超過時は古いファイルから削除

### 生成タイミング

- コンポーネントマウント時に `generateIfNeeded()` を実行
- `uri` 変更時のみ再生成（`useEffect` の依存配列に `uri` のみ）
- 状態変更（アクティブ/非アクティブ）は既存PNGの切り替えのみ

### メモリ管理

- キャッシュは `FileSystem.cacheDirectory` に保存（OSが自動管理）
- 定期的なクリーンアップで上限を維持

## プラットフォーム対応

### Android / iOS

- bitmap icon 方式を使用
- オフスクリーン描画 → PNG生成 → キャッシュ

### Web

- 従来のView Marker方式を使用
- bitmap生成をスキップ（`react-native-view-shot` 不要）

## Deprecated: AvatarBubbleMarker

従来の `AvatarBubbleMarker` は以下の問題があるため、新規実装では使用しないでください：

- Android で円形が崩れる
- state/region更新時にちらつく

代わりに `AvatarBubbleMarkerBitmap` を使用してください。

## トラブルシューティング

### ピンが表示されない

1. `isReady` が `true` になっているか確認
2. コンソールログで生成エラーがないか確認
3. キャッシュディレクトリのパーミッションを確認

### 生成が遅い

1. 画像サイズを確認（大きすぎる場合は `sm` サイズを使用）
2. ネットワーク接続を確認
3. キャッシュヒット率を確認

### メモリ使用量が多い

1. キャッシュ上限設定を確認
2. クリーンアップが正常に動作しているか確認

## 依存関係

- `react-native-view-shot`: PNG生成
- `expo-file-system`: ファイル管理
- `expo-crypto`: ハッシュ生成
- `react-native-maps`: Map表示

## 参考資料

- Issue: #235 Map ピン（AvatarBubbleMarker）を bitmap icon 方式へ移行
- PR: [リンク]
