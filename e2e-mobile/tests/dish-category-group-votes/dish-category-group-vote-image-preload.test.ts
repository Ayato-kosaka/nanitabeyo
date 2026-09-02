import { element, existsNow, launchAppWithSession, localeDeepLink } from "../../fixtures/e2e";
import { DishCategoryGroupVoteScreen } from "../../screens/DishCategoryGroupVoteScreen";

/**
 * 🖼 友達投票・候補画像の先読み（#1213）
 *
 * 対応する e2e-web の spec: tests/dish-category-group-votes/vote-candidate-image-preload.spec.ts
 *
 * ## 何を守るテストか
 * 投票画面は候補カードを **1 枚ずつ**しか描かない。候補を送るたびに生の uri を
 * `DishCategoryVisualCard` へ渡していたため、既に見えているはずの画像でも取得がその場から始まり、
 * カード背景色（#EEE）のグレーが一瞬見えていた。修正は `useDishCategoryImageResources` へ
 * 候補全件を渡して **画面マウント時に先読みする**というもの。
 *
 * ## 観測の仕組み（web との違い）
 * web は「送る前に取得が始まっていたか」を Resource Timing で直接見られるが、
 * native にはそれが無い。`Image.loadAsync` はネットワーク層で完結し、画面に出るのは
 * «今表示している 1 枚» だけなので、Detox からは **「先読みできている」と
 * 「たまたま速かった」を区別できない**。
 * そこでアプリ側（app-expo/lib/e2e/voteImagePreloadProbe.tsx）が、候補ごとの
 * `imageState` を数えて `ready=<n>/<total>` を持つ
 * `dish-category-group-vote-image-preload-probe` を描画する。この spec はそれが
 * `ready=<total>/<total>` になるのを **1 枚も送らないうちに** 待つだけ。
 * **時間ではなく状態を見ている**ので「ランナーが遅い」では赤くならない
 * （tests/search/preload-images.test.ts と同じ観測原則）。
 *
 * ## 感度（偽の緑になっていないか）
 * - 修正後 … マウント時に全件先読みするので `ready=N/N` = **緑が正しい**
 * - 修正前（プリロード契約に未参加）… `imageState` が常に idle で `ready=0/N` で赤くなる
 * - 先読みを «表示中の 1 枚だけ» に縮めた回帰 … `ready=1/N` で赤くなる
 *
 * ## 前提データ / スコープ
 * ネイティブは detail API をモックできないため、実在する **未投票** の shareToken を
 * `TEST_GROUP_VOTE_SHARE_TOKEN` で渡す必要がある（未設定ならスキップ）。
 * 候補数もセッション依存なので固定値でアサートせず、`TEST_GROUP_VOTE_CANDIDATE_COUNT`
 * で渡された数を使う（未設定なら既定 2 件）。
 *
 * プローブは **E2E ビルド限定**で描画される。`EXPO_PUBLIC_E2E_TUTORIAL_HOOK=1` を付けずに
 * ビルドすると要素ごと存在しないため、`expectAllCandidateImagesPreloaded()` はその旨を
 * 名指しで報告して落ちる。
 *
 * ## dev DB への影響
 * 無し（先読みの観測と候補送りだけで、投票の送信は行わない）。
 */
const SHARE_TOKEN = process.env.TEST_GROUP_VOTE_SHARE_TOKEN;
const CANDIDATE_COUNT = Number(process.env.TEST_GROUP_VOTE_CANDIDATE_COUNT || 2);

const describeWithShareToken = SHARE_TOKEN ? describe : describe.skip;

describeWithShareToken("友達投票の候補画像の先読み", () => {
	const voteScreen = new DishCategoryGroupVoteScreen();

	beforeAll(async () => {
		// #1030 【設計】匿名サインインのクォータを消費しないよう、確立済みセッションを注入して起動する
		await launchAppWithSession({
			as: "anon",
			url: localeDeepLink(`search/dish-category-group-votes/${SHARE_TOKEN}/vote`),
		});
	});

	// ─ テストケース: 1 枚も送らないうちに候補画像が全件先読みされている ─
	// 手順:
	//   1. 投票画面へディープリンクして起動する
	//   2. 投票カードが操作できる状態になるまで待つ
	//   3. **まだ 1 枚も送っていない**この時点で `ready=N/N` になるまで待つ
	// 補足: ここで送ってしまうと「送ったから取れた」のか「先読みで取れた」のかが
	//       区別できなくなる（= 偽の緑）。送る前に観測することがこのテストの肝。
	it("投票画面を開いた時点で候補画像が全件先読みされている", async () => {
		await voteScreen.expectVoteCardLoaded();

		await voteScreen.expectAllCandidateImagesPreloaded(CANDIDATE_COUNT);
	});

	// ─ テストケース: 候補を送り切っても先読み済みのまま維持される ─
	// 手順:
	//   1. 候補を «好き» で最後まで送る（完了入力へ切り替わったらボタンは消える）
	//   2. 送り終えた後も `ready=N/N` のままであることを検証する
	// 補足: 候補を送るたびに読み込み直す実装へ戻ると、`imageState` が idle / loading へ
	//       落ちて ready が減るため、ここで赤くなる。
	//       ⚠️ このケースだけでは «送る前から ready だった» ことを言えないので、
	//          上のケースと必ず対にすること（片方だけ残さない）。
	it("候補を送り切っても先読み済みの状態が維持される", async () => {
		for (let i = 0; i < CANDIDATE_COUNT; i += 1) {
			if (!(await existsNow(voteScreen.likeButton))) break;
			await element(voteScreen.likeButton).tap();
		}

		await voteScreen.expectAllCandidateImagesPreloaded(CANDIDATE_COUNT);
	});
});
