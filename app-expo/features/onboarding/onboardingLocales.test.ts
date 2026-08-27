/*
#1486 オンボーディングの文言が **8 言語すべてに揃っていて、実際に置換されること** を固定するテスト。

## なぜこのテストがあるか

オンボーディングは日本語ロケールでしか表示されない（#642 のゲートを踏襲）。
つまり **他のどの spec を通しても、この文言たちは一度も描画されない**。
文言の不備を機械で捕まえる層がここしか無い。

守るのは 2 つ。

1. **8 言語でキーが揃っていること。** `enableFallback` があるため、足りない言語は
   英語へ落ちるだけでエラーにならず、**気づかないまま英語が混ざる**。
   locales/*.json は 8 ファイルとも同じキー数で運用されてきた（lib/i18n.ts 参照）。
2. **プレースホルダが実際に置換されること。** `{{current}}` を打ち間違えると
   その文字列がそのまま読み上げられるが、型でも lint でも捕まらない。

## `{{...}}` と `%{...}` について

i18n-js v4 の既定の placeholder 正規表現は `/(?:\{\{|%\{)(.*?)(?:\}\}?)/gm` で、
**どちらの記法も解釈する**。つまり `%{name}` でも動く。
それでも `{{name}}` へ揃えるのは、既存の 521 キーが例外なくそちらだからで、
記法が混ざると「どちらが正か」を毎回確かめる羽目になる。
下の検査は **バグではなく表記ゆれ**を止めるためのもの。
*/
import i18n from "@/lib/i18n";

import ar from "@/locales/ar-SA.json";
import en from "@/locales/en-US.json";
import es from "@/locales/es-ES.json";
import fr from "@/locales/fr-FR.json";
import hi from "@/locales/hi-IN.json";
import ja from "@/locales/ja-JP.json";
import ko from "@/locales/ko-KR.json";
import zh from "@/locales/zh-CN.json";

const LOCALES = {
	"ar-SA": ar,
	"en-US": en,
	"es-ES": es,
	"fr-FR": fr,
	"hi-IN": hi,
	"ja-JP": ja,
	"ko-KR": ko,
	"zh-CN": zh,
} as const;

/** ネストしたオブジェクトを "a.b.c" のキー一覧へ潰す */
const flatten = (value: unknown, prefix = ""): string[] => {
	if (typeof value !== "object" || value === null) return [prefix];
	return Object.entries(value).flatMap(([key, child]) => flatten(child, prefix ? `${prefix}.${key}` : key));
};

/** 文字列の葉だけを "a.b.c" → 値 の形で集める */
const collectStrings = (value: unknown, prefix = ""): [string, string][] => {
	if (typeof value === "string") return [[prefix, value]];
	if (typeof value !== "object" || value === null) return [];
	return Object.entries(value).flatMap(([key, child]) => collectStrings(child, prefix ? `${prefix}.${key}` : key));
};

const japaneseKeys = flatten((ja as Record<string, unknown>).Onboarding).sort();

describe("Onboarding の i18n", () => {
	it.each(Object.keys(LOCALES))("%s に Onboarding のキーが揃っている", (locale) => {
		const block = (LOCALES[locale as keyof typeof LOCALES] as Record<string, unknown>).Onboarding;

		expect(block).toBeDefined();
		expect(flatten(block).sort()).toEqual(japaneseKeys);
	});

	/**
	 * 表記ゆれの検査（動作の検査ではない）。i18n-js は `%{name}` も解釈するが、
	 * 既存の 521 キーはすべて `{{name}}` なので、そちらへ揃える。
	 */
	it.each(Object.keys(LOCALES))("%s のプレースホルダが `{{...}}` 記法に揃っている", (locale) => {
		const block = (LOCALES[locale as keyof typeof LOCALES] as Record<string, unknown>).Onboarding;
		const offenders = collectStrings(block).filter(([, value]) => value.includes("%{"));

		expect(offenders).toEqual([]);
	});

	it("丸数字インジケータの読み上げ文で current / total が実際に置換される", () => {
		const previous = i18n.locale;
		try {
			i18n.locale = "ja-JP";
			const label = i18n.t("Onboarding.accessibility.stepProgress", { current: 2, total: 3 });

			expect(label).toContain("2");
			expect(label).toContain("3");
			// 置換されずに素通りした場合の «見え方» を名指しで弾く
			expect(label).not.toContain("{{");
			expect(label).not.toContain("%{");
			expect(label).not.toContain("current");
			expect(label).not.toContain("total");
		} finally {
			i18n.locale = previous;
		}
	});

	it("チケットで確定した課題文・解決文がそのまま入っている", () => {
		const previous = i18n.locale;
		try {
			i18n.locale = "ja-JP";

			// #1486 §1 の文言（最終検収で全 3 ページを «つぶやき → 効能» の対に書き換え）。
			// 課題文は «ユーザーの独り言»、解決文は «だから何ができるか» で揃えてある。
			// 長文は画面幅で折り返し位置が揺れるため、意味の切れ目に \n を入れてある。
			// ここを消すと狭い端末で不格好な位置で折り返す
			expect(i18n.t("Onboarding.step1.problem")).toBe("そもそも何食べたいか決まらない");
			expect(i18n.t("Onboarding.step1.solution")).toBe("提案されたオススメの料理の中から選ぶだけ");
			expect(i18n.t("Onboarding.step2.problem")).toBe("お店の候補が多すぎて、\n決めるの疲れるなぁ");
			expect(i18n.t("Onboarding.step2.solution")).toBe("厳選したお店から選ぶから決めやすい！");
			expect(i18n.t("Onboarding.step3.problem")).toBe("友達の意見も聞きたいなぁ");
			expect(i18n.t("Onboarding.step3.solution")).toBe("友達と多数決で料理を決められる！");

			// #1486 §5 / §6 / §7 の確定文言（welcome.title の 🎉 はレビューで削除が確定）
			expect(i18n.t("Onboarding.location.title")).toBe("近くのお店を、すぐ見つけよう 📍");
			expect(i18n.t("Onboarding.notifications.title")).toBe("食べたいを、見逃さない 🔔");
			expect(i18n.t("Onboarding.welcome.title")).toBe("なに食べよへようこそ！");
			expect(i18n.t("Onboarding.welcome.body1")).toBe("もう、お店選びで迷いすぎなくて大丈夫。");
			expect(i18n.t("Onboarding.welcome.body2")).toBe("今日の「食べたい」を見つけにいこう。");
			expect(i18n.t("Onboarding.welcome.cta")).toBe("はじめる");
		} finally {
			i18n.locale = previous;
		}
	});
});
