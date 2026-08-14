/**
 * 🔗 「アプリで開く」ボタンが実際に踏む URL を組み立てる。
 *
 * ## なぜ環境ごとに URL を変える必要があるのか（実機で踏んだ）
 * Universal Links / App Links は «普通のブラウザ» なら https の URL をそのまま踏むだけで
 * アプリが開く。しかし SNS のアプリ内ブラウザ（in-app browser, 以下 IAB）は WebView で、
 * **https のナビゲーションを WebView 内で処理してしまい App Links が発火しない**。
 *
 * 実機で確認した症状:
 *   Android + Instagram のアプリ内ブラウザで投票の共有 URL を開き
 *   「アプリで開く」を押しても **Instagram のブラウザから出られない**。
 *   （同じ Android でも LINE のアプリ内ブラウザからはアプリが開く）
 *
 * Android にはこれ専用の逃げ道として **`intent://` URI** がある。
 * WebView がそのままでは処理できないスキームなので、Meta 系 IAB は
 * これを OS へ委譲し、`package=` で指定したアプリが起動する。
 *
 * ## ⚠️ 効いている経路を «ついでに» 変えないこと
 * この関数が `intent://` を返すのは **Android かつ Meta 系 IAB のときだけ**。
 * - 通常の Chrome は App Links が素直に効くので https のまま
 * - LINE の IAB は実機で «開ける» ことを確認済み。動いているものを触らない
 * - iOS に `intent://` は存在しない（別オリジン経由 = OIA relay で成功率を上げている）
 *
 * 対象を広げたくなったら、まず実機でその IAB が壊れていることを確かめること。
 */

/** 「アプリで開く」の遷移先を決めるのに必要な入力 */
export type OpenInAppUrlInput = {
	/** アプリで開きたい https の URL（Universal Link） */
	universalUrl: string;
	/** User-Agent 文字列 */
	userAgent: string;
	/** OIA relay 経由の URL（iOS 用）。無ければ universalUrl を使う */
	relayUrl?: string;
	/** アプリ未インストール時の逃がし先（Play ストア）。無ければ付けない */
	storeUrl?: string;
	/** Android の applicationId。app.config.ts の android.package と一致させること */
	androidPackage: string;
};

/** Instagram / Facebook / Messenger 系のアプリ内ブラウザか */
export function isMetaInAppBrowser(userAgent: string): boolean {
	return (
		/Instagram/i.test(userAgent) ||
		/\bFBAN\b/i.test(userAgent) ||
		/\bFBAV\b/i.test(userAgent) ||
		/FB_IAB/i.test(userAgent)
	);
}

/** 何らかのアプリ内ブラウザか（案内 UI の出し分けに使う） */
export function isInAppBrowser(userAgent: string): boolean {
	return isMetaInAppBrowser(userAgent) || /Line/i.test(userAgent) || /TikTok/i.test(userAgent);
}

export const isIOSUserAgent = (userAgent: string): boolean => /iPhone|iPad|iPod/i.test(userAgent);
export const isAndroidUserAgent = (userAgent: string): boolean => /Android/i.test(userAgent);

/**
 * Android の `intent://` URI を組み立てる。
 *
 * 形式:
 *   intent://<host><path><search>#Intent;scheme=https;package=<pkg>;S.browser_fallback_url=<enc>;end
 *
 * ⚠️ **`intent://` の後ろに scheme を書かないこと。** host から始める。
 * scheme は fragment 側の `scheme=` で与える。ここを間違えると
 * `intent://https://…` のような «一見それらしい» 壊れた URI ができ、
 * 何も起きないという分かりにくい失敗になる。
 *
 * ⚠️ **fallback URL は必ずエンコードする。** `;` や `=` を含んだまま置くと
 * Intent URI のパラメータ区切りと衝突して解析が壊れる。
 *
 * @returns intent URI。universalUrl が https として解釈できなければ null
 */
export function buildAndroidIntentUrl(universalUrl: string, androidPackage: string, storeUrl?: string): string | null {
	let parsed: URL;
	try {
		parsed = new URL(universalUrl);
	} catch {
		return null;
	}
	if (parsed.protocol !== "https:") return null;

	const parts = [`scheme=${parsed.protocol.replace(":", "")}`, `package=${androidPackage}`];
	// 未インストール端末が «何も起きない» で終わらないように、あればストアへ逃がす
	if (storeUrl) parts.push(`S.browser_fallback_url=${encodeURIComponent(storeUrl)}`);

	return `intent://${parsed.host}${parsed.pathname}${parsed.search}#Intent;${parts.join(";")};end`;
}

/**
 * 「アプリで開く」ボタンの href を決める。
 *
 * @returns 実際に踏ませる URL（必ず何かしらは返る）
 */
export function resolveOpenInAppHref({
	universalUrl,
	userAgent,
	relayUrl,
	storeUrl,
	androidPackage,
}: OpenInAppUrlInput): string {
	// iOS: Safari の「同一サイト起点の UL 抑止」を避けるため別オリジン経由を優先する
	if (isIOSUserAgent(userAgent)) return relayUrl ?? universalUrl;

	// Android かつ Meta 系 IAB: https では WebView 内で完結してしまうので intent:// で OS へ委譲する
	if (isAndroidUserAgent(userAgent) && isMetaInAppBrowser(userAgent)) {
		return buildAndroidIntentUrl(universalUrl, androidPackage, storeUrl) ?? universalUrl;
	}

	return universalUrl;
}
