#!/usr/bin/env python3
"""オンボーディング画像（#1486 §2）を確定アセットへ変換する。

チケットの要件は「元画像を必要最大表示サイズにリサイズしたうえで WebP に圧縮」。
その «必要最大表示サイズ» と圧縮率をここに 1 度だけ書いておき、
画像が差し替わるたびに手作業で決め直さなくて済むようにする。

使い方:

    python3 scripts/build-onboarding-images.py <元画像のディレクトリ>

元画像のファイル名は、出力名（step1-empathy 等）か、チケットの並び順を表す
番号（01-empathy / 1_empathy / onboarding_01_kyokan …）のどちらでも拾えるよう、
「step 番号」と「empathy / solution の別」を名前から推測する。
推測できなかった場合は、どのファイルが余ったかを表示して **何も書かずに終了する**
（間違った画像を静かに上書きするより、止まって人が見るほうが安い）。

依存: Pillow（`pip install Pillow`）
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

try:
    from PIL import Image
except ImportError:  # pragma: no cover - 実行環境の問題をそのまま伝える
    sys.exit("Pillow が必要です: pip install Pillow")

# 出力先（app-expo/assets/images/onboarding）
OUTPUT_DIR = Path(__file__).resolve().parent.parent / "assets" / "images" / "onboarding"

# 用途ごとの最大表示サイズ。詳細は assets/images/onboarding/README.md
#   empathy  … 画面全面に cover で敷く（9:16）
#   solution … 中央に contain で置く（3:4）
TARGET_SIZE = {"empathy": (1080, 1920), "solution": (1080, 1440)}

# リポジトリ既存アセットに合わせた圧縮率
WEBP_QUALITY = 80

# 「解決」側を指す語（日本語のファイル名で渡されることがある）
SOLUTION_WORDS = ("solution", "kaiketsu", "解決", "after")
EMPATHY_WORDS = ("empathy", "kyokan", "共感", "problem", "before")

SOURCE_SUFFIXES = {".png", ".jpg", ".jpeg", ".webp", ".heic", ".tif", ".tiff"}


def classify(path: Path) -> tuple[int, str] | None:
    """ファイル名から (ステップ番号, "empathy" | "solution") を推測する。"""
    name = path.stem.lower()

    match = re.search(r"(?:step|page|no|^|[^0-9])0*([123])(?:[^0-9]|$)", name)
    if not match:
        return None
    step = int(match.group(1))

    if any(word in name for word in SOLUTION_WORDS):
        return step, "solution"
    if any(word in name for word in EMPATHY_WORDS):
        return step, "empathy"
    return None


def convert(source: Path, kind: str, destination: Path) -> None:
    """アスペクト比を保ったまま «収まる» 最大サイズへ縮小し、WebP で書き出す。

    ⚠️ **透過を潰さないこと。** 解決画像（`*-solution.webp`）は «白いフレームだけ» が
    描かれた切り抜きで、背景は透明である。オンボーディングではこれを
    «暗くした共感写真の上» に `contentFit="contain"` で重ねるため、
    `convert("RGB")` で平坦化すると黒（または白）の四角が写真を覆ってしまう。
    """
    with Image.open(source) as image:
        # パレット画像やグレースケールが混ざっても扱えるよう、アルファの有無で正規化する
        has_alpha = image.mode in ("RGBA", "LA") or (image.mode == "P" and "transparency" in image.info)
        image = image.convert("RGBA" if has_alpha else "RGB")

        # thumbnail は «指定枠に収まる» ように縮小する（拡大はしない）。
        # 元画像が枠より小さい場合に引き伸ばして粗くしないための選択
        image.thumbnail(TARGET_SIZE[kind], Image.LANCZOS)
        destination.parent.mkdir(parents=True, exist_ok=True)
        image.save(destination, "WEBP", quality=WEBP_QUALITY, method=6)


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        return int(bool(sys.stderr.write(f"使い方: {Path(argv[0]).name} <元画像のディレクトリ>\n"))) or 2

    source_dir = Path(argv[1]).expanduser()
    if not source_dir.is_dir():
        sys.stderr.write(f"ディレクトリが見つかりません: {source_dir}\n")
        return 2

    sources = sorted(p for p in source_dir.iterdir() if p.suffix.lower() in SOURCE_SUFFIXES)
    if not sources:
        sys.stderr.write(f"変換できる画像がありません: {source_dir}\n")
        return 2

    resolved: dict[tuple[int, str], Path] = {}
    unmatched: list[Path] = []
    for path in sources:
        key = classify(path)
        if key is None or key in resolved:
            unmatched.append(path)
            continue
        resolved[key] = path

    expected = [(step, kind) for step in (1, 2, 3) for kind in ("empathy", "solution")]
    missing = [key for key in expected if key not in resolved]

    if missing or unmatched:
        # 名前が推測できないときは «何も書かずに» 終わる。
        # 片方だけ差し替わった状態は、全部が仮のままより気づきにくい
        for step, kind in missing:
            sys.stderr.write(f"見つかりません: step{step}-{kind}\n")
        for path in unmatched:
            sys.stderr.write(f"どれに当たるか判別できません: {path.name}\n")
        sys.stderr.write(
            "\nファイル名に «ステップ番号(1-3)» と «empathy / solution» が入るようにして再実行してください。\n"
        )
        return 1

    for (step, kind), source in sorted(resolved.items()):
        destination = OUTPUT_DIR / f"step{step}-{kind}.webp"
        convert(source, kind, destination)
        print(f"{source.name} -> {destination.relative_to(OUTPUT_DIR.parent.parent.parent)} "
              f"({destination.stat().st_size // 1024} KB)")

    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
