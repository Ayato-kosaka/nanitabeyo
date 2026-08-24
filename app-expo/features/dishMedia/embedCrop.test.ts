/*
#1375（案 A）埋め込みの切り取り計算。

守るのは 3 点。
1. 写真がセルを必ず覆う（**隙間＝黒帯を作らない**）。これが案 A の目的そのもの
2. 写真の中心がセルの中心に来る
3. Instagram のヘッダといいね欄がセルの外へ出る（＝ 切り取られる）
*/
import { EMBED_HEADER_RATIO, EMBED_MEDIA_ASPECT, computeEmbedCropLayout, type EmbedCropLayout } from "./embedCrop";

/** 切り取り枠の中で、写真がどこに来るか */
const mediaRect = (layout: EmbedCropLayout) => {
	const top = layout.top + layout.frameWidth * EMBED_HEADER_RATIO;
	return {
		left: layout.left,
		right: layout.left + layout.frameWidth,
		top,
		bottom: top + layout.frameWidth * EMBED_MEDIA_ASPECT,
	};
};

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
		const media = mediaRect(layout!);

		// 写真の矩形がセル（0,0)-(width,height）を完全に含んでいること
		expect(media.left).toBeLessThanOrEqual(0);
		expect(media.top).toBeLessThanOrEqual(0);
		expect(media.right).toBeGreaterThanOrEqual(width);
		expect(media.bottom).toBeGreaterThanOrEqual(height);
	});

	it.each(CELLS)("$name: 写真の中心がセルの中心に来る", ({ width, height }) => {
		const media = mediaRect(computeEmbedCropLayout({ width, height })!);
		expect((media.left + media.right) / 2).toBeCloseTo(width / 2, 5);
		expect((media.top + media.bottom) / 2).toBeCloseTo(height / 2, 5);
	});

	it("Instagram のヘッダ帯はセルの上端より外（＝ 見えない）", () => {
		const layout = computeEmbedCropLayout({ width: 393, height: 759 })!;
		// ヘッダ帯の下端 = 写真の上端。それが 0 以下なら帯は 1px も見えていない
		expect(layout.top + layout.frameWidth * EMBED_HEADER_RATIO).toBeLessThanOrEqual(0);
	});

	it("いいね欄（写真の下）はセルの下端より外（＝ 見えない）", () => {
		const cell = { width: 393, height: 759 };
		const media = mediaRect(computeEmbedCropLayout(cell)!);
		expect(media.bottom).toBeGreaterThanOrEqual(cell.height);
	});

	it("埋め込みの高さは写真の下端より下まである（下端が描かれないのを防ぐ）", () => {
		const layout = computeEmbedCropLayout({ width: 393, height: 759 })!;
		const mediaBottomInFrame = layout.frameWidth * (EMBED_HEADER_RATIO + EMBED_MEDIA_ASPECT);
		expect(layout.frameHeight).toBeGreaterThan(mediaBottomInFrame);
	});

	it("寸法が確定していないときは null（中途半端な寸法で描かせない）", () => {
		expect(computeEmbedCropLayout({ width: 0, height: 759 })).toBeNull();
		expect(computeEmbedCropLayout({ width: 393, height: 0 })).toBeNull();
		expect(computeEmbedCropLayout({ width: -1, height: -1 })).toBeNull();
	});
});
