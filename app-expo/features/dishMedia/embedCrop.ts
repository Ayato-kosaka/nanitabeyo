/*
#1641（オーナー判断: 切り取らない）**外部埋め込みから «映像の部分だけ» を、切らずに取り出す。**

## ⚠️ ここの数値は **Instagram の埋め込み専用**である

ヘッダ 54px・メディア枠 4:5 は `https://www.instagram.com/p/{code}/embed/` を実測した値で、
**TikTok / YouTube の埋め込みは形が違う**。同じ数値を当てると、

| provider | 何が起きるか |
| --- | --- |
| youtube | 埋め込み全体が 16:9 のプレイヤーそのもの。上を 54px 削って 1.42 倍すると**映像が切れる** |
| tiktok  | ヘッダ・キャプション欄の高さが違うので、削る量が合わない |

**測っていない provider には «切らない» を返す**（`computeEmbedCropLayout` が null）。
呼び出し側はセル全面の iframe として素直に描く。切る量を推測で決めるより、
余白が出る方がまし（オーナー判断「クロップじゃない」の延長）。

## これは web 専用である

ネイティブ（`ExternalEmbedPlayer.tsx`）は埋め込みページへスクリプトを注入して
`<video>` 自身を WebView いっぱいへ広げるので、外から位置を測る必要が無い。
**web の `<iframe>` は instagram.com のクロスオリジンで中身に触れない**ため、
こちらだけが «外側から位置と大きさで合わせる» 方式を続けている。

## Instagram の埋め込みが返してくる構造（実測: Chrome 152 / 2026-08-27）

幅 W の器へ `https://www.instagram.com/p/{code}/embed/` を入れると、こう組まれる。

    y 0 – 54      アカウント名と「View profile」のヘッダ帯 … **幅によらず 54px 固定**
    y 54 – 54+1.25W  メディア枠（幅いっぱい・高さは常に W × 1.25 = 4:5）
    それ以下       いいね／コメント欄、白い帯

**メディア枠の中は Instagram 自身が `object-fit: contain` で収める。**
つまり 9:16 のリールは、4:5 の枠の中で左右に余白を持って表示される（向こうも切っていない）。

    W=320 → ヘッダ 54px / 枠 320x400
    W=400 → ヘッダ 54px / 枠 400x500
    W=500 → ヘッダ 54px / 枠 500x625
    W=600 → ヘッダ 54px / 枠 600x750

## 直した 2 つの間違い（オーナー指摘 2026-08-27「web だけ正方形に切り取られたまま」）

| 旧 | 何が起きていたか |
| --- | --- |
| ヘッダを «幅の 17/320» と**比率**で見ていた | 実際は 54px 固定。幅 393 では 21px しかずらせず、**ヘッダ帯が見えたまま**だった |
| メディア枠を «幅 × 1（正方形）» としていた | 実際は 4:5。枠の**下 20% が窓の外**に出て、リールが切れていた |

旧コードは «隙間が出るより少し切れる方がまし» という判断でわざと正方形にしていたが、
オーナー判断が **「クロップじゃない。引き延ばしも除外」** で確定したので、その前提ごと入れ替える。

## 切らずに大きく出すために «枠ごと» 拡大する

4:5 の枠を等倍で置くと、9:16 のリールは枠の中で左右に余白を持つぶん小さく写る
（幅 393 のセルで実寸 276px しか無い）。そこで **枠ごと拡大して、リールの幅がセル幅に
一致するところで止める**。はみ出すのは Instagram が付けた左右の余白だけで、
**映像そのものは 1px も切らない**。

    拡大率 = リールの縦横比 ÷ メディア枠の縦横比 = 1.775 / 1.25 ≈ 1.42

⚠️ **拡大してよいのはリールだと分かっているときだけ。** 正方形の写真投稿は枠の幅を
すでに使い切っているので、同じ拡大をすると左右が切れる。判別は `canonicalUrl` の
`/reel/` で行う（`shared/utils/snsUrl.ts` が `p` / `reel` を保存時に保っている）。
リールを `/p/` のリンクで取り込んだ場合は «拡大しない» 側へ倒れるだけで、
**切れる方向へは倒れない**。

⚠️ セルが低いときは拡大率を抑える。抑えないと今度は上下が枠からはみ出して切れる。
*/

/** ヘッダ帯の高さ（px）。**幅によらず固定**（W=320/400/500/600 で 54px を実測） */
export const EMBED_HEADER_PX = 54;

/** 埋め込みがメディアへ与える枠の «高さ ÷ 幅»。常に 4:5 */
export const EMBED_MEDIA_ASPECT = 1.25;

/**
 * リール（縦動画）の «高さ ÷ 幅»。実測 400x710 → 1.775。
 * 16/9（1.7778）ではなく実測値を採る。**大きい値を採ると拡大しすぎて左右が切れる**ので、
 * 迷ったら小さい側（＝ 切らない側）へ倒す。
 */
export const EMBED_REEL_ASPECT = 1.775;

/** 埋め込み本体の高さ ÷ 幅。メディア枠の下端が入りきる最小限（その下は窓の外なので描かせない） */
export const EMBED_FRAME_HEIGHT_RATIO = EMBED_MEDIA_ASPECT + 0.4;

export type EmbedCropLayout = {
	/** 埋め込み本体（iframe）に与える幅。**セル幅そのまま**（引き伸ばさない） */
	frameWidth: number;
	/** 埋め込み本体に与える高さ */
	frameHeight: number;
	/** 埋め込み本体を上へずらす量（ヘッダ帯を窓の外へ追い出す）。負値 */
	frameTop: number;
	/** メディア枠の高さ（幅は frameWidth と同じ） */
	mediaHeight: number;
	/** メディア枠ごとの拡大率。1 なら等倍 */
	scale: number;
};

export type EmbedCropOptions = {
	/**
	 * 縦長のリールだと分かっているか。`canonicalUrl` に `/reel/` があるとき true。
	 * 分からないときは false（＝ 拡大しない＝ 切らない）に倒すこと。
	 */
	isReel?: boolean;
	/**
	 * どの provider の埋め込みか。**Instagram 以外は null を返す**（上のヘッダの表）。
	 * 省略時も null（＝ 切らない）に倒す。
	 */
	provider?: string;
};

/** `canonicalUrl` が «縦長のリール» を指しているか。判別できなければ false */
export function isReelUrl(canonicalUrl: string | null | undefined): boolean {
	if (!canonicalUrl) return false;
	try {
		return /\/reels?\//.test(new URL(canonicalUrl).pathname);
	} catch {
		return false;
	}
}

export function computeEmbedCropLayout(
	cell: { width: number; height: number },
	options: EmbedCropOptions = {},
): EmbedCropLayout | null {
	if (!(cell.width > 0) || !(cell.height > 0)) return null;
	// 実測しているのは Instagram の埋め込みだけ。他は切らない（呼び出し側が全面で描く）
	if (options.provider !== "instagram") return null;

	const frameWidth = cell.width;
	const frameHeight = frameWidth * EMBED_FRAME_HEIGHT_RATIO;
	const mediaHeight = frameWidth * EMBED_MEDIA_ASPECT;

	// リールなら «リールの幅がセル幅に一致する» ところまで枠ごと拡大する
	const wanted = options.isReel ? EMBED_REEL_ASPECT / EMBED_MEDIA_ASPECT : 1;
	/*
	セルの高さで頭打ちにする。ここを外すと、低いセルで上下が窓からはみ出して
	**切らないために入れた拡大が、逆に切る原因になる**。
	*/
	const maxByHeight = cell.height / mediaHeight;
	const scale = Math.min(wanted, maxByHeight);

	return { frameWidth, frameHeight, frameTop: -EMBED_HEADER_PX, mediaHeight, scale };
}

/* -------------------------------------------------------------------------- */
/*  TikTok                                                                     */
/* -------------------------------------------------------------------------- */

/*
#1641 **TikTok の埋め込みは Instagram と構造が違う。**（実測: #1676 / Chromium・モバイル UA）

`https://www.tiktok.com/embed/v2/{id}` は、**iframe に何 px 渡してもカードが固定サイズ**で、
幅を変えても中身は拡大縮小されず、水平方向に中央寄せされるだけだった。

    幅 320 / 375 / 393 / 500 / 600 のいずれでも
      カード全体      323 x 756.25
      ヘッダ帯        y 82 – 175（高さ 93）
      映像のボックス  211 x 280（y 175 から）
      キャプション帯  y 575.22 から（高さ 180.03）
    変わるのは x（中央寄せ）だけで、y / 幅 / 高さは 5 幅すべて完全一致

つまり Instagram のように «iframe の幅に対する比率» で考える前提が成り立たない。
**固定 px を基準に、カードごと拡大して映像を大きく出す。**

⚠️ **実測はヘッドレスで自動再生されていない状態のもの**（`videoWidth` / `videoHeight` は 0）。
   再生が始まったときに TikTok が寸法を変えるなら、この値はずれる。
   数値を疑うときは #1676 の実測をやり直すこと。
*/

/** カード全体の幅（px 固定） */
export const TIKTOK_CARD_WIDTH = 323;
/** カード全体の高さ（px 固定） */
export const TIKTOK_CARD_HEIGHT = 756.25;
/** 映像のボックス（px 固定）。カードの中で中央寄せされる */
export const TIKTOK_VIDEO_WIDTH = 211;
export const TIKTOK_VIDEO_HEIGHT = 280;
/** カード上端から映像のボックス上端までの距離（px 固定） */
export const TIKTOK_VIDEO_TOP = 175;

export type TikTokEmbedLayout = {
	/** iframe に与える幅。**カードの実寸そのまま**（可変にしても中身は変わらない） */
	frameWidth: number;
	/** iframe に与える高さ */
	frameHeight: number;
	/** 拡大率 */
	scale: number;
	/** 拡大の中心をセル中央へ合わせるための平行移動（拡大前の px） */
	offsetX: number;
	offsetY: number;
};

/**
 * TikTok の埋め込みを «映像だけ大きく» 出すための配置を求める。
 *
 * **映像のボックスの幅がセル幅に一致するところまでカードごと拡大する。**
 * はみ出すのは TikTok が付けた背景（ぼかし）とヘッダ・キャプション帯だけで、
 * **映像そのものは 1px も切らない**（Instagram のリールと同じ考え方）。
 *
 * ⚠️ セルが低いときは拡大率を抑える。抑えないと映像の上下が窓からはみ出して切れる。
 */
export function computeTikTokEmbedLayout(cell: {
	width: number;
	height: number;
}): TikTokEmbedLayout | null {
	if (!(cell.width > 0) || !(cell.height > 0)) return null;

	// 映像のボックスが収まる最大の拡大率（幅・高さのどちらも切らない）
	const scale = Math.min(cell.width / TIKTOK_VIDEO_WIDTH, cell.height / TIKTOK_VIDEO_HEIGHT);

	/*
	映像のボックスの中心を、セルの中心へ合わせる。
	カードの中で映像は水平中央にあるので、横のずれは無い。縦だけずらす。
	*/
	const frameHeight = TIKTOK_CARD_HEIGHT;
	const videoCenterY = TIKTOK_VIDEO_TOP + TIKTOK_VIDEO_HEIGHT / 2;

	return {
		frameWidth: TIKTOK_CARD_WIDTH,
		frameHeight,
		scale,
		offsetX: 0,
		offsetY: frameHeight / 2 - videoCenterY,
	};
}
