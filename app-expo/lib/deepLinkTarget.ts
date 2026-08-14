import { SHARE_LINK_PATH_PREFIX, isShareLinkTokenShape } from "@shared/api/v1/constants/shareLinks";

/**
 * 🔗 ディープリンクの URL から「アプリ内の行き先」を決める純関数。
 *
 * ## なぜ app/index.tsx から切り出しているか
 * ここは #1027（ディープリンクの行き先を奪う）と #1135（OAuth の `code` を落とす）で
 * **二度事故っている**判定なのに、`app/index.tsx` の中にあるとテストから触れなかった
 * （あのファイルは expo-router / expo-linking / SplashScreen を読み込むため、
 *  ユニットテストで import すると副作用ごと持ってくる）。
 * 判定だけを純関数として切り出し、分岐を全部テストで固定する。
 */

/** BCP 47 言語タグの形式か（app/[locale]/_layout.tsx と同じ判定） */
export const isValidBcp47Tag = (tag: string): boolean => /^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8})*$/.test(tag);

/**
 * ディープリンクのパスを「アプリ内ルート」として解釈できるなら、その絶対パスを返す。
 *
 * ## 採用する形は 2 つだけ
 *
 * | 形 | 例 | 備考 |
 * | --- | --- | --- |
 * | ロケール配下 | `/ja-JP/profile` | 先頭がロケールであることを条件にする（#1027） |
 * | 共有リンク | `/s/s1_xxxx` | ロケールを持たない（#721） |
 *
 * 先頭セグメントをロケールに限定しているのは、OAuth コールバックのような
 * ルーティング対象外の URL でリダイレクト先を上書きしないため（#1027）。
 *
 * ## ⚠️ 共有リンクを «明示的に» 許可する理由
 * `/s/<token>` の先頭セグメントは `s`（1 文字）で、BCP 47 の判定
 * `/^[a-zA-Z]{2,3}...$/` に**一致しない**。そのため #721 の実装前は、
 * 共有リンクを踏むと `null` になって端末ロケールのホームへ飛んでいた。
 *
 * Universal Links は `/*`、App Links は `pathPrefix: "/"` なので**リンクは確実に
 * アプリへ来る**。受け側で捨てているだけ、という気づきにくい壊れ方になる。
 *
 * ここで「ロケール判定を 1 文字まで緩める」方向へ倒してはいけない。
 * `/a/...` のような別のルートまで巻き込み、#1027 の再発につながる。
 *
 * @param path `Linking.parse(url).path`（先頭スラッシュ無し / 無ければ null）
 * @returns 採用できる場合は "/ja-JP/profile" 形式 / それ以外は null
 */
export const toInAppPath = (path: string | null | undefined): string | null => {
	const normalized = path?.replace(/^\/+/, "") ?? "";
	if (!normalized) return null;
	const [firstSegment, secondSegment] = normalized.split("/");
	if (!firstSegment) return null;

	// #721 共有リンク。token の «形» まで見て、壊れた URL で空の画面へ行かせない
	if (firstSegment === SHARE_LINK_PATH_PREFIX) {
		if (!secondSegment || !isShareLinkTokenShape(secondSegment)) return null;
		// 余計なセグメントやクエリは落とす。行き先の決定に必要なのは token だけ
		return `/${SHARE_LINK_PATH_PREFIX}/${secondSegment}`;
	}

	if (!isValidBcp47Tag(firstSegment)) return null;
	// #1135 `/[locale]/auth/*` は «クエリ込み» でしか意味を持たない route なので、行き先として採用しない
	if (secondSegment === "auth") return null;
	return `/${normalized}`;
};
