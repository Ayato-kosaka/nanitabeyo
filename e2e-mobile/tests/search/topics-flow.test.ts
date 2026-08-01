import { launchAppWithSession } from "../../fixtures/e2e";
import { ResultScreen } from "../../screens/ResultScreen";
import { SearchScreen } from "../../screens/SearchScreen";
import { TopicsScreen } from "../../screens/TopicsScreen";

/**
 * 🍜 検索 → トピック提案 → 結果フィードのハッピーパス（実 API・最重要 / Tier 2）
 *
 * 目的: アプリの中核体験である「条件を入れて検索 → AI のトピック提案 → 料理フィード閲覧 → 戻る」の
 *       一連のフローが、ネイティブでも実データで成立することを保証する。
 *       （e2e-web の tests/search/topics-flow.spec.ts に対応）
 *
 * ## 検索の実行を beforeAll に置いている理由
 * e2e-web の同 spec は 3 つの test それぞれで検索からやり直しているが、トピック生成は AI 応答待ちで
 * 実測数十秒かかる。ネイティブは起動もエミュレータ上で遅いため、同じ構成にすると
 * 「1 つのシナリオを検証するのに毎回 1 分待つ」ことになり、CI 時間とフレークの両方が悪化する。
 * ここでは **検索の実行を beforeAll で 1 回だけ**行い、その後の画面遷移を it 単位で検証する。
 * Jest は 1 ファイル内の it を宣言順に直列実行するため（jest.config.js の maxWorkers: 1 も前提）、
 * 「トピック画面に到達している」という前提を後続の it が共有できる。
 *
 * ## Detox 固有の待ち合わせ（#1031 §4-1 / §4-2）
 * 「場所サジェストの詳細取得」「トピック生成」「結果フィードの事前読み込み」はいずれもネットワーク待ちを含む。
 * Detox には Playwright の `waitForResponse` に相当する API が無いため、
 * Detox の同期機構（未完了リクエスト中は操作をブロックする）＋ **画面上の観測点**で待つ。
 */
describe("検索フロー（実 API）", () => {
	const search = new SearchScreen();
	const topics = new TopicsScreen();
	const result = new ResultScreen();

	beforeAll(async () => {
		await launchAppWithSession({ as: "anon" });
		await search.expectLoaded();

		// 場所だけを確定させる（時間帯 lunch / 同行者 solo には初期値があるため追加選択は不要）
		await search.clearLocationIfPresent();
		await search.typeLocation("渋谷");
		await search.selectLocationSuggestion(0);
		await search.submit();
	});

	// ─ テストケース: 検索実行でトピック提案カードが表示される ─
	// 手順:
	//   1. beforeAll で「渋谷」を確定して検索を実行済み
	//   2. トピック画面のヘッダとカードの選択ボタンが表示されることを検証
	//      （初回訪問時はスポットライトチュートリアルが自動表示されるため、expectLoaded が閉じてから待つ）
	it("検索実行でトピック提案カードが表示される", async () => {
		await topics.expectLoaded();
		await topics.expectHeaderVisible();
	});

	// ─ テストケース: トピックを選ぶと結果フィードが表示され、閉じるとトピック画面へ戻る ─
	// 手順:
	//   1. 先頭カードの「この料理にする！」をタップする（カルーセルの多重マウント対策で atIndex(0)）
	//   2. 結果フィード画面（result-close-button）が表示されることを検証
	//   3. 閉じるボタンを押す
	//   4. 履歴は 検索 → トピック → 結果 と積まれているため、戻り先はトピック画面であることを検証
	it("トピックを選ぶと結果フィードが表示され、閉じるとトピック画面へ戻る", async () => {
		await topics.expectLoaded();

		await topics.chooseFirstTopic();
		await result.expectLoaded();

		await result.close();
		await topics.expectLoaded();
	});
});
