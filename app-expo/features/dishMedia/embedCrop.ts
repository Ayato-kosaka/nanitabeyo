/*
#1641（オーナー判断: 切り取らない）**外部埋め込みから «映像の部分だけ» を、切らずに取り出す。**

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
