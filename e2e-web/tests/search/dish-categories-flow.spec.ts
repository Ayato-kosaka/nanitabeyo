import { test, expect } from "../../fixtures/test";
import { SearchPage } from "../../pages/SearchPage";
import { DishCategoriesPage } from "../../pages/DishCategoriesPage";
import { ResultPage } from "../../pages/ResultPage";

/**
 * 🍜 検索 → トピック提案 → 結果フィードのハッピーパステスト(実 API・最重要)
 *
 * 目的: アプリの中核体験である「条件を入れて検索 → AI のトピック提案 → 料理フィード閲覧」
 *       の一連のフローが実データで成立することを保証する。
 * 前提: 実 API 依存(CORS 設定済み)。トピック生成はレスポンスに時間がかかるため
 *       タイムアウトを長めに設定すること。
 */

/** Places の日次上限だけが持つ errorCode（`shared/api/v1/res/base-response.ts` の `ErrorCode`） */
const QUOTA_ERROR_CODE = "EXTERNAL_QUOTA_EXCEEDED";

/** 観測した bulk-import の失敗。`errorCode` はレスポンス本文が読めなかったとき null */
type BulkImportFailure = { status: number; errorCode: string | null };

/**
 * トピック選択 → 結果フィード表示。**Places クォータ枯渇の日はここで skip する。**
 *
 * 結果フィードの取得（`POST /v1/dishes/bulk-import`）はサーバ側で Google Places Text Search を
 * 叩く。このプロジェクトの SearchText クォータは **45 リクエスト/日で、引き上げない方針**
 * （オーナー判断 2026-08-22: E2E のために課金を発生させない）。枯渇した日はテストの検証対象
 * （UI とフロー）と無関係な失敗になるため、その失敗モード**だけ**を検知して skip する。
 * それ以外の失敗（画面が出ない・遷移しない等）は通常どおり fail させる。
 *
 * ## #1579 【バグ】«どの番号が上限なのか» を確かめずに 5xx を上限と呼んでいた
 *
 * 旧実装は `status >= 500` を «クォータ枯渇» と呼んでいた。**上限は 500 では返ってこない。**
 * `api/src/core/external-api/external-api.service.ts` は上流の 429 / RESOURCE_EXHAUSTED を
 * **429 + `errorCode: EXTERNAL_QUOTA_EXCEEDED`** で返す（#1629 で 500 から外し、#1642 で
 * 503 から 429 へ戻した。503 は `MaintenanceGuard` の番号なので実機にメンテ告知が出た）。
 * つまり旧実装は両方向に外していた:
 *
 * | 起きたこと | 旧実装 | 正しい扱い |
 * | --- | --- | --- |
 * | Places の日次上限（429 / `EXTERNAL_QUOTA_EXCEEDED`） | **skip しない**（< 500）→ 赤 | skip |
 * | 無関係な 500（converter 追従漏れ・未処理例外など） | **skip する**（上限だと名乗る）| 赤 |
 *
 * 下段が重い。**skip は pass ではない**のに失敗すら出さないので、本物のバグが «クォータの日» の
 * 顔をして消える。列を足したあと converter / 生 SQL が落ちる事故はこのリポジトリで 2 回起きている。
 *
 * だから «外部の都合» と名乗ってよいのは **番号と errorCode の両方が一致したときだけ**にする。
 * 一致しなかった失敗は、観測できた内容をログへ出してから元の例外を投げ直す（原因追跡のため）。
 */
async function chooseDishCategoryOrSkipOnQuota(
	appPage: import("@playwright/test").Page,
	dishCategoriesPage: DishCategoriesPage,
	resultPage: ResultPage,
): Promise<void> {
	// 本文を読むのは非同期なので、Promise のまま溜めて catch でまとめて待つ
	const failures: Promise<BulkImportFailure>[] = [];
	const onResponse = (response: import("@playwright/test").Response) => {
		if (!response.url().includes("/v1/dishes/bulk-import")) return;
		if (response.status() < 400) return;
		const status = response.status();
		failures.push(
			response.text().then(
				(text) => ({ status, errorCode: readErrorCode(text) }),
				// 本文が読めなくても «失敗があった» ことは残す（null は «読めなかった»）
				() => ({ status, errorCode: null }),
			),
		);
	};
	appPage.on("response", onResponse);
	try {
		await dishCategoriesPage.chooseFirstDishCategory();
		await resultPage.expectLoaded();
	} catch (error) {
		const observed = await Promise.all(failures);
		const quota = observed.find((f) => f.status === 429 && f.errorCode === QUOTA_ERROR_CODE);
		if (quota) {
			test.skip(
				true,
				`Places SearchText クォータ枯渇（bulk-import が 429 / ${QUOTA_ERROR_CODE}）。45/日・引き上げない方針のため skip`,
			);
		}
		if (observed.length > 0) {
			// ⚠️ ここで skip しない。番号が違う失敗は «外部の都合» ではないので赤にする
			console.error(
				`bulk-import の失敗を観測しましたが、クォータ枯渇（429 / ${QUOTA_ERROR_CODE}）ではありません: ` +
					observed.map((f) => `${f.status} / ${f.errorCode ?? "(本文を読めず)"}`).join(", "),
			);
		}
		throw error;
	} finally {
		appPage.off("response", onResponse);
	}
}

/** API のエラー本文（`BaseResponse`）から `errorCode` を取り出す。読めなければ null */
function readErrorCode(text: string): string | null {
	try {
		const parsed: unknown = JSON.parse(text);
		if (parsed && typeof parsed === "object" && "errorCode" in parsed) {
			const code = (parsed as { errorCode?: unknown }).errorCode;
			return typeof code === "string" ? code : null;
		}
	} catch {
		// JSON でない本文（プロキシの HTML エラーページなど）
	}
	return null;
}

test.describe("検索フロー(実 API)", () => {
	// AI によるトピック生成に時間がかかる(実測 30 秒近くかかることがある)ため、
	// 既定の 30 秒テストタイムアウトでは各ステップの内部 expect(30s) と合算して超過しうる。
	// この describe 全体のテストタイムアウトを 90 秒に延長する。
	test.setTimeout(90_000);

	// ─ テストケース: 検索実行でトピック提案カードが表示される ─
	// 手順:
	//   1. appPage で起動
	//   2. 場所に「渋谷」を入力しサジェスト先頭を選択(location 確定)
	//      (時間帯・シーンには初期値があるため追加選択は不要)
	//   3. 検索ボタン(search-submit-button)をクリック
	//   4. /search/dish-categories へ遷移し、トピックカードが 1 枚以上表示されることを検証
	test("検索実行でトピック提案カードが表示される", async ({ appPage }) => {
		const searchPage = new SearchPage(appPage);
		const dishCategoriesPage = new DishCategoriesPage(appPage);

		await searchPage.typeLocation("渋谷");
		await searchPage.selectLocationSuggestion(0);
		await searchPage.submitButton.click();

		await dishCategoriesPage.expectLoaded();
	});

	// ─ テストケース: トピック選択で結果フィードが表示される ─
	// 手順:
	//   1. 上記フローでトピックカードを表示する
	//   2. 先頭のカードの「この料理にする！」ボタンをタップする
	//   3. 結果フィード画面(result-close-button)が表示されることを検証
	test("トピック選択で結果フィードが表示される", async ({ appPage }) => {
		const searchPage = new SearchPage(appPage);
		const dishCategoriesPage = new DishCategoriesPage(appPage);
		const resultPage = new ResultPage(appPage);

		await searchPage.typeLocation("渋谷");
		await searchPage.selectLocationSuggestion(0);
		await searchPage.submitButton.click();
		await dishCategoriesPage.expectLoaded();

		await chooseDishCategoryOrSkipOnQuota(appPage, dishCategoriesPage, resultPage);
	});

	// ─ テストケース: 結果画面のクローズでトピック画面に戻る ─
	// 手順:
	//   1. 結果フィードを表示する
	//   2. クローズボタン(result-close-button)をクリック
	//   3. トピック画面へ戻ることを検証
	// 補足: クローズ処理(useSearchResult.handleClose)は router.back() を呼ぶ実装であり、
	//       ナビゲーション履歴は 検索 → トピック → 結果 と積まれているため、
	//       1 回の close で戻る先は検索画面ではなく直前のトピック画面になる
	test("結果画面のクローズでトピック画面に戻る", async ({ appPage }) => {
		const searchPage = new SearchPage(appPage);
		const dishCategoriesPage = new DishCategoriesPage(appPage);
		const resultPage = new ResultPage(appPage);

		await searchPage.typeLocation("渋谷");
		await searchPage.selectLocationSuggestion(0);
		await searchPage.submitButton.click();
		await dishCategoriesPage.expectLoaded();
		await chooseDishCategoryOrSkipOnQuota(appPage, dishCategoriesPage, resultPage);

		await resultPage.close();
		await dishCategoriesPage.expectLoaded();
	});
});
