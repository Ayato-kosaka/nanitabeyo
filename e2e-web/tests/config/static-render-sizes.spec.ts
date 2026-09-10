import * as fs from "node:fs";
import * as path from "node:path";
// 注: このテストはブラウザを一切使わない Node 単体の検証のため、例外的に
// fixtures/test ではなく @playwright/test を直接 import する
// (firebase-rewrites.spec.ts と同じ理由)
import { test, expect } from "@playwright/test";

/**
 * 📐 静的書き出し(SSG)HTML に «負のサイズ» が焼き付いていないことの検証
 *
 * ## 背景(実際に起きた本番バグ / #1783)
 *
 * `expo export --platform web` は各ルートの HTML を **Node 上で** 1 回描画して吐く。
 * Node には `window` が無いので `useWindowDimensions()` / `Dimensions.get("window")` は
 * **width=0 / height=0** を返す。その 0 を px 計算へ通すと負の値になり、
 * そのまま HTML の style 属性へ焼き付く。実例:
 *
 *   <div style="width:-9.5px" data-testid="search-time-slot-morning">
 *     <div data-expoimage="true" style="width:-19.5px;height:-19.5px">…
 *
 * そして **React のハイドレーションは属性(style)の食い違いを patch しない**。
 * クライアント側が正しい 120.5px を計算しても DOM には -9.5px が残り続けるため、
 * 検索画面の時間帯・同行者グリッドは **画像が 1 枚も出ず、選択バッジだけがラベルへ
 * 重なる**状態で固定されていた(オーナー実機報告)。
 *
 * dev サーバ(SSG を通らない)では一切再現しないので、成果物を見るこの検査でしか捕まらない。
 *
 * ## 失敗した場合
 *
 * ウィンドウ由来の px を `useWindowDimensions()` / `Dimensions.get()` から直接取って
 * スタイルへ渡している箇所が増えている。`app-expo/hooks/useContentWidth.ts` の
 * `useContentWidth()` / `useWindowHeight()` を使うこと(SSG と初回描画で既定値を返し、
 * ハイドレーション後に実寸へ切り替える)。
 */

const REPO_ROOT = path.resolve(__dirname, "../../..");
const DIST_DIR = path.join(REPO_ROOT, "app-expo/dist");

/** style 属性の中の `width:-12px` / `height:-3.5px` 等 */
const NEGATIVE_INLINE_SIZE = /style="(?:[^"]*;)?(?:width|height):-[0-9.]+px/g;

/**
 * react-native-web が吐く原子 CSS クラス定義のうち、負の width/height を持つもの。
 * `top` / `margin` 等の負値はデザイン上正当なので対象にしない。
 */
const NEGATIVE_SIZE_CLASS = /\.(r-[a-z0-9_-]+)\{(?:width|height):-[0-9.]+px;\}/g;

function listExportedHtml(): string[] {
	const found: string[] = [];
	const walk = (dir: string) => {
		for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
			const full = path.join(dir, entry.name);
			if (entry.isDirectory()) walk(full);
			else if (entry.name.endsWith(".html")) found.push(full);
		}
	};
	walk(DIST_DIR);
	return found;
}

/** 1 ファイル分の違反(«どの要素が» 負のサイズを持つか)を数える */
function findNegativeSizes(html: string): string[] {
	const violations: string[] = [];

	for (const match of html.matchAll(NEGATIVE_INLINE_SIZE)) {
		violations.push(`inline style: ${match[0].slice(0, 120)}`);
	}

	// クラス «定義» だけなら害は無い(その画面で使われていなければ描画されない)。
	// 実際に要素へ当たっているものだけを違反とする
	for (const match of html.matchAll(NEGATIVE_SIZE_CLASS)) {
		const className = match[1];
		const used = new RegExp(`class="[^"]*\\b${className}\\b[^"]*"`).test(html);
		if (used) violations.push(`css class in use: ${match[0]}`);
	}

	return violations;
}

test.describe("SSG 成果物のサイズ健全性", () => {
	// ─ テストケース: 書き出された HTML に負の width/height が 1 つも無い ─
	// 手順:
	//   1. app-expo/dist 配下の全 HTML を列挙
	//   2. style 属性と、実際に要素へ当たっている CSS クラスから
	//      負の width/height を抽出
	//   3. 1 件も無いことを検証
	test("書き出された HTML に負の width/height が焼き付いていない", async () => {
		expect(fs.existsSync(DIST_DIR), `${DIST_DIR} が無い。先に pnpm --filter app-expo build:web を実行すること`).toBe(
			true,
		);

		const htmlFiles = listExportedHtml();
		expect(htmlFiles.length, "dist に HTML が 1 つも無い(ビルドが空)").toBeGreaterThan(0);

		const offenders: string[] = [];
		for (const file of htmlFiles) {
			const violations = findNegativeSizes(fs.readFileSync(file, "utf-8"));
			if (violations.length > 0) {
				offenders.push(`${path.relative(REPO_ROOT, file)} (${violations.length} 件) 例: ${violations[0]}`);
			}
		}

		expect(
			offenders,
			"SSG 時のウィンドウ幅 0 から生まれた負のサイズ。ハイドレーションでは直らないので web で要素が消える。" +
				"該当箇所を hooks/useContentWidth.ts の useContentWidth() / useWindowHeight() 経由へ直すこと",
		).toEqual([]);
	});
});
