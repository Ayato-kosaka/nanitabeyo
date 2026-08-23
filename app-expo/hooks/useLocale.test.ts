// #1194 useLocale が «空文字» や «ロケールでないセグメント» を返さないこと。
//
// 実機（iOS / dev クライアント）で踏んだ症状:
//   起動直後の自動検索が
//     GET /v1/dish-categories/recommendations?…&localLanguageCode=ja   ← languageTag が無い
//     400 languageTag must follow IETF BCP 47 format …, languageTag must be a string
//   で失敗し、0.8 秒後の再実行では成功していた。
//   フロントログの requestPayload は `languageTag: ""`。
//   `fetchWithAuth` の toQueryString が空文字を «未指定» として落とすため、
//   サーバからはパラメータが無いように見えていた。
//
// 原因は usePathname() が起動直後・リダイレクト中に "/" を返すこと。

import React, { act } from "react";
import TestRenderer from "react-test-renderer";
import { usePathname } from "expo-router";
import i18n from "@/lib/i18n";
import { useLocale } from "./useLocale";

jest.mock("expo-router", () => ({ usePathname: jest.fn() }));
// locale はテストごとに書き換えるので、モックは «可変のオブジェクト» にしておく
jest.mock("@/lib/i18n", () => ({ __esModule: true, default: { locale: "ja-JP" } }));

// #1375 実機確認: 退避先の第 1 候補は **端末の言語設定**になった（理由は useLocale.ts のコメント）。
// テストごとに端末ロケールを差し替えられるようにしておく
let mockDeviceLanguageTag: string | undefined = "ja-JP";
jest.mock("expo-localization", () => ({
	getLocales: () => (mockDeviceLanguageTag ? [{ languageTag: mockDeviceLanguageTag }] : []),
}));

beforeEach(() => {
	i18n.locale = "ja-JP";
	mockDeviceLanguageTag = "ja-JP";
});

/** フックを実際にレンダリングして戻り値を取り出す（この repo は react-test-renderer を使う） */
const renderUseLocale = (pathname: string): ReturnType<typeof useLocale> => {
	(usePathname as jest.Mock).mockReturnValue(pathname);

	let captured: ReturnType<typeof useLocale> | undefined;
	const Probe: React.FC = () => {
		captured = useLocale();
		return null;
	};

	act(() => {
		TestRenderer.create(React.createElement(Probe));
	});

	return captured!;
};

const localeOf = (pathname: string) => renderUseLocale(pathname).locale;

describe("#1194 useLocale", () => {
	it("パス先頭のロケールをそのまま使う", () => {
		expect(localeOf("/ja-JP/search/topics")).toBe("ja-JP");
		expect(localeOf("/en-US")).toBe("en-US");
	});

	// ⚠️ これが本体。ここが "" になると languageTag がクエリから消えて 400 になる
	it("起動直後（pathname が '/'）でも空文字を返さない", () => {
		expect(localeOf("/")).toBe("ja-JP");
	});

	it("pathname が空でも空文字を返さない", () => {
		expect(localeOf("")).toBe("ja-JP");
	});

	// `/s/:token` は先頭セグメントが `s`。400 にはならず languageTag=s が静かに飛んでいた
	it("共有リンク /s/:token でロケールを 's' にしない", () => {
		expect(localeOf("/s/s1_AbCdEf")).toBe("ja-JP");
	});

	it("ロケールでないセグメント（/posts など）でも寄せる", () => {
		expect(localeOf("/posts")).toBe("ja-JP");
	});

	// 未対応ロケールの URL は «従来どおり» そのセグメントを使う。
	// ここを PUBLIC_LOCALES の完全一致にすると、この経路の挙動まで変わってしまう
	it("未対応ロケールの URL はそのセグメントを維持する", () => {
		expect(localeOf("/pt-BR/search")).toBe("pt-BR");
	});

	it("isJapanese は解決後のロケールで判定する", () => {
		expect(renderUseLocale("/").isJapanese).toBe(true);
		expect(renderUseLocale("/en-US/search").isJapanese).toBe(false);
	});
});

describe("#1194 useLocale — 端末の言語設定が既定以外のとき", () => {
	// 退避先を ja-JP 決め打ちにすると、英語端末の起動直後だけ日本語で検索してしまう
	it("端末の言語へ寄せる（常に ja-JP へ倒さない）", () => {
		mockDeviceLanguageTag = "en-US";

		expect(localeOf("/")).toBe("en-US");
	});

	it("端末の言語が未対応でも公開ロケールのどれかになる", () => {
		mockDeviceLanguageTag = "pt-BR";

		expect(localeOf("/")).toBe("ja-JP");
	});
});

/*
#1375 実機確認の回帰テスト。

共有シートからのコールドスタートで **画面が英語になった**。

`i18n.locale` を設定しているのは `app/[locale]/_layout.tsx` だけで、その入力は URL の
ロケールセグメントである。つまりロケール付き URL へ入る前は未設定で、
`i18n.defaultLocale`（= "en-US"）が読める。退避先がそれを採っていたため、
端末が日本語でも `/en-US/sns-import` へ push されていた。

共有からの着地は `app/index.tsx` のロケール判定リダイレクトを経由しないので、
**誰も `i18n.locale` を直していない状態でこの分岐が評価される**のが肝である。
*/
describe("#1375 i18n.locale が未設定（既定の en-US）でも端末の言語を採る", () => {
	it("端末が日本語なら ja-JP になる（en-US へ倒れない）", () => {
		// ロケール付き URL へ一度も入っていない状態＝ i18n は既定のまま
		i18n.locale = "en-US";
		mockDeviceLanguageTag = "ja-JP";

		expect(localeOf("/")).toBe("ja-JP");
	});

	it("端末ロケールが取れない環境だけ i18n 側へ落とす", () => {
		i18n.locale = "ko-KR";
		mockDeviceLanguageTag = undefined;

		expect(localeOf("/")).toBe("ko-KR");
	});
});
