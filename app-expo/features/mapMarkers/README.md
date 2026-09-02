# Map Marker 描画（Bitmap Icon 化）

Map 上のピン表示を **1 つの feature** として集約し、Android/iOS の崩れやちらつきを防ぐためのビットマーカー生成をまとめています。MapView 直下には Marker だけを置き、オフスクリーンで PNG 化したアイコンを渡す構成です。

## 目的

- Marker 直下に View を混在させず、bitmap（PNG）を icon/image として渡す
- 生成・キャッシュ・購読を `features/mapMarkers` に集約して保守性を高める
- 旧パス（`@/components/*` / `@/hooks/*`）からの import 互換を維持する

## ディレクトリ構成

- `components/`
  - `MarkerBitmapRendererProvider.tsx`: bitmap 生成・キャッシュ・購読の Provider（オフスクリーン描画を含む）
  - `AvatarBubbleMarkerBitmap.tsx`: Map 上に描画する Marker コンポーネント（placeholder 付き）
  - `BubblePinBitmap.tsx`: view-shot で PNG 化するためのオフスクリーン View
- `hooks/`
  - `useMarkerBitmap.ts`: 旧パス（`@/hooks/*`）からの import 互換のための Hook
- `index.ts`: 公開 API の入口

## 使い方

1. 画面を `MarkerBitmapRendererProvider` でラップする

```tsx
import { MarkerBitmapRendererProvider, AvatarBubbleMarkerBitmap } from "@/features/mapMarkers";

<MarkerBitmapRendererProvider>
  <MapView ...>
    <AvatarBubbleMarkerBitmap uri={avatarUri} coordinate={...} />
  </MapView>
</MarkerBitmapRendererProvider>
```

2. Marker は null を返さず、bitmap 未生成時はローカルの placeholder を使う
   - placeholder 画像は `assets/marker-placeholder.png"`（@2x/@3x を含む）

## 注意点

- 生成順・キャッシュ・色判定の設計判断は、該当コードの `【設計】` コメントを見ること
