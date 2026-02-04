const DEFAULTS = {
  topMargin: 20,
  leftMargin: 10,
  rowHeight: 20,
  fontSize: 12,
  nodePadding: 4,
  nodeBgColor: "#ffffff",
  nodeBorderColor: "#333333",
  connectorColor: "#333333",
  bandColor: "#ffffff",
  bandBgColor: "#6666aa",
};

const dslInput = document.getElementById("dsl-input");
const errorArea = document.getElementById("error-area");
const errorBanner = document.getElementById("error-banner");
const svgContainer = document.getElementById("svg-container");
const downloadButton = document.getElementById("download-svg");

let currentSvg = "";
let currentViewBox = null;

function debounce(fn, delay) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

function parseDsl(text) {
  const lines = text.split(/\r?\n/);
  const blocks = [];
  const errors = [];
  let current = null;

  lines.forEach((line, index) => {
    const lineNumber = index + 1;
    if (!line.trim()) {
      return;
    }
    const blockMatch = line.match(/^(\w+):\s*$/);
    if (blockMatch) {
      current = { type: blockMatch[1], entries: {}, line: lineNumber };
      blocks.push(current);
      return;
    }

    const entryMatch = line.match(/^\s+([^:]+):(.*)$/);
    if (entryMatch) {
      if (!current) {
        errors.push({ line: lineNumber, message: "ブロック開始行がありません" });
        return;
      }
      const key = entryMatch[1].trim();
      const value = entryMatch[2].trim();
      current.entries[key] = value;
      return;
    }

    errors.push({ line: lineNumber, message: "解析できない行です" });
  });

  const model = {
    columns: [],
    nodes: [],
    bands: [],
    connectors: [],
  };

  blocks.forEach((block) => {
    switch (block.type) {
      case "column":
        model.columns.push({ ...block.entries, line: block.line });
        break;
      case "node":
        model.nodes.push({ ...block.entries, line: block.line });
        break;
      case "band":
        model.bands.push({ ...block.entries, line: block.line });
        break;
      case "connector":
        model.connectors.push({ ...block.entries, line: block.line });
        break;
      default:
        errors.push({ line: block.line, message: `未知のブロック種別: ${block.type}` });
    }
  });

  return { model, errors };
}

function parseNumberWithUnit(value, line, errors, label) {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  const match = trimmed.match(/^(-?\d+(?:\.\d+)?)(pt|px)?$/);
  if (!match) {
    errors.push({ line, message: `${label}の値が不正です: ${value}` });
    return null;
  }
  const numeric = Number(match[1]);
  const unit = match[2] || "px";
  const px = unit === "pt" ? numeric * 1.333 : numeric;
  return px;
}

function parseDateString(raw) {
  if (!raw) return null;
  const trimmed = raw.trim();

  let match = trimmed.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (match) {
    return {
      year: Number(match[1]),
      month: Number(match[2]),
      day: Number(match[3]),
      granularity: "day",
    };
  }
  match = trimmed.match(/^(\d{4})(?:\.(\d{1,2}))?(?:\.(\d{1,2}))?$/);
  if (match) {
    const year = Number(match[1]);
    const month = match[2] ? Number(match[2]) : 1;
    const day = match[3] ? Number(match[3]) : 1;
    const granularity = match[3]
      ? "day"
      : match[2]
        ? "month"
        : "year";
    return { year, month, day, granularity };
  }
  match = trimmed.match(/^(\d{4})$/);
  if (match) {
    return { year: Number(match[1]), month: 1, day: 1, granularity: "year" };
  }
  return null;
}

function datePartsToValue(parts) {
  const { year, month, day } = parts;
  const date = new Date(year, month - 1, day);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  const start = new Date(year, 0, 1);
  const end = new Date(year + 1, 0, 1);
  const dayOfYear = (date - start) / (24 * 60 * 60 * 1000);
  const yearLength = (end - start) / (24 * 60 * 60 * 1000);
  return year + dayOfYear / yearLength;
}

function advanceToNextUnit(parts) {
  const { year, month, day, granularity } = parts;
  if (granularity === "year") {
    return { year: year + 1, month: 1, day: 1, granularity: "year" };
  }
  if (granularity === "month") {
    if (month === 12) {
      return { year: year + 1, month: 1, day: 1, granularity: "month" };
    }
    return { year, month: month + 1, day: 1, granularity: "month" };
  }
  const date = new Date(year, month - 1, day);
  date.setDate(date.getDate() + 1);
  return {
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    day: date.getDate(),
    granularity: "day",
  };
}

function parseRange(value) {
  const trimmed = value.trim();
  const splitIndices = [];
  for (let i = 0; i < trimmed.length; i += 1) {
    if (trimmed[i] === "-") {
      splitIndices.push(i);
    }
  }
  for (const index of splitIndices) {
    const left = trimmed.slice(0, index).trim();
    const right = trimmed.slice(index + 1).trim();
    if (!left || !right) continue;
    const start = parseDateString(left);
    const end = parseDateString(right);
    if (start && end) {
      return { start, end };
    }
  }
  return null;
}

function normalizeModel(raw, parseErrors) {
  const errors = [...parseErrors];
  const model = {
    columns: [],
    nodes: [],
    bands: [],
    connectors: [],
    meta: { errors },
  };

  let columnCounter = 1;
  raw.columns.forEach((column) => {
    const id = column.id ? Number(column.id) : columnCounter;
    columnCounter = Math.max(columnCounter, id + 1);
    if (!column.type || !column.width) {
      errors.push({
        line: column.line,
        message: "columnにはtypeとwidthが必要です",
      });
      return;
    }
    const widthPx = parseNumberWithUnit(column.width, column.line, errors, "width");
    const rowHeightPx = column.rowheight
      ? parseNumberWithUnit(column.rowheight, column.line, errors, "rowheight")
      : DEFAULTS.rowHeight;
    let period = null;
    if (column.type === "year") {
      if (!column.period) {
        errors.push({ line: column.line, message: "year列にはperiodが必要です" });
      } else {
        const range = parseRange(column.period);
        if (!range) {
          errors.push({ line: column.line, message: "periodの形式が不正です" });
        } else {
          period = {
            startYear: range.start.year,
            endYear: range.end.year,
          };
        }
      }
    }
    if (widthPx === null) return;

    model.columns.push({
      id,
      type: column.type,
      widthPx,
      rowHeightPx,
      period,
    });
  });

  raw.nodes.forEach((node) => {
    const missing = ["id", "column", "type", "date", "text"].filter(
      (key) => !node[key],
    );
    if (missing.length) {
      errors.push({
        line: node.line,
        message: `nodeに必須キーが不足しています: ${missing.join(", ")}`,
      });
      return;
    }
    const dateParts = parseDateString(node.date);
    if (!dateParts) {
      errors.push({ line: node.line, message: "nodeのdateが不正です" });
      return;
    }
    const dateValue = datePartsToValue(dateParts);
    if (dateValue === null) {
      errors.push({ line: node.line, message: "nodeのdateが不正です" });
      return;
    }
    model.nodes.push({
      id: Number(node.id),
      columnId: Number(node.column),
      type: node.type,
      dateValue,
      text: node.text,
      color: node.color,
      bgColor: node.bgcolor,
      borderColor: node.bordercolor,
      fontSize: node.fontsize,
      padding: node.padding,
      align: node.align,
    });
  });

  raw.bands.forEach((band) => {
    const missing = ["id", "column", "year", "text"].filter(
      (key) => !band[key],
    );
    if (missing.length) {
      errors.push({
        line: band.line,
        message: `bandに必須キーが不足しています: ${missing.join(", ")}`,
      });
      return;
    }
    const range = parseRange(band.year);
    if (!range) {
      errors.push({ line: band.line, message: "bandのyearが不正です" });
      return;
    }
    const startValue = datePartsToValue(range.start);
    const endParts = advanceToNextUnit(range.end);
    const endValue = datePartsToValue(endParts);
    if (startValue === null || endValue === null) {
      errors.push({ line: band.line, message: "bandのyearが不正です" });
      return;
    }
    model.bands.push({
      id: Number(band.id),
      columnId: Number(band.column),
      startDateValue: startValue,
      endDateValue: endValue,
      text: band.text,
      color: band.color,
      bgColor: band.bgcolor,
    });
  });

  raw.connectors.forEach((connector) => {
    if (!connector.id || !connector.node) {
      errors.push({ line: connector.line, message: "connectorにidとnodeが必要です" });
      return;
    }
    const nodeIds = connector.node
      .split(",")
      .map((value) => Number(value.trim()))
      .filter((value) => !Number.isNaN(value));
    if (nodeIds.length < 2) {
      errors.push({
        line: connector.line,
        message: "connectorのnodeは2つ以上必要です",
      });
      return;
    }
    model.connectors.push({
      id: Number(connector.id),
      nodeIds,
      style: connector.style,
      color: connector.color,
      width: connector.width,
    });
  });

  return model;
}

function layout(model) {
  const errors = model.meta.errors;
  const scaleColumn = model.columns.find(
    (column) => column.type === "year" && column.period,
  );
  if (!scaleColumn) {
    errors.push({ line: 0, message: "年表示列が見つかりません" });
  }

  let xCursor = DEFAULTS.leftMargin;
  const columns = model.columns.map((column) => {
    const xStart = xCursor;
    const xCenter = xStart + column.widthPx / 2;
    xCursor += column.widthPx;
    return { ...column, xStart, xCenter };
  });

  const rowHeight = scaleColumn ? scaleColumn.rowHeightPx : DEFAULTS.rowHeight;
  const startYear = scaleColumn ? scaleColumn.period.startYear : 0;
  const endYear = scaleColumn ? scaleColumn.period.endYear : 0;

  const totalYears = endYear - startYear + 1;
  const svgWidth = xCursor + DEFAULTS.leftMargin;
  const svgHeight = DEFAULTS.topMargin + totalYears * rowHeight + DEFAULTS.topMargin;

  const yearLines = [];
  if (scaleColumn) {
    for (let year = startYear; year <= endYear; year += 1) {
      const y = DEFAULTS.topMargin + (year - startYear) * rowHeight;
      yearLines.push({ year, y });
    }
  }

  const columnMap = new Map(columns.map((col) => [col.id, col]));

  const nodes = model.nodes
    .map((node) => {
      const column = columnMap.get(node.columnId);
      if (!column) {
        errors.push({
          line: 0,
          message: `node ${node.id} のcolumn参照が不正です`,
        });
        return null;
      }
      const y = DEFAULTS.topMargin + (node.dateValue - startYear) * rowHeight;
      const width = Math.max(column.widthPx - 8, 10);
      const height = rowHeight * 0.9;
      return {
        ...node,
        x: column.xCenter - width / 2,
        y,
        width,
        height,
      };
    })
    .filter(Boolean);

  const bands = model.bands
    .map((band) => {
      const column = columnMap.get(band.columnId);
      if (!column) {
        errors.push({ line: 0, message: `band ${band.id} のcolumn参照が不正です` });
        return null;
      }
      const yStart =
        DEFAULTS.topMargin + (band.startDateValue - startYear) * rowHeight;
      const yEnd =
        DEFAULTS.topMargin + (band.endDateValue - startYear) * rowHeight;
      const padding = 2;
      return {
        ...band,
        x: column.xStart + padding,
        y: yStart,
        width: Math.max(column.widthPx - padding * 2, 4),
        height: Math.max(yEnd - yStart, rowHeight * 0.2),
      };
    })
    .filter(Boolean);

  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  const connectors = model.connectors.map((connector) => {
    const points = connector.nodeIds
      .map((id) => ({ id, node: nodeMap.get(id) }))
      .map((entry) => {
        if (!entry.node) {
          errors.push({
            line: 0,
            message: `connector ${connector.id} のnode参照が不正です`,
          });
          return null;
        }
        return {
          x: entry.node.x + entry.node.width / 2,
          y: entry.node.y + entry.node.height / 2,
        };
      })
      .filter(Boolean);
    return { ...connector, points };
  });

  return {
    columns,
    nodes,
    bands,
    connectors,
    yearLines,
    svgWidth,
    svgHeight,
    rowHeight,
    startYear,
    endYear,
    errors,
  };
}

function truncateText(text, maxLength = 18) {
  if (!text) return "";
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}...`;
}

function renderSvg(layoutModel) {
  const {
    columns,
    nodes,
    bands,
    connectors,
    yearLines,
    svgWidth,
    svgHeight,
    errors,
  } = layoutModel;

  if (errors.length && !columns.length) {
    return "";
  }

  const svgParts = [];
  svgParts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${svgWidth}" height="${svgHeight}" viewBox="0 0 ${svgWidth} ${svgHeight}">`,
  );
  svgParts.push(`<g id="timeline-root">`);

  if (yearLines.length) {
    yearLines.forEach((line) => {
      svgParts.push(
        `<line x1="0" y1="${line.y}" x2="${svgWidth}" y2="${line.y}" stroke="#e5e7eb" stroke-width="1" />`,
      );
    });
  }

  bands.forEach((band) => {
    const bgColor = band.bgColor || DEFAULTS.bandBgColor;
    const color = band.color || DEFAULTS.bandColor;
    svgParts.push(
      `<rect x="${band.x}" y="${band.y}" width="${band.width}" height="${band.height}" fill="${bgColor}" rx="4" />`,
    );
    svgParts.push(
      `<text x="${band.x + band.width / 2}" y="${
        band.y + band.height / 2
      }" font-size="12" fill="${color}" text-anchor="middle" dominant-baseline="middle" writing-mode="vertical-rl" text-orientation="upright">${truncateText(
        band.text,
      )}</text>`,
    );
  });

  connectors.forEach((connector) => {
    const color = connector.color || DEFAULTS.connectorColor;
    const width = connector.width ? parseNumberWithUnit(connector.width, 0, [], "") : 1;
    if (connector.points.length >= 2) {
      const [origin, ...targets] = connector.points;
      targets.forEach((target) => {
        svgParts.push(
          `<line x1="${origin.x}" y1="${origin.y}" x2="${target.x}" y2="${target.y}" stroke="${color}" stroke-width="${width}" />`,
        );
      });
    }
  });

  nodes.forEach((node) => {
    const bgColor = node.bgColor || DEFAULTS.nodeBgColor;
    const borderColor = node.borderColor || DEFAULTS.nodeBorderColor;
    const fontSize = node.fontSize
      ? parseNumberWithUnit(node.fontSize, 0, [], "font") || DEFAULTS.fontSize
      : DEFAULTS.fontSize;
    svgParts.push(
      `<rect x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}" rx="4" fill="${bgColor}" stroke="${borderColor}" />`,
    );
    svgParts.push(
      `<text x="${node.x + node.width / 2}" y="${node.y + node.height / 2}" text-anchor="middle" dominant-baseline="middle" font-size="${fontSize}" fill="${
        node.color || "#111"
      }">${truncateText(node.text)}</text>`,
    );
  });

  columns.forEach((column) => {
    if (column.type !== "year") return;
    yearLines.forEach((line) => {
      svgParts.push(
        `<text x="${column.xCenter}" y="${line.y + 12}" text-anchor="middle" font-size="12" fill="#6b7280">${line.year}</text>`,
      );
    });
  });

  svgParts.push(`</g></svg>`);
  return svgParts.join("");
}

function updateErrors(errors) {
  if (!errors.length) {
    errorArea.innerHTML = "";
    errorBanner.hidden = true;
    return;
  }
  const listItems = errors.map(
    (error) => `<li>Line ${error.line || "?"}: ${error.message}</li>`,
  );
  errorArea.innerHTML = `<div>エラー:</div><ul>${listItems.join("")}</ul>`;
  errorBanner.hidden = false;
  errorBanner.textContent = "エラーがあります。前回の描画を保持しています。";
}

function attachPanZoom(svgElement) {
  let isDragging = false;
  let lastPosition = null;

  svgElement.addEventListener("wheel", (event) => {
    if (!event.ctrlKey) return;
    event.preventDefault();
    const viewBox = svgElement.viewBox.baseVal;
    const scaleFactor = event.deltaY > 0 ? 1.1 : 0.9;
    const newWidth = viewBox.width * scaleFactor;
    const newHeight = viewBox.height * scaleFactor;
    viewBox.x += (viewBox.width - newWidth) / 2;
    viewBox.y += (viewBox.height - newHeight) / 2;
    viewBox.width = newWidth;
    viewBox.height = newHeight;
    currentViewBox = {
      x: viewBox.x,
      y: viewBox.y,
      width: viewBox.width,
      height: viewBox.height,
    };
  });

  svgElement.addEventListener("mousedown", (event) => {
    isDragging = true;
    lastPosition = { x: event.clientX, y: event.clientY };
  });

  svgElement.addEventListener("mousemove", (event) => {
    if (!isDragging) return;
    const viewBox = svgElement.viewBox.baseVal;
    const dx = ((event.clientX - lastPosition.x) / svgElement.clientWidth) * viewBox.width;
    const dy = ((event.clientY - lastPosition.y) / svgElement.clientHeight) * viewBox.height;
    viewBox.x -= dx;
    viewBox.y -= dy;
    lastPosition = { x: event.clientX, y: event.clientY };
    currentViewBox = {
      x: viewBox.x,
      y: viewBox.y,
      width: viewBox.width,
      height: viewBox.height,
    };
  });

  const endDrag = () => {
    isDragging = false;
    lastPosition = null;
  };

  svgElement.addEventListener("mouseup", endDrag);
  svgElement.addEventListener("mouseleave", endDrag);
}

function render() {
  const { model, errors: parseErrors } = parseDsl(dslInput.value);
  const normalized = normalizeModel(model, parseErrors);
  const layoutModel = layout(normalized);

  updateErrors(layoutModel.errors);

  const nextSvg = renderSvg(layoutModel);
  if (!layoutModel.errors.length || currentSvg === "") {
    currentSvg = nextSvg;
  }

  if (currentSvg) {
    svgContainer.innerHTML = currentSvg;
    const svgElement = svgContainer.querySelector("svg");
    if (svgElement) {
      if (currentViewBox) {
        svgElement.setAttribute(
          "viewBox",
          `${currentViewBox.x} ${currentViewBox.y} ${currentViewBox.width} ${currentViewBox.height}`,
        );
      }
      attachPanZoom(svgElement);
    }
  }
}

const debouncedRender = debounce(render, 200);

async function loadExampleDsl() {
  const response = await fetch("example.txt");
  if (!response.ok) {
    throw new Error(`example.txtの取得に失敗しました: ${response.status}`);
  }
  return response.text();
}

async function init() {
  try {
    dslInput.value = await loadExampleDsl();
  } catch (error) {
    updateErrors([
      {
        line: null,
        message: error instanceof Error ? error.message : "example.txtの読み込みに失敗しました",
      },
    ]);
  }
  render();
}

dslInput.addEventListener("input", debouncedRender);

downloadButton.addEventListener("click", () => {
  if (!currentSvg) return;
  const blob = new Blob([currentSvg], { type: "image/svg+xml" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "timeline.svg";
  link.click();
  URL.revokeObjectURL(url);
});

init();
