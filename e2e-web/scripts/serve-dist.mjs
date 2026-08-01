/**
 * 🌐 app-expo/dist（Expo Web 静的エクスポート）を配信するローカル静的サーバ
 *
 * ## なぜ `npx serve` 等を使わないのか
 * 本番は Firebase Hosting（firebase.json）が以下の rewrite を行っている:
 *   1. `/:locale/xxx` → `/[locale]/xxx…`（動的セグメント [locale] の HTML へ書き換え）
 *   2. `**`           → `/index.html`（SPA fallback）
 * 汎用の SPA サーバでは 2 しか再現できず、ディープリンク時に本番と異なる HTML が返ってしまう。
 * このスクリプトは Node 標準ライブラリのみで上記に近い解決を行う（追加依存ゼロ）。
 *
 * ## ⚠️ Firebase Hosting との差分（重要）
 * このサーバは firebase.json の rewrite ルールを 1 つずつ読むのではなく、
 * 「X.html と X/index.html の両方を試す」寛容な探索で近似している。つまり
 * **Firebase Hosting より当たりやすい**。firebase.json の destination が
 * dist の実構造とズレていても、ここでは正しく表示できてしまうため、
 * その種の設定ミス（実際に本番 4 タブが 404 になる事故が起きた）は
 * ブラウザ E2E では検知できない。この設定と成果物の整合性は
 * tests/config/firebase-rewrites.spec.ts が静的に検証している。
 * （Firebase Emulator を使えば完全一致するが、起動が重いため採用していない）
 *
 * ## リクエストパスの解決順
 *   1. 完全一致するファイル            （例: /favicon.ico）
 *   2. `.html` を付けたファイル        （例: /ja-JP/map → /ja-JP/map.html）
 *   3. `/index.html` を付けたファイル  （例: /ja-JP/search → /ja-JP/search/index.html）
 *   4. 先頭セグメントを `[locale]` に置換して 1〜3 を再試行
 *      （例: /ja-JP/search → /[locale]/search/index.html — Expo の動的ルート出力に対応）
 *   5. SPA fallback: /index.html
 */
import * as http from "node:http";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 配信対象: モノレポルートから見た app-expo/dist
const DIST_DIR = path.resolve(__dirname, "../../app-expo/dist");
const PORT = Number(process.env.PLAYWRIGHT_PORT ?? 4173);

// dist が無い場合は日本語で案内して終了（webServer 起動失敗時に原因がすぐ分かるように）
if (!fs.existsSync(path.join(DIST_DIR, "index.html"))) {
	console.error("❌ app-expo/dist が見つかりません。");
	console.error("   先にリポジトリルートで次を実行してください:");
	console.error("   pnpm --filter app-expo build:web");
	process.exit(1);
}

/** 最小限の MIME タイプ対応表（dist に含まれる拡張子をカバー） */
const MIME_TYPES = {
	".html": "text/html; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".gif": "image/gif",
	".svg": "image/svg+xml",
	".ico": "image/x-icon",
	".txt": "text/plain; charset=utf-8",
	".xml": "application/xml; charset=utf-8",
	".webp": "image/webp",
	".woff": "font/woff",
	".woff2": "font/woff2",
	".ttf": "font/ttf",
	".map": "application/json; charset=utf-8",
	".webmanifest": "application/manifest+json; charset=utf-8",
};

/**
 * リクエストパスに対応するファイルを解決順に従って探す。
 * @param {string} pathname URL デコード・クエリ除去済みのパス
 * @returns {string | null} 見つかったファイルの絶対パス。見つからなければ null
 */
function resolveFile(pathname) {
	// パストラバーサル防御: dist 外へ出るパスは拒否する
	const safePath = path.normalize(pathname).replace(/^(\.\.[/\\])+/, "");

	/** 1 つのパス候補について「そのまま → .html → /index.html」の順で探すヘルパ */
	const tryCandidates = (p) => {
		const base = path.join(DIST_DIR, p);
		if (!base.startsWith(DIST_DIR)) return null; // 念のため二重チェック
		for (const candidate of [base, `${base}.html`, path.join(base, "index.html")]) {
			if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
		}
		return null;
	};

	// 手順 1〜3: パスをそのまま解決
	const direct = tryCandidates(safePath);
	if (direct) return direct;

	// 手順 4: 先頭セグメントを [locale] に置換して再試行
	// （firebase.json の `/:locale/xxx → /[locale]/xxx.html` rewrite に相当）
	const localeMatch = safePath.match(/^[/\\]?([A-Za-z]{2}(?:-[A-Za-z]{2})?)([/\\].*)?$/);
	if (localeMatch) {
		const rest = localeMatch[2] ?? "";
		const substituted = tryCandidates(path.join("[locale]", rest));
		if (substituted) return substituted;
	}

	return null;
}

const server = http.createServer((req, res) => {
	// クエリストリング・ハッシュを除去し、URL デコードする
	const pathname = decodeURIComponent((req.url ?? "/").split("?")[0].split("#")[0]);

	// 解決できなければ SPA fallback（firebase.json の `**` → /index.html rewrite に相当）
	const filePath = resolveFile(pathname) ?? path.join(DIST_DIR, "index.html");

	const ext = path.extname(filePath).toLowerCase();
	res.writeHead(200, { "Content-Type": MIME_TYPES[ext] ?? "application/octet-stream" });
	fs.createReadStream(filePath).pipe(res);
});

server.listen(PORT, () => {
	console.log(`🚀 Expo Web 静的サーバを起動しました: http://localhost:${PORT}`);
	console.log(`   配信ディレクトリ: ${DIST_DIR}`);
});
