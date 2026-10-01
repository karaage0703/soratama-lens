# 開発・公開

## 構成

- `index.html`: 画面
- `style.css`: スタイル
- `app.js`: WebGL描画、ファイル読み込み、保存
- `.nojekyll`: GitHub Pagesで静的ファイルをそのまま配信
- `tests/`: ブラウザ検証

アプリ本体に外部ライブラリやビルド工程はありません。

## GitHub Pages

このリポジトリではPagesを設定済みです。`main` ブランチのルート `/` を配信します。

PRをmainへマージするとPagesのデプロイ対象になります。反映状況はリポジトリのActionsまたはSettings → Pagesで確認してください。

配信先: https://karaage0703.github.io/soratama-lens/

アセットの参照は相対パスを維持してください。初期設定のやり直しや独自のデプロイワークフローは不要です。

## 検証

リポジトリのルートで実行します。

```sh
node --check app.js
uv run --with playwright --with pillow python tests/smoke.py
uv run --with playwright python tests/formats.py
```

テストにPlaywright（Apache-2.0）とPillow（HPND系）、テスト動画作成にffmpegを使用。アプリへの同梱依存なし。ブラウザはPlaywrightのChromiumを使用し、`uv run --with playwright playwright install chromium` で準備できます。検証記録は [検証記録](validation.md)。


## 参考

- 発想・見た目: https://karaage.hatenadiary.jp/entry/20120614/1339683656
- https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/captureStream
- https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder/isTypeSupported_static

参考記事のProcessingコードはコピーせず、新規のJavaScript/GLSLで実装しました。
