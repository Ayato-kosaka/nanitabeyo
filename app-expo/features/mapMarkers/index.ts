// Map Marker 描画機能の公開エントリーポイント

// #235 【設計】View Marker 方式の新コンポーネント（推奨）
export { AvatarBubbleMarker } from "./components/AvatarBubbleMarker";

// #235 【設計】Bitmap Marker 方式（非推奨：パフォーマンス問題のため使用しない）
export { AvatarBubbleMarkerBitmap } from "./components/AvatarBubbleMarkerBitmap";

// #235 【設計】共通ユーティリティ（Bitmap / View 両方で使用）
export {
	MarkerBitmapRendererProvider,
	useMarkerBitmapRenderer,
	useMarkerBitmapState,
	normalizeColor,
	makeKey,
	ACTIVE_COLOR_HEX,
	INACTIVE_COLOR_HEX,
} from "./components/MarkerBitmapRendererProvider";
export { BubblePinBitmap } from "./components/BubblePinBitmap";
export { useMarkerBitmap } from "./hooks/useMarkerBitmap";
