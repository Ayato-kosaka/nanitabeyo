/*
#1375（案 A）埋め込みの切り取り計算。

守るのは 4 点。
1. 写真がセルを必ず覆う（**隙間＝黒帯を作らない**）。これが案 A の目的そのもの
2. Instagram のヘッダといいね欄がセルの外へ出る（＝ 切り取られる）
3. **埋め込み本体をセル幅より広くしない**（広げると Android が真っ黒になる）
4. 寸法が確定するまでは何も返さない
*/
import {
	EMBED_FRAME_HEIGHT_RATIO,
	EMBED_HEADER_RATIO,
	EMBED_MEDIA_ASPECT,
	computeEmbedCropLayout,
	type EmbedCropLayout,
} from "./embedCrop";

/** 拡大後に、写真の箱がどれだけの大きさになるか */
const scaledMedia = (layout: EmbedCropLayout) => ({
	width: layout.frameWidth * layout.scale,
	height: layout.mediaHeight * layout.scale,
});

/** 実機・実端末で出うるセル寸法 */
const CELLS = [
	{ name: "iPhone 15 相当", width: 393, height: 759 },
	{ name: "Pixel 相当", width: 412, height: 823 },
	{ name: "小さい端末", width: 320, height: 568 },
	{ name: "横長（タブレット）", width: 834, height: 600 },
];

describe("computeEmbedCropLayout", () => {
	it.each(CELLS)("$name: 写真がセル全体を覆う（黒帯を作らない）", ({ width, height }) => {
		const layout = computeEmbedCropLayout({ width, height });
		expect(layout).not.toBeNull();
		const media = scaledMedia(layout!);
		// 箱は中央寄せで置くので、縦横とも «セル以上» なら覆えている
		expect(media.width).toBeGreaterThanOrEqual(width);
		expect(media.height).toBeGreaterThanOrEqual(height);
	});

	/**
	 * #1375 実機 Detox（run 32724564583 / 32727534712）で **Android だけ真っ黒**になった。
	 *
	 * 最初の実装は «埋め込み本体をセルの高さぶんの幅まで引き伸ばす» 方式で、実寸 2000px を
	 * 超える幅を WebView へ渡していた。Android の WebView は与えられた寸法ぶんの描画面を
	 * 確保するため、そこまで大きいと何も描かれない（iOS には同じ上限が無く描けていた）。
	 *
	 * 本体は素の幅のまま置き、拡大は transform（プラットフォームのビュー変換で、
	 * 新しい描画面を作らない）で行う。ここが再び大きくなると Android が黒に戻る。
	 */
	it.each(CELLS)("$name: 埋め込み本体をセル幅より広くしない（Android が描けなくなる）", ({ width }) => {
		const layout = computeEmbedCropLayout({ width, height: 800 })!;
		expect(layout.frameWidth).toBe(width);
		// 高さも «ヘッダ + 写真» が収まる最小限
		expect(layout.frameHeight).toBeCloseTo(width * EMBED_FRAME_HEIGHT_RATIO, 5);
	});

	it("ヘッダ帯は箱の外（上）へ出る＝ 1px も見えない", () => {
		const layout = computeEmbedCropLayout({ width: 393, height: 759 })!;
		// 本体を上へずらす量が、ちょうどヘッダ帯の高さ
		expect(layout.frameTop).toBeCloseTo(-(layout.frameWidth * EMBED_HEADER_RATIO), 5);
		expect(layout.frameTop).toBeLessThan(0);
	});

	it("いいね欄は箱の外（下）へ出る＝ 1px も見えない", () => {
		const layout = computeEmbedCropLayout({ width: 393, height: 759 })!;
		// 箱の高さ = 写真の高さ。本体はそれより高いので、余りは下へはみ出して切られる
		expect(layout.mediaHeight).toBeCloseTo(layout.frameWidth * EMBED_MEDIA_ASPECT, 5);
		expect(layout.frameHeight + layout.frameTop).toBeGreaterThan(layout.mediaHeight);
	});

	it("拡大率は 1 倍を下回らない（縮めると隙間が出る）", () => {
		for (const cell of CELLS) {
			expect(computeEmbedCropLayout(cell)!.scale).toBeGreaterThanOrEqual(1);
		}
	});

	it("寸法が確定していないときは null（中途半端な寸法で描かせない）", () => {
		expect(computeEmbedCropLayout({ width: 0, height: 759 })).toBeNull();
		expect(computeEmbedCropLayout({ width: 393, height: 0 })).toBeNull();
		expect(computeEmbedCropLayout({ width: -1, height: -1 })).toBeNull();
	});
});
