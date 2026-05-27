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
  let currentTool = "basic"; // basic, calligraphy, highlighter, spray, eraser, pan
  let isPainting = false;
  let currentColor = "#000000";
  let brushSize = 5;
  let brushOpacity = 1;
  let points = []; // queue of points for bezier interpolation
  let activePointers = new Map(); // tracker for multi-touch (ID -> {x, y})
  let isStylusActive = false; // flag if user is drawing with a physical pen
  let panStartY = 0;
  let panStartScrollTop = 0;

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

  function drawBezier(e) {
    if (!isPainting) return;

    // Get pointer coordinates relative to canvas
    const rect = canvas.getBoundingClientRect();
    const clientX = e.clientX - rect.left;
    const clientY = e.clientY - rect.top;

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
    if (currentTool === 'calligraphy') {
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

    // Handle Drawing
    if (isPainting) {
      drawBezier(e);
      checkAndExpandCanvas(e.clientY);
      updateBrushPreview(e.clientX, e.clientY);
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
      saveState(); // Add to history stack
    }
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
    { element: toolPan, name: "pan" }
  ];

  tools.forEach(t => {
    t.element.addEventListener("click", () => {
      tools.forEach(o => o.element.classList.remove("active"));
      t.element.classList.add("active");
      currentTool = t.name;

      if (currentTool === "pan") {
        canvas.classList.add("pan-mode");
        showToast("✋ 화면 이동 모드 활성화 (두 손가락 스크롤도 가능)");
      } else {
        canvas.classList.remove("pan-mode");
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
  function showToast(message) {
    const toast = document.createElement("div");
    toast.className = "toast";
    toast.innerText = message;
    toastContainer.appendChild(toast);

    // Auto-remove toast after animation finishes
    setTimeout(() => {
      toast.remove();
    }, 3000);
  }

  // Run on startup
  initCanvasSize();
  renderGallery();
  showToast("🎨 크리에이티브 프리미엄 캔버스가 활성화되었습니다.");
});
