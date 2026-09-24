"""🏪 `restaurant_reports` の «未処理» を GitHub Issue へ 1 件 1 本で起票する（#1933 受け入れ条件 7）。

## なぜ受付 API から切り離すのか

受付（`POST /v1/restaurant-reports`）の中で起票すると、**受付の応答時間が GitHub の
生死に縛られる**うえ、起票に失敗したときに «報告は消えたのか» がユーザーにも運営にも
分からなくなる。受付は DB へ 1 行書くだけで完結させ、起票は `status = 'pending'` かつ
`github_issue_number IS NULL` の行を**後から拾う**側の責務にする
（索引 `idx_restaurant_reports_status_created` はそのために張ってある）。

## ⚠️ Issue 本文へ書いてよいもの / 書いてはいけないもの

このリポジトリは **public** である。

| 列 | Issue へ | 理由 |
| --- | --- | --- |
| `id` | ✅ | オーナーが DB を引くための鍵。これが無いと処理できない |
| `field` | ✅ | 選択式（`name` / `closed` / `opening_hours`）で、自由入力ではない |
| `restaurant_id` | ✅ | 自社 DB の UUID。店の画面を開くリンクに使う |
| `created_at` | ✅ | いつの報告か |
| **`proposed_value`** | ❌ | **ユーザーの自由入力。第三者の個人情報を含みうる** |
| **`reporter_user_id`** | ❌ | **報告者の識別子。誰が報告したかを public に出さない** |

値はオーナーが DB で見る（migration のコメントと同じ規則）。

## 二重起票を防ぐ仕組み

Issue 本文の末尾に `<!-- restaurant-report:<id> -->` を埋め、**起票の前に既存 Issue を
走査して索引を作る**（error-triage の `<!-- fp:… -->` と同じ形）。

⚠️ **「DB の `github_issue_number` が NULL かどうか」だけを根拠にしない。**
Issue を作った直後に DB の UPDATE が落ちると、次の run が同じ報告をもう 1 本立てる。
索引があれば、その場合は **起票せずに番号を書き戻すだけ**で復旧する。

## 実行

    # 何が起票されるかだけ見る（GitHub へも DB へも書かない）
    python3 scripts/restaurant-reports/file_pending_reports.py --schema dev --limit 20 --dry-run

    # 実際に起票する（GITHUB_TOKEN が要る）
    python3 scripts/restaurant-reports/file_pending_reports.py --schema dev --limit 20

⚠️ `--limit` は必須。既定値を置くと、溜まった報告を一度に全部起票してしまう。
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request

LOGGER = logging.getLogger(__name__)

GITHUB_API = "https://api.github.com"

# 起票した Issue に付けるラベル。索引を作るときの絞り込みにも使う
ISSUE_LABEL = "restaurant-report"

# 本文へ埋める機械可読マーカー。`id` はこの中にしか入れない形にはせず、
# 本文にも出す（人が読める必要がある）
MARKER_RE = re.compile(r"<!--\s*restaurant-report:([0-9a-fA-F-]{36})\s*-->")


def marker(report_id: str) -> str:
    return f"<!-- restaurant-report:{report_id} -->"


# ⚠️ **`proposed_value` と `reporter_user_id` を SELECT しない。**
# 取ってこなければ、うっかり本文へ差し込むことが構造的にできない
# （«書かない» を気をつけで守らない）。
PENDING_SQL = """
  SELECT id::text, restaurant_id::text, field, created_at
  FROM restaurant_reports
  WHERE status = 'pending'
    AND github_issue_number IS NULL
  ORDER BY created_at, id
  LIMIT %(limit)s
"""

UPDATE_ISSUE_NUMBER_SQL = """
  UPDATE restaurant_reports
  SET github_issue_number = %(issue_number)s,
      updated_at = now()
  WHERE id = %(id)s
"""

FIELD_LABELS = {
    "name": "店名",
    "closed": "閉店した",
    "opening_hours": "営業時間",
}


def issue_title(report: dict) -> str:
    label = FIELD_LABELS.get(report["field"], report["field"])
    return f"[店舗情報の報告] {label} — {report['restaurant_id']}"


def issue_body(report: dict, *, web_base_url: str) -> str:
    """Issue の本文。

    ⚠️ **`proposed_value` を差し込まないこと。** 引数の dict にそもそも入っていない
    （`PENDING_SQL` が取ってこない）ので、ここへ書こうとすると KeyError で落ちる。
    """
    label = FIELD_LABELS.get(report["field"], report["field"])
    store_url = urllib.parse.urljoin(web_base_url, f"/ja-JP/restaurant/{report['restaurant_id']}")
    return "\n".join(
        [
            f"@Ayato-kosaka 店舗情報の報告が 1 件届きました（**{label}**）。",
            "",
            "| | |",
            "| --- | --- |",
            f"| 報告 ID | `{report['id']}` |",
            f"| 店 | [{report['restaurant_id']}]({store_url}) |",
            f"| 項目 | {label}（`{report['field']}`） |",
            f"| 受付 | {report['created_at']} |",
            "",
            "### ⚠️ ユーザーが入力した «正しい値» はここに載せていません",
            "",
            "このリポジトリは public で、自由入力には第三者の個人情報が書かれうるためです。",
            "値は DB で確認してください。",
            "",
            "```sql",
            f"SELECT field, proposed_value, created_at FROM dev.restaurant_reports WHERE id = '{report['id']}';",
            "```",
            "",
            "### 返し方",
            "",
            "この Issue に «反映» か «却下» をコメントしてください（1 Issue = 1 報告なので番号の指定は要りません）。",
            "報告しただけでは店の情報は変わりません。",
            "",
            marker(report["id"]),
        ]
    )


class GitHubClient:
    """必要な 2 つの操作だけを持つ最小のクライアント。

    ⚠️ `dry_run` のときは **トークンを要求しない**。読み取りすら行わないので、
    「dry-run のつもりの実行がトークンを持っている」状態を作らない
    （権限そのものは workflow の Job を分けて落とす）。
    """

    def __init__(self, repo: str, token: str) -> None:
        self.repo = repo
        self.token = token

    def _request(self, method: str, path: str, payload: dict | None = None) -> dict | list:
        url = f"{GITHUB_API}{path}"
        data = json.dumps(payload).encode("utf-8") if payload is not None else None
        request = urllib.request.Request(url, data=data, method=method)
        request.add_header("Authorization", f"Bearer {self.token}")
        request.add_header("Accept", "application/vnd.github+json")
        if data is not None:
            request.add_header("Content-Type", "application/json")
        with urllib.request.urlopen(request, timeout=30) as response:
            return json.loads(response.read().decode("utf-8"))

    def filed_report_ids(self) -> dict[str, int]:
        """既に起票済みの «報告 ID → Issue 番号»。

        ⚠️ **open だけを見ない。** 反映 / 却下が済んで close された Issue も
        «起票済み» である。見落とすと、処理が終わった報告をもう 1 本立てる。
        """
        index: dict[str, int] = {}
        page = 1
        while True:
            query = urllib.parse.urlencode(
                {"labels": ISSUE_LABEL, "state": "all", "per_page": 100, "page": page}
            )
            issues = self._request("GET", f"/repos/{self.repo}/issues?{query}")
            if not isinstance(issues, list) or not issues:
                break
            for issue in issues:
                # PR も /issues に混ざって返る。本文にマーカーが無ければどのみち拾わない
                found = MARKER_RE.search(issue.get("body") or "")
                if found:
                    index[found.group(1)] = issue["number"]
            if len(issues) < 100:
                break
            page += 1
        return index

    def create_issue(self, title: str, body: str) -> int:
        created = self._request(
            "POST",
            f"/repos/{self.repo}/issues",
            {"title": title, "body": body, "labels": [ISSUE_LABEL]},
        )
        return created["number"]


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    # ⚠️ `public` を選択肢に置かない。本番へ触れるのはオーナーが public と言ったときだけ
    parser.add_argument("--schema", default="dev", choices=["dev"])
    parser.add_argument(
        "--limit",
        type=int,
        required=True,
        help="⚠️ 必須。既定値を置くと、溜まった報告を一度に全部起票してしまう",
    )
    parser.add_argument("--repo", default="Ayato-kosaka/nanitabeyo")
    parser.add_argument(
        "--web-base-url",
        default="https://nanitabeyo.com",
        help="Issue に貼る店の画面のリンクの基点",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="GitHub へも DB へも書かない。何が起票されるかだけ出す",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s - %(message)s")
    args = parse_args(argv)

    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        LOGGER.error("❌ DATABASE_URL environment variable is required")
        return 1

    token = os.getenv("GITHUB_TOKEN", "")
    if not args.dry_run and not token:
        LOGGER.error("❌ GITHUB_TOKEN environment variable is required（--dry-run なら不要）")
        return 1

    import psycopg2

    with psycopg2.connect(database_url) as conn:
        with conn.cursor() as cur:
            if args.dry_run:
                # ⚠️ dry-run では **DB 側も読み取り専用に固定する**。
                # 「書かないつもり」をコードの流れだけで守らない
                cur.execute("SET default_transaction_read_only = on")
            cur.execute(f'SET search_path TO "{args.schema}", extensions')
            cur.execute(PENDING_SQL, {"limit": args.limit})
            rows = cur.fetchall()

            reports = [
                {"id": r[0], "restaurant_id": r[1], "field": r[2], "created_at": r[3].isoformat()}
                for r in rows
            ]
            LOGGER.info("未起票の報告: %s 件（schema=%s / limit=%s）", len(reports), args.schema, args.limit)

            if args.dry_run:
                for report in reports:
                    LOGGER.info("  [dry-run] %s", issue_title(report))
                LOGGER.info("dry-run のため GitHub へも DB へも書いていません")
                return 0

            client = GitHubClient(args.repo, token)
            already = client.filed_report_ids()
            LOGGER.info("既に起票済み（open + closed）: %s 件", len(already))

            created = 0
            backfilled = 0
            for report in reports:
                existing = already.get(report["id"])
                if existing is not None:
                    # 前回の run が «Issue は作ったが DB の UPDATE で落ちた» 形。
                    # もう 1 本立てずに番号を書き戻すだけで復旧する
                    LOGGER.warning(
                        "⚠️ 起票済みなのに DB が NULL でした（#%s / report=%s）。番号だけ書き戻します",
                        existing,
                        report["id"],
                    )
                    cur.execute(UPDATE_ISSUE_NUMBER_SQL, {"issue_number": existing, "id": report["id"]})
                    conn.commit()
                    backfilled += 1
                    continue

                number = client.create_issue(
                    issue_title(report), issue_body(report, web_base_url=args.web_base_url)
                )
                cur.execute(UPDATE_ISSUE_NUMBER_SQL, {"issue_number": number, "id": report["id"]})
                # ⚠️ **1 件ごとに commit する。** まとめて commit すると、途中で落ちたときに
                # «Issue は立っているのに DB は NULL» の行が大量に残る
                conn.commit()
                created += 1
                LOGGER.info("起票: #%s（report=%s / field=%s）", number, report["id"], report["field"])

            LOGGER.info("起票 %s 件 / 番号の書き戻し %s 件", created, backfilled)
    return 0


if __name__ == "__main__":
    sys.exit(main())
