// lib/authNext.ts
//
// #1359 【設計】ログイン画面（app/[locale]/auth/login.tsx）の «行き先» を決める純関数を 1 箇所に集める。
//
// ログインをモーダルからルートへ移すと、「ログインが終わった後どこへ帰るか」を
// URL（`?next=`）とナビゲーション履歴の 2 つで表現することになる。どちらも
// 実機・実ブラウザでしか再現しづらい経路（OAuth の全画面リダイレクト、
// ディープリンク、Android のハードウェアバック）で使われるため、判定だけを
// router から切り離してここに置き、分岐をユニットテストで固定する。
//
// ⚠️ `router` を引数に取らないこと。boolean と文字列だけを受けて «結果» を返す形にしてある。
// router を渡す形にすると、テストが expo-router のモックの都合に引きずられる。

import { isValidBcp47Tag } from "./deepLinkTarget";

/**
 * ログイン後の行き先。
 *
 * - `back`: 直前の画面へ戻る。元画面はマウントされたままなので、URL に出ていない
 *   画面内 state（例: 店舗選択で選んでいる店 = review/selectRestaurant.tsx の useState）ごと復帰できる。
 * - `replace`: 履歴が無い（コールドロード / web の OAuth 全画面リダイレクト）ときの保険。
 *   URL だけで再現できる行き先へ置き換える。
 */
export type PostLoginTarget = { type: "back" } | { type: "replace"; href: string };

/** 制御文字（改行を含む）。URL に載せて良いものが 1 つも無いので丸ごと弾く */
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

/** `http:` / `https:` / `javascript:` のようなスキーム付き URL か */
const HAS_SCHEME = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;

/**
 * パスの先頭セグメントを、現在の locale で «上書き» する。
 *
 * `next` は別ロケールで組まれた URL（共有された `/en-US/...`、以前のセッションの
 * ディープリンク）で渡ってきうる。そのまま遷移すると、ログインを挟んだ瞬間だけ
 * 表示言語が変わる。先頭セグメントがロケールの形をしているときだけ差し替える。
 *
 * 先頭がロケールでないパス（`/s/<token>` の共有リンク等）は locale を持たない route なので、
 * ロケールを «足さず» にそのまま通す。足すと `/ja-JP/s/...` という存在しない route になる。
 */
const withCurrentLocale = (path: string, locale: string): string => {
	// クエリ・フラグメントを先に切り離す。`/en-US?tab=x` のような形で
	// 先頭セグメントが "en-US?tab=x" になり、ロケール判定に当たらなくなるのを避ける
	const suffixIndex = path.search(/[?#]/);
	const pathname = suffixIndex < 0 ? path : path.slice(0, suffixIndex);
	const suffix = suffixIndex < 0 ? "" : path.slice(suffixIndex);

	const segments = pathname.split("/");
	// pathname は必ず "/" 始まりなので segments[0] は空文字、segments[1] が先頭セグメント
	const first = segments[1];
	if (!first || !isValidBcp47Tag(first)) return path;

	segments[1] = locale;
	return `${segments.join("/")}${suffix}`;
};

/**
 * `next` がログイン画面«自身»を指しているか。
 *
 * #1359 【設計】`?next=/ja-JP/auth/login` を «ログイン済みで» 開くと、login.tsx の自動離脱が
 * 同じルートへ replace する。params が変わるだけで再マウントされない場合、離脱を 1 回に閉じる
 * `hasLeftRef` が true のまま残り、**ログイン済みなのにログイン画面に留まる**。
 * 通常導線（4 箇所）はこの値を組まないので、実際に踏めるのは自作 URL / ディープリンクだけだが、
 * 「行き先として採用してよいか」を判定するこの層で閉じておく。
 *
 * ロケールの有無は問わない（`/auth/login` も `/ja-JP/auth/login` も同じ画面）。
 * `withCurrentLocale` と同じく、先頭セグメントがロケールの形をしているときだけ 1 つ読み飛ばす。
 */
const isLoginRoutePath = (path: string): boolean => {
	const suffixIndex = path.search(/[?#]/);
	const pathname = suffixIndex < 0 ? path : path.slice(0, suffixIndex);

	// 先頭の空文字（"/" 始まりのため）と末尾スラッシュ由来の空文字を落とす
	const segments = pathname.split("/").filter(Boolean);
	const rest = segments.length > 0 && isValidBcp47Tag(segments[0]) ? segments.slice(1) : segments;

	return rest.length === 2 && rest[0] === "auth" && rest[1] === "login";
};

/**
 * 🔒 `?next=` を «アプリ内の遷移先» として採用できるかを判定し、採用できるなら
 * 現在の locale へ寄せた絶対パスを返す。
 *
 * ## 何から守っているか
 * `next` は URL に出る。web では open redirect（`?next=https://evil.com` で外部サイトへ飛ばす）、
 * ネイティブではディープリンク（`nanitabeyo://ja-JP/auth/login?next=...`）経由で
 * 任意の行き先を第三者が指定できる経路になる。**先頭 `/` の内部パスだけ**を通す。
 *
 * ## 弾く形
 *
 * | 入力 | 理由 |
 * | --- | --- |
 * | `https://evil.com` / `javascript:alert(1)` | スキーム付き = 外部（`javascript:` は web で XSS） |
 * | `//evil.com` | プロトコル相対 URL。ブラウザは外部ホストとして解決する |
 * | `/\evil.com` | ブラウザは `\` を `/` として解釈するため `//evil.com` と同じ |
 * | 空文字 / `undefined` / 配列 | 指定なしと同じ扱い（呼び出し側が既定の行き先へ倒す） |
 * | 改行等の制御文字を含む | ログや URL 組み立てを壊すだけで、正当な用途が無い |
 * | `/ja-JP/auth/login`（ログイン画面自身） | 自ルートへの遷移。`isLoginRoutePath` のコメント参照 |
 *
 * @param next `useLocalSearchParams()` から受け取った生の値
 * @param locale 現在のロケール（`useLocale().locale`）
 * @returns 採用できる場合は `/ja-JP/...` 形式の絶対パス / それ以外は null
 */
export const resolveNextPath = (next: unknown, locale: string): string | null => {
	if (typeof next !== "string") return null;

	const candidate = next.trim();
	if (!candidate) return null;
	if (CONTROL_CHARS.test(candidate)) return null;
	// 先頭 `/` の判定でも落ちるが、「スキーム付きは外部」という契約を明示するために単独で置く
	if (HAS_SCHEME.test(candidate)) return null;
	if (!candidate.startsWith("/")) return null;
	if (candidate.startsWith("//") || candidate.startsWith("/\\")) return null;
	if (isLoginRoutePath(candidate)) return null;

	return withCurrentLocale(candidate, locale);
};

/**
 * 🚪 ログイン画面の «自動離脱»（ログイン済みになった瞬間に `next` へ replace する保険）を
 * 実行してよいか。
 *
 * #1736 【バグ】**ログイン成功後、権限フローの画面が 2 枚生えていた。**
 *
 * ネイティブの OAuth は「ログイン画面 → `auth/callback` へ replace → callback が
 * `next` へ replace」という順で進む。ところが React Navigation は replace された画面を
 * **遷移アニメーションの間はマウントしたまま**にするため、その隙間にセッション確立
 * （`user` の更新）が届くと、**もう居ないはずのログイン画面の effect が動き出し**、
 * callback とは別に `next` へ replace してしまう。行き先は同じ
 * `/[locale]/onboarding/location` なので、位置情報の説明画面が 2 枚積まれ、
 * OS の許可ダイアログも 2 回出る。
 *
 * 実測（dev ログ 2026-08-30 / 08-31、Android 実機）: ログイン経由の 2 セッションは
 * どちらも `onboarding_location_permission_settled` が **2 回**記録され、
 * スキップ経由の 7 セッションはすべて 1 回だった。2 回目の直前には必ず
 * `login_screen_already_authenticated`（path_name が `/ja-JP/auth/callback`）がある。
 *
 * この保険が本来面倒を見るのは「**ログイン画面に居るのに**ログイン済み」という状態
 *（ログイン済みのまま URL 直叩き / ディープリンク）なので、**いま表示されている
 * ルートがログイン画面であること**を条件に足す。OAuth の帰り道では現在ルートが
 * `auth/callback` なので、離脱は callback だけが行う。
 *
 * @param params.pathname `usePathname()` の値（= いま表示されているルート）
 */
export const shouldAutoLeaveLoginScreen = (params: {
	isAuthResolved: boolean;
	isGuest: boolean;
	pathname: string;
}): boolean => params.isAuthResolved && !params.isGuest && isLoginRoutePath(params.pathname);

/**
 * 🧭 ログイン画面を離れるときの行き先を決める。
 *
 * ## なぜ 2 層なのか
 * 同一セッションで push されてきた場合（呼び出し 4 箇所からの通常導線）は、元画面が
 * マウントされたまま残っている。`back` ならその画面内 state ごと戻れるので、`next` より
 * 忠実に復帰できる。**`next` は履歴が無いときの保険**であって、通常の戻り道ではない。
 *
 * 履歴が無いのは次の 2 つ:
 * - `/ja-JP/auth/login` を URL で直接開いた（コールドロード / ディープリンク）
 * - web の OAuth 全画面リダイレクトから戻ってきた（ページごと作り直されている）
 *
 * `next` が無い・採用できない場合は、ログイン導線の主な出発点であるマイページへ倒す。
 *
 * @param params.canGoBack `router.canGoBack()` の結果
 * @param params.next `useLocalSearchParams()` から受け取った生の `next`
 * @param params.locale 現在のロケール
 */
export const resolvePostLoginTarget = (params: {
	canGoBack: boolean;
	next?: unknown;
	locale: string;
}): PostLoginTarget => {
	if (params.canGoBack) return { type: "back" };

	const next = resolveNextPath(params.next, params.locale);
	return { type: "replace", href: next ?? `/${params.locale}/profile` };
};
