window.addEventListener('DOMContentLoaded', () => {
  const canvas = document.querySelector("#canvas");
  const ctx = canvas.getContext("2d");
  const viewport = document.querySelector("#viewport-wrapper");
  const container = document.querySelector("#canvas-container");

  // Floating settings panel & inputs
  const penSettingsPanel = document.querySelector("#pen-settings-panel");
  const btnSettings = document.querySelector("#btn-settings");
  const brushSizeSlider = document.querySelector("#brushSizeSlider");
  const brushSizeVal = document.querySelector("#brush-size-val");
  const brushOpacitySlider = document.querySelector("#brushOpacitySlider");
  const brushOpacityVal = document.querySelector("#brush-opacity-val");
  const colorPicker = document.querySelector("#colorPicker");
  const colorHexText = document.querySelector("#colorHexText");
  const colorPresets = document.querySelector("#color-presets");

  // Drawing Tools
  const toolBasic = document.querySelector("#tool-basic");
  const toolCalligraphy = document.querySelector("#tool-calligraphy");
  const toolHighlighter = document.querySelector("#tool-highlighter");
  const toolSpray = document.querySelector("#tool-spray");
  const toolEraser = document.querySelector("#tool-eraser");
  const toolScribble = document.querySelector("#tool-scribble");
  const toolPan = document.querySelector("#tool-pan");

  // Action Buttons
  const btnUndo = document.querySelector("#btn-undo");
  const btnRedo = document.querySelector("#btn-redo");
  const btnClear = document.querySelector("#btn-clear");
  const btnSave = document.querySelector("#btn-save");
  const btnGallery = document.querySelector("#btn-gallery");

  // Gallery Drawer
  const galleryDrawer = document.querySelector("#gallery-drawer");
  const btnCloseGallery = document.querySelector("#btn-close-gallery");
  const galleryList = document.querySelector("#gallery-list");

  // Save Modal
  const saveModal = document.querySelector("#save-modal");
  const btnSaveCancel = document.querySelector("#btn-save-cancel");
  const btnSaveConfirm = document.querySelector("#btn-save-confirm");
  const saveTitleInput = document.querySelector("#save-title-input");

  // Toast & Brush Indicator
  const brushPreview = document.querySelector("#brush-preview");
  const toastContainer = document.querySelector("#toast-container");

  // Premium Quick Color Presets
  const premiumColors = [
    "#000000", "#ef4444", "#3b82f6", "#10b981", "#f59e0b", "#8b5cf6",
    "#ffffff", "#f43f5e", "#06b6d4", "#a855f7", "#ec4899", "#14b8a6"
  ];

  // Global Engine State
  let currentTool = "basic"; // basic, calligraphy, highlighter, spray, eraser, scribble, pan

  // Scribble (Ink-to-Text) State
  let scribbleStrokes = [];       // Array of strokes, each stroke = { xs: [], ys: [], ts: [] }
  let currentScribbleStroke = null;
  let scribbleTimeout = null;
  let scribbleSnapshotDataURL = null; // Canvas snapshot taken BEFORE scribble drawing begins
  let isPainting = false;
  let currentColor = "#000000";
  let brushSize = 5;
  let brushOpacity = 1;
  let points = []; // queue of points for bezier interpolation
  let activePointers = new Map(); // tracker for multi-touch (ID -> {x, y})
  let isStylusActive = false; // flag if user is drawing with a physical pen
  let panStartY = 0;
  let panStartScrollTop = 0;
  
  // Edge Auto-Scrolling variables
  let autoScrollInterval = null;

  // Digital Ink Stabilizer variables
  let lastStabilizedX = 0;
  let lastStabilizedY = 0;
  const STABILIZER_FACTOR = 0.22; // Weight factor: lower value = more stabilizer smoothing (reduces tremors)

  function startAutoScroll(direction) {
    if (autoScrollInterval) return;
    autoScrollInterval = setInterval(() => {
      viewport.scrollTop += direction * 7;
    }, 16); // smooth ~60fps scroll step
  }

  function stopAutoScroll() {
    if (autoScrollInterval) {
      clearInterval(autoScrollInterval);
      autoScrollInterval = null;
    }
  }

  // History & Storage State
  let historyStack = [];
  let redoStack = [];
  const MAX_HISTORY = 30;
  let currentDrawingId = null; // tracking if editing a loaded file

  // --- 1. Canvas Initializing & Dynamic resizing ---
  function initCanvasSize() {
    // We want a virtual high-resolution canvas with infinite height potential
    // The width is locked to the viewport width, default height is 3000px for continuous scrolling
    const defaultCanvasWidth = viewport.clientWidth;
    const defaultCanvasHeight = 4000; 

    // Backup current drawing if resizing
    let backupCanvas = document.createElement("canvas");
    backupCanvas.width = canvas.width;
    backupCanvas.height = canvas.height;
    let backupCtx = backupCanvas.getContext("2d");
    if (canvas.width > 0) {
      backupCtx.drawImage(canvas, 0, 0);
    }

    canvas.width = defaultCanvasWidth;
    canvas.height = defaultCanvasHeight;
    container.style.height = `${defaultCanvasHeight}px`;

    // Fill white background
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Restore backup
    if (backupCanvas.width > 0) {
      ctx.drawImage(backupCanvas, 0, 0);
    }

    saveState(); // initial blank state
  }

  // Auto-expand canvas if user draws near bottom
  function checkAndExpandCanvas(clientY) {
    // Relative position to the canvas top
    const canvasRect = canvas.getBoundingClientRect();
    const relativeY = clientY - canvasRect.top;

    // If pointer is within 300px from the bottom, expand height by 1500px
    if (relativeY > canvas.height - 300) {
      const oldWidth = canvas.width;
      const oldHeight = canvas.height;
      const newHeight = oldHeight + 1500;

      // Copy existing canvas
      const tempCanvas = document.createElement("canvas");
      tempCanvas.width = oldWidth;
      tempCanvas.height = oldHeight;
      tempCanvas.getContext("2d").drawImage(canvas, 0, 0);

      // Expand
      canvas.height = newHeight;
      container.style.height = `${newHeight}px`;

      // Fill new white background & restore
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(tempCanvas, 0, 0);

      showToast("📝 가상 드로잉 영역이 확장되었습니다.");
    }
  }

  // --- 2. Advanced Drawing Smoothness & Velocity calculation ---
  let lastTime = 0;
  let lastWidth = brushSize;

  function drawBezier(clientX, clientY) {
    if (!isPainting) return;

    // Calculate time delta & speed for dynamic width
    const now = Date.now();
    const dt = now - lastTime || 1;
    lastTime = now;

    // Setup style options based on tool
    ctx.fillStyle = currentColor;
    
    // Convert current opacity to hex alpha or canvas alpha
    ctx.globalAlpha = brushOpacity;

    if (currentTool === 'eraser') {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.strokeStyle = 'rgba(0,0,0,1)'; // transparent eraser
      ctx.fillStyle = 'rgba(0,0,0,1)';
    } else if (currentTool === 'highlighter') {
      ctx.globalCompositeOperation = 'source-over'; // blend beautifully
      ctx.strokeStyle = convertHexToRGBA(currentColor, 0.4 * brushOpacity);
      ctx.fillStyle = convertHexToRGBA(currentColor, 0.4 * brushOpacity);
    } else {
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = currentColor;
    }

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    const currentPoint = { x: clientX, y: clientY, t: now };
    points.push(currentPoint);

    if (points.length < 3) {
      // Draw a tiny starting dot
      ctx.beginPath();
      ctx.arc(clientX, clientY, brushSize / 2, 0, Math.PI * 2);
      ctx.fill();
      return;
    }

    // Velocity-based stroke smoothing
    const p1 = points[points.length - 3];
    const p2 = points[points.length - 2];
    const p3 = points[points.length - 1];

    const dx = p3.x - p2.x;
    const dy = p3.y - p2.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const speed = dist / dt;

    let targetWidth = brushSize;
    if (currentTool === 'basic') {
      // Finger Tapering (세필): Thinner at high speed, thicker at slow speed
      const minWidth = brushSize * 0.22; // drop down to 22% thickness at max speed
      targetWidth = Math.max(minWidth, brushSize * (1 / (1 + speed * 0.45)));
    } else if (currentTool === 'calligraphy') {
      // High speed = thinner line, slow = thicker line (Calligraphic effect)
      const minWidth = brushSize * 0.3;
      const maxWidth = brushSize * 1.5;
      targetWidth = Math.max(minWidth, Math.min(maxWidth, brushSize - (speed * 1.8)));
      // Calligraphy angle styling
      ctx.lineCap = 'square';
    } else if (currentTool === 'spray') {
      // Spray particles instead of drawing lines
      const radius = brushSize * 2;
      const density = Math.min(40, Math.round(brushSize * 2));
      ctx.globalAlpha = brushOpacity * 0.5;
      for (let i = 0; i < density; i++) {
        const angle = Math.random() * Math.PI * 2;
        const r = Math.random() * radius;
        const px = clientX + Math.cos(angle) * r;
        const py = clientY + Math.sin(angle) * r;
        ctx.beginPath();
        ctx.arc(px, py, 1, 0, Math.PI * 2);
        ctx.fill();
      }
      return;
    }

    // Lerp width for smooth thickness transitions
    let activeWidth = lastWidth + (targetWidth - lastWidth) * 0.25;
    lastWidth = activeWidth;
    ctx.lineWidth = activeWidth;

    // Calculate midpoints for Quadratic Bezier
    const mid1 = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
    const mid2 = { x: (p2.x + p3.x) / 2, y: (p2.y + p3.y) / 2 };

    // Draw smooth curved segment
    ctx.beginPath();
    ctx.moveTo(mid1.x, mid1.y);
    ctx.quadraticCurveTo(p2.x, p2.y, mid2.x, mid2.y);
    ctx.stroke();

    // Limit queue size
    if (points.length > 5) {
      points.shift();
    }
  }

  function convertHexToRGBA(hex, alpha) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  // --- 3. Strict Multi-Touch Gesture Scrolling & Stylus Discrimination ---
  // Block default browser touch/pinch zoom on viewport
  window.addEventListener('touchstart', (e) => {
    if (e.touches.length > 1) {
      e.preventDefault(); // hard prevent pinch zoom
    }
  }, { passive: false });

  window.addEventListener('touchmove', (e) => {
    if (e.touches.length > 1) {
      e.preventDefault(); // hard prevent pinch zoom
    }
  }, { passive: false });

  // Monitor pointers
  viewport.addEventListener("pointerdown", (e) => {
    activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    // Stylus Auto-differentiation
    if (e.pointerType === "pen") {
      isStylusActive = true;
    }

    // If 2 fingers touch, trigger gesture panning/scrolling
    if (activePointers.size >= 2 || currentTool === "pan") {
      isPainting = false;
      panStartY = e.clientY;
      panStartScrollTop = viewport.scrollTop;
      return;
    }

    // Single finger touch drawing mode (unless user specifically activated hand tool)
    if (currentTool !== "pan") {
      isPainting = true;
      points = [];
      lastTime = Date.now();
      lastWidth = brushSize;
      
      const rect = canvas.getBoundingClientRect();
      const clientX = e.clientX - rect.left;
      const clientY = e.clientY - rect.top;
      
      // Initialize stabilizer coordinates to starting touch point
      lastStabilizedX = clientX;
      lastStabilizedY = clientY;
      
      points.push({ x: clientX, y: clientY, t: lastTime });

      // Live brush preview position
      updateBrushPreview(e.clientX, e.clientY);
    }
  });

  viewport.addEventListener("pointermove", (e) => {
    if (!activePointers.has(e.pointerId)) return;
    
    // Update pointer position in tracking map
    activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    // Handle Multi-Touch Panning (Two-finger drag)
    if (activePointers.size >= 2) {
      const pointerArray = Array.from(activePointers.values());
      const currentMidY = (pointerArray[0].y + pointerArray[1].y) / 2;
      
      // Calculate delta movement
      if (!viewport.dataset.lastMidY) {
        viewport.dataset.lastMidY = currentMidY;
      }
      const deltaY = currentMidY - parseFloat(viewport.dataset.lastMidY);
      viewport.scrollTop -= deltaY;
      viewport.dataset.lastMidY = currentMidY;
      return;
    }

    // Handle Single-Touch Pan Tool
    if (currentTool === "pan") {
      const deltaY = e.clientY - panStartY;
      viewport.scrollTop = panStartScrollTop - deltaY;
      return;
    }

    // Handle Drawing (SKIP for scribble mode - handled separately)
    if (isPainting && currentTool !== "scribble") {
      const rect = canvas.getBoundingClientRect();
      const targetX = e.clientX - rect.left;
      const targetY = e.clientY - rect.top;

      // Exponential Moving Average Stabilizer (EMA Filter)
      lastStabilizedX = lastStabilizedX + (targetX - lastStabilizedX) * STABILIZER_FACTOR;
      lastStabilizedY = lastStabilizedY + (targetY - lastStabilizedY) * STABILIZER_FACTOR;

      drawBezier(lastStabilizedX, lastStabilizedY);
      checkAndExpandCanvas(e.clientY);
      updateBrushPreview(e.clientX, e.clientY);

      // Smooth Edge Auto-Scrolling Check
      const threshold = 100;
      if (e.clientY > window.innerHeight - threshold) {
        startAutoScroll(1); // Scroll down
      } else if (e.clientY < threshold && viewport.scrollTop > 0) {
        startAutoScroll(-1); // Scroll up
      } else {
        stopAutoScroll();
      }
    }
  });

  function endPointer(e) {
    activePointers.delete(e.pointerId);
    if (activePointers.size < 2) {
      delete viewport.dataset.lastMidY;
    }

    if (isPainting) {
      isPainting = false;
      points = [];

      // Scribble mode: finish current stroke and start recognition countdown
      if (currentTool === "scribble" && currentScribbleStroke && currentScribbleStroke.xs.length > 5) {
        scribbleStrokes.push(currentScribbleStroke);
        currentScribbleStroke = null;

        // Reset recognition timer on each new stroke lift (wait for user to finish writing)
        if (scribbleTimeout) clearTimeout(scribbleTimeout);
        scribbleTimeout = setTimeout(() => {
          recognizeScribble();
        }, 1200); // 1.2s inactivity triggers recognition
      } else {
        saveState(); // Normal tools: add to history stack
      }
    }
    stopAutoScroll();
    brushPreview.style.display = "none";
  }

  viewport.addEventListener("pointerup", endPointer);
  viewport.addEventListener("pointercancel", endPointer);

  // Brush Cursor Live Size Circle
  function updateBrushPreview(clientX, clientY) {
    if (currentTool === "pan" || currentTool === "spray") {
      brushPreview.style.display = "none";
      return;
    }
    brushPreview.style.width = `${brushSize}px`;
    brushPreview.style.height = `${brushSize}px`;
    brushPreview.style.left = `${clientX}px`;
    brushPreview.style.top = `${clientY}px`;
    brushPreview.style.display = "block";
  }

  // --- 4. History Undo / Redo Manager ---
  function saveState() {
    // Stack current state
    if (historyStack.length >= MAX_HISTORY) {
      historyStack.shift();
    }
    historyStack.push(canvas.toDataURL());
    redoStack = []; // reset redo stack on new action
  }

  btnUndo.addEventListener("click", () => {
    if (historyStack.length > 1) {
      const current = historyStack.pop();
      redoStack.push(current);
      const previous = historyStack[historyStack.length - 1];
      loadCanvasFromURL(previous);
      showToast("↩️ 작업이 실행 취소되었습니다.");
    } else {
      showToast("더 이상 되돌릴 수 없습니다.");
    }
  });

  btnRedo.addEventListener("click", () => {
    if (redoStack.length > 0) {
      const next = redoStack.pop();
      historyStack.push(next);
      loadCanvasFromURL(next);
      showToast("↪️ 작업이 다시 실행되었습니다.");
    } else {
      showToast("되살릴 작업이 없습니다.");
    }
  });

  function loadCanvasFromURL(dataURL) {
    let img = new Image();
    img.src = dataURL;
    img.onload = () => {
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);
    };
  }

  // --- 5. Tool Switching ---
  const tools = [
    { element: toolBasic, name: "basic" },
    { element: toolCalligraphy, name: "calligraphy" },
    { element: toolHighlighter, name: "highlighter" },
    { element: toolSpray, name: "spray" },
    { element: toolEraser, name: "eraser" },
    { element: toolScribble, name: "scribble" },
    { element: toolPan, name: "pan" }
  ];

  tools.forEach(t => {
    t.element.addEventListener("click", () => {
      // Double tap/click to reset basic pen to defaults
      if (currentTool === t.name) {
        if (t.name === "basic") {
          currentColor = "#000000";
          brushSize = 5;
          brushOpacity = 1;
          
          // Sync GUI Controls
          brushSizeSlider.value = 5;
          brushSizeVal.innerText = "5px";
          brushOpacitySlider.value = 100;
          brushOpacityVal.innerText = "100%";
          colorPicker.value = "#000000";
          colorHexText.innerText = "#000000";
          updateActivePalette();
          
          showToast("🔄 일반 펜 설정이 기본값(검정색, 5px)으로 초기화되었습니다.");
        }
        return;
      }

      tools.forEach(o => o.element.classList.remove("active"));
      t.element.classList.add("active");
      currentTool = t.name;

      if (currentTool === "pan") {
        canvas.classList.add("pan-mode");
        // Enable buttery smooth native momentum browser scrolling on Canvas in Pan Mode
        canvas.style.touchAction = "pan-y";
        showToast("✋ 화면 이동 모드 활성화 (화면을 위아래로 끌어당기세요)");
      } else {
        canvas.classList.remove("pan-mode");
        // Lock touch events during drawing for bezier curve rendering
        canvas.style.touchAction = "none";
        showToast(`🖌️ ${t.element.getAttribute("title")} 도구 선택`);
      }
      
      // Close pen panel when switching tools to save space
      penSettingsPanel.classList.remove("active");
    });
  });

  // Settings dropdown toggle
  btnSettings.addEventListener("click", (e) => {
    e.stopPropagation();
    penSettingsPanel.classList.toggle("active");
  });

  // Click outside close panel
  document.addEventListener("click", (e) => {
    if (!penSettingsPanel.contains(e.target) && e.target !== btnSettings) {
      penSettingsPanel.classList.remove("active");
    }
  });

  // Pen Controls
  brushSizeSlider.addEventListener("input", (e) => {
    brushSize = parseInt(e.target.value);
    brushSizeVal.innerText = `${brushSize}px`;
  });

  brushOpacitySlider.addEventListener("input", (e) => {
    brushOpacity = parseInt(e.target.value) / 100;
    brushOpacityVal.innerText = `${e.target.value}%`;
  });

  // Advanced color picker
  colorPicker.addEventListener("input", (e) => {
    currentColor = e.target.value;
    colorHexText.innerText = currentColor.toUpperCase();
    updateActivePalette();
  });

  // Generate quick premium palettes
  premiumColors.forEach(color => {
    const chip = document.createElement("button");
    chip.className = "palette-color";
    chip.style.backgroundColor = color;
    if (color === currentColor) chip.classList.add("active");
    
    chip.addEventListener("click", () => {
      currentColor = color;
      colorPicker.value = color;
      colorHexText.innerText = color.toUpperCase();
      updateActivePalette();
    });
    colorPresets.appendChild(chip);
  });

  function updateActivePalette() {
    document.querySelectorAll(".palette-color").forEach(chip => {
      if (chip.style.backgroundColor.toUpperCase() === currentColor.toUpperCase() || 
          rgbToHex(chip.style.backgroundColor).toUpperCase() === currentColor.toUpperCase()) {
        chip.classList.add("active");
      } else {
        chip.classList.remove("active");
      }
    });
  }

  function rgbToHex(rgb) {
    if (rgb.startsWith("#")) return rgb;
    const rgbValues = rgb.match(/\d+/g);
    if (!rgbValues) return rgb;
    return "#" + rgbValues.slice(0, 3).map(x => {
      const hex = parseInt(x).toString(16);
      return hex.length === 1 ? "0" + hex : hex;
    }).join("");
  }

  // Clear Canvas All
  btnClear.addEventListener("click", () => {
    if (confirm("정말로 모든 그림을 초기화하시겠습니까?")) {
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      saveState();
      showToast("🗑️ 캔버스가 전부 지워졌습니다.");
    }
  });

  // --- 6. Beautiful LocalStorage Gallery Systems ---
  const GALLERY_KEY = "premium_creative_canvas_drawings";

  function getGalleryItems() {
    const items = localStorage.getItem(GALLERY_KEY);
    return items ? JSON.parse(items) : [];
  }

  function saveGalleryItems(items) {
    localStorage.setItem(GALLERY_KEY, JSON.stringify(items));
  }

  // Show/Hide save modal
  btnSave.addEventListener("click", () => {
    saveTitleInput.value = `무제 드로잉_${new Date().toLocaleDateString()}`;
    saveModal.classList.add("open");
    saveTitleInput.focus();
  });

  btnSaveCancel.addEventListener("click", () => {
    saveModal.classList.remove("open");
  });

  btnSaveConfirm.addEventListener("click", () => {
    const title = saveTitleInput.value.trim() || "이름 없는 그림";
    const dataUrl = canvas.toDataURL("image/png");
    
    // Save to localStorage DB
    const items = getGalleryItems();
    const now = new Date();
    const formattedDate = `${now.getFullYear()}.${String(now.getMonth()+1).padStart(2,'0')}.${String(now.getDate()).padStart(2,'0')} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;

    if (currentDrawingId) {
      // Update existing item
      const idx = items.findIndex(i => i.id === currentDrawingId);
      if (idx !== -1) {
        items[idx].title = title;
        items[idx].dataUrl = dataUrl;
        items[idx].date = formattedDate;
        showToast("💾 기존 그림 파일이 업데이트되었습니다.");
      } else {
        items.push({ id: Date.now().toString(), title, dataUrl, date: formattedDate });
        showToast("🎨 새 그림이 갤러리에 저장되었습니다.");
      }
    } else {
      // New save
      const newId = Date.now().toString();
      currentDrawingId = newId;
      items.push({ id: newId, title, dataUrl, date: formattedDate });
      showToast("🎨 새 그림이 갤러리에 저장되었습니다.");
    }

    saveGalleryItems(items);
    renderGallery();
    saveModal.classList.remove("open");

    // Clear and initialize drawing board after successful save
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    currentDrawingId = null; // Reset to a fresh blank document
    saveState(); // push blank state to history stack
    
    showToast("💾 그림이 안전하게 저장된 후, 도화지가 깨끗이 정리되었습니다.");
  });

  // Render gallery list
  function renderGallery() {
    const items = getGalleryItems();
    galleryList.innerHTML = "";

    if (items.length === 0) {
      galleryList.innerHTML = `
        <div class="empty-state">
          <svg viewBox="0 0 24 24" fill="currentColor"><path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"/></svg>
          <p>저장된 그림이 없습니다.<br>나만의 크리에이티브를 저장해 보세요!</p>
        </div>
      `;
      return;
    }

    items.reverse().forEach(item => {
      const card = document.createElement("div");
      card.className = "gallery-card";
      card.innerHTML = `
        <div class="card-thumbnail" style="background-image: url('${item.dataUrl}')" data-id="${item.id}"></div>
        <div class="card-info">
          <div class="card-title">${item.title}</div>
          <div class="card-date">${item.date}</div>
        </div>
        <div class="card-actions">
          <button class="card-btn download-btn" data-id="${item.id}">
            내보내기 📥
          </button>
          <button class="card-btn delete-btn" data-id="${item.id}">
            삭제 🗑️
          </button>
        </div>
      `;

      // Load/Edit trigger
      card.querySelector(".card-thumbnail").addEventListener("click", () => {
        if (confirm(`'${item.title}' 도면을 불러와서 편집하시겠습니까?\n(현재 작업 중인 캔버스는 초기화됩니다.)`)) {
          currentDrawingId = item.id;
          loadCanvasFromURL(item.dataUrl);
          galleryDrawer.classList.remove("open");
          showToast(`📁 '${item.title}' 도면이 성공적으로 불러와졌습니다.`);
        }
      });

      // Export/Download PNG
      card.querySelector(".download-btn").addEventListener("click", () => {
        const link = document.createElement("a");
        link.download = `${item.title.replace(/\s+/g, "_")}.png`;
        link.href = item.dataUrl;
        link.click();
        showToast("⬇️ PNG 다운로드가 완료되었습니다.");
      });

      // Delete drawing
      card.querySelector(".delete-btn").addEventListener("click", () => {
        if (confirm(`'${item.title}' 그림을 영구히 삭제하시겠습니까?`)) {
          const freshItems = getGalleryItems().filter(i => i.id !== item.id);
          saveGalleryItems(freshItems);
          if (currentDrawingId === item.id) currentDrawingId = null;
          renderGallery();
          showToast("🗑️ 그림이 갤러리에서 영구히 삭제되었습니다.");
        }
      });

      galleryList.appendChild(card);
    });
  }

  // Gallery drawer open/close
  btnGallery.addEventListener("click", () => {
    renderGallery();
    galleryDrawer.classList.add("open");
  });

  btnCloseGallery.addEventListener("click", () => {
    galleryDrawer.classList.remove("open");
  });

  // --- 7. Toast Alerts UI ---
  let toastTimeout = null;
  function showToast(message) {
    // Clear previous toasts immediately so they don't stack downwards
    toastContainer.innerHTML = "";
    if (toastTimeout) {
      clearTimeout(toastTimeout);
    }

    const toast = document.createElement("div");
    toast.className = "toast";
    toast.innerText = message;
    toastContainer.appendChild(toast);

    // Auto-remove toast after animation finishes
    toastTimeout = setTimeout(() => {
      toast.remove();
    }, 2800);
  }

  // --- 8. Scribble: Google Handwriting Recognition Engine ---

  // Override pointerdown for scribble: take snapshot & start collecting stroke data
  function handleScribblePointerDown(clientX, clientY) {
    // Take a canvas snapshot BEFORE this scribble session begins (to restore later)
    if (scribbleStrokes.length === 0) {
      scribbleSnapshotDataURL = canvas.toDataURL();
    }

    currentScribbleStroke = { xs: [], ys: [], ts: [] };
    const now = Date.now();
    currentScribbleStroke.xs.push(clientX);
    currentScribbleStroke.ys.push(clientY);
    currentScribbleStroke.ts.push(now);
  }

  // Override pointermove for scribble: collect coordinates & draw blue guide
  function handleScribblePointerMove(clientX, clientY) {
    if (!currentScribbleStroke) return;

    const now = Date.now();
    currentScribbleStroke.xs.push(clientX);
    currentScribbleStroke.ys.push(clientY);
    currentScribbleStroke.ts.push(now);

    // Draw temporary blue guide ink on canvas
    const len = currentScribbleStroke.xs.length;
    if (len >= 2) {
      ctx.save();
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = '#3b82f6';
      ctx.globalAlpha = 0.6;
      ctx.lineWidth = 2.5;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(currentScribbleStroke.xs[len - 2], currentScribbleStroke.ys[len - 2]);
      ctx.lineTo(currentScribbleStroke.xs[len - 1], currentScribbleStroke.ys[len - 1]);
      ctx.stroke();
      ctx.restore();
    }
  }

  // Hook scribble handlers into pointerdown & pointermove
  const originalPointerDown = viewport.onpointerdown; // already handled via addEventListener
  viewport.addEventListener("pointerdown", (e) => {
    if (currentTool === "scribble" && activePointers.size < 2) {
      const rect = canvas.getBoundingClientRect();
      handleScribblePointerDown(e.clientX - rect.left, e.clientY - rect.top);
    }
  });

  viewport.addEventListener("pointermove", (e) => {
    if (currentTool === "scribble" && isPainting) {
      const rect = canvas.getBoundingClientRect();
      handleScribblePointerMove(e.clientX - rect.left, e.clientY - rect.top);
    }
  });

  // Core Recognition Request to Google Handwriting API
  async function recognizeScribble() {
    if (scribbleStrokes.length === 0) return;

    showToast("✍️ 손글씨를 분석 중입니다...");

    // Build the ink array in the format Google expects: [[xs, ys, ts], ...]
    const inkArray = scribbleStrokes.map(stroke => [
      stroke.xs,
      stroke.ys,
      stroke.ts
    ]);

    // Calculate the bounding box of all strokes for text placement
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    scribbleStrokes.forEach(stroke => {
      stroke.xs.forEach(x => { minX = Math.min(minX, x); maxX = Math.max(maxX, x); });
      stroke.ys.forEach(y => { minY = Math.min(minY, y); maxY = Math.max(maxY, y); });
    });

    const strokeHeight = maxY - minY;
    const fontSize = Math.max(18, Math.min(64, strokeHeight * 0.9));

    console.log('[Scribble] Sending', scribbleStrokes.length, 'strokes to Google API');
    console.log('[Scribble] Ink payload:', JSON.stringify(inkArray).substring(0, 300));

    try {
      const response = await fetch('https://inputtools.google.com/request?itc=ko-t-i0-handwrit&app=demopage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          options: 'enable_pre_space',
          requests: [{
            writing_guide: {
              writing_area_width: canvas.width,
              writing_area_height: canvas.height
            },
            ink: inkArray,
            language: 'ko'
          }]
        })
      });

      const data = await response.json();
      console.log('[Scribble] API response:', JSON.stringify(data));

      // Parse recognized text - Google response format:
      // ["SUCCESS", [["input", ["candidate1", "candidate2", ...], [], {}]]]
      // data[0] = "SUCCESS"
      // data[1][0][1] = candidates array
      let recognizedText = '';
      if (data && data[0] === 'SUCCESS' && data[1] && data[1][0] && data[1][0][1]) {
        recognizedText = data[1][0][1][0]; // top candidate
        console.log('[Scribble] Recognized:', recognizedText);
      } else {
        console.warn('[Scribble] Unexpected response structure:', data);
      }

      if (recognizedText) {
        // Step 1: Restore the canvas to the pre-scribble snapshot (erasing blue guide strokes)
        if (scribbleSnapshotDataURL) {
          const img = new Image();
          img.onload = () => {
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(img, 0, 0);

            // Step 2: Render the recognized text at the scribble location
            renderScribbleText(recognizedText, minX, minY, maxX, maxY, fontSize);
          };
          img.src = scribbleSnapshotDataURL;
        } else {
          renderScribbleText(recognizedText, minX, minY, maxX, maxY, fontSize);
        }

        showToast(`✅ 인식 결과: "${recognizedText}"`);
      } else {
        showToast("⚠️ 글씨를 인식하지 못했습니다. 좀 더 크고 또렷하게 써 보세요.");
        // Restore snapshot to remove failed scribble strokes
        if (scribbleSnapshotDataURL) {
          loadCanvasFromURL(scribbleSnapshotDataURL);
        }
      }
    } catch (err) {
      console.error('[Scribble] Recognition error:', err);
      showToast("❌ API 연결 실패. 웹 서버(localhost)에서 실행 중인지 확인해 주세요.");
      // Restore on error
      if (scribbleSnapshotDataURL) {
        loadCanvasFromURL(scribbleSnapshotDataURL);
      }
    }

    // Reset scribble session
    scribbleStrokes = [];
    currentScribbleStroke = null;
    scribbleSnapshotDataURL = null;
  }

  // Render clean font text onto the canvas at the scribble location
  function renderScribbleText(text, minX, minY, maxX, maxY, fontSize) {
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.fillStyle = currentColor;
    ctx.font = `600 ${fontSize}px 'Outfit', 'Inter', sans-serif`;
    ctx.textBaseline = 'top';

    // Render text starting at the left edge of the bounding box,
    // vertically centered within the scribble region
    const textY = minY + (maxY - minY - fontSize) / 2;
    ctx.fillText(text, minX, textY);
    ctx.restore();

    saveState(); // Save the clean text render to history
  }

  // Run on startup
  initCanvasSize();
  renderGallery();
  showToast("🎨 크리에이티브 프리미엄 캔버스가 활성화되었습니다.");
});
