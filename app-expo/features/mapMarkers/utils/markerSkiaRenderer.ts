// app-expo/features/mapMarkers/utils/markerSkiaRenderer.ts

/**
 * #235 Skiaベースのマーカー画像生成
 *
 * 🎯 目的：
 * - react-native-view-shot / expo-file-system を廃止
 * - Skia Canvas でバブルピン画像をメモリ上に生成
 * - Base64 PNG として返し、Marker の icon / image に直接渡す
 *
 * 🧠 設計：
 * - 入力: { uri: サムネURL, size: ピンサイズ, color: 枠色 }
 * - 出力: Base64 PNG の data URI
 * - キャッシュ: メモリ上の LRU (100-200件)
 * - プラットフォーム: iOS / Android のみ（Webは従来のView Markerを継続）
 */

import { Skia, PaintStyle, FilterMode, MipmapMode, type SkImage } from "@shopify/react-native-skia";
import { PixelRatio } from "react-native";

// ----------------------------
// 型定義
// ----------------------------

export type MarkerBitmapKey = {
	uri: string; // 空文字の場合はプレースホルダ扱い
	size: number; // 論理サイズ (px)
	color: string; // 正規化済み #RRGGBB
};

export type MarkerBitmapResult = {
	source: { uri: string } | undefined;
	isReady: boolean;
	error?: Error;
};

type CachedBitmap = {
	dataUri: string; // data:image/png;base64,...
	lastUsedAt: number; // Date.now()
	key: string;
};

// ----------------------------
// メモリキャッシュ（LRU）
// ----------------------------

class SkiaMarkerBitmapCache {
	private cache = new Map<string, CachedBitmap>();
	private maxSize = 150; // #235 【設計】上限数（実測して調整）

	/**
	 * キャッシュキー生成（ハッシュ不要、直接文字列で十分軽量）
	 */
	makeKey(params: MarkerBitmapKey): string {
		return `${params.uri}|${params.size}|${params.color}`;
	}

	/**
	 * キャッシュ取得
	 */
	get(key: string): string | undefined {
		const cached = this.cache.get(key);
		if (!cached) return undefined;

		// LRU更新
		cached.lastUsedAt = Date.now();
		this.cache.set(key, cached);
		return cached.dataUri;
	}

	/**
	 * キャッシュ保存 + LRU削除
	 */
	set(key: string, dataUri: string): void {
		this.cache.set(key, {
			dataUri,
			lastUsedAt: Date.now(),
			key,
		});

		// #235 【設計】上限超過時は古いものから削除
		if (this.cache.size > this.maxSize) {
			this.evictOldest();
		}
	}

	/**
	 * 古いキャッシュを削除（LRU）
	 */
	private evictOldest(): void {
		const entries = Array.from(this.cache.values());
		entries.sort((a, b) => a.lastUsedAt - b.lastUsedAt);

		// 上限まで減らす
		const toDelete = entries.slice(0, this.cache.size - this.maxSize);
		for (const entry of toDelete) {
			this.cache.delete(entry.key);
		}

		if (toDelete.length > 0) {
			console.log(`[SkiaMarkerCache] Evicted ${toDelete.length} old entries`);
		}
	}

	/**
	 * デバッグ用
	 */
	getStats() {
		return {
			size: this.cache.size,
			maxSize: this.maxSize,
		};
	}
}

// シングルトンインスタンス
const cache = new SkiaMarkerBitmapCache();

// ----------------------------
// Skia描画ロジック
// ----------------------------

/**
 * #235 【設計】Skia Canvas でバブルピン画像を生成
 *
 * @param params - { uri, size, color }
 * @returns Base64 PNG の data URI (例: "data:image/png;base64,iVBORw0...")
 */
export async function generateMarkerBitmap(params: MarkerBitmapKey): Promise<string> {
	const { uri, size, color } = params;

	// #235 【設計】物理サイズ = 論理サイズ × PixelRatio（高DPIディスプレイ対応）
	const scale = PixelRatio.get();
	const physicalSize = Math.round(size * scale);

	// tail の高さ（論理サイズ基準で 4px）
	const tailHeight = Math.round(4 * scale);
	const canvasWidth = physicalSize;
	const canvasHeight = physicalSize + tailHeight;

	// Canvas 作成
	const surface = Skia.Surface.Make(canvasWidth, canvasHeight);
	if (!surface) {
		throw new Error("[SkiaMarkerRenderer] Failed to create surface");
	}

	const canvas = surface.getCanvas();

	// 背景透明
	canvas.clear(Skia.Color("transparent"));

	// 円の中心と半径
	const radius = physicalSize / 2;
	const centerX = canvasWidth / 2;
	const centerY = radius;

	// #235 【設計】サムネ画像の読み込み（オプショナル）
	let thumbnailImage: SkImage | null = null;
	if (uri) {
		try {
			thumbnailImage = await loadImageFromUri(uri);
		} catch (err) {
			console.warn(`[SkiaMarkerRenderer] Failed to load image: ${uri}`, err);
			// エラーでもプレースホルダとして続行
		}
	}

	// ----------------------------
	// 1. 円形マスク領域を定義
	// ----------------------------

	const circlePath = Skia.Path.Make();
	circlePath.addCircle(centerX, centerY, radius);

	canvas.save();
	// #235 【設計】ClipOp.Intersect でマスク適用（Skia API: op, doAntiAlias）
	const ClipOp = { Intersect: 1 }; // Skia ClipOp enum
	canvas.clipPath(circlePath, ClipOp.Intersect, true);

	// 背景色（グレー）
	const bgPaint = Skia.Paint();
	bgPaint.setColor(Skia.Color("#E0E0E0"));
	bgPaint.setStyle(PaintStyle.Fill);
	canvas.drawCircle(centerX, centerY, radius, bgPaint);

	// サムネ画像がある場合は描画（cover リサイズ）
	if (thumbnailImage) {
		drawImageCover(canvas, thumbnailImage, centerX - radius, centerY - radius, physicalSize, physicalSize);
	}

	canvas.restore();

	// ----------------------------
	// 2. 円の枠線
	// ----------------------------

	const borderPaint = Skia.Paint();
	borderPaint.setColor(Skia.Color(color));
	borderPaint.setStyle(PaintStyle.Stroke);
	borderPaint.setStrokeWidth(2 * scale); // 枠線 2px
	borderPaint.setAntiAlias(true);
	canvas.drawCircle(centerX, centerY, radius - scale, borderPaint); // 内側に描画

	// ----------------------------
	// 3. tail（バブルしっぽ）
	// ----------------------------

	const tailSize = Math.round(8 * scale);
	const tailX = centerX;
	const tailY = physicalSize - tailSize / 2;

	canvas.save();
	canvas.translate(tailX, tailY);
	canvas.rotate(45, 0, 0); // 45度回転

	const tailPaint = Skia.Paint();
	tailPaint.setColor(Skia.Color(color));
	tailPaint.setStyle(PaintStyle.Fill);
	canvas.drawRect(Skia.XYWHRect(-tailSize / 2, -tailSize / 2, tailSize, tailSize), tailPaint);

	canvas.restore();

	// ----------------------------
	// 4. PNG エンコード
	// ----------------------------

	const image = surface.makeImageSnapshot();
	if (!image) {
		throw new Error("[SkiaMarkerRenderer] Failed to create image snapshot");
	}

	const bytes = image.encodeToBase64(); // PNG形式
	if (!bytes) {
		throw new Error("[SkiaMarkerRenderer] Failed to encode to base64");
	}

	const dataUri = `data:image/png;base64,${bytes}`;
	return dataUri;
}

/**
 * #235 【設計】画像を cover モードで描画（中央トリミング）
 */
function drawImageCover(
	canvas: any, // Skia Canvas型
	image: SkImage,
	x: number,
	y: number,
	width: number,
	height: number,
): void {
	const imgWidth = image.width();
	const imgHeight = image.height();

	const targetAspect = width / height;
	const imgAspect = imgWidth / imgHeight;

	let srcX = 0;
	let srcY = 0;
	let srcWidth = imgWidth;
	let srcHeight = imgHeight;

	// cover: 枠に収まるように拡大し、はみ出す部分をトリミング
	if (imgAspect > targetAspect) {
		// 画像が横長 → 縦を基準に拡大し、横をトリミング
		srcWidth = imgHeight * targetAspect;
		srcX = (imgWidth - srcWidth) / 2;
	} else {
		// 画像が縦長 → 横を基準に拡大し、縦をトリミング
		srcHeight = imgWidth / targetAspect;
		srcY = (imgHeight - srcHeight) / 2;
	}

	const srcRect = Skia.XYWHRect(srcX, srcY, srcWidth, srcHeight);
	const dstRect = Skia.XYWHRect(x, y, width, height);

	const paint = Skia.Paint();
	paint.setAntiAlias(true);

	canvas.drawImageRect(image, srcRect, dstRect, paint, FilterMode.Linear, MipmapMode.None);
}

/**
 * #235 【設計】URI から SkImage を非同期ロード
 */
async function loadImageFromUri(uri: string): Promise<SkImage> {
	// #235 【設計】Skia の Data.fromURI は非同期でネットワークからフェッチ可能
	const data = await Skia.Data.fromURI(uri);
	if (!data) {
		throw new Error(`[SkiaMarkerRenderer] Failed to load data from URI: ${uri}`);
	}

	const image = Skia.Image.MakeImageFromEncoded(data);
	if (!image) {
		throw new Error(`[SkiaMarkerRenderer] Failed to decode image from URI: ${uri}`);
	}

	return image;
}

// ----------------------------
// 公開API
// ----------------------------

/**
 * #235 【設計】キャッシュ付きのマーカー画像生成
 *
 * キャッシュヒット時は即座に返す。
 * ミス時は Skia で生成してキャッシュに保存。
 */
export async function getOrGenerateMarkerBitmap(params: MarkerBitmapKey): Promise<string> {
	const key = cache.makeKey(params);

	// キャッシュヒット
	const cached = cache.get(key);
	if (cached) {
		console.log(`[SkiaMarkerRenderer] Cache hit: ${key}`);
		return cached;
	}

	// 生成
	console.log(`[SkiaMarkerRenderer] Generating: ${key}`);
	const dataUri = await generateMarkerBitmap(params);

	// キャッシュ保存
	cache.set(key, dataUri);

	return dataUri;
}

/**
 * #235 【設計】デバッグ用：キャッシュ統計
 */
export function getCacheStats() {
	return cache.getStats();
}
