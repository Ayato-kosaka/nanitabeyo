#!/usr/bin/env python3
"""#1273 現行 public.dish_media / public.restaurants のソース棚卸し（静的監査）。

DBに接続できないため、リポジトリのコード・Prismaスキーマ・migration・
バッチスクリプトだけから「現行103,528店とその dish_media が何から作られたか」を
機械的に再現可能な形で確定する。

出力: out/existing-db-audit.json
"""

from __future__ import annotations

import json
import re
import subprocess
from dataclasses import asdict, dataclass
from pathlib import Path

# #1273 【設計】監査は「リポジトリのルート」を基準に固定パスで行う。
# grep のヒット位置(file:line)を証拠として JSON に残し、後から人が再検証できるようにする。
REPO = Path(__file__).resolve().parents[3]
OUT = Path(__file__).resolve().parent / "out" / "existing-db-audit.json"


@dataclass
class Site:
    """コード上の1箇所。file は必ずリポジトリ相対。"""

    path: str
    line: int
    excerpt: str
    note: str


def read_line(rel: str, line: int) -> str:
    p = REPO / rel
    try:
        lines = p.read_text(encoding="utf-8", errors="replace").splitlines()
    except OSError:
        return ""
    if 1 <= line <= len(lines):
        return lines[line - 1].strip()
    return ""


def grep(pattern: str, *globs: str) -> list[tuple[str, int, str]]:
    """rg 相当。node_modules と生成物(index.d.ts)は除外する。"""
    cmd = ["grep", "-rnE", pattern, str(REPO)]
    for g in globs:
        cmd.extend(["--include", g])
    cmd.extend(["--exclude-dir", "node_modules", "--exclude", "index.d.ts"])
    proc = subprocess.run(cmd, capture_output=True, text=True)
    out: list[tuple[str, int, str]] = []
    for row in proc.stdout.splitlines():
        m = re.match(r"^(.*?):(\d+):(.*)$", row)
        if not m:
            continue
        rel = str(Path(m.group(1)).relative_to(REPO))
        out.append((rel, int(m.group(2)), m.group(3).strip()))
    return out


def site(rel: str, line: int, note: str) -> Site:
    return Site(path=rel, line=line, excerpt=read_line(rel, line), note=note)


def main() -> None:
    findings: dict[str, object] = {}

    # ------------------------------------------------------------------
    # 1. restaurants の主キー的制約: google_place_id が NOT NULL かつ UNIQUE か
    # ------------------------------------------------------------------
    schema = (REPO / "shared/prisma/schema.prisma").read_text(encoding="utf-8")
    m = re.search(
        r"model restaurants \{(.*?)\n\}", schema, re.S
    )
    restaurants_block = m.group(1) if m else ""
    gpid = re.search(r"google_place_id\s+(\S+)\s+(.*)", restaurants_block)
    findings["restaurants_google_place_id"] = {
        "declared_type": gpid.group(1) if gpid else None,
        "attributes": gpid.group(2).strip() if gpid else None,
        # String（?なし）= NOT NULL。@unique 付きなので Place ID 無しの行は物理的に存在できない。
        "nullable": bool(gpid and gpid.group(1).endswith("?")),
        "unique": bool(gpid and "@unique" in gpid.group(2)),
    }

    # ------------------------------------------------------------------
    # 2. 書き込み経路
    # ------------------------------------------------------------------
    write_paths = [
        site("api/src/v1/dishes/dishes.repository.ts", 57,
             "restaurants.upsert（where: google_place_id）。API経路の唯一の店舗生成点"),
        site("api/src/v1/dishes/dishes.repository.ts", 92,
             "dishes.create。Google Place × dish_category から生成"),
        site("api/src/v1/dishes/dishes.repository.ts", 105,
             "dish_media.upsert。Google写真1枚 = dish_media 1行"),
        site("api/src/v1/dishes/dishes.service.ts", 142,
             "bulkImportFromGoogle: Places Text Search → restaurants/dishes/dish_media/dish_reviews を一括生成"),
        site("api/src/v1/dishes/dishes.controller.ts", 62,
             "POST エンドポイントから bulkImportFromGoogle を起動（ユーザーの検索操作が契機）"),
        site("api/src/v1/dish-media/dish-media.repository.ts", 1083,
             "dish_media.create（ユーザー投稿経路）"),
        site("scripts/20260808T0000_restaurant/9_1_sync_restaurants.py", 1,
             "BigQuery restaurant_catalog → PostgreSQL restaurants 同期（#1273系の新経路。未投入）"),
        site("scripts/20260808T0000_restaurant/9_2_sync_dishes_and_media.py", 257,
             "dish_media_external_embeddings への INSERT（新経路）"),
    ]
    findings["write_paths"] = [asdict(s) for s in write_paths]

    # ------------------------------------------------------------------
    # 3. media_path / thumbnail_path の実体
    # ------------------------------------------------------------------
    media_sites = [
        site("api/src/v1/dishes/dishes.service.ts", 468,
             "media_path = buildFullPath({resourceType:'google-maps', usageType:'photo'}) — GCSオブジェクトパス"),
        site("api/src/v1/dishes/dishes.service.ts", 493,
             "restaurants.image_url に Places Photo の photoUri をそのまま保存"),
        site("api/src/internal/dishes/create-dish-media-entry.service.ts", 104,
             "photoUri を fetch し実体バイナリを取得"),
        site("api/src/internal/dishes/create-dish-media-entry.service.ts", 112,
             "取得したバイナリを storage.uploadFileAtPath で GCS へ永続保存"),
        site("api/src/v1/restaurants/restaurants.service.ts", 219,
             "tryGetPhotoMedia(photos, false) = skipHttpRedirect:false で画像バイナリを直接ダウンロード"),
        site("api/src/v1/restaurants/restaurants.service.ts", 228,
             "storageService.uploadFile(resourceType:'google-maps') で GCS へ保存"),
        site("api/src/v1/dish-media/dish-media.assembler.ts", 191,
             "buildCdnUrlFromPath: media_path を自社CDN URL に変換して配信"),
    ]
    findings["media_path_origin"] = [asdict(s) for s in media_sites]

    # ------------------------------------------------------------------
    # 4. Google Places API 利用箇所
    # ------------------------------------------------------------------
    google_hits = grep(
        r"places\.googleapis\.com|maps\.googleapis\.com",
        "*.ts", "*.py",
    )
    findings["google_api_endpoints"] = [
        {"path": p, "line": ln, "excerpt": ex} for p, ln, ex in google_hits
    ]

    # ------------------------------------------------------------------
    # 5. #1273 §40 の要求実装状況
    # ------------------------------------------------------------------
    ext_tbl = grep(r"dish_media_external_embeddings", "*.sql")
    render_type = grep(r"render_type", "*.sql", "*.prisma", "*.ts", "*.tsx")
    findings["issue_40_requirements"] = {
        "dish_media_external_embeddings": {
            "migration_present": bool(ext_tbl),
            "sites": [{"path": p, "line": ln} for p, ln, _ in ext_tbl[:5]],
            "in_prisma_schema": "dish_media_external_embeddings" in schema,
        },
        "render_type": {
            "sites": [{"path": p, "line": ln, "excerpt": ex} for p, ln, ex in render_type],
            "in_prisma_schema": "render_type" in schema,
            "in_migrations": any(p.endswith(".sql") for p, _, _ in render_type),
        },
    }

    # ------------------------------------------------------------------
    # 6. 現行 dish_media のうち外部API由来と判明した割合
    # ------------------------------------------------------------------
    # #1273 【仕様】dish_media 単位の由来比率はコードだけでは確定できない。
    # 理由: dish_media は「Google import (user_id=null)」と「ユーザー投稿 (user_id!=null)」の
    # 2経路があり、どちらも同一テーブルに入る。行数分布はDBにしか無い。
    # 一方 restaurants は google_place_id が NOT NULL + UNIQUE なので、
    # 「全店舗が Google Place ID を持つ」ことだけはスキーマから100%確定する。
    findings["metric"] = {
        "dish_media_external_api_ratio_pct": -1,
        "reason": "dish_media行の user_id null/非null 分布はDBにしか存在せず、コードからは確定不能",
        "restaurants_google_place_id_coverage_pct": 100.0,
        "restaurants_basis": "schema.prisma: google_place_id String @unique（NOT NULL）",
    }

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(findings, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(findings["metric"], ensure_ascii=False, indent=2))
    print(f"wrote {OUT}")


if __name__ == "__main__":
    main()
