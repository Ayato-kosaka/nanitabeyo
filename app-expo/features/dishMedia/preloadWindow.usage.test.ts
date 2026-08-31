/*
#1629【30】**«どの画面が先読みを持っているか» を機械で押さえる。**

2026-08-27、オーナーの「お店提案がチカチカする」に対して `DishMediaFeed` だけを直し、
「直った」と報告した。実際にお店提案を描いているのは `DishMediaMap` の方
（`app/[locale]/(tabs)/search/result.tsx:203`）で、**直した先が違っていた**。
実機では何も変わっておらず、翌日に «まだチカチカする» と再指摘された。

原因は «窓を作る判断» が 2 つのコンポーネントに別々のインラインの式として
散らばっていたこと。片方だけ直しても誰も気づけない。

このテストは **先読みの窓を張る全画面コンポーネントが、例外なく
`computePreloadIds` を通っていること**を、ソースを読んで固定する。
新しく `useDishMediaBackgroundImageResources` を使う画面を足したときも、
自前の `slice` を書けばここで落ちる。
*/
import { readFileSync } from "fs";
import { join } from "path";

const COMPONENT_DIR = join(__dirname, "components");

/** 背景画像の先読みを購読している全画面コンポーネント */
const FULLSCREEN_COMPONENTS = ["DishMediaFeed.tsx", "DishMediaMap.tsx"] as const;

describe("#1629【30】背景画像の先読みは 1 か所の判断に統一されている", () => {
	it.each(FULLSCREEN_COMPONENTS)("%s は computePreloadIds を使う", (file) => {
		const source = readFileSync(join(COMPONENT_DIR, file), "utf8");
		expect(source).toContain("computePreloadIds(ids, currentIndex)");
	});

	it.each(FULLSCREEN_COMPONENTS)("%s は preloadIds を自前の slice で組まない", (file) => {
		const source = readFileSync(join(COMPONENT_DIR, file), "utf8");
		// コメント中の説明文で誤検知しないよう、**コードとしての** ids.slice( だけを見る
		const codeOnly = source
			.replace(/\/\*[\s\S]*?\*\//g, "")
			.split("\n")
			.filter((line) => !line.trim().startsWith("//"))
			.join("\n");
		expect(codeOnly).not.toContain("ids.slice(");
	});

	it("先読みを購読する画面を数え漏らしていない", () => {
		// `useDishMediaBackgroundImageResources` を呼ぶ全画面は上のリストで尽きている、
		// という前提そのものを固定する（新しい画面が増えたらここで落ちて気づける）
		const { readdirSync } = require("fs") as typeof import("fs");
		const users = readdirSync(COMPONENT_DIR)
			.filter((f) => f.endsWith(".tsx") && !f.endsWith(".test.tsx"))
			.filter((f) => readFileSync(join(COMPONENT_DIR, f), "utf8").includes("useDishMediaBackgroundImageResources("));
		expect(users.sort()).toEqual([...FULLSCREEN_COMPONENTS].sort());
	});
});
