# Soratama Lens

プロジェクト名: `soratama-lens`

画像・動画を宙玉レンズ風に加工する静的Webアプリ。WebGLシェーダーで背景ぼかしと球面歪みを端末内で処理します。外部ライブラリ・CDN・画像アップロード・解析送信はありません。

## 使い方

ZIPを展開して `index.html` をブラウザで開くか、HTTPサーバーで配信します。

```sh
uv run python -m http.server 8080 --bind 127.0.0.1
```

ブラウザで http://localhost:8080 を開きます。画像・動画を選択し、大きさ・倍率・歪み・背景ぼかし・光沢・反転を調整。球の位置はドラッグとスライダーで変更できます。PNG保存、動画の先頭からの保存、途中終了に対応します。

## GitHub Pages

マージ後、リポジトリの **Settings → Pages** で次を設定します。

1. Source: **Deploy from a branch**
2. Branch: **main**、フォルダ: **/(root)**
3. **Save** を押し、Pagesのデプロイ完了を待ちます。

公開先: https://karaage0703.github.io/soratama-lens/ （Pages有効化・デプロイ完了後に利用可能）

`index.html`, `style.css`, `app.js`, `.nojekyll` をルートに配置済みです。ビルドや独自のActionsワークフローは不要。相対パスなのでプロジェクトPagesのサブパスでも動作します。以後はmainへの変更が配信されます。

参考: [GitHub Pagesの公開元設定](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)

## 動画とGPUについて

- ブラウザが読める画像・動画形式に対応します。HEIC、MOV内のコーデックなどは環境依存。非対応時はエラーを表示。
- PNG・動画は選択した長辺以内、元画像を超える拡大なし。縦横比をほぼ維持し、動画互換のため偶数ピクセルへ丸めます。
- 描画はWebGL。GPU利用はブラウザの設定とドライバー次第で、ソフトウェア描画の場合もあります。離散GPUの利用やFPSは保証しません。
- 背景ぼかしは縦横1/4の中間テクスチャで2パス。静止画は変更時、動画は新しいフレーム時のみ再描画。FPS表示は描画頻度で、GPU単体の処理時間ではありません。
- 動画保存はcanvas.captureStream(30) + MediaRecorder。原則WebM、対応環境ではMP4にフォールバック。保存形式はブラウザが決定します。
- MediaRecorder生成のWebMは総再生時間のメタデータがない場合があり、プレイヤーによって時間表示・シークに制限があります。
- 保存は実時間方式（例: 1分の動画は約1分）。負荷によってフレーム落ち・音声ずれが起こり得ます。フレーム完全性や高速オフラインエンコード、HDRは対象外です。
- プレビューは無音。保存時はWeb Audio APIで元音声を収録できます。チェックを外すと無音保存。音声のない入力に音声を生成することはありません。
- 保存中は設定・ファイル変更を禁止。タブ非表示で部分保存します。初版は10分以内の入力、出力512MBを目安とした安全上限（最後のチャンク分は超過することがあります）。出力はメモリへ蓄積されます。
- コンテキスト喪失時は再読み込みが必要です。アニメーションGIFは静止画として扱います。

## 検証

```sh
node --check app.js
uv run --with playwright --with pillow python tests/smoke.py
```

テストにPlaywright（Apache-2.0）とPillow（HPND系）、テスト動画作成にffmpegを使用。アプリへの同梱依存なし。ブラウザはPlaywrightのChromiumを使用し、`uv run --with playwright playwright install chromium` で準備できます。検証記録は `VALIDATION.md`。

## 参考

- 発想・見た目: https://karaage.hatenadiary.jp/entry/20120614/1339683656
- https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/captureStream
- https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder/isTypeSupported_static

参考記事のProcessingコードはコピーせず、新規のJavaScript/GLSLで実装しました。
