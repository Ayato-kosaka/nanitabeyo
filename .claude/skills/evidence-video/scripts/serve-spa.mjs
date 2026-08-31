// SPA フォールバック付き静的サーバ。`python -m http.server` だと /ja-JP/search のような
// 深い URL が 404 になるため、無いパスは index.html へ落とす（expo の single 出力用）
import http from "node:http";
import { readFile } from "node:fs/promises";
import { join, extname } from "node:path";

const ROOT = process.env.EVIDENCE_DIST ?? new URL("../../../../app-expo/dist-local", import.meta.url).pathname;
const TYPES = {
	".html": "text/html",
	".js": "text/javascript",
	".css": "text/css",
	".json": "application/json",
	".png": "image/png",
	".webp": "image/webp",
	".ico": "image/x-icon",
	".svg": "image/svg+xml",
	".ttf": "font/ttf",
	".woff2": "font/woff2",
};

http
	.createServer(async (req, res) => {
		const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
		for (const candidate of [path, "/index.html"]) {
			try {
				const body = await readFile(join(ROOT, candidate));
				res.writeHead(200, { "content-type": TYPES[extname(candidate)] ?? "application/octet-stream" });
				return res.end(body);
			} catch {
				// 次の候補（index.html フォールバック）へ
			}
		}
		res.writeHead(404);
		res.end("not found");
	})
	.listen(8788, () => console.log(`serving ${ROOT} on 8788`));
