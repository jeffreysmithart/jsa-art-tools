#!/usr/bin/env python3
"""
Builds data/nga-paintings.json: a compact search index of the National
Gallery of Art (Washington) paintings that have open-access images.

The Gallery has no live search API, but publishes its full catalog as CSV
files under CC0 (https://github.com/NationalGalleryOfArt/opendata). This
script downloads two of them (about 175 MB together), keeps only paintings
whose primary image is open access, and writes one small JSON file that the
app searches in the browser.

Usage:
    python3 tools/build_nga_index.py              # download and build
    python3 tools/build_nga_index.py OBJECTS.csv IMAGES.csv   # use local copies

Each row is [objectid, title, attribution, displaydate, image uuid, max side].
"""
import csv
import json
import os
import sys
import tempfile
import urllib.request

BASE = 'https://raw.githubusercontent.com/NationalGalleryOfArt/opendata/main/data/'
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data', 'nga-paintings.json')


def download(name, folder):
    path = os.path.join(folder, name)
    print(f'downloading {name}…', file=sys.stderr)
    urllib.request.urlretrieve(BASE + name, path)
    return path


def build(objects_csv, images_csv):
    csv.field_size_limit(10**9)
    images = {}
    with open(images_csv, newline='', encoding='utf-8') as f:
        for r in csv.DictReader(f):
            if r['viewtype'] == 'primary' and r['openaccess'] == '1':
                images[r['depictstmsobjectid']] = r
    rows = []
    with open(objects_csv, newline='', encoding='utf-8') as f:
        for r in csv.DictReader(f):
            img = images.get(r['objectid'])
            if r['classification'] != 'Painting' or not img:
                continue
            side = max(int(img['width'] or 0), int(img['height'] or 0))
            rows.append([
                int(r['objectid']),
                r['title'].strip(),
                (r['attribution'] or '').strip(),
                (r['displaydate'] or '').strip(),
                img['uuid'],
                side,
            ])
    rows.sort(key=lambda x: x[0])
    return rows


def main():
    if len(sys.argv) == 3:
        objects_csv, images_csv = sys.argv[1], sys.argv[2]
        rows = build(objects_csv, images_csv)
    else:
        with tempfile.TemporaryDirectory() as tmp:
            rows = build(download('objects.csv', tmp), download('published_images.csv', tmp))
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump(rows, f, ensure_ascii=False, separators=(',', ':'))
        f.write('\n')
    print(f'wrote {len(rows)} paintings to {os.path.relpath(OUT)} ({os.path.getsize(OUT) // 1024} KB)', file=sys.stderr)


if __name__ == '__main__':
    main()
