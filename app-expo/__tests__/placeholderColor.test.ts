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
*/
import { readFileSync } from "node:fs";
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
});
