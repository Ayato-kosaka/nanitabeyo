import { revokeAllSessions } from "../utils/revokeSessions";

/**
 * 🧹 Jest globalTeardown（Detox 公式 globalTeardown のラッパー）
 *
 * ## 役割
 * 1. この run で発行したセッションを **`signOut({ scope: "global" })` で revoke する**（#1030 レビュー B-2 の MUST）
 * 2. Detox 公式の globalTeardown を呼ぶ（デバイスの後始末）
 *
 * ## ⚠️ Detox の globalTeardown は「置き換え」てはならない（#1030 レビュー M-6）
 * Detox 公式の Jest 連携は globalSetup / globalTeardown / testEnvironment / reporter の 4 点セットで成立しており、
 * 独自ロジックが要る場合は **公式実装を import して呼んだうえで自前処理を足す**ことが公式に指示されている。
 * かつ **revoke が失敗しても必ず呼ぶ**（finally）— さもないとエミュレータが解放されずに残り、次の run を巻き込む。
 */

// #1030 【設計】M-6: Detox 公式の globalTeardown。型定義が提供されていないため require で読み込む
const detoxGlobalTeardown = require("detox/runners/jest/globalTeardown") as () => Promise<void>;

export default async function globalTeardown(): Promise<void> {
	try {
		await revokeAllSessions();
	} finally {
		await detoxGlobalTeardown();
	}
}
