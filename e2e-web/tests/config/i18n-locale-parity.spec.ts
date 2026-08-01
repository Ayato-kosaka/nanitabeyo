import * as fs from "node:fs";
import * as path from "node:path";
// 注: このテストはブラウザを一切使わない Node 単体の検証のため、例外的に
// fixtures/test ではなく @playwright/test を直接 import する
// (firebase-rewrites.spec.ts と同じ理由)
import { test, expect } from "@playwright/test";

/**
 * 🌐 8言語 locale ファイルのキー整合性テスト
 *
 * ## 背景
 * app-expo/locales/*.json は i18n キーの唯一の情報源で、`.github/copilot-instructions.md`
 * の i18n ポリシーで UI 文字列の直書きが禁止されている。しかしキー追加時に一部言語だけ
 * 更新を忘れると、その言語では該当キーが未翻訳のままフォールバックし、既存の英語/日本語が
 * 意図せず残る(#948 で発覚したゲスト表示名の英語固定文言のような不具合の温床になる)。
 *
 * ローカライズ内容そのもの(翻訳品質)は検証しない。あくまで「基準言語(ja-JP)に存在する
 * キーが全言語に存在するか」という構造的な整合性のみを、ブラウザ不要・数十msで検証する。
 *
 * ## 失敗した場合
 * 新規追加/削除したキーを、基準言語以外の locale ファイルにも反映すること。
 */

const REPO_ROOT = path.resolve(__dirname, "../../..");
const LOCALES_DIR = path.join(REPO_ROOT, "app-expo/locales");
const BASE_LOCALE = "ja-JP.json";

/** ネストされたオブジェクトを "a.b.c" 形式のキーパスの配列へ平坦化する */
function flattenKeys(obj: unknown, prefix = ""): string[] {
	if (typeof obj !== "object" || obj === null || Array.isArray(obj)) {
		return [prefix];
	}
	return Object.entries(obj as Record<string, unknown>).flatMap(([key, value]) =>
		flattenKeys(value, prefix ? `${prefix}.${key}` : key),
	);
}

test.describe("locale ファイルのキー整合性", () => {
	const localeFiles = fs.readdirSync(LOCALES_DIR).filter((f) => f.endsWith(".json"));

	test("8言語すべての locale ファイルが存在する", () => {
		expect(localeFiles.sort()).toEqual(
			[
				"ar-SA.json",
				"en-US.json",
				"es-ES.json",
				"fr-FR.json",
				"hi-IN.json",
				"ja-JP.json",
				"ko-KR.json",
				"zh-CN.json",
			].sort(),
		);
	});

	const baseJson = JSON.parse(fs.readFileSync(path.join(LOCALES_DIR, BASE_LOCALE), "utf-8"));
	const baseKeys = new Set(flattenKeys(baseJson));

	for (const fname of localeFiles) {
		if (fname === BASE_LOCALE) continue;

		test(`${fname} のキーが ${BASE_LOCALE} と一致する`, () => {
			const targetJson = JSON.parse(fs.readFileSync(path.join(LOCALES_DIR, fname), "utf-8"));
			const targetKeys = new Set(flattenKeys(targetJson));

			const missing = [...baseKeys].filter((k) => !targetKeys.has(k));
			const extra = [...targetKeys].filter((k) => !baseKeys.has(k));

			expect(missing, `${fname} に不足しているキー`).toEqual([]);
			expect(extra, `${fname} に余分なキー(${BASE_LOCALE} 側の削除漏れの可能性)`).toEqual([]);
		});
	}
});
