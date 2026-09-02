import { usePathname } from "expo-router";
import { useMemo } from "react";
import * as Localization from "expo-localization";

import i18n from "@/lib/i18n";
import { resolvePublicLocale } from "@/constants/seoLocales";

/**
 * URL パス先頭のセグメントが «ロケールらしい» か（BCP 47 の形）。
 *
 * `ja-JP` / `ja` / `zh-Hant-TW` に当たり、`s`（共有リンク）・`posts`・空文字には当たらない。
 * 完全一致（`PUBLIC_LOCALES` に含まれるか）で判定しないのは、`/xx-YY/...` のような
 * 未対応ロケールの URL で **従来どおりそのセグメントを使う**挙動を変えないため。
 */
const LOCALE_LIKE = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;

/**
 * #1599 その文字列を `Intl` 系 API（`toLocaleDateString` 等）へ渡して安全か。
 *
 * 【バグ】`LOCALE_LIKE` は BCP 47 の «形» の近似でしかなく、実際のタグ規則より緩い。
 * サブタグに `[A-Za-z0-9]{2,8}` を許すが、BCP 47 のリージョンは «英字 2» か «数字 3» で、
 * `ja-01` や `en-A1` はそのどちらでもない。**正規表現は通るのに `Intl` は例外を投げる。**
 *
 * ```
 * new Date().toLocaleDateString("ja-01")  // RangeError: Incorrect locale information provided
 * ```
 *
 * 実際に `profile/content-reports` と `profile/dish-category-group-votes` が
 * `toLocaleDateString(locale)` を直接呼んでおり、`/ja-01/profile/content-reports` のような
 * URL（手打ち・改変された共有リンク・クローラの誤生成）で入ると**レンダー中に例外が飛び、
 * 画面全体が ErrorBoundary のフォールバックへ置き換わる**。一覧が一切見られなくなる。
 *
 * 【設計】上のコメントにあるとおり «未対応ロケールの URL ではそのセグメントを使う» のは
 * 意図した挙動なので、対応ロケール一覧との突き合わせでは弾かない。弾くのは
 * **`Intl` が受け付けない = 渡すと必ず壊れる**ものだけにする。
 * `pt-BR` や `xx-YY` のような «妥当だが未対応» は従来どおり素通しになる。
 */
const isIntlUsableLocale = (tag: string): boolean => {
	// Intl が無い環境（web の一部・一部の JS エンジン）では検証しようがない。
	// その環境では toLocaleDateString も Intl を使わないので、素通しでよい。
	if (typeof Intl === "undefined" || typeof Intl.DateTimeFormat !== "function") return true;
	try {
		new Intl.DateTimeFormat(tag);
		return true;
	} catch {
		return false;
	}
};

/**
 * 🌐 現在のロケールを URL から取り出す。
 *
 * ## ⚠️ 空文字を返してはいけない（実機で踏んだ）
 * かつては `pathname.split("/")[1]` をそのまま返していました。`usePathname()` は
 * **アプリ起動直後やリダイレクトの途中で `"/"` を返す**ため、その瞬間だけ
 * ロケールが空文字になります。
 *
 * 実機（iOS）のログ:
 *
 * ```
 * requestPayload: { address: "…", languageTag: "", localLanguageCode: "ja", … }
 * status: 400  languageTag must follow IETF BCP 47 format …
 * ```
 *
 * `fetchWithAuth` の `toQueryString` は空文字を «未指定» として落とすので、
 * サーバからはパラメータ自体が無いように見えて 400 になります。
 * 起動時の自動検索がこれに当たり、**1 回失敗してから 0.8 秒後に成功**していました
 * （＝ ユーザーには一瞬のエラー、こちらには無駄な Google Places クォータ消費）。
 *
 * ## もう一つの穴
 * `/s/:token`（共有リンク）では先頭セグメントが `s` なので、**ロケールが `"s"` になります**。
 * こちらは 400 にはならず、`languageTag=s` が静かにサーバへ渡っていました。
 *
 * どちらも「パス先頭が必ずロケールである」という前提が崩れる経路です。
 * 呼び出し側は 38 箇所あるので、**ここで必ず妥当な値へ寄せる**のが唯一の直し方です。
 *
 * @returns locale はロケールらしい文字列であることが保証される。空文字にはならず、
 *          **`Intl` 系 API（`toLocaleDateString` 等）へ渡しても例外にならない**ことも保証する（#1599）
 */
export const useLocale = () => {
	const pathname = usePathname();

	const locale = useMemo(() => {
		const fromPath = pathname.split("/")[1];
		// #1599 `Intl` へ渡して壊れるものは «ロケールらしい» とは言えない。
		// 弾いたものは以降のフォールバック（端末の言語設定）へ落ちる。
		if (fromPath && LOCALE_LIKE.test(fromPath) && isIntlUsableLocale(fromPath)) return fromPath;

		// ## ⚠️ `i18n.locale` を先に読んではいけない（#1375 実機で踏んだ）
		//
		// `i18n.locale` を設定しているのは `app/[locale]/_layout.tsx` だけで、その入力は
		// **URL のロケールセグメント**である。つまりロケール付き URL へ入る前は未設定で、
		// `i18n.defaultLocale`（= "en-US"）が読める。ここでそれを採ると
		// **端末が日本語でも en-US になる**。
		//
		// 実際に踏んだのが共有シートからのコールドスタートである。`usePathname()` は起動直後
		// `"/"` を返すのでこの分岐へ落ち、`/en-US/sns-import` へ push されて画面が英語になった
		// （`app/index.tsx` のロケール判定リダイレクトを経由しないため、誰も `i18n.locale` を
		//   直していない状態でここが評価される）。
		//
		// したがって **端末の言語設定を直接読む**。`app/index.tsx` の起動時リダイレクトと
		// 同じ入力（`Localization.getLocales()[0].languageTag`）を使うので、
		// «通常起動で着くロケール» と «この分岐が返すロケール» が一致する。
		const deviceLanguageTag = Localization.getLocales?.()[0]?.languageTag;
		if (deviceLanguageTag) return resolvePublicLocale(deviceLanguageTag);

		// 端末ロケールすら取れない環境（web の一部・テスト）だけ i18n 側へ落とす
		return resolvePublicLocale(i18n.locale);
	}, [pathname]);

	const isJapanese = useMemo(() => ["ja-JP", "ja"].includes(locale), [locale]);

	return { locale, isJapanese };
};
