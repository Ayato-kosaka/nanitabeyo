#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
pageviews.py

【目的】
#737 Wikimedia Analytics API から記事の月次ページビューを取る。

【なぜこの API か】
- 料金 0 / API キー不要。集計データは **CC0**（商用利用可）
- 5 年分の履歴が今すぐ手に入る（Instagram のハッシュタグ API は過去 24 時間しか返さない）
- 記事は `dish_category_catalog.sitelinks_json` に既に入っているので名寄せが要らない
- 言語版を変えるだけで他国の曲線が同じ仕組みで取れる

【実測した制約（2026-08 時点）】
- **User-Agent が必須**。無いと予告なくブロックされうる
- 2026 年に全体レート制限が入り、**連続アクセスすると 429 が返る**。
  1〜2 秒間隔 + 指数バックオフで 122 件が 15 分程度
- 記事が存在しない場合は 404。呼び出し側で「データ無し」として扱う
"""

import json
import logging
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Dict, List, Optional

logger = logging.getLogger(__name__)

API_BASE = "https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article"


class PageviewsClient:
    """Wikimedia Analytics API の薄いクライアント"""

    def __init__(
        self,
        user_agent: str,
        sleep_sec: float = 1.3,
        max_retries: int = 5,
        timeout_sec: int = 45,
    ):
        """
        Args:
            user_agent: 連絡先を含む User-Agent（必須。API の利用条件）
            sleep_sec: リクエスト間のウェイト。429 を避けるため 1 秒以上を推奨
            max_retries: 429 時の再試行回数
            timeout_sec: 1 リクエストのタイムアウト
        """
        if not user_agent or "http" not in user_agent:
            # 「連絡先の無い UA」はブロック対象。ここで落として気付けるようにする
            raise ValueError(
                "user_agent には連絡先（リポジトリ URL 等）を含めてください。"
                "Wikimedia の利用条件で User-Agent は必須です。"
            )
        self.user_agent = user_agent
        self.sleep_sec = sleep_sec
        self.max_retries = max_retries
        self.timeout_sec = timeout_sec

    def fetch_monthly(
        self,
        wiki: str,
        article: str,
        start_ym: str,
        end_ym: str,
    ) -> Optional[List[Dict]]:
        """
        1 記事の月次ページビューを取る

        Args:
            wiki: 言語版。例 "ja.wikipedia"
            article: 記事タイトル（デコード済みの生の文字列）
            start_ym: 開始月 "YYYY-MM"
            end_ym: 終了月 "YYYY-MM"

        Returns:
            [{"ym": "2021-01", "views": 11645}, ...]。
            記事が無い（404）場合は None。

        Raises:
            RuntimeError: 429 が続いて諦めた場合。**黙って空リストを返さない**
                （「季節性が無い」と「取れなかった」を取り違えると、
                  平坦な曲線として採用されてしまうため）
        """
        url = "{base}/{wiki}/all-access/user/{article}/monthly/{start}00/{end}00".format(
            base=API_BASE,
            wiki=wiki,
            article=urllib.parse.quote(article, safe=""),
            start=start_ym.replace("-", "") + "01",
            end=end_ym.replace("-", "") + "01",
        )

        for attempt in range(self.max_retries):
            try:
                req = urllib.request.Request(
                    url, headers={"User-Agent": self.user_agent}
                )
                with urllib.request.urlopen(req, timeout=self.timeout_sec) as res:
                    items = json.load(res).get("items", [])
                return [
                    {"ym": f"{it['timestamp'][:4]}-{it['timestamp'][4:6]}", "views": int(it["views"])}
                    for it in items
                ]
            except urllib.error.HTTPError as e:
                if e.code == 404:
                    logger.warning(f"article not found: {wiki}/{article}")
                    return None
                if e.code == 429:
                    wait = 4 * (attempt + 1)
                    logger.warning(
                        f"429 rate limited ({wiki}/{article}), retry in {wait}s "
                        f"[{attempt + 1}/{self.max_retries}]"
                    )
                    time.sleep(wait)
                    continue
                raise
            except (urllib.error.URLError, TimeoutError) as e:
                wait = 2 * (attempt + 1)
                logger.warning(f"network error ({e}), retry in {wait}s")
                time.sleep(wait)
                continue
            finally:
                time.sleep(self.sleep_sec)

        raise RuntimeError(
            f"pageviews の取得に {self.max_retries} 回失敗しました: {wiki}/{article}. "
            "「取れなかった」を「季節性が無い」と取り違えないため、ここで中断します。"
        )


def parse_wiki_article(sitelinks_json: Optional[str], wiki_host: str) -> Optional[str]:
    """
    `dish_category_catalog.sitelinks_json` から記事タイトルを取り出す

    sitelinks_json はサイト URL をキーにした辞書で、値がフル URL:
        {"https://ja.wikipedia.org/": "https://ja.wikipedia.org/wiki/%E3%81%8A%E3%81%A7%E3%82%93"}

    Args:
        sitelinks_json: catalog の生文字列
        wiki_host: 例 "ja.wikipedia.org"

    Returns:
        デコード済みの記事タイトル。無ければ None
    """
    if not sitelinks_json:
        return None
    try:
        links = json.loads(sitelinks_json)
    except (json.JSONDecodeError, TypeError):
        logger.warning("sitelinks_json のパースに失敗しました")
        return None

    prefix = f"https://{wiki_host}/wiki/"
    for url in links.values():
        if isinstance(url, str) and url.startswith(prefix):
            return urllib.parse.unquote(url[len(prefix) :])
    return None
