/*
#1641 埋め込み（web の iframe）の位置合わせ計算。

オーナー判断 2026-08-27:**「全画面表示というのはクロップじゃないですよ？ 引き延ばしは除外で判断したはず」**
したがってここで守るのは、まず **投稿された映像を 1px も切らないこと**である。

1. **切らない** — メディア枠は実測どおり 4:5。正方形の窓にして下 20% を捨てない
2. **ヘッダ帯といいね欄は窓の外へ出す**（ヘッダは幅によらず 54px 固定）
3. **引き延ばさない** — 拡大は縦横比を保った枠ごとの拡大だけ。リールと分かっているときに限る
4. 拡大してもセルからはみ出させない（はみ出す＝ 切れる）
5. 寸法が確定するまでは何も返さない
*/
import {
	EMBED_FRAME_HEIGHT_RATIO,
	EMBED_HEADER_PX,
	EMBED_MEDIA_ASPECT,
	EMBED_REEL_ASPECT,
	computeEmbedCropLayout,
	computeTikTokEmbedLayout,
	TIKTOK_CARD_HEIGHT,
	TIKTOK_CARD_WIDTH,
	TIKTOK_VIDEO_HEIGHT,
	TIKTOK_VIDEO_TOP,
	TIKTOK_VIDEO_WIDTH,
	isReelUrl,
} from "./embedCrop";

/** 実機・実端末で出うるセル寸法 */
const CELLS = [
	{ name: "iPhone 15 相当", width: 393, height: 759 },
	{ name: "Pixel 相当", width: 412, height: 823 },
	{ name: "小さい端末", width: 320, height: 568 },
	{ name: "横長（タブレット）", width: 834, height: 600 },
];

/** 拡大後に «実際に見えている映像» が占める幅と高さ */
const visibleMedia = (layout: NonNullable<ReturnType<typeof computeEmbedCropLayout>>, isReel: boolean) => {
	// メディア枠の中は Instagram 自身が contain で収める
	const boxW = layout.frameWidth * layout.scale;
	const boxH = layout.mediaHeight * layout.scale;
	const aspect = isReel ? EMBED_REEL_ASPECT : 1;
	// 枠より縦長なら高さ基準、そうでなければ幅基準
	return boxH / boxW > aspect ? { width: boxW, height: boxW * aspect } : { width: boxH / aspect, height: boxH };
};

describe("computeEmbedCropLayout", () => {
	it.each(CELLS)("$name: 埋め込み本体はセル幅のまま（引き伸ばさない）", ({ width, height }) => {
		const layout = computeEmbedCropLayout({ width, height }, { provider: "instagram" });
		expect(layout).not.toBeNull();
		expect(layout!.frameWidth).toBe(width);
		expect(layout!.frameHeight).toBeCloseTo(width * EMBED_FRAME_HEIGHT_RATIO, 5);
	});

	/*
	実測（Chrome 152 / 2026-08-27）: メディア枠は幅によらず 4:5。
	ここを 1（正方形）にしていたのが「web だけリールが正方形に切り取られたまま」の原因だった。
	*/
	it.each(CELLS)("$name: メディア枠は 4:5（正方形にして下 20% を捨てない）", ({ width, height }) => {
		const layout = computeEmbedCropLayout({ width, height }, { provider: "instagram" })!;
		expect(layout.mediaHeight).toBeCloseTo(width * EMBED_MEDIA_ASPECT, 5);
		expect(EMBED_MEDIA_ASPECT).toBe(1.25);
	});

	/*
	実測: ヘッダ帯は W=320/400/500/600 のいずれでも 54px。**比率ではない。**
	比率（旧 17/320）で計算すると幅 393 では 21px しかずらせず、ヘッダ帯が見えたまま残る。
	*/
	it.each(CELLS)("$name: ヘッダ帯は幅によらず 54px ぶん上へ逃がす", ({ width, height }) => {
		const layout = computeEmbedCropLayout({ width, height }, { provider: "instagram" })!;
		expect(layout.frameTop).toBe(-EMBED_HEADER_PX);
	});

	it("いいね欄は窓の外（下）へ出る＝ 1px も見えない", () => {
		const layout = computeEmbedCropLayout({ width: 393, height: 759 }, { provider: "instagram" })!;
		expect(layout.frameHeight + layout.frameTop).toBeGreaterThan(layout.mediaHeight);
	});

	describe("拡大（リールを大きく出すが、切らない）", () => {
		it("リールは «映像の幅がセル幅に一致する» ところまで枠ごと拡大する", () => {
			const cell = { width: 393, height: 852 };
			const layout = computeEmbedCropLayout(cell, { provider: "instagram", isReel: true })!;
			expect(layout.scale).toBeCloseTo(EMBED_REEL_ASPECT / EMBED_MEDIA_ASPECT, 5);

			const seen = visibleMedia(layout, true);
			expect(seen.width).toBeCloseTo(cell.width, 1);
			// 縦横比は保たれている（引き延ばしていない）
			expect(seen.height / seen.width).toBeCloseTo(EMBED_REEL_ASPECT, 5);
		});

		it("リールと分からない投稿は拡大しない（切れる側へ倒さない）", () => {
			const layout = computeEmbedCropLayout({ width: 393, height: 852 }, { provider: "instagram" })!;
			expect(layout.scale).toBe(1);
		});

		it.each(CELLS)("$name: 拡大してもセルからはみ出さない（はみ出す＝ 切れる）", ({ width, height }) => {
			for (const isReel of [true, false]) {
				const layout = computeEmbedCropLayout({ width, height }, { provider: "instagram", isReel })!;
				const seen = visibleMedia(layout, isReel);
				// 1px の丸め誤差までは許す
				expect(seen.width).toBeLessThanOrEqual(width + 1);
				expect(seen.height).toBeLessThanOrEqual(height + 1);
			}
		});

		it("低いセルでは拡大率を抑える（抑えないと上下が切れる）", () => {
			// 高さがメディア枠より低いセル
			const layout = computeEmbedCropLayout({ width: 400, height: 300 }, { provider: "instagram", isReel: true })!;
			expect(layout.scale).toBeLessThan(EMBED_REEL_ASPECT / EMBED_MEDIA_ASPECT);
			expect(layout.mediaHeight * layout.scale).toBeCloseTo(300, 5);
		});
	});

	it("寸法が確定していないときは null（中途半端な寸法で描かせない）", () => {
		expect(computeEmbedCropLayout({ width: 0, height: 759 }, { provider: "instagram" })).toBeNull();
		expect(computeEmbedCropLayout({ width: 393, height: 0 }, { provider: "instagram" })).toBeNull();
		expect(computeEmbedCropLayout({ width: -1, height: -1 })).toBeNull();
	});
});

describe("isReelUrl", () => {
	it.each([
		["https://www.instagram.com/reel/CDg3owdFa6W/", true],
		["https://www.instagram.com/reels/CDg3owdFa6W/", true],
		["https://www.instagram.com/p/CDg3owdFa6W/", false],
		["https://www.tiktok.com/@user/video/123", false],
	])("%s → %s", (url, expected) => {
		expect(isReelUrl(url)).toBe(expected);
	});

	// 判別できないものは «拡大しない» 側（＝ 切らない側）へ倒す
	it.each([null, undefined, "", "not a url", "/reel/相対パスは URL ではない"])("%s は false", (url) => {
		expect(isReelUrl(url as string | null | undefined)).toBe(false);
	});
});

/*
#1641 **この計算は Instagram の埋め込みを実測した値である。**

ヘッダ 54px・メディア枠 4:5 は `instagram.com/p/{code}/embed/` の形。YouTube の埋め込みは
全体が 16:9 のプレイヤーそのもので、上を 54px 削って 1.42 倍すると**映像が切れる**。
TikTok もヘッダ・キャプション欄の高さが違う。

**測っていない provider は «切らない»**（null）に倒す。呼び出し側はセル全面の iframe として
素直に描く。切る量を推測で決めるより余白が出る方がまし（オーナー判断「クロップじゃない」の延長）。
*/
describe("#1641 Instagram 以外は切らない", () => {
	it.each(["tiktok", "youtube", "unknown"])("%s は null（＝ 全面で描かせる）", (provider) => {
		expect(computeEmbedCropLayout({ width: 393, height: 852 }, { provider })).toBeNull();
	});

	it("provider を渡し忘れたときも切らない側へ倒す", () => {
		expect(computeEmbedCropLayout({ width: 393, height: 852 })).toBeNull();
	});
});

/*
#1641 TikTok の埋め込みは **iframe の幅に中身が追随しない**（実測 #1676 / 5 幅で完全一致）。
Instagram 用の «幅に対する比率» が使えないので、固定 px を基準に映像だけ大きく出す。
*/
describe("computeTikTokEmbedLayout", () => {
	it("iframe にはカードの実寸をそのまま渡す（可変にしても中身は変わらない）", () => {
		const layout = computeTikTokEmbedLayout({ width: 393, height: 759 })!;
		expect(layout.frameWidth).toBe(TIKTOK_CARD_WIDTH);
		expect(layout.frameHeight).toBe(TIKTOK_CARD_HEIGHT);
	});

	it("映像の幅がセル幅に一致するところまで拡大する（映像は切らない）", () => {
		const cell = { width: 393, height: 759 };
		const layout = computeTikTokEmbedLayout(cell)!;
		expect(TIKTOK_VIDEO_WIDTH * layout.scale).toBeCloseTo(cell.width, 5);
		// 高さ側も収まっている＝ 1px も切れていない
		expect(TIKTOK_VIDEO_HEIGHT * layout.scale).toBeLessThanOrEqual(cell.height);
	});

	/*
	⚠️ 抑えないと、低いセルで映像の上下が窓からはみ出して切れる。
	   «切らないために入れた拡大» が、逆に切る原因になる。
	*/
	it("低いセルでは拡大率を抑える", () => {
		const cell = { width: 400, height: 300 };
		const layout = computeTikTokEmbedLayout(cell)!;
		expect(TIKTOK_VIDEO_HEIGHT * layout.scale).toBeLessThanOrEqual(cell.height);
		expect(TIKTOK_VIDEO_WIDTH * layout.scale).toBeLessThanOrEqual(cell.width);
	});

	it("映像の中心がセルの中心へ来るようにずらす", () => {
		const layout = computeTikTokEmbedLayout({ width: 393, height: 759 })!;
		// カードの中で映像は水平中央にあるので、横のずれは要らない
		expect(layout.offsetX).toBe(0);
		// 映像はカードの上寄りにあるので、下へずらして中心を合わせる
		const videoCenterY = TIKTOK_VIDEO_TOP + TIKTOK_VIDEO_HEIGHT / 2;
		expect(layout.offsetY).toBeCloseTo(TIKTOK_CARD_HEIGHT / 2 - videoCenterY, 5);
		expect(layout.offsetY).toBeGreaterThan(0);
	});

	it("寸法が確定していないときは null", () => {
		expect(computeTikTokEmbedLayout({ width: 0, height: 759 })).toBeNull();
	});
});
