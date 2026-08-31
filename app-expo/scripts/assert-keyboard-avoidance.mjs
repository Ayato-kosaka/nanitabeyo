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
const INPUT_MARKERS = [
	/<TextInput\b/,
	/<RNTextInput\b/,
	/<PaperTextInput\b/,
	/*
	#1629 【バグ】**入力欄を «部品越しに» 置いている画面を見落としていた。**

	`LocationAutocomplete` などの部品は「単独では画面にならない。置く側が検査対象だから免除」
	という理由で EXEMPTIONS に入れていた。ところが **置く側は `<TextInput` を 1 つも書かない**
	ので、この検査の対象にすら入っていなかった。**免除の理由が循環していた。**

	その結果「入力欄を持つ画面は全て回避を持っています ✅」と報告し続けながら、
	実際には «さがす» の «どのあたりで探す？» / お店を選ぶの検索窓 /
	保存カテゴリの地点検索 / 料理カテゴリ選択 の 4 画面が **無防備のまま**だった。

	⚠️ 入力欄を内包する部品をここへ足すこと。足し忘れると同じ嘘をつく。
	*/
	/<LocationAutocomplete\b/,
	/<DishCategoryAutocomplete\b/,
	/<RestaurantNameSearch\b/,
	/<FeedbackForm\b/,
	/<SavedDishCategoryLocationSearch\b/,
	/<DishCategorySearchForm\b/,
];

/** キーボード回避を «Android でも» 持っていると見なす印 */
const AVOIDANCE_MARKERS = [
	// behavior を Android にも渡している KeyboardAvoidingView
	/behavior=\{Platform\.select\(/,
	/behavior=\{Platform\.OS === "ios" \? "padding" : "height"\}/,
	/behavior="(padding|height)"/,
	// 共有ヘルパ
	/<KeyboardAwareForm\b/,
	/KeyboardAwareScrollView/,
	/*
	#1629 キーボードの高さを直接もらって自分で余白を空ける方式（`hooks/useKeyboardInset.ts`）。
	`KeyboardAvoidingView` は «自分の枠を測って引き算する» 前提で、Android 15 以降の
	edge-to-edge ではその前提が崩れる。オーナー実機で 2 度«直っていない»と言われた実績があるので、
	新しく直す画面はこちらを使うこと。
	*/
	/useKeyboardInset\(\)/,
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
		"入力欄だけを描く部品。置く側（search/index.tsx / select-restaurant.tsx / " +
			"saved-dish-category-location.tsx）が INPUT_MARKERS でこの部品ごと検査対象になった（#1629）。",
	],
	[
		"features/restaurantPicker/components/RestaurantNameSearch.tsx",
		"同上。置く側は add-record.tsx / select-restaurant.tsx で、どちらも検査対象。",
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
	/*
	#1629 ⚠️ **ここから下の 6 つも «直っていない» 免除である。**

	いずれも «ヘッダーの直下に検索窓、その下に候補リスト» という形の画面・部品で、
	**入力欄そのものはキーボードより上にあるので隠れない**。覆われるのは候補リストの下の方で、
	オーナー報告（「入力した文字が見えない」）とは別の症状である。

	候補リストへ回避を入れるには、リストの高さをキーボードぶん詰める作りへ直す必要があり、
	画面ごとに構造が違う（FlatList / 独自パネル / 親が高さを固定）。まとめて機械的に包むと壊す。

    **同じ穴は空いている。** «入力欄が隠れる» 側を先に直し、これらは «見えている宿題» として残す。
	触るときは 1 画面ずつ実機で確認すること。
	*/
	[
		"app/[locale]/(tabs)/my-dishes/select-restaurant.tsx",
		"検索窓はヘッダー直下（キーボードより上）。候補リストの下端は未対応（上のコメント参照）。",
	],
	[
		"app/[locale]/(tabs)/profile/saved-dish-category-location.tsx",
		"同上。中身は LocationSearchForm。",
	],
	["app/[locale]/restaurant/[restaurantId]/dish-category.tsx", "同上。中身は DishCategorySearchForm。"],
	["features/map/components/DishCategorySearchForm.tsx", "同上（上の 2 画面の中身）。"],
	["features/map/components/DishCategoryStep.tsx", "同上。記録フローの 1 歩目で、検索窓は最上部。"],
	["features/profile/components/LocationSearchForm.tsx", "同上。"],
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
