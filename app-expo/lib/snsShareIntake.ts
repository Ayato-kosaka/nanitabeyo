// lib/snsShareIntake.ts
//
// #1400（親 #1375）共有された URL を受け取って «取り込み» へ渡す、判定だけの純関数。
//
// ## この層の責務は «行き先を決めること» だけ
//
// 実際に OS から URL を受け取る部分（Android の `Intent.EXTRA_TEXT` / iOS の Share Extension）は
// PR2 / PR3 の担当で、このファイルは **「URL 文字列を渡されたときに何をするか」** しか知らない。
// そのおかげで実機無しにユニットテストで全分岐を固定できる（設計 §5 PR1）。
//
// ## 判定は #1399 の `parseSnsUrl()` に一本化する
//
// provider の判定・ID の抽出・canonical 化はすべて `shared/utils/snsUrl.ts` が持っている。
// ここで「tiktok.com を含むか」のような判定を書き足すと、API 側（取り込みエンドポイント）と
// 判定がずれる。**ここは parseSnsUrl の戻り値の形で分岐するだけ**にすること。
//
// ## 3 分岐（設計 §3）
//
// | `parseSnsUrl()` | この層の振る舞い |
// | --- | --- |
// | `kind: "content"` | 取り込み確認へ進む（`/{locale}/add-record?url=<canonical>`） |
// | `kind: "shortlink"` | 展開は API の仕事なので叩かない。「準備中」として確認画面で受ける |
// | `null` | 黙って落とさない。対応 provider を明示する画面を出す |

import { parseSnsUrl, type SnsUrlContent, type SnsUrlShortlink } from "@shared/utils/snsUrl";

/**
 * 取り込み確認画面のルート。`app/[locale]/add-record.tsx` に対応する。
 *
 * #1375（5 巡目）ファイル名を `sns-import` から `add-record` へ改名した。この画面は
 * «＋ で開く追加のシート» で、SNS 取り込みと «食べたを記録» の 2 つのタブを持つ。
 * `sns-import` という名前は片方のタブしか指しておらず、実装を読む人を毎回迷わせていた。
 * 定数名は **役割そのまま**（この定数の利用者は «取り込みの着地点» としてしか使わない）。
 */
export const SNS_IMPORT_PATHNAME = "/[locale]/add-record" as const;

/** ログイン画面のルート。`?next=` の作法は lib/authNext.ts（#1359）に従う */
export const LOGIN_PATHNAME = "/[locale]/auth/login" as const;

/**
 * 取り込み確認画面が描くべき状態。
 *
 * `expandPending` を `unsupported` と混ぜてはいけない。TikTok アプリの共有ボタンが出すのは
 * `vm.tiktok.com/{code}` なので、混ぜると **TikTok の主要導線が丸ごと「非対応」に見える**
 * （`shared/utils/snsUrl.ts` の `SnsUrlShortlink` の doc コメントと同じ理由）。
 */
export type SnsShareIntakeView =
	| { state: "confirm"; content: SnsUrlContent }
	| { state: "expandPending"; shortlink: SnsUrlShortlink }
	| { state: "unsupported" };

/**
 * 取り込み確認画面へ渡された `url` から、描くべき状態を決める。
 *
 * `url` が無い（共有以外の経路でこのルートを直接開いた / ログイン往復で落ちた）場合も
 * `unsupported` に倒す。空の画面を出すより「何が対応しているか」を出す方が親切で、
 * 呼び出し側に「url が無い」専用の分岐を作らせずに済む。
 */
export const resolveSnsShareIntakeView = (url: string | null | undefined): SnsShareIntakeView => {
	const parsed = parseSnsUrl(url);
	if (!parsed) return { state: "unsupported" };
	if (parsed.kind === "shortlink") return { state: "expandPending", shortlink: parsed };
	return { state: "confirm", content: parsed };
};

/**
 * 取り込み確認画面の絶対パス。**ログイン後の復帰先（`?next=`）としてそのまま使える形**にする。
 *
 * `lib/authNext.ts` の `resolveNextPath()` は「先頭 `/` の内部パス」しか通さないので、
 * ここで組み立てた文字列がその検証を通ることがこの関数の契約になる
 * （`lib/snsShareIntake.test.ts` が実際に `resolveNextPath()` へ通して固定している）。
 */
export const buildSnsImportPath = (locale: string, url?: string | null): string =>
	url ? `/${locale}/add-record?url=${encodeURIComponent(url)}` : `/${locale}/add-record`;

/**
 * 共有を受け取ったときの遷移先。`router.push()` にそのまま渡せる形で返す。
 *
 * 純関数に留めるため `router` を引数に取らない（`lib/authNext.ts` と同じ方針）。
 */
export type SnsShareIntakeRoute =
	| { type: "import"; pathname: typeof SNS_IMPORT_PATHNAME; params: { locale: string; url?: string } }
	| { type: "login"; pathname: typeof LOGIN_PATHNAME; params: { locale: string; next: string } };

/**
 * 🔗 共有されたテキスト（URL 単体でも、説明文つきの共有テキストでもよい）の行き先を決める。
 *
 * ## 未ログインのとき URL を捨てない（設計 §3 の縮退表）
 *
 * 取り込みはログインが要る操作だが、ここで URL を捨てるとユーザーは
 * **アプリを切り替えて共有からやり直す**ことになる。既存の作法（`?next=` に行き先を載せて
 * ログインへ push する。`app/[locale]/(tabs)/profile/index.tsx:169` ほか 4 箇所）に乗せ、
 * ログイン後に **同じ URL の取り込み確認へ復帰**させる。新しい保持の仕組みは作らない。
 *
 * ## 対象外 URL ではログインへ送らない
 *
 * `parseSnsUrl()` が `null` を返した URL は、ログインしても取り込めない。
 * ログインを挟んでから「非対応です」と言うのは二重に無駄なので、確認画面へ直行して
 * 対応 provider を明示する。Android の `ACTION_SEND` は URL 以外のテキストも飛んでくるため
 * （設計 §6 R-4）、この経路は例外ではなく **主要経路のひとつ**になりうる。
 *
 * ## `url` に載せるのは parseSnsUrl が組み直した URL だけ
 *
 * 共有テキストは第三者が作った任意の文字列である。それを URL のクエリへそのまま載せると、
 * 履歴・ログ・（web では）アドレスバーへ素通しすることになる。`canonicalUrl` / `expandUrl` は
 * 正規表現を通過した ID から `parseSnsUrl()` が組み立て直した値なので、これだけを運ぶ。
 * 対象外のときは **何も載せない**（画面の文言は URL を必要としない）。
 */
export const resolveSnsShareIntake = (params: {
	/** 共有されたテキスト。OS から来た生の値 */
	sharedText: string | null | undefined;
	/** 現在のロケール（`useLocale().locale`） */
	locale: string;
}): SnsShareIntakeRoute => {
	const view = resolveSnsShareIntakeView(params.sharedText);
	const url =
		view.state === "confirm"
			? view.content.canonicalUrl
			: view.state === "expandPending"
				? view.shortlink.expandUrl
				: undefined;

	// #1375 実機確認: **ログインへ寄り道させない。**
	//
	// 取り込みは `dish_media.user_id` を NULL のままにし、ユーザーとの紐付けは
	// `reactions(save)` が持つ（匿名ユーザーも実 user id を持つので save は書ける）。
	// API も `AuthAnonGuard` なので、共有からの着地でログインを挟む理由が無い。
	// 挟むと「共有した直後にログイン画面が出る」という、一番離脱する形になる。
	//
	// ログインが要るのは «食べたを記録»（`dish_reviews` を書く公開レビュー）だけで、
	// その判定は取り込み画面側の上部タブが行う。
	return {
		type: "import",
		pathname: SNS_IMPORT_PATHNAME,
		params: { locale: params.locale, ...(url ? { url } : {}) },
	};
};
