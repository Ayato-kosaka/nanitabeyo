/*
#1629 【回帰】ダークモードでプレースホルダーが読めなくなるのを止めるラチェット。

オーナー実機報告:「SNS URL を貼るテキストボックスのプレースホルダーの文字が黒くて見えない」

## なぜ起きるのか

`placeholderTextColor` を指定しない `TextInput` は、**OS 既定の濃いグレー**で描かれる。
アプリ側のテーマがダークになっても OS 既定色は変わらないので、暗い地の上で黒に近い字が出る。
`style` に `color` を書いても**入力文字の色にしか効かない**（プレースホルダーは別プロパティ）。

実測: 10 箇所が未指定のまま出ていた。SNS 取り込みの URL 入力はその 1 つ。

⚠️ ここが赤くなったら «その画面はダークで読めない» ということである。
   直し方は `placeholderTextColor={colors.textSecondary}` を足すだけ。

## 「指定してある」だけでは足りない（#1629 で追加した 2 本目）

`placeholderTextColor="#9CA3AF"` のようにリテラルを直書きしても 1 本目の検査は通るが、
**ライトの淡い灰がダークでもそのまま出る**ので、症状は未指定のときと変わらない。
2 本目で «値がテーマ由来か»（`colors.…` を経由しているか）まで見る。
`scripts/assert-no-hardcoded-colors.mjs` は .tsx の色リテラルを落とすが、
凍結リストに載っているファイルの中は素通りするため、ここでも独立に見る。
*/
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";

const ROOT = join(__dirname, "..");

/** app / features / components 配下の .tsx を列挙する */
const listFiles = (): string[] =>
	execSync(`find app features components -name '*.tsx' -not -path '*/node_modules/*'`, {
		cwd: ROOT,
		encoding: "utf-8",
	})
		.split("\n")
		.filter(Boolean);

/** 1 つの `<TextInput ... />` の属性部分だけを切り出す */
const textInputSegments = (source: string): string[] => {
	const segments: string[] = [];
	let index = source.indexOf("<TextInput");
	while (index !== -1) {
		const rest = source.slice(index);
		const end = rest.indexOf("/>");
		segments.push(end === -1 ? rest : rest.slice(0, end));
		index = source.indexOf("<TextInput", index + 1);
	}
	return segments;
};

/** `placeholderTextColor=…` に渡している式・文字列を取り出す */
const placeholderColorValues = (segment: string): string[] =>
	[...segment.matchAll(/placeholderTextColor=(\{[^}]*\}|"[^"]*"|'[^']*'|`[^`]*`)/g)].map((m) => m[1]);

/** 色リテラル（`"#RRGGBB"` / `"white"` / `rgba(…)`）を直書きしているか */
const isLiteralColor = (value: string): boolean =>
	/#[0-9a-fA-F]{3,8}/.test(value) ||
	/\b(?:rgba?|hsla?)\s*\(/.test(value) ||
	/["'`](?:white|black|gray|grey)["'`]/.test(value);

/**
 * リテラルのまま凍結してよいファイル（appRoot 相対）→ 理由。
 *
 * ⚠️ ここへ公開画面を足してはいけない。凍結できるのは «画面ごと直書きのままで、
 *    プレースホルダーだけテーマ追従にすると **かえって悪くなる**» ものだけである
 *    （白固定の入力欄にダークの淡い字を出すことになる）。
 * ⚠️ リテラルを解消したらこの行を消すこと（残すとこのテストが落ちる）。
 */
/*
凍結リスト。**いまは空である。**

guard 側の作業時点では社内タスク画面 2 件が «入力欄の地ごと直書き» で残っており、
プレースホルダーだけテーマ追従にすると «白い欄に淡い字» で悪化するため凍結していた。
その 2 件は同じ巡回で画面ごとトークン化され、凍結の理由が消えた
（このラチェットが «直書きが解消済みなのに行が残っている» と落ちて教えてくれた）。

空のまま維持すること。ここへ行を足すのは «直せない理由» が本当にあるときだけである。
*/
const LITERAL_EXCLUSIONS: Record<string, string> = {};
describe("#1629 プレースホルダーはテーマ追従の色を明示する", () => {
	it("placeholder を出す TextInput は placeholderTextColor も指定している", () => {
		const offenders: string[] = [];
		for (const file of listFiles()) {
			const source = readFileSync(join(ROOT, file), "utf-8");
			for (const segment of textInputSegments(source)) {
				if (segment.includes("placeholder=") && !segment.includes("placeholderTextColor")) {
					offenders.push(file);
				}
			}
		}
		expect(offenders).toEqual([]);
	});

	it("placeholderTextColor の値は色リテラルではなくテーマのトークンである", () => {
		const offenders: string[] = [];
		const litFiles = new Set<string>();
		for (const file of listFiles()) {
			const source = readFileSync(join(ROOT, file), "utf-8");
			for (const segment of textInputSegments(source)) {
				for (const value of placeholderColorValues(segment)) {
					if (!isLiteralColor(value)) continue;
					litFiles.add(file);
					if (!(file in LITERAL_EXCLUSIONS)) offenders.push(`${file} … ${value}`);
				}
			}
		}
		expect(offenders).toEqual([]);

		// ラチェット: 凍結リストは «減る方向» にしか動かさない
		const brokenExclusions: string[] = [];
		for (const [file, reason] of Object.entries(LITERAL_EXCLUSIONS)) {
			if (!existsSync(join(ROOT, file))) {
				brokenExclusions.push(`${file} … ファイルが無い（消した・改名したのならこの行も消す）`);
			} else if (reason.trim().length < 30) {
				brokenExclusions.push(`${file} … 理由が短すぎる（なぜ凍結してよいかを書く）`);
			} else if (!litFiles.has(file)) {
				// 直書きが消えたのに残っている行は落とす（消し忘れの凍結を許さない）
				brokenExclusions.push(`${file} … 直書きが解消済み。LITERAL_EXCLUSIONS から行を消す`);
			}
		}
		expect(brokenExclusions).toEqual([]);
	});
});
