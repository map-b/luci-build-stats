#!/usr/bin/env python3
"""Extract LuCI build statistics from artifact directories.

Produces data/data.json with three layers:
  - packages: APK file sizes
  - images:   disk image file sizes
  - installed_js: JS file sizes and content from rootfs targz

Usage:
  ./extract_data.py --dir esbuild=~/Downloads/build-artifacts_esbuild ...
"""

import argparse, json, os, sys, tarfile
from datetime import datetime
from pathlib import Path

IMAGE_PATTERNS = [
    "*squashfs*img*",
    "*targz*",
    "*vmlinux-initramfs*",
    "*vmlinux*.elf",
    "*uImage-gzip*",
    "*uImage-lzma*",
    "*ext4*img*",
    "*rootfs*cpio*",
]

MAX_JS_CONTENT_FILES = 15

VARIANTS_META = {
    "esbuild":            {"profile": "Default", "branch": "25.12",   "js_minified": True,  "css_minified": True,  "tool": "esbuild"},
    "jsmin":              {"profile": "Default", "branch": "25.12",   "js_minified": True,  "css_minified": True,  "tool": "jsmin"},
    "no_js":              {"profile": "Default", "branch": "25.12",   "js_minified": False, "css_minified": True,  "tool": None},
    "no_css":             {"profile": "Default", "branch": "25.12",   "js_minified": True,  "css_minified": False, "tool": "esbuild"},
    "no_minifier":        {"profile": "Default", "branch": "25.12",   "js_minified": False, "css_minified": False, "tool": None},
    "esbuild-snapshot":   {"profile": "Generic", "branch": "snapshot", "js_minified": True,  "css_minified": True,  "tool": "esbuild"},
    "jsmin-snapshot":     {"profile": "Generic", "branch": "snapshot", "js_minified": True,  "css_minified": True,  "tool": "jsmin"},
}


def find_targz(targets_dir: Path) -> Path | None:
    cands = list(targets_dir.glob("*targz*"))
    if not cands:
        cands = list(targets_dir.glob("*rootfs.tar.gz"))
    if cands:
        return cands[0]
    return None


def collect_packages(variant_dir: Path) -> list:
    luci_dir = variant_dir / "packages" / "mipsel_24kc" / "luci"
    pkgs = []
    if luci_dir.is_dir():
        for f in sorted(luci_dir.iterdir()):
            if f.suffix == ".apk" and f.is_file():
                pkgs.append({
                    "name": f.name,
                    "size_bytes": f.stat().st_size,
                })
    return pkgs


def collect_images(targets_dir: Path) -> dict:
    images = {}
    for pat in IMAGE_PATTERNS:
        for f in targets_dir.glob(pat):
            if f.is_file() and not f.name.endswith((".manifest", ".buildinfo")):
                images[f.name] = f.stat().st_size
    return dict(sorted(images.items()))


def collect_installed_js(targets_dir: Path, content_paths: set | None = None) -> dict:
    targz_path = find_targz(targets_dir)
    if targz_path is None:
        return {"total_size_bytes": 0, "file_count": 0, "files": []}
    files = []
    with open(targz_path, "rb") as fh:
        tf = tarfile.open(fileobj=fh, mode="r:gz")
        for member in tf.getmembers():
            if member.name.endswith(".js") and member.isfile():
                files.append({
                    "path": member.name,
                    "size_bytes": member.size,
                })
    files.sort(key=lambda x: x["size_bytes"], reverse=True)
    total = sum(f["size_bytes"] for f in files)
    # mark content
    for f in files:
        f["content"] = None
    if content_paths:
        with open(targz_path, "rb") as fh:
            tf2 = tarfile.open(fileobj=fh, mode="r:gz")
            for entry in tf2.getmembers():
                if entry.name in content_paths and entry.isfile():
                    for f in files:
                        if f["path"] == entry.name:
                            try:
                                raw = tf2.extractfile(entry).read()
                                f["content"] = raw.decode("utf-8", errors="replace")
                            except Exception:
                                f["content"] = None
                            break
    return {
        "total_size_bytes": total,
        "file_count": len(files),
        "files": files,
    }


def extract_variant(variant_id: str, variant_dir: Path,
                    content_paths: set | None = None) -> dict:
    targets_dir = variant_dir / "targets" / "malta" / "le"
    pkgs = collect_packages(variant_dir)
    images = collect_images(targets_dir)
    installed_js = collect_installed_js(targets_dir, content_paths)
    meta = VARIANTS_META.get(variant_id, {})
    total_pkg = sum(p["size_bytes"] for p in pkgs)
    total_img = sum(images.values())
    return {
        "id": variant_id,
        "meta": meta,
        "packages": {"count": len(pkgs), "total_size_bytes": total_pkg, "list": pkgs},
        "images": {"count": len(images), "total_size_bytes": total_img, "list": images},
        "installed_js": installed_js,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", action="append", default=[],
                    help="Variant directory in form name=path")
    ap.add_argument("-o", "--output", default="data/data.json")
    args = ap.parse_args()
    if not args.dir:
        dl = Path.home() / "Downloads"
        for d in sorted(dl.glob("build-artifacts_*")):
            vid = d.name.removeprefix("build-artifacts_")
            args.dir.append(f"{vid}={d}")
    dirs = {}
    for spec in args.dir:
        if "=" not in spec:
            print(f"ERROR: --dir entries must be name=path, got: {spec}", file=sys.stderr)
            sys.exit(1)
        vid, vpath = spec.split("=", 1)
        vdir = Path(vpath).expanduser().resolve()
        if not vdir.is_dir():
            print(f"ERROR: not a directory: {vdir}", file=sys.stderr)
            sys.exit(1)
        dirs[vid] = vdir

    # Pass 1: extract without content
    print("Pass 1: collecting file sizes...", file=sys.stderr)
    variants = {}
    for vid, vdir in dirs.items():
        print(f"  {vid} ...", file=sys.stderr)
        variants[vid] = extract_variant(vid, vdir)

    # Determine global top content paths (union of each variant's top N)
    all_candidates = {}
    for v in variants.values():
        for i, f in enumerate(v["installed_js"]["files"]):
            if i < MAX_JS_CONTENT_FILES and f["size_bytes"] > 0:
                all_candidates.setdefault(f["path"], 0)
                all_candidates[f["path"]] = max(all_candidates[f["path"]], f["size_bytes"])
    global_top = set(sorted(all_candidates, key=lambda p: all_candidates[p], reverse=True)
                     [:MAX_JS_CONTENT_FILES])
    print(f"Global top {len(global_top)} files for content:",
          file=sys.stderr)
    for p in sorted(global_top):
        print(f"    {p}", file=sys.stderr)

    # Pass 2: re-extract with content for those paths
    print("Pass 2: reading content...", file=sys.stderr)
    for vid, vdir in dirs.items():
        print(f"  {vid} ...", file=sys.stderr)
        variants[vid] = extract_variant(vid, vdir, content_paths=global_top)

    out_path = Path(args.output)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    data = {
        "version": 1,
        "generated": datetime.now().isoformat(),
        "variants": variants,
    }
    out_path.write_text(json.dumps(data, indent=2, default=str))
    print(f"Wrote {out_path} ({len(variants)} variants)", file=sys.stderr)


if __name__ == "__main__":
    main()
