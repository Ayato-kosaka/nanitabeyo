import type { PublicLocale } from "../constants/publicLocales";
import type { ShareLinkTargetType } from "../constants/shareLinks";

/**
 * 🔗 共有リンクのレスポンス型（#721）。
 */

/** `POST /v1/share-links` のレスポンス */
export type CreateShareLinkResponse = {
	/** 共有トークン（`s1_` 始まり）。DB には sha256 しか無いので、返せるのはここだけ */
	token: string;
	/**
	 * そのまま共有できる絶対 URL（`https://app.nanitabeyo.net/s/<token>`）。
	 *
	 * app 側で base URL を組み立て直させないための値。組み立てを 2 箇所に置くと、
	 * 環境（development / production）でドメインがずれる。
	 */
	url: string;
	/** 共有カードの言語（作成時に固定される） */
	locale: PublicLocale;
};

/**
 * `GET /v1/share-links/:token/resolve` のレスポンス。
 *
 * アプリはこれを受けて、`target.type` ごとの **allowlist された Router** へ変換する。
 * ここで path を返さないのは、サーバが返した文字列をそのまま `router.push` すると
 * サーバ側の不備がそのままアプリ内の任意遷移になるため。
 */
export type ResolveShareLinkResponse = {
	/** `share_links.schema_version`。アプリが将来の形を安全に無視するために返す */
	schemaVersion: number;
	target: {
		type: ShareLinkTargetType;
		/** 主たる対象の ID（`dish_media` なら先頭の dish_media.id、投票なら session.id） */
		id: string;
		/** type 固有の追加情報（`dish_media` の残り ID、投票の shareToken など） */
		params: Record<string, unknown>;
	};
};
