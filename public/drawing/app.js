(() => {
  'use strict';

  const canvas = document.getElementById('drawingCanvas');
  const previewCanvas = document.getElementById('previewCanvas');
  const frame = document.getElementById('canvasFrame');
  const baseCtx = canvas.getContext('2d', { willReadFrequently: true });
  const previewCtx = previewCanvas.getContext('2d');

  const toolButtons = [...document.querySelectorAll('[data-tool]')];
  const colorButtons = [...document.querySelectorAll('[data-color]')];
  const customColor = document.getElementById('customColor');
  const currentColorSwatch = document.getElementById('currentColorSwatch');
  const currentColorValue = document.getElementById('currentColorValue');
  const brushSizeInput = document.getElementById('brushSize');
  const eraserSizeInput = document.getElementById('eraserSize');
  const brushSizeValue = document.getElementById('brushSizeValue');
  const eraserSizeValue = document.getElementById('eraserSizeValue');
  const clearButton = document.getElementById('clearButton');
  const undoButton = document.getElementById('undoButton');
  const redoButton = document.getElementById('redoButton');
  const toolHint = document.getElementById('toolHint');
  const emptyHint = document.getElementById('emptyHint');
  const toast = document.getElementById('toast');

  let logicalWidth = 0;
  let logicalHeight = 0;
  let pixelRatio = 1;
  let activeTool = 'brush';
  let currentColor = '#1f2937';
  let brushSize = Number(brushSizeInput.value);
  let eraserSize = Number(eraserSizeInput.value);
  let strokes = [];
  const knownStrokeIds = new Set();
  let undone = [];
  let activeStroke = null;
  let activePointerId = null;
  let sentPointCount = 0;
  const remoteActive = new Map();
  let toastHandle = null;

  const toolCopy = {
    brush: { hint: 'Nhấn giữ và kéo chuột để vẽ.' },
    eraser: { hint: 'Kéo qua phần muốn xóa. Kích thước tẩy được chỉnh riêng.' },
    eyedropper: { hint: 'Nhấn lên nét vẽ trên Canvas để lấy màu đó.' },
  };

  function makeId() {
    if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') {
      return globalThis.crypto.randomUUID();
    }
    return `stroke-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
  }

  function cloneStroke(stroke) {
    return {
      id: stroke.id,
      tool: stroke.tool,
      color: stroke.color,
      size: stroke.size,
      points: stroke.points.map(point => ({ x: point.x, y: point.y })),
    };
  }

  function showToast(message) {
    toast.textContent = message;
    toast.classList.add('show');
    if (toastHandle) clearTimeout(toastHandle);
    toastHandle = setTimeout(() => toast.classList.remove('show'), 1900);
  }

  function updateCanvasInfo() {
    emptyHint.classList.toggle('hidden', strokes.length > 0 || Boolean(activeStroke));
    updateHistoryButtons();
  }

  function updateHistoryButtons() {
    if (undoButton) undoButton.disabled = strokes.length === 0 && !activeStroke;
    if (redoButton) redoButton.disabled = undone.length === 0;
  }

  function setContextScale(context) {
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    context.lineCap = 'round';
    context.lineJoin = 'round';
  }

  function pointToCanvas(point) {
    return { x: point.x * logicalWidth, y: point.y * logicalHeight };
  }

  function renderStroke(context, stroke) {
    if (!stroke || !Array.isArray(stroke.points) || stroke.points.length === 0) return;
    const points = stroke.points.map(pointToCanvas);
    const lineWidth = Math.max(0.75, (Number(stroke.size) || 0.006) * logicalWidth);

    context.save();
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.lineWidth = lineWidth;
    context.strokeStyle = stroke.color || '#1f2937';
    context.fillStyle = stroke.color || '#1f2937';

    if (points.length === 1) {
      context.beginPath();
      context.arc(points[0].x, points[0].y, lineWidth / 2, 0, Math.PI * 2);
      context.fill();
      context.restore();
      return;
    }

    context.beginPath();
    context.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length - 1; i += 1) {
      const current = points[i];
      const next = points[i + 1];
      const midX = (current.x + next.x) / 2;
      const midY = (current.y + next.y) / 2;
      context.quadraticCurveTo(current.x, current.y, midX, midY);
    }
    const last = points[points.length - 1];
    context.lineTo(last.x, last.y);
    context.stroke();
    context.restore();
  }

  /** Vẽ thêm các điểm mới của nét (dùng cho đồng bộ trực tiếp). */
  function renderStrokeTail(context, stroke, fromIndex) {
    const pts = stroke.points;
    if (!Array.isArray(pts) || pts.length === 0) return;
    if (fromIndex <= 0) return renderStroke(context, stroke);
    const start = Math.max(0, fromIndex - 1);
    const lineWidth = Math.max(0.75, (Number(stroke.size) || 0.006) * logicalWidth);
    context.save();
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.lineWidth = lineWidth;
    context.strokeStyle = stroke.color || '#1f2937';
    context.fillStyle = stroke.color || '#1f2937';
    const a = pointToCanvas(pts[start]);
    context.beginPath();
    context.moveTo(a.x, a.y);
    for (let i = start + 1; i < pts.length; i += 1) {
      const p = pointToCanvas(pts[i]);
      context.lineTo(p.x, p.y);
    }
    context.stroke();
    if (pts.length === start + 1) {
      context.beginPath();
      context.arc(a.x, a.y, lineWidth / 2, 0, Math.PI * 2);
      context.fill();
    }
    context.restore();
  }

  function paintBase() {
    if (!logicalWidth || !logicalHeight) return;
    setContextScale(baseCtx);
    baseCtx.clearRect(0, 0, logicalWidth, logicalHeight);
    baseCtx.fillStyle = '#ffffff';
    baseCtx.fillRect(0, 0, logicalWidth, logicalHeight);
    for (const stroke of strokes) renderStroke(baseCtx, stroke);
  }

  function paintPreview() {
    if (!logicalWidth || !logicalHeight) return;
    setContextScale(previewCtx);
    previewCtx.clearRect(0, 0, logicalWidth, logicalHeight);
    if (activeStroke) renderStroke(previewCtx, activeStroke);
  }

  function resizeCanvases() {
    const rect = previewCanvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;

    logicalWidth = rect.width;
    logicalHeight = rect.height;
    pixelRatio = Math.max(1, window.devicePixelRatio || 1);

    const backingWidth = Math.max(1, Math.round(logicalWidth * pixelRatio));
    const backingHeight = Math.max(1, Math.round(logicalHeight * pixelRatio));
    for (const target of [canvas, previewCanvas]) {
      if (target.width !== backingWidth || target.height !== backingHeight) {
        target.width = backingWidth;
        target.height = backingHeight;
      }
    }
    paintBase();
    paintPreview();
    updateCanvasInfo();
  }

  function normalizedPoint(event) {
    const rect = previewCanvas.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)),
    };
  }

  function isFarEnough(a, b) {
    const dx = (a.x - b.x) * logicalWidth;
    const dy = (a.y - b.y) * logicalHeight;
    return Math.hypot(dx, dy) >= 0.4;
  }

  function setTool(tool) {
    if (!toolCopy[tool]) return;
    activeTool = tool;
    for (const button of toolButtons) {
      const selected = button.dataset.tool === tool;
      button.classList.toggle('active', selected);
      button.setAttribute('aria-pressed', String(selected));
    }
    frame.dataset.tool = tool;
    toolHint.textContent = toolCopy[tool].hint;
  }

  function setColor(color) {
    currentColor = color.toLowerCase();
    currentColorSwatch.style.background = currentColor;
    currentColorValue.textContent = currentColor.toUpperCase();
    customColor.value = currentColor;
    for (const button of colorButtons) {
      const selected = button.dataset.color.toLowerCase() === currentColor;
      button.classList.toggle('selected', selected);
      button.setAttribute('aria-pressed', String(selected));
    }
  }

  function updateSizeLabels() {
    brushSizeValue.textContent = `${brushSize} px`;
    eraserSizeValue.textContent = `${eraserSize} px`;
  }

  function pickColor(event) {
    const rect = canvas.getBoundingClientRect();
    const xCss = Math.min(rect.width - 1, Math.max(0, event.clientX - rect.left));
    const yCss = Math.min(rect.height - 1, Math.max(0, event.clientY - rect.top));
    const px = Math.min(canvas.width - 1, Math.max(0, Math.floor(xCss * canvas.width / rect.width)));
    const py = Math.min(canvas.height - 1, Math.max(0, Math.floor(yCss * canvas.height / rect.height)));
    try {
      const rgba = baseCtx.getImageData(px, py, 1, 1).data;
      const hex = [rgba[0], rgba[1], rgba[2]].map(value => value.toString(16).padStart(2, '0')).join('');
      setColor(`#${hex}`);
      setTool('brush');
      showToast(`Đã lấy màu #${hex.toUpperCase()}`);
    } catch (error) {
      console.error('Không thể lấy màu từ Canvas:', error);
      showToast('Không thể lấy màu ở vị trí này.');
    }
  }

  function emitStrokeStart(stroke) {
    window.dispatchEvent(new CustomEvent('drawing:stroke-start', { detail: cloneStroke(stroke) }));
  }
  function emitStrokePoints(id, points) {
    if (!points.length) return;
    window.dispatchEvent(new CustomEvent('drawing:stroke-points', {
      detail: { id, points: points.map(p => ({ x: p.x, y: p.y })) },
    }));
  }
  function emitStrokeEnd(id) {
    window.dispatchEvent(new CustomEvent('drawing:stroke-end', { detail: { id } }));
  }

  function startStroke(event) {
    if (event.button !== undefined && event.button !== 0) return;
    if (activeTool === 'eyedropper') {
      pickColor(event);
      return;
    }
    if (!logicalWidth || !logicalHeight || activeStroke) return;

    event.preventDefault();
    activePointerId = event.pointerId;
    previewCanvas.setPointerCapture?.(event.pointerId);
    const isEraser = activeTool === 'eraser';
    const chosenSize = isEraser ? eraserSize : brushSize;
    activeStroke = {
      id: makeId(),
      tool: isEraser ? 'eraser' : 'brush',
      color: isEraser ? '#ffffff' : currentColor,
      size: chosenSize / logicalWidth,
      points: [normalizedPoint(event)],
    };
    sentPointCount = 1;
    emitStrokeStart(activeStroke);
    paintPreview();
    emptyHint.classList.add('hidden');
    updateHistoryButtons();
  }

  function moveStroke(event) {
    if (!activeStroke || event.pointerId !== activePointerId) return;
    event.preventDefault();
    const incoming = typeof event.getCoalescedEvents === 'function' ? event.getCoalescedEvents() : [event];
    const events = incoming && incoming.length ? incoming : [event];
    const fresh = [];
    for (const item of events) {
      const point = normalizedPoint(item);
      const last = activeStroke.points[activeStroke.points.length - 1];
      if (isFarEnough(point, last)) {
        activeStroke.points.push(point);
        fresh.push(point);
      }
    }
    if (fresh.length) {
      // Đồng bộ NGAY trong lúc kéo, không chờ thả chuột.
      emitStrokePoints(activeStroke.id, fresh);
      sentPointCount = activeStroke.points.length;
      paintPreview();
    }
  }

  function finishStroke(event) {
    if (!activeStroke || (event && event.pointerId !== undefined && event.pointerId !== activePointerId)) return;
    if (event && Number.isFinite(event.clientX) && Number.isFinite(event.clientY)) {
      const finalPoint = normalizedPoint(event);
      const last = activeStroke.points[activeStroke.points.length - 1];
      if (last && isFarEnough(finalPoint, last)) {
        activeStroke.points.push(finalPoint);
        emitStrokePoints(activeStroke.id, [finalPoint]);
      }
    }

    const completed = activeStroke;
    activeStroke = null;
    activePointerId = null;
    if (completed.points.length > 0 && !knownStrokeIds.has(completed.id)) {
      strokes.push(completed);
      knownStrokeIds.add(completed.id);
      undone = [];
      paintBase();
      paintPreview();
      updateCanvasInfo();
      emitStrokeEnd(completed.id);
    } else {
      paintPreview();
    }
  }

  function undo() {
    if (activeStroke) finishStroke();
    const stroke = strokes.pop();
    if (!stroke) {
      showToast('Không còn nét nào để hoàn tác.');
      return;
    }
    undone.push(stroke);
    knownStrokeIds.delete(stroke.id);
    remoteActive.delete(stroke.id);
    paintBase();
    paintPreview();
    updateCanvasInfo();
    window.dispatchEvent(new CustomEvent('drawing:undo', { detail: { id: stroke.id } }));
  }

  function redo() {
    const stroke = undone.pop();
    if (!stroke) {
      showToast('Không còn nét nào để làm lại.');
      return;
    }
    strokes.push(stroke);
    knownStrokeIds.add(stroke.id);
    paintBase();
    paintPreview();
    updateCanvasInfo();
    window.dispatchEvent(new CustomEvent('drawing:redo', { detail: { stroke: cloneStroke(stroke) } }));
  }

  function resetCanvas() {
    activeStroke = null;
    activePointerId = null;
    strokes = [];
    undone = [];
    knownStrokeIds.clear();
    remoteActive.clear();
    paintBase();
    paintPreview();
    updateCanvasInfo();
  }

  function clearCanvas(broadcast) {
    resetCanvas();
    if (broadcast) {
      window.dispatchEvent(new CustomEvent('drawing:clear', { detail: { at: Date.now() } }));
    }
  }

  function applyRemoteStroke(stroke) {
    if (!stroke || typeof stroke !== 'object' || !Array.isArray(stroke.points) || stroke.points.length === 0) return false;
    if (stroke.id && knownStrokeIds.has(stroke.id)) return false;
    const safePoints = stroke.points
      .filter(point => point && Number.isFinite(point.x) && Number.isFinite(point.y))
      .map(point => ({ x: Math.min(1, Math.max(0, point.x)), y: Math.min(1, Math.max(0, point.y)) }));
    if (!safePoints.length) return false;

    const safeStroke = {
      id: typeof stroke.id === 'string' ? stroke.id : makeId(),
      tool: stroke.tool === 'eraser' ? 'eraser' : 'brush',
      color: typeof stroke.color === 'string' && /^#[0-9a-f]{6}$/i.test(stroke.color) ? stroke.color : '#1f2937',
      size: Number.isFinite(stroke.size) && stroke.size > 0 ? Math.min(0.5, stroke.size) : 0.006,
      points: safePoints,
    };
    if (knownStrokeIds.has(safeStroke.id)) return false;
    strokes.push(safeStroke);
    knownStrokeIds.add(safeStroke.id);
    renderStroke(baseCtx, safeStroke);
    updateCanvasInfo();
    return true;
  }

  /** Bắt đầu nét từ xa: thêm vào danh sách và vẽ ngay điểm đầu. */
  function beginRemoteStroke(stroke) {
    if (!stroke || typeof stroke !== 'object' || !Array.isArray(stroke.points) || stroke.points.length === 0) return false;
    if (knownStrokeIds.has(stroke.id)) return false;
    const safe = {
      id: typeof stroke.id === 'string' ? stroke.id : makeId(),
      tool: stroke.tool === 'eraser' ? 'eraser' : 'brush',
      color: typeof stroke.color === 'string' && /^#[0-9a-f]{6}$/i.test(stroke.color) ? stroke.color : '#1f2937',
      size: Number.isFinite(stroke.size) && stroke.size > 0 ? Math.min(0.5, stroke.size) : 0.006,
      points: [{ x: stroke.points[0].x, y: stroke.points[0].y }],
    };
    strokes.push(safe);
    knownStrokeIds.add(safe.id);
    remoteActive.set(safe.id, safe);
    renderStroke(baseCtx, safe);
    updateCanvasInfo();
    return true;
  }

  function appendRemotePoints(id, points) {
    if (!Array.isArray(points) || !points.length) return false;
    const stroke = remoteActive.get(id);
    if (!stroke) return false;
    const from = stroke.points.length;
    for (const p of points) {
      if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
      stroke.points.push({ x: Math.min(1, Math.max(0, p.x)), y: Math.min(1, Math.max(0, p.y)) });
    }
    if (stroke.points.length === from) return false;
    renderStrokeTail(baseCtx, stroke, from);
    return true;
  }

  function endRemoteStroke(id) {
    remoteActive.delete(id);
  }

  function undoRemote(id) {
    const index = strokes.findIndex(s => s.id === id);
    if (index === -1) return false;
    strokes.splice(index, 1);
    knownStrokeIds.delete(id);
    remoteActive.delete(id);
    paintBase();
    updateCanvasInfo();
    return true;
  }

  function redoRemote(stroke) { return applyRemoteStroke(stroke); }

  /** Sau khi load snapshot: đăng ký nét đang vẽ dở vào remoteActive
   *  để các điểm gởi tiếp theo (draw:stroke-points) không bị bỏ trôi. */
  function activateRemoteStroke(id) {
    const stroke = knownStrokeIds.has(id) ? strokes.find(s => s.id === id) : null;
    if (!stroke) return false;
    remoteActive.set(id, stroke);
    return true;
  }

  function loadStrokes(list) {
    resetCanvas();
    for (const s of Array.isArray(list) ? list : []) applyRemoteStroke(s);
    updateCanvasInfo();
  }

  for (const button of toolButtons) {
    button.addEventListener('click', () => setTool(button.dataset.tool));
  }
  for (const button of colorButtons) {
    button.addEventListener('click', () => setColor(button.dataset.color));
  }
  customColor.addEventListener('input', event => setColor(event.target.value));
  brushSizeInput.addEventListener('input', event => {
    brushSize = Number(event.target.value);
    updateSizeLabels();
  });
  eraserSizeInput.addEventListener('input', event => {
    eraserSize = Number(event.target.value);
    updateSizeLabels();
  });
  clearButton.addEventListener('click', () => {
    clearCanvas(true);
    showToast('Đã xóa toàn bộ Canvas');
  });
  undoButton.addEventListener('click', undo);
  redoButton.addEventListener('click', redo);

  previewCanvas.addEventListener('pointerdown', startStroke);
  previewCanvas.addEventListener('pointermove', moveStroke);
  previewCanvas.addEventListener('pointerup', finishStroke);
  previewCanvas.addEventListener('pointercancel', finishStroke);
  previewCanvas.addEventListener('lostpointercapture', event => {
    if (activeStroke && event.pointerId === activePointerId) finishStroke();
  });

  window.addEventListener('keydown', event => {
    const target = event.target;
    const typing = target instanceof HTMLElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
    if ((event.ctrlKey || event.metaKey) && !typing) {
      const key = event.key.toLowerCase();
      if (key === 'z' && !event.shiftKey) { event.preventDefault(); undo(); return; }
      if (key === 'y' || (key === 'z' && event.shiftKey)) { event.preventDefault(); redo(); return; }
    }
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (typing) return;
    const key = event.key.toLowerCase();
    if (key === 'b') setTool('brush');
    if (key === 'e') setTool('eraser');
    if (key === 'i') setTool('eyedropper');
  });

  if (typeof ResizeObserver !== 'undefined') {
    const resizeObserver = new ResizeObserver(resizeCanvases);
    resizeObserver.observe(frame);
  } else {
    window.addEventListener('resize', resizeCanvases);
  }

  // API cho game: nhận nét từ server mà không phát lại event, tránh vòng lặp.
  window.drawingTool = Object.freeze({
    applyStroke: applyRemoteStroke,
    beginRemoteStroke,
    appendRemotePoints,
    endRemoteStroke,
    activateRemoteStroke,
    undoRemote,
    redoRemote,
    loadStrokes,
    clear(options = {}) { clearCanvas(Boolean(options.broadcast)); },
    getStrokes() { return strokes.map(cloneStroke); },
    getCanvas() { return canvas; },
  });

  setColor(currentColor);
  setTool('brush');
  updateSizeLabels();
  resizeCanvases();
})();
