# Map Marker Bitmap Implementation

## 概要

このドキュメントは、Map ピン（AvatarBubbleMarker）を bitmap icon 方式へ移行した実装の詳細を記載しています。

## 問題の背景

### Android で発生していた問題

1. **円形崩れ** - 店舗ピン（アバター）が円形ではなく扇形や欠けた形で表示される
2. **ちらつき** - state/region 更新に連動して Marker がちらつく

### iOS で発生していた問題

3. **生成不安定** - `react-native-view-shot` で `Error: No view found with reactTag` が発生

### 原因

- Google Maps（Android）での **View Marker（Marker children）→ Bitmap化** の過程で、`borderRadius` / `overflow: hidden` / alpha合成が端末/GPU依存で破綻し、円形クリップが欠ける
- iOS では ref のマウントタイミングが不安定で capture が失敗する

## 解決策

### View Marker 廃止 → bitmap icon 方式 + Renderer 統合

- `Marker` に children を渡さず、`icon` プロパティに **ローカル PNG（file://）** を渡す
- PNG は **オフスクリーンで1回生成 → キャッシュ**し、以降再利用
- アクティブ/非アクティブは「2種類の bitmap」で吸収
- **全マーカーで1個の Renderer を共有**し、オフスクリーン View を MapView の外に配置

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

### 2. MarkerBitmapRenderer.tsx (新規)

全マーカーの bitmap 生成を一元管理する Renderer。

**機能:**

- Context ベースのグローバル Renderer（Provider/Consumer パターン）
- 優先度付き生成キュー（high/low）
- 同時生成数制限（最大2件）
- リトライ機構（最大3回、指数バックオフ）
- 色の正規化（`rgb(...)` → `#RRGGBB`）でキャッシュヒット率向上
- `collapsable={false}` + `requestAnimationFrame` × 2回で生成安定化
- アンマウントガード（`isMountedRef`）

**キャッシュ制限:**

- 最大ファイル数: 200ファイル
- 最大容量: 20MB
- LRU方式で古いファイルから削除

**API:**

```typescript
// Provider
<MarkerBitmapRendererProvider>
  {children}
</MarkerBitmapRendererProvider>

// Hook
const { requestBitmap, getState, subscribe } = useMarkerBitmapRenderer();

// 生成リクエスト
requestBitmap({
  uri: "https://...",
  size: 48,
  color: "#FFF",
  priority: "low" | "high" // low=初回一括, high=オンデマンド
});

// 状態取得
const state = getState(uri, size, color);
// { iconUri, isReady, isGenerating, error }

// 購読
const unsubscribe = subscribe(uri, size, color, (state) => {
  console.log(state);
});
```

### 3. AvatarBubbleMarkerBitmap.tsx

bitmap icon使用Markerコンポーネント（Renderer統合版）。

**特徴:**

- `Marker` children を持たず、`icon` プロパティに PNG を指定
- `tracksViewChanges={false}` でちらつき防止
- オフスクリーン View は **削除**（Renderer側で一元管理）
- アクティブ/非アクティブの2種類の bitmap を Renderer に要求
- 初回は inactive を優先生成（priority: "low"）
- active はアクティブ時にオンデマンド生成（priority: "high"）
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

### 4. useMarkerBitmap.ts (廃止予定)

**NOTE:** 本Hook は旧実装で、新実装では `MarkerBitmapRenderer` に統合されました。
後方互換性のため残していますが、新規実装では使用しないでください。

## 使用方法

### 基本的な使用

```tsx
import { MarkerBitmapRendererProvider } from "@/components/MarkerBitmapRenderer";
import { AvatarBubbleMarkerBitmap } from "@/components/AvatarBubbleMarkerBitmap";

export default function MapScreen() {
	return (
		<MarkerBitmapRendererProvider>
			<MapView>
				<AvatarBubbleMarkerBitmap
					coordinate={{ latitude: 35.6762, longitude: 139.6503 }}
					uri="https://example.com/image.jpg"
					color={isActive ? "rgb(52, 119, 248)" : "#FFF"}
				/>
			</MapView>
		</MarkerBitmapRendererProvider>
	);
}
```

### DishMediaMap での使用例

```tsx
export default function DishMediaMap({ ... }: DishMediaMapProps) {
  return (
    <MarkerBitmapRendererProvider>
      <View style={styles.container}>
        <View style={styles.mapContainer}>
          <MapView ref={mapRef} style={styles.map} region={getMapRegion()}>
            {restaurants.map((restaurant, index) => (
              <AvatarBubbleMarkerBitmap
                key={`marker-${index}`}
                coordinate={restaurant.coordinate}
                onPress={() => handleMarkerPress(index)}
                uri={restaurant.imageUrls?.sm}
                color={index === currentIndex ? "rgb(52, 119, 248)" : "#FFF"}
              />
            ))}
          </MapView>
        </View>
        {/* Carousel etc... */}
      </View>
    </MarkerBitmapRendererProvider>
  );
}
```

## パフォーマンス最適化

### キャッシュ戦略

1. **初回生成**: 画像URLごとに inactive（白枠）を優先生成
2. **オンデマンド生成**: アクティブ時に active（青枠）を生成
3. **キャッシュヒット**: 同一の `uri|size|color` の組み合わせは再利用
4. **LRU削除**: 上限超過時は古いファイルから削除

### 生成タイミング

- 初回マウント時に inactive を `priority: "low"` で一括リクエスト
- アクティブ時に active を `priority: "high"` でオンデマンドリクエスト
- 生成キューは優先度順に処理（high → low）
- 同時生成数を2件に制限してパフォーマンスを担保

### 生成安定化（iOS対策）

1. `collapsable={false}` を capture 対象 View に付与
2. `requestAnimationFrame` を2回呼び出して ref を安定化
3. `captureRef(viewRef.current, ...)` で実体を渡す
4. リトライ機構（最大3回、指数バックオフ）
5. アンマウント検知（`isMountedRef`）で setState を防ぐ

### メモリ管理

- キャッシュは `FileSystem.cacheDirectory` に保存（OSが自動管理）
- 定期的なクリーンアップで上限を維持（200ファイル / 20MB）

## プラットフォーム対応

### Android / iOS

- bitmap icon 方式を使用
- オフスクリーン描画 → PNG生成 → キャッシュ
- Renderer 1個で全マーカーを管理

### Web

- 従来のView Marker方式を使用
- bitmap生成をスキップ（`react-native-view-shot` 不要）

## Deprecated: AvatarBubbleMarker

従来の `AvatarBubbleMarker` は以下の問題があるため、新規実装では使用しないでください：

- Android で円形が崩れる
- state/region更新時にちらつく

代わりに `AvatarBubbleMarkerBitmap` + `MarkerBitmapRendererProvider` を使用してください。

## トラブルシューティング

### ピンが表示されない

1. `MarkerBitmapRendererProvider` で画面全体をラップしているか確認
2. コンソールログで生成エラーがないか確認
3. キャッシュディレクトリのパーミッションを確認

### 生成が遅い

1. 画像サイズを確認（大きすぎる場合は `sm` サイズを使用）
2. ネットワーク接続を確認
3. キャッシュヒット率を確認（コンソールログ）

### iOS で reactTag エラーが出る

1. `requestAnimationFrame` が2回呼び出されているか確認
2. `collapsable={false}` が設定されているか確認
3. リトライログを確認

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
- PR: [このPR]
