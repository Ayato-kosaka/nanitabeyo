/*
#1375（案 A）埋め込みの切り取り計算。

守るのは 4 点。
1. **拡大しない**（オーナー判断 2026-08-25）。拡大すると指の動きが中身のドラッグに取られ、
   Instagram 自身の再生ボタンも動いて押せなくなる。写真はセル幅いっぱいの等倍で置く
2. Instagram のヘッダといいね欄がセルの外へ出る（＝ 切り取られる）
3. **埋め込み本体をセル幅より広くしない**（広げると Android が真っ黒になる）
4. 寸法が確定するまでは何も返さない
*/
import {
	EMBED_FRAME_HEIGHT_RATIO,
	EMBED_HEADER_RATIO,
	EMBED_MEDIA_ASPECT,
	computeEmbedCropLayout,
} from "./embedCrop";

/** 実機・実端末で出うるセル寸法 */
const CELLS = [
	{ name: "iPhone 15 相当", width: 393, height: 759 },
	{ name: "Pixel 相当", width: 412, height: 823 },
	{ name: "小さい端末", width: 320, height: 568 },
	{ name: "横長（タブレット）", width: 834, height: 600 },
];

describe("computeEmbedCropLayout", () => {
	/*
	オーナー判断（2026-08-25）**拡大しない。**

	以前は «写真がセル全面を覆う» ことを守っていたが、そのために掛けていた拡大が
	  - 指の動きを中身のドラッグとして食う
	  - Instagram 自身の再生ボタンを動かして押しにくくする
	という副作用を生み、**再生できない**状態になっていた。
	いまは写真をセル幅いっぱいの **等倍** で置く（上下にはアプリの地色が残る）。
	*/
	it.each(CELLS)("$name: 写真はセル幅いっぱい・等倍（拡大しない）", ({ width, height }) => {
		const layout = computeEmbedCropLayout({ width, height });
		expect(layout).not.toBeNull();
		expect(layout!.frameWidth).toBe(width);
		expect(layout!.mediaHeight).toBeCloseTo(width * EMBED_MEDIA_ASPECT, 5);
	});

	/**
	 * #1375 実機 Detox（run 32724564583 / 32727534712）で **Android だけ真っ黒**になった。
	 *
	 * 最初の実装は «埋め込み本体をセルの高さぶんの幅まで引き伸ばす» 方式で、実寸 2000px を
	 * 超える幅を WebView へ渡していた。Android の WebView は与えられた寸法ぶんの描画面を
	 * 確保するため、そこまで大きいと何も描かれない（iOS には同じ上限が無く描けていた）。
	 *
	 * 本体は素の幅のまま置く。ここが再び大きくなると Android が黒に戻る。
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

	// 拡大をやめた以上、レイアウトに «倍率» という概念を残さない。
	// 残っていると「少しだけ拡大する」が後からこっそり戻ってくる
	it("レイアウトに拡大率を持たない", () => {
		const layout = computeEmbedCropLayout({ width: 393, height: 759 })!;
		expect(Object.keys(layout).sort()).toEqual(["frameHeight", "frameTop", "frameWidth", "mediaHeight"]);
	});

	it("寸法が確定していないときは null（中途半端な寸法で描かせない）", () => {
		expect(computeEmbedCropLayout({ width: 0, height: 759 })).toBeNull();
		expect(computeEmbedCropLayout({ width: 393, height: 0 })).toBeNull();
		expect(computeEmbedCropLayout({ width: -1, height: -1 })).toBeNull();
	});
});
