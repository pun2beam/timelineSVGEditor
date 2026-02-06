# 仕様書：タイムラインSVGエディタ（左DSL入力 → 右SVGプレビュー）

## 1. 目的

左ペインのテキスト入力（Markdown的なDSL）から年表データを定義し、右ペインに**リアルタイム**で年表をSVG描画するWebアプリを作成する。年表は**縦方向が時間軸**で、横方向に複数の列（可変）を持つ。

---

## 2. 画面要件（UI）

### 2.1 レイアウト

* 画面は左右2ペイン

  * 左：`textarea`（DSL入力）
  * 右：SVGプレビュー領域（スクロール可能）
* ペイン比率：初期 40% : 60%（可変は任意）

### 2.2 リアルタイム更新

* 入力変更から **200ms程度のデバウンス**後に再パース・再描画
* パースエラー時：

  * 右ペインは前回の成功描画を保持（またはエラー表示に切替：どちらか採用。推奨：前回保持＋上部にエラー帯）
  * エラー内容（行番号・原因）を左下などに表示

### 2.3 右ペイン操作（優先度：中）

* ズーム（Ctrl+ホイール）・パン（ドラッグ）をサポート（SVGを`viewBox`で制御）
* 「SVGとして保存」ボタン（SVG文字列ダウンロード）

---

## 3. 入力DSL仕様（文法）

### 3.1 全体構造

* DSLは「ブロック」の繰り返しで構成
* ブロック種別：`column`, `node`, `connector`, `band`, `defaults`
* ブロックは以下の形式：

```
<blockType>:
  key1:value1
  key2:value2
  ...
```

* 同種ブロックは複数回出現可能（columnは複数必須）
* インデントはスペース2を標準（ただし実装は“先頭の空白数”で階層判定し、2以外でも許容してよい）

### 3.2 キー・値の基本ルール

* `key:value` の区切りは最初の `:` を採用
* 値はトリム（両端空白除去）
* 文字列値は原則そのまま（引用符は不要）
* 数値：`20`, `15pt` 等を許容（単位付きは後述）

### 3.3 column ブロック

必須：`type`, `width`
任意：`rowheight`, `period`

例：

```
column:
  id:1
  type:year
  width:20pt
  rowheight:20pt
  period:1990-2026
```

* `id`：省略可能。省略時は出現順で 1..N を付与
* `type`：

  * `year`：年表示列（縦の目盛りを生成）
  * `base`：通常列（ノード、帯、コネクタの配置対象）
* `width`：列幅（単位 pt/px 対応。省略時px扱い）
* `rowheight`：年表示の基本行高（`type:year` に推奨。省略時はデフォルト 20px）
* `period`：表示範囲

  * 形式：`YYYY-YYYY`（例：1990-2026）
  * `type:year` の column に必須（この列がタイムスケール定義者）

### 3.4 node ブロック

必須：`id`, `column`, `type`, `date`, `text`

例：

```
node:
  id:1
  column:3
  type:box
  date:1990.1.1
  text:日本共産党
  borderdasharray:4 2
```

* `column`：配置先列ID
* `type`：当面 `box` のみ必須実装（将来拡張可：point等）
* `date`：日時指定（後述）
* `text`：表示文字列
* 任意：`color`, `bgcolor`, `bordercolor`, `borderdasharray`, `fontsize`, `padding`, `align`
* 任意：`offset`（`x,y` 形式でpx指定。座標に加算して微調整）

### 3.5 band ブロック（期間帯）

必須：`id`, `column`, `date`, `text`
任意：`color`, `bgcolor`

例：

```
band:
  id:2
  column:2
  date:1993-1994
  text:非自民連立
  color:#ffffff
  bgcolor:#0a00a0
```

* `date`（bandの場合）：`YYYY-YYYY` または `YYYY.M-YYYY.M` 等の範囲（後述）
* 描画は指定期間を縦に延ばした「帯状タイル」

### 3.6 connector ブロック（接続線）

必須：`id`, `node`
任意：`style`, `color`, `width`

例：

```
connector:
  id:1
  node:2,3
```

* `node`：接続するnode idをカンマ区切り
* 最小実装：

  * 2点（nodeが2つ）を直線で結ぶ
* 拡張：

  * 3点以上は折れ線（上から順に接続）または“ハブ”方式（仕様で選ぶ）
* 仕様固定案：**3点以上は「最初のnodeを起点」に他ノードへ個別線を引く（スター結合）**

### 3.7 defaults ブロック（既定値）

DSL内の既定値を上書きする。1つ以上指定可能で、同一キーは後勝ち。

例：

```
defaults:
  node.box.height:22px
```

対応キー：

* `node.box.height`：`type:box` のノード高さの既定値。単位は `pt/px` または省略（px扱い）。
* `node.box.last`：`on/off` を指定。`on` の場合、`type:box` かつ年表示列の末尾まで継続するノードは末尾位置にも同じボックスを再描画する。

---

## 4. 日付（year）表現の仕様

### 4.1 許容形式

* `YYYY` → `YYYY-01-01`
* `YYYY.M` → `YYYY-(M)-01`
* `YYYY.M.D` → その日付
* `YYYY-MM-DD` も許容（将来互換）
* band範囲：

  * `YYYY-YYYY`（年単位。開始=YYYY-01-01, 終了=YYYY+1-01-01 ではなく、表示上はYYYY末までに延ばす）
  * `YYYY.M-YYYY.M`（月単位）
  * `YYYY.M.D-YYYY.M.D`

### 4.2 正規化ルール（重要：曖昧排除）

* 内部的には `dateValue` を **“年からの連続値”**として扱う

  * `1993.4` は 1993年4月1日と解釈
* 範囲の終端は「含む」扱いにせず、描画上は **終端の次の最小単位の先頭**まで延長する（実装簡略のため）

  * 例：`1993-1994` は 1993-01-01〜1995-01-01 相当の高さにするか、1994-12-31までにするかは選択が必要
  * 推奨：**1993-1994 は 1993-01-01〜1995-01-01（2年分）**（年表的に直感的・計算が簡単）

---

## 5. 単位・スタイル値

* `width`, `rowheight`, `fontsize`, `padding` は数値または `pt/px` を許容
* 単位省略時は `px` 扱い
* `pt`→`px` 変換： 1pt = 1.333px（96dpi基準）で固定
* 色：`#RRGGBB` を基本（`#RGB` も任意対応）

---

## 6. データモデル（内部表現）

パース後に以下へ正規化する（例：JS object）：

```js
{
  columns: [
    { id, type, widthPx, rowHeightPx, period: {startYear, endYear} }
  ],
  nodes: [
    { id, columnId, type, dateValue, offset, text, style... }
  ],
  bands: [
    { id, columnId, startDateValue, endDateValue, text, style... }
  ],
  connectors: [
    { id, nodeIds: [..], style... }
  ],
  meta: { errors: [...] }
}
```

---

## 7. レイアウト・座標計算仕様（SVG生成の核）

### 7.1 基本座標系

* 原点（0,0）はSVG左上
* 縦方向：時間が増えるほど **下へ**
* 横方向：列1→列Nへ **右へ**

### 7.2 列のX座標

* `column[i].xStart = sum(width[1..i-1])`
* `column[i].xCenter = xStart + width/2`

### 7.3 時間→Y座標

* タイムスケールは `type:year` かつ `period` を持つcolumnを **scaleColumn** とする（複数あれば最初）
* `rowHeight = scaleColumn.rowheight`（デフォルト20px）
* `y(yearIndex) = topMargin + (yearIndex - startYear) * rowHeight`
* 月/日は年内で線形補間：

  * `y = y(YYYY) + (dayOfYear / daysInYear) * rowHeight`
  * 最小要件：月まででも良い（`month-1)/12`）
  * 推奨：**月=12分割、日=365/366で細分**（精度は任意だが仕様で固定）

### 7.4 ノード（box）の配置

* boxの幅：その列幅の 90%（左右margin 5%ずつ）または固定 `nodeWidth`（仕様固定案：列幅-8px）
* boxの高さ：`defaults.node.box.height` が指定されていればその値、なければ `minHeight = rowHeight*0.9`
* boxのy：指定日付の `y(dateValue)` を中心（または上端）にする
* `offset` 指定時は `x` と `y` に加算して位置をずらす

  * 仕様固定案：**中心合わせ**（boxCenterY = y(date))

### 7.5 バンド（band）の配置

* x：指定列のxStart + bandPadding（例：2px）
* width：列幅 - 2*bandPadding
* y：`y(start)`
* height：`y(end) - y(start)`（endは前述の“次単位先頭”ルールで計算）
* テキスト：帯の上端付近に配置、長い場合は省略（`...`）

### 7.6 コネクタ描画

* ノードの接続点：boxの左右中央 or 中央上/中央下（仕様で固定）

  * 仕様固定案：**各boxの中心点 (cx, cy)** を接続点にする
* 2点：直線 `line`
* 3点以上：スター結合（最初を起点に他へ線）

---

## 8. SVG出力仕様

### 8.1 SVG構造（推奨）

* `<svg>` 内に `<g id="timeline-root">`
* レイヤ順（下→上）：

  1. 背景（任意）
  2. 年グリッド（year列の目盛線）
  3. band
  4. connector
  5. node
  6. 前景（ラベルなど）

### 8.2 年表示（type:year列）

* 各年のyに水平ガイド（薄線）を引く（全幅または年列のみ）
* 年文字はyear列の中央に配置（例：`1990`）

### 8.3 文字の折返し

* SVGでの折返しは実装が難しいため、最小要件は以下：

  * 1行のみ表示、超過は省略（`...`）
* 中要件：

  * `<foreignObject>` + HTMLで折返し（ブラウザ依存あり）
* 仕様固定案：**最小要件（省略）を必須、foreignObjectはオプション**

---

## 9. エラー処理仕様

* パースエラー分類：

  * 文法エラー（コロン不足、インデント不正など）
  * 必須キー欠落（nodeにidがない等）
  * 参照エラー（connectorが存在しないnode id参照）
  * 型エラー（yearの解釈不可、width不正など）
* エラー出力：

  * `[{line, blockType, message}]`
* エラーがあっても可能な範囲で描画を継続（部分描画）

  * ただしスケール列（type:year & period）が無い場合は描画不能 → エラー表示のみ

---

## 10. デフォルト値一覧

* `topMargin`: 20px
* `leftMargin`: 10px（列計算に加算してもよい）
* `rowheight`（year列）: 20px
* `fontSize`: 12px
* `node padding`: 4px
* `node bgcolor`: #ffffff
* `node bordercolor`: #333333
* `connector color`: #333333
* `band color`: #ffffff
* `band bgcolor`: #6666aa（未指定時）

---

## 11. 入力例（あなたの例を修正版として整形）

※ `colum` は `column` に統一（仕様）

```
column:
  id:1
  type:year
  width:20pt
  rowheight:20pt
  period:1990-2026

column:
  id:2
  type:base
  width:15pt

column:
  id:3
  type:base
  width:20pt

column:
  id:4
  type:base
  width:20pt

column:
  id:5
  type:base
  width:20pt

node:
  id:1
  column:3
  type:box
  date:1990.1.1
  text:日本共産党

node:
  id:2
  column:4
  type:box
  date:1990.1.1
  text:自由民主党

node:
  id:3
  column:5
  type:box
  date:1993.4
  text:さきがけ

connector:
  id:1
  node:2,3

band:
  id:1
  column:2
  date:1990-1993
  text:自由民主党
  color:#ffffff
  bgcolor:#00a0a0

band:
  id:2
  column:2
  date:1993-1994
  text:非自民連立
  color:#ffffff
  bgcolor:#0a00a0
```

---

## 12. 実装要件（Codex向けタスク分割）

### 12.1 必須モジュール

1. `parseDsl(text) -> {model, errors}`
2. `normalizeModel(rawModel) -> model`（単位変換、日付正規化、デフォルト付与）
3. `layout(model) -> layoutModel`（x/y/width/height計算）
4. `renderSvg(layoutModel) -> svgString`（DOM生成でも文字列でも可）
5. UI（textarea入力、デバウンス、右ペインに反映、エラー表示）

### 12.2 受入条件（最低ライン）

* 入力例がエラーなく描画される
* 年列が1990〜2026の縦スケールで表示される
* nodeの箱が指定列・指定日付位置に表示される
* bandが指定期間で帯として表示される
* connectorがnode間に線として表示される
* 入力更新でリアルタイムに追従する
* SVG保存ができる（最低：生成SVG文字列をダウンロード）

---

## 13. 今後の拡張

* コネクタの直交配線（マンハッタン配線）
