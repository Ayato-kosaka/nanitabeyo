import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * #1599 **翻訳キーの名前空間が «リネーム途中» のまま残らないようにするラチェット。**
 *
 * ## なぜ要るのか
 *
 * #1553 で「topic という表現を消して dish-category 系へ統一する」リネームをしたが、
 * **6 箇所だけ `Topics.*` を参照したまま残っていた**。結果として
 *
 *   - `Topics.*`（47 キー）と `DishCategories.*`（47 キー）が丸ごと二重に存在し
 *   - そのうち 33 キーは文言まで完全に同じ
 *   - `Topics.*` は «ほぼ死んでいる» のに、6 箇所だけ生きている
 *
 * という状態になっていた。**«ほぼ死んでいる» が一番危ない。** 死んでいると思って
 * 消すと 6 箇所が壊れ、生きていると思って残すと次の人がどちらへ足すか迷う。
 *
 * 実際、単純に消すだけでは足りなかった。`Topics.accessibility.blockTopic` の移行先は
 * 同名の `DishCategories.accessibility.blockTopic` ではなく、**リネーム済みの
 * `DishCategories.accessibility.blockDishCategory`** だった。
 * 名前が変わっているものが混ざっているので、機械的な置換だけでは通らない。
 *
 * ## この検査が守るもの
 *
 * 「消したはずの名前空間が、翻訳ファイルにもコードにも復活しないこと」。
 */
const LOCALES_DIR = join(__dirname, "..", "locales");
const APP_ROOT = join(__dirname, "..");

/** 撤去済みの名前空間。**復活させないこと。** 増やすときは理由を書く */
const REMOVED_NAMESPACES = ["Topics"] as const;

const SKIP_DIRS = new Set(["node_modules", ".expo", "dist", "android", "ios", "locales", "__tests__"]);

function listSourceFiles(dir: string): string[] {
	const out: string[] = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		if (entry.isDirectory()) {
			if (SKIP_DIRS.has(entry.name)) continue;
			out.push(...listSourceFiles(join(dir, entry.name)));
			continue;
		}
		if (!/\.tsx?$/.test(entry.name)) continue;
		if (/\.test\.tsx?$/.test(entry.name)) continue;
		out.push(join(dir, entry.name));
	}
	return out;
}

const localeFiles = readdirSync(LOCALES_DIR).filter((f) => f.endsWith(".json"));

describe("#1599 撤去した翻訳キーの名前空間は復活させない", () => {
	it("検査対象のロケールを実際に走査できている（0 件なら検査自体が壊れている）", () => {
		expect(localeFiles.length).toBe(8);
	});

	it.each(REMOVED_NAMESPACES)("どのロケールにも %s 名前空間が無い", (namespace) => {
		const offenders = localeFiles.filter((file) => {
			const json = JSON.parse(readFileSync(join(LOCALES_DIR, file), "utf8")) as Record<string, unknown>;
			return namespace in json;
		});

		expect(offenders).toEqual([]);
	});

	it.each(REMOVED_NAMESPACES)("コードのどこからも i18n.t(\"%s.…\") を呼んでいない", (namespace) => {
		// ⚠️ i18n のキーだけを見る。`useScreenTrace("Topics")` は Firebase Performance の
		// 既存系列を分断しないため意図的に旧名を維持しており（dish-categories.tsx のコメント）、
		// これを巻き込んではいけない。
		const pattern = new RegExp(`i18n\\.t\\([\`"']${namespace}\\.`);

		const offenders = listSourceFiles(APP_ROOT)
			.filter((file) => pattern.test(readFileSync(file, "utf8")))
			.map((file) => file.slice(APP_ROOT.length + 1));

		expect(offenders).toEqual([]);
	});

	it("移行先のキーは全ロケールに実在する（消しただけで移行し忘れていない）", () => {
		// #1553 のリネームで実際に使われている移行先。ここが欠けると
		// 画面には翻訳キーの文字列がそのまま出る
		const migrated = [
			"DishCategories.errors.invalidSearchParams",
			"DishCategories.reloadDialog.message",
			"DishCategories.reloadDialog.title",
			"DishCategories.reloadDialog.confirm",
			"DishCategories.reloadDialog.cancel",
			"DishCategories.accessibility.blockDishCategory",
		];

		const missing: string[] = [];
		for (const file of localeFiles) {
			const json = JSON.parse(readFileSync(join(LOCALES_DIR, file), "utf8")) as Record<string, unknown>;
			for (const key of migrated) {
				let cursor: unknown = json;
				for (const part of key.split(".")) {
					cursor =
						typeof cursor === "object" && cursor !== null ? (cursor as Record<string, unknown>)[part] : undefined;
				}
				if (typeof cursor !== "string") missing.push(`${file}#${key}`);
			}
		}

		expect(missing).toEqual([]);
	});
});
