/*
⌨️ 入力欄を持つ画面が «Android でキーボード回避を持っているか» を機械で見張る（#1629）

## なぜ要るのか

オーナー実機報告:
「Android で『SNSから』でお店、料理カテゴリのテキストボックスがキーボードで隠れる。
　このキーボードで隠れる系のバグ、多いので横並びで直して。（食べたを記録の料金も）」

**«多い» が要点である。** 実際に数えたら、入力欄を持つファイルごとに 4 通りの流儀が
混在していて、Android で何も効かない画面が複数あった。1 画面ずつ直しても、
次に入力欄を足した人がまた同じ穴を開ける。**入口で機械が止めるのが唯一の再発防止**になる。

## 何を見るか

「テキスト入力を描画するファイル」を全部拾い、次のどちらかを満たさなければ落とす。

1. そのファイル自身がキーボード回避を持っている
2. 下の EXEMPTIONS に **理由付きで** 載っている

⚠️ **祖先を静的に辿って «親が守っているから OK» と判定しない。**
   親子関係は props や条件分岐で変わるので、静的解析では嘘になる。
   «親が守っている» と言い切れるものは、その根拠を EXEMPTIONS へ日本語で書くこと。
   書けないなら、それは «守られている» と確認できていないということである。

## Android で «何もしない» 書き方に注意

`behavior` を渡さない / `Platform.OS === "ios" ? "padding" : undefined` は、
**Android では KeyboardAvoidingView が 1px も動かさない**。OS の adjustResize に
全部任せる形になる。持っているだけでは «守っている» ことにならないので、
このスクリプトは behavior の有無まで見る。
*/
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const SCAN_DIRS = ["app", "features", "components"];

/** テキスト入力を描画していると見なす印 */
const INPUT_MARKERS = [/<TextInput\b/, /<RNTextInput\b/, /<PaperTextInput\b/];

/** キーボード回避を «Android でも» 持っていると見なす印 */
const AVOIDANCE_MARKERS = [
	// behavior を Android にも渡している KeyboardAvoidingView
	/behavior=\{Platform\.select\(/,
	/behavior=\{Platform\.OS === "ios" \? "padding" : "height"\}/,
	/behavior="(padding|height)"/,
	// 共有ヘルパ
	/<KeyboardAwareForm\b/,
	/KeyboardAwareScrollView/,
];

/**
 * 免除。**必ず «なぜ守られているか / なぜ守らなくてよいか» を書くこと。**
 * 「たぶん親が見てる」は理由ではない。
 */
const EXEMPTIONS = new Map([
	[
		"components/DishCategoryAutocomplete.tsx",
		"入力欄だけを描く部品。単独では画面にならず、必ず下の «守られている画面» の中に置かれる。" +
			"置く側（ReviewForm / dish-category.tsx / add-record.tsx）がこのスクリプトの検査対象になっている。",
	],
	[
		"components/LocationAutocomplete.tsx",
		"同上。置く側は search/index.tsx / select-restaurant.tsx / saved-dish-category-location.tsx。",
	],
	[
		"features/restaurantPicker/components/RestaurantNameSearch.tsx",
		"同上。置く側は add-record.tsx / select-restaurant.tsx。",
	],
	[
		"features/profile/components/FeedbackForm.tsx",
		"描画元は app/[locale]/(tabs)/profile/feedback.tsx の 1 箇所だけ（grep で確認済み。" +
			"edit.tsx / ProfileEditForm.tsx の登場はコメント内の言及）。その feedback.tsx が " +
			"#1629 で Android にも behavior を渡すようになったので守られている。",
	],
	[
		"features/dishCategoryGroupVotes/components/DishCategoryGroupVoteCompletionModal.tsx",
		"描画元は DishCategoryGroupVoteVoteScreen の 1 箇所だけで、必ず " +
			"DishCategoryGroupVoteInlineOverlay に包まれている（同ファイル 287-295 行）。" +
			"そのオーバーレイは Android にも behavior=\"height\" を渡している。",
	],

	/*
	#1629 ⚠️ **ここから下の 4 つは «直っていない» 免除である。**

	社内の貢献タスク画面（contribution-tasks）。一般ユーザーは到達しない管理用の画面で、
	1 ファイルずつ構造が違い（早期 return が複数・画面ルートとサブ部品が同居）、
	機械的に包むと壊す。タスクのデータと権限が要るため手元で動作確認もできない。

	**同じ穴は空いている。** 一般ユーザー向けの画面を優先して先に直し、これらは
	«見えている宿題» として残す。触るときは 1 ファイルずつ実機で確認すること。
	*/
	[
		"app/[locale]/contribution-tasks/dish-category-image-review.tsx",
		"社内の貢献タスク画面。未対応（上のコメント参照）。",
	],
	[
		"app/[locale]/contribution-tasks/dish-category-manual-text-supply.tsx",
		"社内の貢献タスク画面。未対応（上のコメント参照）。",
	],
	["app/[locale]/contribution-tasks/dish-copy-survey.tsx", "社内の貢献タスク画面。未対応（上のコメント参照）。"],
	["app/[locale]/contribution-tasks/dish-ranking-summary.tsx", "社内の貢献タスク画面。未対応（上のコメント参照）。"],
	[
		"features/map/components/BidForm.tsx",
		"入札 UI。どの画面からも描画されていない（#1411 で導線を落としたまま残っている）。" +
			"到達できないので «隠れる» が起きない。復活させるときはこの行を消して回避を入れること。",
	],
]);

function walk(dir, out = []) {
	for (const name of readdirSync(dir)) {
		const p = path.join(dir, name);
		if (statSync(p).isDirectory()) {
			if (name === "node_modules" || name === "__tests__") continue;
			walk(p, out);
		} else if (name.endsWith(".tsx") && !name.includes(".test.")) {
			out.push(p);
		}
	}
	return out;
}

const files = SCAN_DIRS.flatMap((d) => walk(path.join(ROOT, d)));
const offenders = [];
const exempted = [];

for (const abs of files) {
	const rel = path.relative(ROOT, abs).split(path.sep).join("/");
	const src = readFileSync(abs, "utf8");
	if (!INPUT_MARKERS.some((re) => re.test(src))) continue;

	if (EXEMPTIONS.has(rel)) {
		exempted.push(rel);
		continue;
	}
	if (AVOIDANCE_MARKERS.some((re) => re.test(src))) continue;

	// 何が足りないのかを言い分ける（«持っていない» と «持っているが Android で無効» は直し方が違う）
	const hasInertKav =
		/<KeyboardAvoidingView/.test(src) &&
		(/behavior=\{Platform\.OS === "ios" \? "padding" : undefined\}/.test(src) || !/behavior=/.test(src));
	offenders.push({
		rel,
		why: hasInertKav
			? "KeyboardAvoidingView はあるが behavior を Android へ渡していない（Android では 1px も動かない）"
			: "キーボード回避が無い",
	});
}

if (offenders.length > 0) {
	console.error("❌ 入力欄があるのに Android のキーボード回避が無いファイル:\n");
	for (const o of offenders) console.error(`   ・${o.rel}\n     → ${o.why}`);
	console.error(
		`\n合計 ${offenders.length} 件。回避を入れるか、EXEMPTIONS へ **理由を書いて** 追加すること。\n` +
			`「たぶん親が見てる」は理由にならない（scripts/assert-keyboard-avoidance.mjs 冒頭を読むこと）。`,
	);
	process.exit(1);
}

console.log(`✅ 入力欄を持つ画面は全て Android のキーボード回避を持っています`);
console.log(`   ・理由付きで免除中 … ${exempted.length} ファイル`);
