/**
 * 共有された SNS の URL を「ルールだけで」解釈する純粋関数。
 *
 * #1399（親 #1375）SNS URL Import の最初の一枚。
 * API（取り込みエンドポイント）と app-expo（共有シート / 貼り付け欄）の両方が
 * **同じ判定** を使う必要があるため `shared/` に置く。判定を 2 か所に書くと必ずずれる。
 *
 * ## この関数がやらないこと（意図的な制約）
 *
 * - **ネットワークを一切叩かない。** oEmbed も HEAD も fetch も行わない。
 *   結果として「URL の文字列だけでは確定できないこと」が残る。それらは戻り値の形で
 *   呼び出し側へ申告する（`kind: "shortlink"` と `requiresShortsCheck`）。黙って推測しない。
 * - **LLM を使わない。** 判定はすべて正規表現とホスト名の完全一致で閉じている。
 * - **DB を見ない。** 重複判定（自然キー `(provider, external_content_id, dish_id)`）は
 *   呼び出し側の責務で、ここは `externalContentId` を確定させるところまで。
 *
 * ## 対象 provider は 3 つだけ
 *
 * `instagram` / `tiktok` / `youtube`。X と threads は #1399 のリーダー確定で対象外であり、
 * `dish_media_external_embeddings` の CHECK 制約（`dmee_provider_check`、
 * `infra/supabase/migrations/20260819T0200_create_dish_media_external_embeddings.sql`）でも
 * 構造的に弾かれている。対象外の URL は **例外を投げずに `null` を返す**。
 * 呼び出し側が「取り込めない URL」として素直に扱えるようにするためで、
 * `x.com` を貼った人にスタックトレースを見せる理由は無い。
 *
 * ## セキュリティ上の約束
 *
 * - provider の判定は **ホスト名の完全一致**（許可リスト）で行う。`includes()` も
 *   `endsWith()` も使わない。`tiktok.com.evil.example` / `evil.example/tiktok.com/...` /
 *   `evil-instagram.com` はすべて `null` になる。
 * - `user:pass@host` 形式、`https` / `http` 以外のスキーム、明示ポートは拒否する。
 * - `canonicalUrl` は **入力の文字列を引き回さずこちらで組み立て直す**。
 *   通すのは正規表現を通過した ID と（TikTok の）ユーザー名だけなので、
 *   入力に混ざった細工が canonical へ漏れない。
 */

/** 取り込み対象の SNS。`dish_media_external_embeddings.provider` と同じ値域。 */
export const SNS_PROVIDERS = ["instagram", "tiktok", "youtube"] as const;

export type SnsProvider = (typeof SNS_PROVIDERS)[number];

/**
 * 投稿が一意に特定できた状態。そのまま `dish_media_external_embeddings` へ書ける。
 */
export type SnsUrlContent = {
	kind: "content";
	provider: SnsProvider;
	/** provider 側の投稿 ID。`(provider, external_content_id, dish_id)` の自然キーに使う */
	externalContentId: string;
	/** 表示・外部遷移に使う正規 URL。トラッキングパラメータを含まない */
	canonicalUrl: string;
	/**
	 * Instagram カルーセルの `?img_index=N`（1 始まり）。指定が無ければ `undefined`。
	 *
	 * #1399 リーダー確定「カルーセルの `?img_index=N` は捨てない」に対応する。
	 * ただし **`canonicalUrl` へは入れない**。canonical に入れると
	 * 「同じ投稿の 1 枚目と 2 枚目」で別の URL になり、自然キーの一意性の意味が壊れる。
	 * 保持したいのは「ユーザーが見せたかった 1 枚」であって同一性ではないので、
	 * 独立した値として返し、保存先の列は別 PR（migration が要る）で用意する。
	 */
	mediaIndex?: number;
	/**
	 * `true` のとき「YouTube だが Shorts かどうかが URL からは確定していない」。
	 *
	 * `youtu.be/{id}` と `/watch?v={id}` が該当する。実測（#1399 設計コメント §5-2-2）で
	 * `youtu.be` は `/watch?v=` へ 303 するだけであり、**短縮 URL と watch 形式からは
	 * 縦動画かどうかを URL だけで判定できない**。
	 *
	 * 呼び出し側は `HEAD https://www.youtube.com/shorts/{id}` のステータスで確定させること
	 * （200 = Shorts / 303 = 横動画 / 404 = 無い）。これは YouTube 側の実装であって
	 * 契約された仕様ではないため、**判定できなかったときは弾かずユーザーに確認させて通す**
	 * （リーダー確定 §3 の条件 1）。
	 */
	requiresShortsCheck?: boolean;
};

/**
 * provider は確定したが、**投稿 ID がネットワークなしでは取り出せない**状態。
 *
 * TikTok の共有ボタンが出す `vm.tiktok.com/{code}` / `vt.tiktok.com/{code}` /
 * `tiktok.com/t/{code}` がこれにあたる。code から数字 ID への対応は TikTok 側にしか無い。
 *
 * ここで `null` を返さずこの形を返すのは、`null`（＝対応していない URL）と
 * 「対応しているが展開が要る」を呼び出し側が区別できないと、
 * **TikTok アプリの共有ボタンから来た URL が全部「非対応」に見える**ためである。
 * 展開は API 側で `redirect: "manual"` / 最大 3 ホップ / 各ホップ許可リスト再検証で行う（#1399 §5-1）。
 */
export type SnsUrlShortlink = {
	kind: "shortlink";
	provider: SnsProvider;
	/** 展開のために取りに行く URL。https 固定・許可リスト済みホストのみ */
	expandUrl: string;
};

export type SnsUrlParseResult = SnsUrlContent | SnsUrlShortlink;

// ---------------------------------------------------------------------------
// ホスト許可リスト
//
// すべて **完全一致** で引く。サブドメインを増やしたいときはここへ明示的に足すこと。
// `www.` / `m.` を剥がしてから照合する実装にしないのは、剥がす処理そのものが
// `www.tiktok.com.evil.example` のような入力で誤爆する余地を作るためである。
// ---------------------------------------------------------------------------

/** 投稿 URL をそのまま解釈できる YouTube のホスト */
const YOUTUBE_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com"]);

/** YouTube の短縮ホスト。パスに ID が入っているので展開は要らない */
const YOUTUBE_SHORT_HOSTS = new Set(["youtu.be", "www.youtu.be"]);

/** 投稿 URL をそのまま解釈できる TikTok のホスト */
const TIKTOK_HOSTS = new Set(["tiktok.com", "www.tiktok.com", "m.tiktok.com"]);

/** TikTok の短縮ホスト。展開しないと数字 ID が得られない */
const TIKTOK_SHORT_HOSTS = new Set(["vm.tiktok.com", "vt.tiktok.com"]);

/**
 * Instagram のホスト。
 *
 * `instagr.am` と `m.instagram.com` は **パスを保ったままホストだけ差し替わる**ことを実測した
 * （`instagr.am/p/{code}/` → 301 `www.instagram.com/p/{code}/`、
 * `m.instagram.com/reel/{code}/` → 301 `www.instagram.com/reel/{code}/`）。
 * したがってネットワーク無しでローカル変換でき、短縮 URL 扱いにする必要が無い。
 */
const INSTAGRAM_HOSTS = new Set([
	"instagram.com",
	"www.instagram.com",
	"m.instagram.com",
	"instagr.am",
	"www.instagr.am",
]);

// ---------------------------------------------------------------------------
// ID の形
// ---------------------------------------------------------------------------

/** YouTube の動画 ID は 11 文字固定 */
const YOUTUBE_VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

/** TikTok の投稿 ID は 19 桁の数字（実測）。将来の桁数変動に少しだけ余裕を持たせる */
const TIKTOK_VIDEO_ID_PATTERN = /^[0-9]{15,25}$/;

/** TikTok のユーザー名。空になりうる（短縮 URL の解決先が `/@/video/{id}` になる実測がある） */
const TIKTOK_USERNAME_PATTERN = /^[A-Za-z0-9._]{0,24}$/;

/** TikTok の短縮コード */
const TIKTOK_SHORT_CODE_PATTERN = /^[A-Za-z0-9]{5,32}$/;

/**
 * Instagram の shortcode。**長さで弾かない**（11 文字が多いが固定ではない）。
 */
const INSTAGRAM_SHORTCODE_PATTERN = /^[A-Za-z0-9_-]{5,32}$/;

/** Instagram のユーザー名（`/{username}/reel/{code}/` 形式の判定用） */
const INSTAGRAM_USERNAME_PATTERN = /^[A-Za-z0-9._]{1,30}$/;

/**
 * Instagram の予約パス。ユーザー名の位置に来ても **ユーザー名として扱ってはいけない**。
 *
 * これが無いと `/share/reel/{code}/`（解決先が未検証で、今回は非対応と決めた形）が
 * 「`share` というユーザーの reel」として通ってしまう。
 */
const INSTAGRAM_RESERVED_PATH_SEGMENTS = new Set([
	"accounts",
	"direct",
	"explore",
	"p",
	"reel",
	"reels",
	"s",
	"share",
	"stories",
	"tv",
]);

// ---------------------------------------------------------------------------
// 入力の前処理
// ---------------------------------------------------------------------------

/**
 * 受け付ける入力長の上限。共有シートは説明文ごと渡してくるので URL 単体より長いが、
 * 数 KB を超えるものは貼り付け事故なので正規表現に食わせる前に落とす（ReDoS 予防も兼ねる）。
 */
const MAX_INPUT_LENGTH = 4096;

/**
 * 貼り付けテキストから最初の URL を切り出す。
 *
 * `javascript:` / `data:` / `file:` はここで構造的に落ちる（http/https しか拾わない）。
 */
const URL_IN_TEXT_PATTERN = /https?:\/\/[^\s<>"'`\\]+/i;

/**
 * URL の末尾に食い込む句読点・閉じ括弧・閉じ引用符。
 * 日本語圏の共有テキストは `…を見て https://... 。` のように書かれることがある。
 */
const TRAILING_PUNCTUATION_PATTERN = /[.,;:!?)\]}>"'”’」』】…、。・]+$/;

/**
 * 入力文字列から、安全に解釈してよい `URL` を取り出す。
 *
 * 弾いた場合は `null`。ここを通った時点で「https/http・認証情報なし・既定ポート」が保証される。
 */
function extractSafeUrl(input: string | null | undefined): URL | null {
	if (typeof input !== "string") return null;
	if (input.length === 0 || input.length > MAX_INPUT_LENGTH) return null;

	// 全角で貼られた URL（`ｈｔｔｐｓ：／／…`）を救う。NFKC は ASCII をそのまま残すので
	// ID や shortcode の文字は変化しない。キリル文字などの同形異字は NFKC では変換されないため、
	// 見た目が似ているだけの別ドメインは後段のホスト完全一致で弾かれる。
	const normalized = input.normalize("NFKC");

	const matched = URL_IN_TEXT_PATTERN.exec(normalized);
	if (!matched) return null;

	const candidate = matched[0].replace(TRAILING_PUNCTUATION_PATTERN, "");

	let url: URL;
	try {
		url = new URL(candidate);
	} catch {
		// 推測で補完しない。パースできないものは非対応として扱う。
		return null;
	}

	// URL_IN_TEXT_PATTERN で保証済みだが、この関数単体の不変条件として明示しておく。
	if (url.protocol !== "https:" && url.protocol !== "http:") return null;

	// `https://www.tiktok.com@evil.example/...` のような、ホストを誤認させる古典的な形を弾く。
	if (url.username !== "" || url.password !== "") return null;

	// 443/80 は URL API が空文字へ正規化する。明示された非既定ポートは受け付けない。
	if (url.port !== "") return null;

	return url;
}

/**
 * 照合用のホスト名。`URL` の時点で小文字化・punycode 化されているので、
 * ここでは DNS 的に等価な末尾ドット（`www.tiktok.com.`）だけを落とす。
 */
function hostKey(url: URL): string {
	return url.hostname.replace(/\.$/, "");
}

/** パスを空要素なしのセグメント配列にする。`%2F` は分割しない（デコードしない）。 */
function pathSegments(url: URL): string[] {
	return url.pathname.split("/").filter((segment) => segment.length > 0);
}

// ---------------------------------------------------------------------------
// provider 別のパース
// ---------------------------------------------------------------------------

/**
 * YouTube。**受け付けるのは Shorts のみ**（#1399 リーダー確定 §1）。
 *
 * - `/shorts/{id}` … そのまま確定
 * - `/watch?v={id}` … ID は取れるが Shorts か分からないので `requiresShortsCheck` を立てる。
 *   「`/watch` は非対応」と切り捨てないのは、リーダー確定 §3 が
 *   「URL の形ではなく動画の実体（`/shorts/{id}` への HEAD）で判定する」を採用したため。
 * - `/embed/{id}` `/live/{id}` `/@channel` … 非対応（`null`）。
 *   embed はプレイヤー URL であって投稿 URL ではなく、live は Shorts ではない。
 */
function parseYouTube(url: URL): SnsUrlParseResult | null {
	const segments = pathSegments(url);

	if (segments.length === 2 && segments[0].toLowerCase() === "shorts") {
		const id = segments[1];
		if (!YOUTUBE_VIDEO_ID_PATTERN.test(id)) return null;
		return {
			kind: "content",
			provider: "youtube",
			externalContentId: id,
			canonicalUrl: `https://www.youtube.com/shorts/${id}`,
		};
	}

	if (segments.length === 1 && segments[0].toLowerCase() === "watch") {
		// ID の抽出にクエリを読むのはここだけ。読んだあとクエリは canonical から捨てる。
		const id = url.searchParams.get("v");
		if (!id || !YOUTUBE_VIDEO_ID_PATTERN.test(id)) return null;
		return {
			kind: "content",
			provider: "youtube",
			externalContentId: id,
			canonicalUrl: `https://www.youtube.com/shorts/${id}`,
			requiresShortsCheck: true,
		};
	}

	return null;
}

/**
 * `youtu.be/{id}`。ID はパスに入っているのでネットワーク無しで取れるが、
 * Shorts かどうかは分からない（実測: `youtu.be/{id}` → 303 `/watch?v={id}`）。
 */
function parseYouTubeShortHost(url: URL): SnsUrlParseResult | null {
	const segments = pathSegments(url);
	if (segments.length !== 1) return null;

	const id = segments[0];
	if (!YOUTUBE_VIDEO_ID_PATTERN.test(id)) return null;

	return {
		kind: "content",
		provider: "youtube",
		externalContentId: id,
		canonicalUrl: `https://www.youtube.com/shorts/${id}`,
		requiresShortsCheck: true,
	};
}

/**
 * TikTok。
 *
 * - `/@{user}/video/{id}` … 標準形
 * - `/@/video/{id}` … 短縮 URL の解決先でユーザー名が空になる実測がある。
 *   この形は実際に 200 を返し、oEmbed も 200 を返すことを確認済みなので canonical にも使える。
 * - `/video/{id}` … ユーザー名の無い形。ID は一意に取れるので受ける（canonical は `/@/video/{id}`）
 * - `/t/{code}` … 短縮。展開が要る
 *
 * `external_content_id` は **パスの数字 ID を SoT** とする（リーダー確定）。
 * `@user` は短縮 URL 経由で失われることがあるため同一性判定に使わない。
 * `/@{user}/photo/{id}`（写真投稿）は今回の確定スコープに無いので `null`。
 */
function parseTikTok(url: URL): SnsUrlParseResult | null {
	const segments = pathSegments(url);

	if (segments.length === 2 && segments[0].toLowerCase() === "t") {
		const code = segments[1];
		if (!TIKTOK_SHORT_CODE_PATTERN.test(code)) return null;
		return { kind: "shortlink", provider: "tiktok", expandUrl: `https://www.tiktok.com/t/${code}/` };
	}

	let username = "";
	let rest = segments;

	if (segments.length > 0 && segments[0].startsWith("@")) {
		username = segments[0].slice(1);
		if (!TIKTOK_USERNAME_PATTERN.test(username)) return null;
		rest = segments.slice(1);
	}

	if (rest.length !== 2 || rest[0].toLowerCase() !== "video") return null;

	const id = rest[1];
	if (!TIKTOK_VIDEO_ID_PATTERN.test(id)) return null;

	return {
		kind: "content",
		provider: "tiktok",
		externalContentId: id,
		canonicalUrl: `https://www.tiktok.com/@${username}/video/${id}`,
	};
}

/** `vm.tiktok.com/{code}` / `vt.tiktok.com/{code}`。展開しないと数字 ID が得られない。 */
function parseTikTokShortHost(url: URL): SnsUrlParseResult | null {
	const segments = pathSegments(url);
	if (segments.length !== 1) return null;

	const code = segments[0];
	if (!TIKTOK_SHORT_CODE_PATTERN.test(code)) return null;

	// ホストは許可リストを通った値しか来ないので、そのまま組み立ててよい。
	return { kind: "shortlink", provider: "tiktok", expandUrl: `https://${hostKey(url)}/${code}/` };
}

/** `?img_index=N` を 1 始まりの整数として読む。壊れた値は黙って捨てる（推測で補完しない）。 */
function parseMediaIndex(url: URL): number | undefined {
	const raw = url.searchParams.get("img_index");
	if (!raw || !/^[0-9]{1,2}$/.test(raw)) return undefined;

	const index = Number.parseInt(raw, 10);
	if (index < 1 || index > 20) return undefined;

	return index;
}

/**
 * Instagram。reel と feed 投稿の両方を受ける（#1399 リーダー確定 §1）。
 *
 * - `/reel/{code}/` `/reels/{code}/` `/{username}/reel/{code}/` … reel。canonical は `/reel/{code}/`
 * - `/p/{code}/` `/{username}/p/{code}/` … feed 投稿。canonical は `/p/{code}/`
 * - `/tv/{code}/`（IGTV）、`/stories/...`、`/share/...` … 非対応（`null`）
 *
 * `/share/...` を落としているのは、この形が実際にどこへ解決されるかを **確認できていない**ため。
 * 未確認のものを通すと誤った canonical を保存してしまう。実機で確認できた時点で足すこと。
 *
 * reel は `/p/{code}/` でも開けるため、同じ投稿から 2 種類の canonical が生まれうるが、
 * 同一性は shortcode（= `externalContentId`）で見るので自然キーは割れない。
 */
function parseInstagram(url: URL): SnsUrlParseResult | null {
	const segments = pathSegments(url);

	let kindSegment: string;
	let code: string;

	if (segments.length === 2) {
		kindSegment = segments[0].toLowerCase();
		code = segments[1];
	} else if (
		segments.length === 3 &&
		INSTAGRAM_USERNAME_PATTERN.test(segments[0]) &&
		!INSTAGRAM_RESERVED_PATH_SEGMENTS.has(segments[0].toLowerCase())
	) {
		// `/{username}/reel/{code}/` 形式。ユーザー名は canonical には残さない
		kindSegment = segments[1].toLowerCase();
		code = segments[2];
	} else {
		return null;
	}

	if (kindSegment !== "p" && kindSegment !== "reel" && kindSegment !== "reels") return null;
	if (!INSTAGRAM_SHORTCODE_PATTERN.test(code)) return null;

	const canonicalPath = kindSegment === "p" ? "p" : "reel";
	const mediaIndex = parseMediaIndex(url);

	return {
		kind: "content",
		provider: "instagram",
		externalContentId: code,
		// 末尾スラッシュ付きが Instagram 自身の出す形
		canonicalUrl: `https://www.instagram.com/${canonicalPath}/${code}/`,
		...(mediaIndex === undefined ? {} : { mediaIndex }),
	};
}

// ---------------------------------------------------------------------------
// 公開 API
// ---------------------------------------------------------------------------

/**
 * 共有された文字列（URL 単体でも、説明文つきの共有テキストでもよい）を解釈する。
 *
 * - 投稿が確定した … `{ kind: "content", provider, externalContentId, canonicalUrl, ... }`
 * - provider は分かるが展開が要る … `{ kind: "shortlink", provider, expandUrl }`
 * - 対象外・解釈不能 … `null`（**例外は投げない**）
 *
 * `canonicalUrl` からはクエリとフラグメントを必ず落とす。`igsh` / `si` / `utm_*` /
 * `is_from_webapp` などのトラッキングパラメータは、
 * (1) 同じ投稿が別の行として保存されるのを防ぐため、
 * (2) 共有した人を特定しうる値を保存しないため、
 * の 2 つの理由で残してはならない。
 */
export function parseSnsUrl(input: string | null | undefined): SnsUrlParseResult | null {
	const url = extractSafeUrl(input);
	if (!url) return null;

	const host = hostKey(url);

	if (YOUTUBE_HOSTS.has(host)) return parseYouTube(url);
	if (YOUTUBE_SHORT_HOSTS.has(host)) return parseYouTubeShortHost(url);
	if (TIKTOK_HOSTS.has(host)) return parseTikTok(url);
	if (TIKTOK_SHORT_HOSTS.has(host)) return parseTikTokShortHost(url);
	if (INSTAGRAM_HOSTS.has(host)) return parseInstagram(url);

	return null;
}
