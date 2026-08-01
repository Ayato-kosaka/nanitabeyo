import * as fs from "node:fs";
import * as path from "node:path";
import { test as setup } from "@playwright/test";
import { ANON_STORAGE_STATE_PATH } from "../../playwright.config";
import { waitForAnonymousSession } from "../../utils/auth";

/**
 * 🕶️ 匿名セッションセットアップ
 *
 * ## 背景
 * Supabase の匿名サインイン(signInAnonymously)には「30 回/時/IP」というレート制限があり、
 * dev/prod で同一プロジェクトを共有しているため無視できない制約になっている。
 * アプリは `AuthProvider` が起動時にセッションが無ければ自動で匿名サインインを行うため、
 * テストごとに新規ブラウザコンテキストで起動する = テストごとに新規匿名ユーザーが
 * 作成される、という構造だと E2E スイートを 1 回回すだけで上限に達してしまう。
 *
 * ## 対応
 * ログイン済みユーザー(tests/setup/auth.setup.ts)と同じ考え方で、匿名セッションも
 * 「1 回だけ確立して storageState として使い回す」方式にする。
 * これにより desktop-chrome / mobile-chrome / mobile-safari の 3 プロジェクト分の
 * 匿名サインイン消費が実質 1 回にまで削減される。
 *
 * ※ 匿名サインインの自動確立そのものを検証する tests/smoke/boot.spec.ts だけは、
 *   この storageState を使わずファイル内で明示的にフレッシュな状態へ戻している。
 */
setup("匿名セッションを確立し storageState を生成する", async ({ page }) => {
	await page.goto("/");
	await waitForAnonymousSession(page);

	fs.mkdirSync(path.dirname(ANON_STORAGE_STATE_PATH), { recursive: true });
	await page.context().storageState({ path: ANON_STORAGE_STATE_PATH });
});
