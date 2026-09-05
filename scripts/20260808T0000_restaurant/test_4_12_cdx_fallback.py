"""#1273 sitemap を持たない host を Common Crawl の URL index（CDX）で救う経路を固定する。

守りたいのは 3 つ。

1. **sitemap が取れる host の挙動を変えない**（既存 host を巻き添えにしない）
2. **sitemap が空のときだけ CDX へ落ち、経路が `discovery_method` に残る**
3. **CDX が返す «記事でない URL»（画像・タグ一覧・日付アーカイブ・カート）を読みに行かない**

ネットワークにも BigQuery にも触らない。CDX の生行だけを差し込んで判定を確かめる。
"""

from __future__ import annotations

import importlib.util
import json
import sys
import unittest
from pathlib import Path

# google.cloud.bigquery の軽量スタブは conftest.py が 1 箇所で用意する
# （各テストへ写経すると «先に入れた者勝ち» で実行順に依存して落ちる）。

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import cc_cdx  # noqa: E402


def _load(path: Path, name: str):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


crawler = _load(HERE / "4_12_crawl_gourmet_media.py", "crawl_gourmet_media")
discover = _load(HERE / "4_15_discover_embed_hosts.py", "discover_embed_hosts")


def cdx_line(surt: str, url: str, status: str = "200", mime: str = "text/html") -> str:
    """CDX の生行（`SURT timestamp {json}`）を作る。"""
    return f"{surt} 20260901000000 " + json.dumps({"url": url, "status": status, "mime-detected": mime})


class IsArticleUrl(unittest.TestCase):
    """CDX は画像も CSS もタグ一覧も返す。読みに行ってよいのは記事だけ。"""

    HOST = "okayamagourmet.com"

    def assertArticle(self, path: str) -> None:
        self.assertTrue(crawler.is_article_url(f"https://{self.HOST}{path}", self.HOST), path)

    def assertNotArticle(self, path: str) -> None:
        self.assertFalse(crawler.is_article_url(f"https://{self.HOST}{path}", self.HOST), path)

    def test_記事らしいURLは通す(self):
        for path in ("/12345", "/12345/", "/archives/98765.html", "/2026/09/03/yakiniku/",
                     "/ramen-shop-okayama/", "/gourmet/lunch-2026/", "/?p=1234"):
            self.assertArticle(path)

    def test_トップページと別ホストは通さない(self):
        self.assertNotArticle("/")
        self.assertFalse(crawler.is_article_url("https://other.example/12345", self.HOST))
        self.assertFalse(crawler.is_article_url("ftp://okayamagourmet.com/12345", self.HOST))

    def test_www_の有無は同じホストとみなす(self):
        self.assertTrue(crawler.is_article_url(f"https://www.{self.HOST}/12345", self.HOST))

    def test_資産ファイルは通さない(self):
        for path in ("/wp-content/uploads/2026/09/a.jpg", "/style.css", "/app.js",
                     "/menu.pdf", "/logo.svg", "/feed.xml", "/movie.mp4"):
            self.assertNotArticle(path)

    def test_一覧ページは通さない(self):
        for path in ("/tag/ramen/", "/category/lunch/", "/author/taro/", "/page/2/",
                     "/search/ramen", "/2026/", "/2026/09/", "/2026/09/03/",
                     "/date/2026/06/", "/gourmet/2026/"):
            self.assertNotArticle(path)

    def test_記事でない機能ページは通さない(self):
        for path in ("/cart/", "/checkout/", "/my-account/", "/contact/", "/privacy/",
                     "/wp-json/wp/v2/posts", "/xmlrpc.php", "/sitemap_index.xml",
                     "/12345/trackback/", "/12345/embed/"):
            self.assertNotArticle(path)

    def test_記事idでないクエリは通さない(self):
        self.assertNotArticle("/?s=ramen")
        self.assertNotArticle("/12345/?replytocom=99")
        self.assertNotArticle("/12345/?utm_source=twitter")


class CdxBlockRetry(unittest.TestCase):
    """1 host が 1 ブロックにしか無いことは普通にある。取り損なうと host が丸ごと消える。"""

    def test_ブロック取得に失敗したら1度やり直す(self):
        import gzip
        calls = []

        def flaky(url, rng=None, timeout=180):
            calls.append(url)
            if len(calls) == 1:
                raise OSError("IncompleteRead")
            return gzip.compress(cdx_line("com,x)/a", "https://x.com/a").encode())

        orig, cc_cdx.range_get = cc_cdx.range_get, flaky
        try:
            rows = [["com,x)/", "cdx-00000.gz", "0", "10"]]
            got = list(cc_cdx.iter_cdx_lines("com,x)", rows, [r[0] for r in rows], "CC-MAIN-2026-34"))
        finally:
            cc_cdx.range_get = orig
        self.assertEqual(1, len(got))
        self.assertEqual(2, len(calls))


class CdxOrder(unittest.TestCase):
    def test_新しい年の記事から読む(self):
        urls = ["https://h/2019/05/old/", "https://h/2026/09/new/", "https://h/2022/01/mid/"]
        self.assertEqual(["https://h/2026/09/new/", "https://h/2022/01/mid/", "https://h/2019/05/old/"],
                         sorted(urls, key=crawler._cdx_order_key, reverse=True))

    def test_連番は数値の大小で並ぶ(self):
        # 文字列比較だと "/9" > "/12345" になり、古い記事から読んでしまう。
        urls = ["https://h/9/", "https://h/12345/", "https://h/700/"]
        self.assertEqual(["https://h/12345/", "https://h/700/", "https://h/9/"],
                         sorted(urls, key=crawler._cdx_order_key, reverse=True))


class CdxArticleUrls(unittest.TestCase):
    """CDX の生行 → 記事URL。status / mime / 重複の扱いを固定する。"""

    HOST = "okayamagourmet.com"
    LINES = [
        cdx_line("com,okayamagourmet)/2026/09/03/yakiniku", "https://okayamagourmet.com/2026/09/03/yakiniku/"),
        # 同じ記事の別スナップショット（CC は同一 URL を複数回取る）→ 1 本に畳む
        cdx_line("com,okayamagourmet)/2026/09/03/yakiniku", "https://okayamagourmet.com/2026/09/03/yakiniku/"),
        cdx_line("com,okayamagourmet)/2019/01/01/old", "https://okayamagourmet.com/2019/01/01/old/"),
        # 404 と リダイレクトは読みに行っても中身が無い
        cdx_line("com,okayamagourmet)/2026/08/gone", "https://okayamagourmet.com/2026/08/gone/", status="404"),
        cdx_line("com,okayamagourmet)/2026/08/moved", "https://okayamagourmet.com/2026/08/moved/", status="301"),
        # 画像は mime でも path でも落ちる
        cdx_line("com,okayamagourmet)/wp-content/a.jpg", "https://okayamagourmet.com/wp-content/a.jpg",
                 mime="image/jpeg"),
        cdx_line("com,okayamagourmet)/tag/ramen", "https://okayamagourmet.com/tag/ramen/"),
        cdx_line("com,okayamagourmet)/", "https://okayamagourmet.com/"),
    ]

    def setUp(self):
        self._orig_index, self._orig_iter = crawler._cdx_index, cc_cdx.iter_cdx_lines
        self.asked: list[str] = []
        crawler._cdx_index = lambda crawl, cache_dir: ([], [])

        def fake_iter(prefix, rows, keys, crawl, max_blocks=60, line_prefixes=None):
            self.asked.append(prefix)
            return iter(self.LINES)

        cc_cdx.iter_cdx_lines = fake_iter

    def tearDown(self):
        crawler._cdx_index, cc_cdx.iter_cdx_lines = self._orig_index, self._orig_iter

    def test_記事だけが新しい順に返る(self):
        self.assertEqual(["https://okayamagourmet.com/2026/09/03/yakiniku/",
                          "https://okayamagourmet.com/2019/01/01/old/"],
                         crawler.cdx_article_urls(self.HOST, 100))

    def test_ホスト終端の丸括弧まで前置に入れる(self):
        # `)` を付けないと okayamagourmet2.com のような別ホストまで拾う。
        crawler.cdx_article_urls(self.HOST, 100)
        self.assertEqual(["com,okayamagourmet)"], self.asked)

    def test_skip_urls_で前回読んだぶんを飛ばす(self):
        self.assertEqual(["https://okayamagourmet.com/2019/01/01/old/"],
                         crawler.cdx_article_urls(self.HOST, 100, skip_urls=1))


class ArticleUrlsWithSource(unittest.TestCase):
    """分岐は 1 か所だけ。sitemap が取れたら CDX を引かない。"""

    def setUp(self):
        self._sitemap, self._cdx = crawler.article_urls, crawler.cdx_article_urls
        self.cdx_calls = 0

    def tearDown(self):
        crawler.article_urls, crawler.cdx_article_urls = self._sitemap, self._cdx

    def _stub(self, sitemap_urls: list[str]) -> None:
        crawler.article_urls = lambda *a, **k: list(sitemap_urls)

        def fake_cdx(host, max_urls, skip_urls=0, crawl=None, cache_dir=None):
            self.cdx_calls += 1
            return ["https://h/from-cdx/"]

        crawler.cdx_article_urls = fake_cdx

    def test_sitemap_が取れたらCDXを引かない(self):
        self._stub(["https://h/a/"])
        urls, source = crawler.article_urls_with_source("h", 10, 0, "CC-MAIN-2026-34")
        self.assertEqual((["https://h/a/"], "sitemap"), (urls, source))
        self.assertEqual(0, self.cdx_calls)

    def test_sitemap_が空ならCDXへ落ちる(self):
        self._stub([])
        urls, source = crawler.article_urls_with_source("h", 10, 0, "CC-MAIN-2026-34")
        self.assertEqual((["https://h/from-cdx/"], "cdx"), (urls, source))
        self.assertEqual(1, self.cdx_calls)

    def test_フォールバックを切れば従来どおり何も読まない(self):
        self._stub([])
        self.assertEqual(([], "sitemap"), crawler.article_urls_with_source("h", 10, 0, None))
        self.assertEqual(0, self.cdx_calls)

    def test_経路は_discovery_method_に残る(self):
        # BigQuery だけで «CDX 経路が割に合ったか» を数え直せること。
        self.assertEqual("media_embed", crawler.DISCOVERY_METHOD["sitemap"])
        self.assertEqual("media_embed_cdx", crawler.DISCOVERY_METHOD["cdx"])


class CcCdxPrefixes(unittest.TestCase):
    """`cc_cdx` は 4_12（ホスト 1 件）と 4_15（サブドメイン網）の両方に使われる。"""

    BLOCK = [
        cdx_line("jp,goguynet)/index", "https://goguynet.jp/index"),
        cdx_line("jp,goguynet,higashinari)/1", "https://higashinari.goguynet.jp/1"),
        cdx_line("jp,goguynet2)/1", "https://goguynet2.jp/1"),
    ]

    def setUp(self):
        self._orig = cc_cdx.range_get
        import gzip
        cc_cdx.range_get = lambda url, rng=None, timeout=180: gzip.compress(
            ("\n".join(self.BLOCK)).encode())

    def tearDown(self):
        cc_cdx.range_get = self._orig

    def _lines(self, prefix, line_prefixes=None):
        rows = [["jp,goguynet)/", "cdx-00000.gz", "0", "10"]]
        return list(cc_cdx.iter_cdx_lines(prefix, rows, [r[0] for r in rows],
                                          "CC-MAIN-2026-34", 60, line_prefixes))

    def test_surt_prefix(self):
        self.assertEqual("jp,goguynet", cc_cdx.surt_prefix("goguynet.jp"))
        self.assertEqual("com,gurutto-", cc_cdx.surt_prefix("com,gurutto-"))

    def test_ホスト1件に絞れる(self):
        self.assertEqual(1, len(self._lines("jp,goguynet)")))

    def test_サブドメイン網は拾い_別ドメインは拾わない(self):
        got = self._lines("jp,goguynet", ("jp,goguynet,", "jp,goguynet)"))
        self.assertEqual(2, len(got))
        self.assertFalse(any("goguynet2" in ln for ln in got))


class Discover415Unchanged(unittest.TestCase):
    """4_15 の expand を cc_cdx へ寄せた refactor で、拾う host が変わっていないこと。"""

    BLOCK = CcCdxPrefixes.BLOCK

    def setUp(self):
        self._orig = cc_cdx.range_get
        import gzip
        cc_cdx.range_get = lambda url, rng=None, timeout=180: gzip.compress(
            ("\n".join(self.BLOCK)).encode())

    def tearDown(self):
        cc_cdx.range_get = self._orig

    def _hosts(self, domain):
        rows = [["jp,goguynet)/", "cdx-00000.gz", "0", "10"]]
        return discover.hosts_under_domain(domain, rows, [r[0] for r in rows], "CC-MAIN-2026-34")

    def test_ドメイン指定は本体とサブドメインだけ(self):
        self.assertEqual({"goguynet.jp": 1, "higashinari.goguynet.jp": 1}, self._hosts("goguynet.jp"))

    def test_SURT前置指定は前方一致(self):
        self.assertEqual({"goguynet.jp": 1, "higashinari.goguynet.jp": 1, "goguynet2.jp": 1},
                         self._hosts("jp,goguynet"))


if __name__ == "__main__":
    unittest.main()
