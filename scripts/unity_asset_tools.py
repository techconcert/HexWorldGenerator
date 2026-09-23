#!/usr/bin/env python3
"""
Unity Asset Package Downloader & Extractor
Directly downloads purchased packages from Unity Asset Store and extracts models/textures
without needing the Unity Editor or Unity Hub.
"""

import sys
import os
import re
import json
import tarfile
import urllib.request
import urllib.error
from pathlib import Path

PACKAGE_ID = "290678"  # KayKit - Medieval Hexagon Pack
API_DOWNLOAD_URL = f"https://assetstore.unity.com/api/downloads/{PACKAGE_ID}"

def download_unitypackage(cookie_str, output_pkg_path):
    output_pkg_path = Path(output_pkg_path)
    output_pkg_path.parent.mkdir(parents=True, exist_ok=True)

    headers = {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
        "Accept": "*/*",
        "Cookie": cookie_str.strip(),
        "Referer": "https://assetstore.unity.com/",
        "Origin": "https://assetstore.unity.com"
    }

    req = urllib.request.Request(API_DOWNLOAD_URL, headers=headers)
    print(f"Connecting to Unity Asset Store for package {PACKAGE_ID}...")

    try:
        with urllib.request.urlopen(req) as resp:
            content_disp = resp.headers.get("Content-Disposition", "")
            filename = f"KayKit_Medieval_Hexagon_Pack_{PACKAGE_ID}.unitypackage"
            if "filename=" in content_disp:
                match = re.search(r'filename=["\']?([^"\';]+)', content_disp)
                if match:
                    filename = match.group(1)

            total_bytes = int(resp.headers.get("Content-Length", 0))
            print(f"Downloading: {filename} ({total_bytes / (1024*1024):.1f} MB)...")

            downloaded = 0
            block_size = 1024 * 64
            with open(output_pkg_path, "wb") as out_f:
                while True:
                    chunk = resp.read(block_size)
                    if not chunk:
                        break
                    out_f.write(chunk)
                    downloaded += len(chunk)
                    if total_bytes > 0:
                        pct = (downloaded / total_bytes) * 100
                        print(f"\rProgress: {downloaded / (1024*1024):.1f}MB / {total_bytes / (1024*1024):.1f}MB ({pct:.1f}%)", end="", flush=True)
                    else:
                        print(f"\rDownloaded: {downloaded / (1024*1024):.1f}MB", end="", flush=True)

            print(f"\nDownload complete: {output_pkg_path}")
            return output_pkg_path

    except urllib.error.HTTPError as e:
        print(f"\nHTTP Error {e.code}: {e.reason}")
        if e.code in (401, 403):
            print("Authentication failed: Your Unity session cookie is missing, expired, or doesn't own this package.")
            print("Please log into https://assetstore.unity.com and copy a fresh Cookie header.")
        elif e.code == 404:
            print(f"Package ID {PACKAGE_ID} was not found on Unity Asset Store.")
        return None
    except Exception as e:
        print(f"\nDownload failed: {e}")
        return None

def extract_unitypackage(pkg_path, output_dir):
    pkg_path = Path(pkg_path)
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    print(f"Extracting {pkg_path.name} to {output_dir}...")
    try:
        with tarfile.open(pkg_path, "r:*") as tar:
            guid_paths = {}
            guid_assets = {}

            for member in tar.getmembers():
                parts = member.name.split("/")
                if len(parts) >= 2:
                    guid = parts[0]
                    fname = parts[1]
                    if fname == "pathname":
                        f = tar.extractfile(member)
                        if f:
                            path_str = f.read().decode("utf-8", errors="replace").strip()
                            path_str = path_str.split("\n")[0].strip("\x00\r\n")
                            guid_paths[guid] = path_str
                    elif fname == "asset":
                        guid_assets[guid] = member

            print(f"Found {len(guid_assets)} assets in package archive.")

            extracted_count = 0
            for guid, member in guid_assets.items():
                if guid in guid_paths:
                    rel_path = guid_paths[guid]
                    dest_path = output_dir / rel_path
                    dest_path.parent.mkdir(parents=True, exist_ok=True)
                    with tar.extractfile(member) as src_f, open(dest_path, "wb") as dst_f:
                        dst_f.write(src_f.read())
                    extracted_count += 1

            print(f"Successfully extracted {extracted_count} files into {output_dir}.")
            return output_dir
    except Exception as e:
        print(f"Extraction failed: {e}")
        return None

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage:")
        print("  1. Download and extract using cookie:")
        print("     python3 scripts/unity_asset_tools.py download [cookie_string_or_file] [output_dir]")
        print("     (If omitted, reads cookie from 'unity_cookie.txt' or UNITY_COOKIE env variable)")
        print("  2. Extract an existing .unitypackage file:")
        print("     python3 scripts/unity_asset_tools.py extract <path/to/package.unitypackage> [output_dir]")
        sys.exit(1)

    action = sys.argv[1].lower()

    if action == "extract":
        if len(sys.argv) < 3:
            print("Error: Specify path to .unitypackage file.")
            sys.exit(1)
        pkg_file = sys.argv[2]
        out_dir = sys.argv[3] if len(sys.argv) > 3 else "./imported_assets/kaykit_full"
        extract_unitypackage(pkg_file, out_dir)

    elif action == "download":
        cookie = None
        out_dir = "./imported_assets/kaykit_full"

        if len(sys.argv) >= 3:
            arg = sys.argv[2]
            if os.path.isfile(arg):
                with open(arg, "r", encoding="utf-8") as f:
                    cookie = f.read().strip()
                if len(sys.argv) >= 4:
                    out_dir = sys.argv[3]
            elif arg.startswith("-"):
                pass
            elif len(arg) > 50:  # Raw cookie string
                cookie = arg
                if len(sys.argv) >= 4:
                    out_dir = sys.argv[3]

        if not cookie:
            # Check default cookie file or env var
            if os.path.isfile("unity_cookie.txt"):
                print("Reading cookie from unity_cookie.txt...")
                with open("unity_cookie.txt", "r", encoding="utf-8") as f:
                    cookie = f.read().strip()
            elif os.environ.get("UNITY_COOKIE"):
                print("Reading cookie from UNITY_COOKIE environment variable...")
                cookie = os.environ.get("UNITY_COOKIE").strip()

        if not cookie:
            print("Error: No cookie provided.")
            print("Please provide your Unity session cookie as an argument, put it in 'unity_cookie.txt',")
            print("or set the UNITY_COOKIE environment variable.")
            sys.exit(1)

        temp_pkg = Path("./imported_assets/kaykit_full.unitypackage")
        res = download_unitypackage(cookie, temp_pkg)
        if res:
            extract_unitypackage(temp_pkg, out_dir)
            print("\nAll assets extracted and ready!")
    else:
        print(f"Unknown action '{action}'. Use 'download' or 'extract'.")
