import { createWithEqualityFn } from "zustand/traditional";

// #501 【設計】CDN 向け Cookie を保持する型定義
type CdnCookie = {
	name: string;
	value: string;
};

// #501 【設計】Cloud CDN のサインド Cookie 名
const CLOUD_CDN_COOKIE_NAME = "Cloud-CDN-Cookie";

/**
 * CDN サインド Cookie を管理するストア。
 *
 * - ネイティブ（Android / iOS）の動画再生時に Cookie ヘッダを付与するために使用する
 * - Web ではブラウザが自動的に Cookie を送信するため不要だが、一貫性のためストアは共用する
 * - Cookie 値をログに出力しないこと（セキュリティ配慮）
 */
export type CdnCookieStore = {
	/**
	 * CDN 用 Cookie の配列（現時点では Cloud-CDN-Cookie のみだが拡張性のため配列）
	 */
	cookies: CdnCookie[];

	/**
	 * レスポンスヘッダから CDN Cookie を抽出して保存する。
	 *
	 * @param headers - fetch レスポンスの Headers オブジェクト
	 */
	setFromResponseHeaders: (headers: Headers) => void;

	/**
	 * Cookie ヘッダ用の文字列を取得する（例: "Cloud-CDN-Cookie=xxxx; Other-Cookie=yyyy"）。
	 * Cookie が存在しない場合は空文字を返す。
	 */
	getCookieHeader: () => string;

	/**
	 * 全ての CDN Cookie をクリアする。
	 */
	clearCookies: () => void;
};

/**
 * CDN Cookie を取得するセレクタ。
 */
export const selectCdnCookies = (state: CdnCookieStore): CdnCookie[] => state.cookies;

/**
 * Cookie ヘッダ文字列を取得するセレクタ。
 */
export const selectCookieHeader = (state: CdnCookieStore): string =>
	state.cookies.map((c) => `${c.name}=${c.value}`).join("; ");

export const useCdnCookieStore = createWithEqualityFn<CdnCookieStore>()((set, get) => ({
	// ------ 初期状態 ------
	cookies: [],

	// ------ メソッド ------

	setFromResponseHeaders: (headers: Headers) => {
		// #501 【設計】Set-Cookie ヘッダから Cloud-CDN-Cookie を抽出する
		// NOTE: ブラウザの fetch では Set-Cookie ヘッダが取得できないことが多いが、
		//       ネイティブ環境（React Native）では取得可能
		const setCookieHeader = headers.get("set-cookie");
		if (!setCookieHeader) return;

		// 複数の Set-Cookie がカンマ区切りで返る場合と、セミコロン区切りの場合がある
		// Cloud-CDN-Cookie の形式: "Cloud-CDN-Cookie=xxxx; Path=/; ..."
		const newCookies: CdnCookie[] = [];

		// Set-Cookie ヘッダを解析（カンマまたは改行で分割されることがある）
		const cookieLines = setCookieHeader.split(/,(?=[^;]*=)/);
		for (const line of cookieLines) {
			// 各 cookie 行は "name=value; attr1; attr2=val" 形式
			const parts = line.trim().split(";");
			const nameValuePart = parts[0];
			if (!nameValuePart) continue;

			const equalIndex = nameValuePart.indexOf("=");
			if (equalIndex === -1) continue;

			const name = nameValuePart.substring(0, equalIndex).trim();
			const value = nameValuePart.substring(equalIndex + 1).trim();

			// Cloud-CDN-Cookie のみを対象とする
			if (name === CLOUD_CDN_COOKIE_NAME && value) {
				newCookies.push({ name, value });
			}
		}

		if (newCookies.length === 0) return;

		set((state) => {
			// 既存の Cookie と新規 Cookie をマージ（同名なら上書き）
			const cookieMap = new Map<string, CdnCookie>();
			for (const cookie of state.cookies) {
				cookieMap.set(cookie.name, cookie);
			}
			for (const cookie of newCookies) {
				cookieMap.set(cookie.name, cookie);
			}
			return { cookies: Array.from(cookieMap.values()) };
		});
	},

	getCookieHeader: () => {
		const { cookies } = get();
		if (cookies.length === 0) return "";
		return cookies.map((c) => `${c.name}=${c.value}`).join("; ");
	},

	clearCookies: () => set({ cookies: [] }),
}));
