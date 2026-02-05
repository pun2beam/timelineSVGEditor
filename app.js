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
const saveDslButton = document.getElementById("save-dsl");
const loadDslButton = document.getElementById("load-dsl");
const dslFileInput = document.getElementById("dsl-file-input");
const mainLayout = document.querySelector("main");
const leftPane = document.querySelector(".pane.left");
const rightPane = document.querySelector(".pane.right");
const paneResizer = document.getElementById("pane-resizer");

let currentSvg = "";
let currentViewBox = null;
let leftPaneRatio = 0.4;

function debounce(fn, delay) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function setPaneWidths(leftWidth) {
  if (!mainLayout || !leftPane || !rightPane || !paneResizer) return;
  const mainRect = mainLayout.getBoundingClientRect();
  const resizerWidth = paneResizer.getBoundingClientRect().width || 6;
  const minLeft = 220;
  const minRight = 280;
  const maxLeft = mainRect.width - resizerWidth - minRight;
  const clampedLeft = clamp(leftWidth, minLeft, maxLeft);
  const rightWidth = Math.max(mainRect.width - resizerWidth - clampedLeft, minRight);
  leftPane.style.width = `${clampedLeft}px`;
  rightPane.style.width = `${rightWidth}px`;
  leftPaneRatio = clampedLeft / mainRect.width;
  paneResizer.setAttribute("aria-valuenow", Math.round(leftPaneRatio * 100).toString());
}

function initializePaneResizer() {
  if (!mainLayout || !leftPane || !rightPane || !paneResizer) return;
  let isResizing = false;

  const updateFromPointer = (event) => {
    if (!isResizing) return;
    const mainRect = mainLayout.getBoundingClientRect();
    const nextLeft = event.clientX - mainRect.left;
    setPaneWidths(nextLeft);
  };

  paneResizer.addEventListener("pointerdown", (event) => {
    isResizing = true;
    paneResizer.setPointerCapture(event.pointerId);
    document.body.classList.add("is-resizing");
  });

  paneResizer.addEventListener("pointermove", updateFromPointer);

  const stopResizing = (event) => {
    if (!isResizing) return;
    isResizing = false;
    paneResizer.releasePointerCapture(event.pointerId);
    document.body.classList.remove("is-resizing");
  };

  paneResizer.addEventListener("pointerup", stopResizing);
  paneResizer.addEventListener("pointercancel", stopResizing);

  window.addEventListener("resize", () => {
    const mainRect = mainLayout.getBoundingClientRect();
    setPaneWidths(mainRect.width * leftPaneRatio);
  });

  requestAnimationFrame(() => {
    const mainRect = mainLayout.getBoundingClientRect();
    setPaneWidths(mainRect.width * leftPaneRatio);
  });
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
    defaults: [],
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
      case "defaults":
        model.defaults.push({ ...block.entries, line: block.line });
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
  const defaults = {
    nodeBoxHeightPx: null,
  };
  const model = {
    columns: [],
    nodes: [],
    bands: [],
    connectors: [],
    meta: { errors, defaults },
  };

  raw.defaults.forEach((block) => {
    Object.entries(block).forEach(([key, value]) => {
      if (key === "line") return;
      if (key === "node.box.height") {
        const parsed = parseNumberWithUnit(value, block.line, errors, "node.box.height");
        defaults.nodeBoxHeightPx = parsed;
        return;
      }
      errors.push({
        line: block.line,
        message: `defaultsのキーが不明です: ${key}`,
      });
    });
  });

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
    let endRaw = null;
    let endDateValue = null;
    if (node.end) {
      endRaw = node.end.trim();
      if (endRaw !== "*") {
        const endParts = parseDateString(endRaw);
        if (!endParts) {
          errors.push({ line: node.line, message: "nodeのendが不正です" });
          return;
        }
        endDateValue = datePartsToValue(endParts);
        if (endDateValue === null) {
          errors.push({ line: node.line, message: "nodeのendが不正です" });
          return;
        }
      }
    }
    model.nodes.push({
      id: Number(node.id),
      columnId: Number(node.column),
      type: node.type,
      dateValue,
      endRaw,
      endDateValue,
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
    const missing = ["id", "column", "date", "text"].filter(
      (key) => !band[key],
    );
    if (missing.length) {
      errors.push({
        line: band.line,
        message: `bandに必須キーが不足しています: ${missing.join(", ")}`,
      });
      return;
    }
    const range = parseRange(band.date);
    if (!range) {
      errors.push({ line: band.line, message: "bandのdateが不正です" });
      return;
    }
    const startValue = datePartsToValue(range.start);
    const endParts = advanceToNextUnit(range.end);
    const endValue = datePartsToValue(endParts);
    if (startValue === null || endValue === null) {
      errors.push({ line: band.line, message: "bandのdateが不正です" });
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
  const defaultNodeBoxHeight = model.meta.defaults?.nodeBoxHeightPx ?? null;
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
      const effectiveDateValue =
        node.type === "box" && scaleColumn && node.dateValue < startYear
          ? startYear
          : node.dateValue;
      const y = DEFAULTS.topMargin + (effectiveDateValue - startYear) * rowHeight;
      const width = Math.max(column.widthPx - 8, 10);
      const height = node.type === "box" && defaultNodeBoxHeight !== null
        ? defaultNodeBoxHeight
        : rowHeight * 0.9;
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

  const nodeEndLines = nodes
    .filter((node) => node.type === "box" && node.endRaw)
    .map((node) => {
      if (!scaleColumn) return null;
      const endValue = node.endRaw === "*" ? endYear + 1 : node.endDateValue;
      if (endValue === null) return null;
      const x = node.x + node.width / 2;
      const startY = node.y + node.height / 2;
      const endY = DEFAULTS.topMargin + (endValue - startYear) * rowHeight;
      return {
        x1: x,
        y1: startY,
        x2: x,
        y2: endY,
        color: node.borderColor || DEFAULTS.connectorColor,
      };
    })
    .filter(Boolean);

  return {
    columns,
    nodes,
    bands,
    connectors,
    nodeEndLines,
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

function wrapTextByWidth(text, maxWidth, fontSize) {
  if (!text) return [""];
  const widthPerChar = fontSize * 0.9;
  const maxChars = Math.max(1, Math.floor(maxWidth / widthPerChar));
  const lines = [];
  let buffer = "";
  for (const char of text) {
    buffer += char;
    if (buffer.length >= maxChars) {
      lines.push(buffer);
      buffer = "";
    }
  }
  if (buffer) {
    lines.push(buffer);
  }
  return lines;
}

function splitNodeBoxText(text, maxWidth, fontSize) {
  if (!text) return { lines: [""], isTwoLine: false };
  const normalized = String(text);
  const hasEscapedNewline = normalized.includes("\\n");
  const segments = hasEscapedNewline ? normalized.split("\\n") : normalized.split(/\n/);
  if (segments.length > 1) {
    return {
      lines: [segments[0], segments.slice(1).join("")],
      isTwoLine: true,
    };
  }
  const widthPerChar = fontSize * 0.9;
  const maxChars = Math.max(1, Math.floor(maxWidth / widthPerChar));
  if (normalized.length > maxChars) {
    return {
      lines: [normalized.slice(0, maxChars), normalized.slice(maxChars)],
      isTwoLine: true,
    };
  }
  return { lines: [normalized], isTwoLine: false };
}

function renderSvg(layoutModel) {
  const {
    columns,
    nodes,
    bands,
    connectors,
    nodeEndLines,
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
      }" font-size="12" fill="${color}" text-anchor="middle" dominant-baseline="central" alignment-baseline="central" writing-mode="vertical-rl" text-orientation="upright">${truncateText(
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

  nodeEndLines.forEach((line) => {
    svgParts.push(
      `<line x1="${line.x1}" y1="${line.y1}" x2="${line.x2}" y2="${line.y2}" stroke="${line.color}" stroke-width="1" />`,
    );
  });

  nodes.forEach((node) => {
    const bgColor = node.bgColor || DEFAULTS.nodeBgColor;
    const borderColor = node.borderColor || DEFAULTS.nodeBorderColor;
    const fontSize = node.fontSize
      ? parseNumberWithUnit(node.fontSize, 0, [], "font") || DEFAULTS.fontSize
      : DEFAULTS.fontSize;
    if (node.type === "text") {
      const padding = node.padding
        ? parseNumberWithUnit(node.padding, 0, [], "padding") || DEFAULTS.nodePadding
        : DEFAULTS.nodePadding;
      const maxTextWidth = Math.max(node.width - padding * 2, 10);
      const lines = wrapTextByWidth(node.text, maxTextWidth, fontSize);
      const lineHeight = fontSize * 1.2;
      const textStartY = node.y + padding;
      const textX = node.x + padding;
      svgParts.push(
        `<text x="${textX}" y="${textStartY}" text-anchor="start" dominant-baseline="hanging" font-size="${fontSize}" fill="${
          node.color || "#111"
        }">`,
      );
      lines.forEach((line, index) => {
        const dy = index === 0 ? 0 : lineHeight;
        svgParts.push(`<tspan x="${textX}" dy="${dy}">${line}</tspan>`);
      });
      svgParts.push(`</text>`);
    } else {
      svgParts.push(
        `<rect x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}" rx="4" fill="${bgColor}" stroke="${borderColor}" />`,
      );
      const padding = DEFAULTS.nodePadding;
      const maxTextWidth = Math.max(node.width - padding * 2, 10);
      const { lines, isTwoLine } = splitNodeBoxText(node.text, maxTextWidth, fontSize);
      const centerX = node.x + node.width / 2;
      const centerY = node.y + node.height / 2;
      const lineHeight = fontSize * 1.2;
      if (isTwoLine) {
        const textStartY = centerY - lineHeight;
        svgParts.push(
          `<text x="${centerX}" y="${textStartY}" text-anchor="middle" dominant-baseline="hanging" font-size="${fontSize}" fill="${
            node.color || "#111"
          }">`,
        );
        lines.forEach((line, index) => {
          const dy = index === 0 ? 0 : lineHeight;
          svgParts.push(`<tspan x="${centerX}" dy="${dy}">${line}</tspan>`);
        });
        svgParts.push(`</text>`);
      } else {
        svgParts.push(
          `<text x="${centerX}" y="${centerY}" text-anchor="middle" dominant-baseline="middle" font-size="${fontSize}" fill="${
            node.color || "#111"
          }">${lines[0]}</text>`,
        );
      }
    }
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
  initializePaneResizer();
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

saveDslButton.addEventListener("click", () => {
  const blob = new Blob([dslInput.value], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "timeline.dsl";
  link.click();
  URL.revokeObjectURL(url);
});

loadDslButton.addEventListener("click", () => {
  dslFileInput.click();
});

dslFileInput.addEventListener("change", async (event) => {
  const [file] = event.target.files || [];
  if (!file) return;
  try {
    dslInput.value = await file.text();
    render();
  } finally {
    event.target.value = "";
  }
});

init();
