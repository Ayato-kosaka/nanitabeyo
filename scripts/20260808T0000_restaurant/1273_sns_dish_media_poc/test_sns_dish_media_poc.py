from __future__ import annotations

import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import sns_dish_media_poc as poc


class ReadLinesTests(unittest.TestCase):
    def test_skips_comments_and_blank_lines(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "urls.txt"
            path.write_text("# comment\n\nhttps://example.com/a\n  \nhttps://example.com/b\n", encoding="utf-8")
            self.assertEqual(poc.read_lines(path), ["https://example.com/a", "https://example.com/b"])


class TikTokOembedTests(unittest.TestCase):
    def test_success_response_is_ok(self) -> None:
        payload = {
            "html": "<blockquote>...</blockquote>",
            "author_name": "shimayan.ramen",
            "provider_name": "TikTok",
            "thumbnail_url": "https://example.com/thumb.jpg",
        }
        with mock.patch.object(poc, "http_get_json", return_value=(200, payload, None)):
            result = poc.check_tiktok_oembed("https://www.tiktok.com/@shimayan.ramen/video/1")
        self.assertTrue(result.oembed_ok)
        self.assertEqual(result.author_name, "shimayan.ramen")
        self.assertTrue(result.has_html)
        self.assertTrue(result.has_thumbnail)
        self.assertIsNone(result.error)

    def test_http_error_is_not_ok(self) -> None:
        with mock.patch.object(poc, "http_get_json", return_value=(404, None, "HTTPError: Not Found")):
            result = poc.check_tiktok_oembed("https://www.tiktok.com/@nobody/video/0")
        self.assertFalse(result.oembed_ok)
        self.assertEqual(result.http_status, 404)
        self.assertEqual(result.error, "HTTPError: Not Found")


class XOembedTests(unittest.TestCase):
    def test_success_response_is_ok(self) -> None:
        payload = {"html": "<blockquote>...</blockquote>", "author_name": "kappasushi_jp", "provider_name": "X"}
        with mock.patch.object(poc, "http_get_json", return_value=(200, payload, None)):
            result = poc.check_x_oembed("https://x.com/kappasushi_jp/status/1")
        self.assertTrue(result.oembed_ok)
        self.assertEqual(result.provider, "x")


class RunOembedCheckTests(unittest.TestCase):
    def test_aggregates_ok_rate(self) -> None:
        def fake_check(url: str) -> poc.OembedResult:
            ok = url.endswith("/1")
            return poc.OembedResult(
                provider="fake",
                url=url,
                http_status=200 if ok else 404,
                oembed_ok=ok,
                author_name=None,
                provider_name=None,
                has_thumbnail=False,
                has_html=ok,
                error=None if ok else "HTTPError: Not Found",
                checked_at="2026-08-12T00:00:00+00:00",
            )

        output = poc.run_oembed_check(fake_check, ["u/1", "u/2"])
        self.assertEqual(output["total"], 2)
        self.assertEqual(output["oembed_ok"], 1)
        self.assertEqual(output["oembed_ok_rate"], 0.5)
        self.assertEqual(output["cost"], "free")
        self.assertFalse(output["requires_auth"])


class YoutubeApiKeyTests(unittest.TestCase):
    def test_fails_closed_without_env_var(self) -> None:
        env = dict(os.environ)
        env.pop("YOUTUBE_API_KEY", None)
        with mock.patch.dict(os.environ, env, clear=True):
            with self.assertRaises(SystemExit) as ctx:
                poc.require_youtube_api_key()
        self.assertEqual(ctx.exception.code, 2)

    def test_returns_key_when_set(self) -> None:
        with mock.patch.dict(os.environ, {"YOUTUBE_API_KEY": "test-key"}):
            self.assertEqual(poc.require_youtube_api_key(), "test-key")


class YtdlpSearchTests(unittest.TestCase):
    def test_missing_binary_reports_error_without_raising(self) -> None:
        with mock.patch.object(poc.shutil, "which", return_value=None):
            result = poc.run_ytdlp_search("ラーメン 東京", max_results=3)
        self.assertEqual(result["error"], "yt-dlp not installed")
        self.assertEqual(result["video_ids"], [])

    def test_parses_ndjson_stdout_into_ids_titles_channels(self) -> None:
        stdout = "\n".join(
            [
                '{"id": "abc123", "title": "Ramen Tokyo", "channel": "Foo Channel"}',
                '{"id": "def456", "title": "Ramen 2", "channel": "Bar Channel"}',
            ]
        )
        fake_proc = subprocess_result(returncode=0, stdout=stdout, stderr="")
        with mock.patch.object(poc.shutil, "which", return_value="/usr/local/bin/yt-dlp"), mock.patch.object(
            poc.subprocess, "run", return_value=fake_proc
        ):
            result = poc.run_ytdlp_search("ラーメン 東京", max_results=2)
        self.assertEqual(result["video_ids"], ["abc123", "def456"])
        self.assertEqual(result["titles"], ["Ramen Tokyo", "Ramen 2"])
        self.assertIsNone(result["error"])

    def test_nonzero_exit_reports_stderr_as_error(self) -> None:
        fake_proc = subprocess_result(returncode=1, stdout="", stderr="ERROR: some extractor failure")
        with mock.patch.object(poc.shutil, "which", return_value="/usr/local/bin/yt-dlp"), mock.patch.object(
            poc.subprocess, "run", return_value=fake_proc
        ):
            result = poc.run_ytdlp_search("ラーメン 東京", max_results=2)
        self.assertEqual(result["video_ids"], [])
        self.assertIn("ERROR: some extractor failure", result["error"])


class TextMatchConfidenceTests(unittest.TestCase):
    def test_substring_present_is_full_confidence(self) -> None:
        self.assertEqual(poc.text_match_confidence("一蘭", "一蘭 渋谷店で豚骨ラーメンを実食"), 1.0)

    def test_substring_absent_is_zero_confidence(self) -> None:
        self.assertEqual(poc.text_match_confidence("一蘭", "全然関係ない動画タイトル"), 0.0)

    def test_empty_needle_is_zero_confidence(self) -> None:
        self.assertEqual(poc.text_match_confidence("", "何かのタイトル"), 0.0)


class YoutubeIframeEmbedHtmlTests(unittest.TestCase):
    def test_embeds_video_id_and_escapes_title(self) -> None:
        embed_html = poc.youtube_iframe_embed_html("abc123", '<script>alert("x")</script>')
        self.assertIn("https://www.youtube.com/embed/abc123", embed_html)
        self.assertNotIn("<script>", embed_html)
        self.assertIn("&lt;script&gt;", embed_html)


class NormalizeCoreRestaurantNameTests(unittest.TestCase):
    def test_strips_full_width_parenthetical_suffix(self) -> None:
        self.assertEqual(
            poc.normalize_core_restaurant_name("とりろう（やきとり、刺身、おでん）"),
            "とりろう",
        )

    def test_no_parenthesis_is_unchanged(self) -> None:
        self.assertEqual(poc.normalize_core_restaurant_name("丸 中華そば"), "丸 中華そば")

    def test_leading_parenthesis_is_not_stripped(self) -> None:
        # 店名の先頭が括弧の場合(idx==0)は補足ではなく店名の一部とみなし、切り落とさない
        self.assertEqual(poc.normalize_core_restaurant_name("（株）テスト食堂"), "（株）テスト食堂")


class EvaluateRestaurantMatchTests(unittest.TestCase):
    def test_full_name_in_title_is_strongest(self) -> None:
        match = poc.evaluate_restaurant_match("一蘭", "一蘭 渋谷店で豚骨ラーメンを実食", "", "フード太郎チャンネル")
        self.assertEqual(match.confidence, 1.0)
        self.assertEqual(match.evidence_type, "full_name_in_title")

    def test_core_name_in_channel_title_is_strong(self) -> None:
        match = poc.evaluate_restaurant_match(
            "とりろう（やきとり、刺身、おでん）", "今日の晩御飯", "", "とりろう公式チャンネル"
        )
        self.assertEqual(match.confidence, 0.9)
        self.assertEqual(match.evidence_type, "core_name_in_channel")

    def test_core_name_in_title_is_strongish(self) -> None:
        match = poc.evaluate_restaurant_match(
            "とりろう（やきとり、刺身、おでん）", "とりろうに行ってきた", "", "フード太郎チャンネル"
        )
        self.assertEqual(match.confidence, 0.8)
        self.assertEqual(match.evidence_type, "core_name_in_title")

    def test_name_in_description_is_medium(self) -> None:
        match = poc.evaluate_restaurant_match(
            "一休 (もんじゃ焼き、お好み焼きなど)",
            "足立区のもんじゃ焼き店を取材",
            "もんじゃ・お好み焼き「一休」日下登店主にインタビューしました",
            "LEARN JAPANESE with NEWS",
        )
        self.assertEqual(match.confidence, 0.7)
        self.assertEqual(match.evidence_type, "name_in_description")

    def test_credit_only_mention_in_description_is_rejected(self) -> None:
        # #1273 実測で見つかった誤検出(撮影協力クレジットに店名が載っているだけで
        # 動画本編とは無関係)を再現し、confidence 0.0 で不採用になることを確認する
        match = poc.evaluate_restaurant_match(
            "Studio Sweets box 宇治金時",
            "組長代理 #ショートドラマ",
            "【撮影協力】\nStudio Sweets box 宇治金時\nhttps://studio-sweets-box.jp/studio/uji-kintoki/",
            "ドラマみたいだ",
        )
        self.assertEqual(match.confidence, 0.0)
        self.assertEqual(match.evidence_type, "credit_context_only")

    def test_no_evidence_is_zero(self) -> None:
        match = poc.evaluate_restaurant_match("一蘭", "全然関係ない動画タイトル", "", "誰かのチャンネル")
        self.assertEqual(match.confidence, 0.0)
        self.assertEqual(match.evidence_type, "none")

    def test_short_core_name_is_not_evaluated(self) -> None:
        # コア名が1文字だと誤マッチ率が高すぎるため、テキストに含まれていても不採用とする
        match = poc.evaluate_restaurant_match("鮨（すきやばし）", "鮨を食べに行った", "", "フード太郎チャンネル")
        self.assertEqual(match.confidence, 0.0)


def subprocess_result(*, returncode: int, stdout: str, stderr: str):
    completed = mock.Mock()
    completed.returncode = returncode
    completed.stdout = stdout
    completed.stderr = stderr
    return completed


if __name__ == "__main__":
    unittest.main()
