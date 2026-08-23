import { by, describeMutation, launchAppWithSession, tapWhenVisible, waitUntilVisible } from "../../fixtures/e2e";
import { DishCategoryGroupVoteResultScreen } from "../../screens/DishCategoryGroupVoteResultScreen";
import { DishCategoryGroupVoteScreen } from "../../screens/DishCategoryGroupVoteScreen";
import { MyDishCategoryGroupVotesScreen } from "../../screens/MyDishCategoryGroupVotesScreen";
import { ProfileScreen } from "../../screens/ProfileScreen";
import { SearchScreen } from "../../screens/SearchScreen";
import { SettingsScreen } from "../../screens/SettingsScreen";
import { TabBar } from "../../screens/TabBar";
import { TopicsScreen } from "../../screens/TopicsScreen";

/**
 * 🗳「グループ投票の履歴」一覧画面（#1505 / ネイティブ）
 *
 * e2e-web の tests/profile/my-dish-category-group-votes.spec.ts に対応する。
 *
 * ## 一覧に出るもの（#1505 仕様変更）
 * 一覧は **自分が主催した投票だけ**（参加しただけの投票は API の where 句で除かれる）。
 * 全行が主催なので「主催」バッジは無く、行のバッジは投票済み／未投票の 1 つだけになった。
 *
 * ## Web 版からの変更点（e2e-web は API をモックしているが、ここは実データで検証する）
 * Detox には `page.route()` に相当するネットワーク傍受手段が無いため、一覧の中身を
 * 固定できない。そのため web 側の 4 ケース（表示 / 0 件 / 遷移 / 参加しただけの投票を出さない）
 * のうち、**この spec で実際に検証できるのは「主催した投票が一覧に出て、そこから投票結果画面 →
 * 投票画面まで遷移できること」だけ**に絞っている。落とした 2 ケースと理由:
 *
 * - **0 件表示**: この spec が使う匿名セッションは他の mutation spec とも共有される dev
 *   アカウントで、履歴を空に戻す手段が無い（削除導線が無いのは #1205 の topics-group-vote-
 *   double-tap.test.ts と同じ事情）。0 件表示は web 側のモックでのみ担保する。
 * - **参加しただけの投票が出ないこと**: 「参加」を作るには別アカウントが共有リンクを開いて
 *   投票する必要があり、Detox 側にアカウント切り替えの仕組みが無い。除外は API の where 句
 *   （api 側の repository spec で固定）と web 側のモックで担保する。
 *
 * ## 一覧の先頭行を「今日の日付」で特定する理由と限界
 * 行に testID が無く、観測点は `accessibilityLabel`（表示日付）のみ（詳細は
 * screens/MyDishCategoryGroupVotesScreen.ts 冒頭コメント）。同じ dev アカウントで同日に
 * 他の mutation spec が投票を作成していると、同じ表示日付の行が複数になりうる。
 * 一覧は新しい順に並ぶ前提で `atIndex(0)`（=画面内で最初に見つかる行）を使うが、
 * これは「直前に自分が作成した投票が最新である」という前提に依存する近似であり、
 * 万一 flaky になった場合は行に testID を足す実装変更で解消するのが本筋。
 *
 * ## dev DB への影響（重要）
 * 友達投票の作成 API を実際に呼ぶため **不可逆**（dev DB に投票セッションが 1 件積み上がる。
 * 削除導線は無い）。`RUN_MUTATION=1` を明示した手動実行でのみ走らせること。
 */
describeMutation("グループ投票の履歴一覧 @mutation (#1505)", () => {
	const search = new SearchScreen();
	const topics = new TopicsScreen();
	const voteResult = new DishCategoryGroupVoteResultScreen();
	const voteScreen = new DishCategoryGroupVoteScreen();
	const tabBar = new TabBar();
	const profileScreen = new ProfileScreen();
	const settingsScreen = new SettingsScreen();
	const myGroupVotesScreen = new MyDishCategoryGroupVotesScreen();

	// #1027 テストごとに起動し直して独立性を担保する
	// #1030 3-1 セッション注入起動は匿名クォータを消費しない
	beforeEach(async () => {
		await launchAppWithSession({ as: "anon" });
		await search.expectLoaded();
	});

	// ─ テストケース: 主催した投票が一覧の先頭に表示され、結果画面 → 投票画面へ遷移できる ─
	// 手順:
	//   1. 検索してトピック提案画面まで進み、「友達投票開始」で投票セッションを作る（自分が主催）
	//   2. マイページの「グループ投票の履歴」行から一覧画面へ遷移する
	//   3. 先頭行（今日の日付）が出ていること、まだ投票していないので「未投票」バッジが付くことを検証
	//   4. その行をタップし、投票結果画面（[shareToken] ルート）へ遷移することを検証
	//   5. まだ投票していないため出る「投票する」CTA を押し、既存の投票画面
	//      （DishCategoryGroupVoteScreen / vote.tsx）へ遷移できることを検証
	it("主催した投票が一覧に表示され、結果画面を経由して投票画面へ遷移できる", async () => {
		await search.typeLocation("渋谷");
		await search.selectLocationSuggestion(0);
		await search.submit();
		await topics.expectLoaded();

		await topics.openGroupVote();
		await voteResult.expectSingleLoaded();

		const todayLabel = new Date().toLocaleDateString("ja-JP", {
			year: "numeric",
			month: "short",
			day: "numeric",
		});

		await tabBar.gotoProfile();
		// #1402 で独立した設定画面は無くなり、設定項目はマイページの縦リストへ統合された。
		// 「グループ投票の履歴」行もそこに並ぶので、歯車を経由せずマイページから直接タップする。
		await profileScreen.expectLoaded();
		await settingsScreen.openMyGroupVotes();

		await myGroupVotesScreen.expectLoaded();
		await myGroupVotesScreen.expectItemVisible(todayLabel, undefined, 0);

		// 作ったばかりで自分はまだ投票していないので「未投票」バッジが付く
		const hasNotVotedBadge = await myGroupVotesScreen.hasNotVotedBadge(todayLabel);
		if (!hasNotVotedBadge) {
			throw new Error("主催した投票の行に「未投票」バッジが出ていません。");
		}

		await myGroupVotesScreen.openItem(todayLabel, 0);

		// 結果画面へ着いたことを検証（ヘッダーの「共有リンクをコピー」は画面 1 枚につき 1 つだけ）
		await waitUntilVisible(by.id("dish-category-group-vote-copy-share-link"));

		// まだ投票していないので「投票する」CTA が出る（DishCategoryGroupVoteResultScreen.tsx）。
		// 押すと既存の投票画面（vote.tsx）へ遷移する
		await tapWhenVisible(by.text("投票する"));
		await voteScreen.expectVoteCardLoaded();
	});
});
