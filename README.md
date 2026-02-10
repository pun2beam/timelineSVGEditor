# Timeline SVG Editor

タイムラインDSL（Markdown風の入力）から縦方向の年表をSVG描画する、シンプルなブラウザアプリです。左ペインでDSLを編集すると、右ペインのSVGプレビューがリアルタイムに更新されます。

- GitHub Pages: https://pun2beam.github.io/timelineSVGEditor/

## 主な機能

- 左ペインのDSL入力を200msデバウンスで再描画
- `column / node / band / connector / defaults` ブロックを解釈してSVG生成
- 年表示列を基準にY座標を計算し、ノード・帯・コネクタを配置
- Ctrl + ホイールでズーム、ドラッグでパン
- SVGとして保存、DSLとして保存/読み込み

## 使い方

1. ブラウザで `index.html` を開きます（または上記GitHub Pagesにアクセス）。
2. 左ペインのDSLを編集すると右ペインにプレビューが描画されます。
3. `SVGとして保存` でSVGをダウンロードできます。
4. `DSLとして保存` / `DSLを読み込む` でDSLファイルを管理できます。

## DSL仕様の概要

### ブロック構造

```
<blockType>:
  key:value
```

- ブロック種別: `column`, `node`, `connector`, `band`, `defaults`
- インデントはスペース2を標準（実装では先頭空白数で判定）

### column

必須: `type`, `width`
任意: `id`, `rowheight`, `period`

```
column:
  id:1
  type:year
  width:20pt
  rowheight:20pt
  period:1990-2026
```

- `type:year` の列は年目盛りの基準（`period` が必須）
- `width` と `rowheight` は `pt/px` を許容（省略時はpx）

### node

必須: `id`, `column`, `type`, `date`, `text`
任意: `color`, `bgcolor`, `bordercolor`, `fontsize`, `padding`, `align`, `offset`

```
node:
  id:1
  column:3
  type:box
  date:1990.1.1
  text:日本共産党
```

- `date` は `YYYY` / `YYYY.M` / `YYYY.M.D` / `YYYY-MM-DD` を許容
- `offset` は `x,y` 形式で座標を微調整

### band

必須: `id`, `column`, `date`, `text`
任意: `color`, `bgcolor`

```
band:
  id:2
  column:2
  date:1993-1994
  text:非自民連立
```

- `date` は範囲指定（例: `YYYY-YYYY` / `YYYY.M-YYYY.M`）

### connector

必須: `id`, `node`

```
connector:
  id:1
  node:2,3
```

- `node` は接続するnode idをカンマ区切り
- 3点以上は最初のnodeを起点にしたスター結合

### defaults

```
defaults:
  node.box.height:22px
  node.box.last:on
  translation.box.adjust:on
```

- `node.box.height` でボックスの高さを既定値として指定
- `node.box.last` を `on` にすると、年表示列の末尾まで継続する `type:box` ノードを末尾位置にも描画
- `translation.box.adjust` を `on` にすると、transition の接続先が `type:box` の場合に from の位置関係に応じて接続点を左辺/中央/右辺へ自動調整

## レイアウトの考え方

- 縦方向が時間軸（年が増えるほど下方向）
- 年表示列の `rowheight` を基準にY座標を算出
- ノードは列の中央に配置し、帯は指定期間分の高さを持つ

## 開発メモ

- 主要ロジックは `app.js` に集約
- `parseDsl` → `normalizeModel` → `layout` → `renderSvg` の流れで描画
- `styles.css` にレイアウト/配色/エラーバナーの定義

## 例

`example.txt` にサンプルDSLがあります。アプリ起動時に自動読み込みされます。
