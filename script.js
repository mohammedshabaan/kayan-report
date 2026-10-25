(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const form = $('decisionForm');
  const poster = $('poster');
  const viewport = $('posterViewport');
  const toast = $('toast');
  const portraitImg = $('outPortrait');
  const portraitFrame = $('portraitFrame');

  let toastTimer;
  let currentPosterScale = 1;

  // Defaults storage
  const defaults = {};
  [...form.querySelectorAll('input:not([type=file]):not([type=range]):not([type=checkbox]), textarea')].forEach(el => {
    defaults[el.name] = el.value;
  });

  // Portrait transformation state
  const portraitState = {
    zoom: 100,
    x: 0,
    y: 0,
    rotate: 0
  };

  // -------------------------------------------------------------
  // 1. Toast Notification Helper
  // -------------------------------------------------------------
  function showToast(message, duration = 3000) {
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), duration);
  }

  // -------------------------------------------------------------
  // 2. IndexedDB Helper for Large Images Persistence
  // -------------------------------------------------------------
  const DB_NAME = 'DecisionMakerDB';
  const DB_VERSION = 1;
  const STORE_NAME = 'images';

  function openDB() {
    return new Promise((resolve, reject) => {
      if (!window.indexedDB) {
        resolve(null);
        return;
      }
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    });
  }

  async function getStoredImage(key) {
    try {
      const db = await openDB();
      if (!db) return localStorage.getItem('dm_img_' + key);
      return new Promise((resolve) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const req = store.get(key);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => resolve(null);
      });
    } catch (_) {
      return null;
    }
  }

  async function setStoredImage(key, dataUrl) {
    try {
      const db = await openDB();
      if (!db) {
        try { localStorage.setItem('dm_img_' + key, dataUrl); } catch (_) {}
        return;
      }
      return new Promise((resolve) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        store.put(dataUrl, key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      });
    } catch (_) {}
  }

  async function clearStoredImages() {
    try {
      const db = await openDB();
      if (db) {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).clear();
      }
      Object.keys(localStorage).forEach(k => {
        if (k.startsWith('dm_img_')) localStorage.removeItem(k);
      });
    } catch (_) {}
  }

  // -------------------------------------------------------------
  // 3. Asset Loading & Transparent Background Processing
  // -------------------------------------------------------------
  function getDefaultAsset(filename) {
    if (window.DEFAULT_ASSETS && window.DEFAULT_ASSETS[filename]) {
      return window.DEFAULT_ASSETS[filename];
    }
    return `assets/${filename}`;
  }

  // Remove white background from an image to make it transparent (e.g. signature & logos)
  function removeWhiteBackground(dataUrl, tolerance = 28) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        try {
          const c = document.createElement('canvas');
          c.width = img.naturalWidth || img.width;
          c.height = img.naturalHeight || img.height;
          const ctx = c.getContext('2d');
          ctx.drawImage(img, 0, 0);
          const imgData = ctx.getImageData(0, 0, c.width, c.height);
          const d = imgData.data;
          const threshold = 255 - tolerance;

          for (let i = 0; i < d.length; i += 4) {
            const r = d[i], g = d[i + 1], b = d[i + 2];
            // If near white / paper background
            if (r >= threshold && g >= threshold && b >= threshold) {
              d[i + 3] = 0; // Transparent
            } else if (r >= threshold - 25 && g >= threshold - 25 && b >= threshold - 25) {
              // Smooth feathered alpha edge
              const minVal = Math.min(r, g, b);
              const factor = (255 - minVal) / (tolerance + 25);
              d[i + 3] = Math.min(255, Math.max(0, Math.round(factor * 255)));
            }
          }
          ctx.putImageData(imgData, 0, 0);
          resolve(c.toDataURL('image/png'));
        } catch (_) {
          resolve(dataUrl);
        }
      };
      img.onerror = () => resolve(dataUrl);
      img.src = dataUrl;
    });
  }

  // -------------------------------------------------------------
  // 4. Portrait Transformation Logic
  // -------------------------------------------------------------
  function applyPortraitTransform() {
    if (!portraitImg) return;
    const scale = portraitState.zoom / 100;
    portraitImg.style.transform = `translate(${portraitState.x}px, ${portraitState.y}px) scale(${scale}) rotate(${portraitState.rotate}deg)`;

    // Update form control badges and values
    const zoomInput = $('portraitZoom');
    const xInput = $('portraitX');
    const yInput = $('portraitY');
    const zoomBadge = $('portraitZoomVal');
    const xBadge = $('portraitXVal');
    const yBadge = $('portraitYVal');

    if (zoomInput) zoomInput.value = portraitState.zoom;
    if (xInput) xInput.value = portraitState.x;
    if (yInput) yInput.value = portraitState.y;

    if (zoomBadge) zoomBadge.textContent = `${portraitState.zoom}%`;
    if (xBadge) xBadge.textContent = `${portraitState.x}px`;
    if (yBadge) yBadge.textContent = `${portraitState.y}px`;

    saveLocal();
  }

  // Interactive Dragging on the Portrait Frame
  let isDragging = false;
  let dragStartX = 0;
  let dragStartY = 0;
  let initialPanX = 0;
  let initialPanY = 0;

  if (portraitFrame) {
    portraitFrame.addEventListener('pointerdown', (e) => {
      // Prevent drag if clicked on a button or link
      if (e.target.closest('button')) return;
      isDragging = true;
      portraitFrame.setPointerCapture(e.pointerId);
      dragStartX = e.clientX;
      dragStartY = e.clientY;
      initialPanX = portraitState.x;
      initialPanY = portraitState.y;
    });

    portraitFrame.addEventListener('pointermove', (e) => {
      if (!isDragging) return;
      // Account for the poster scaling inside viewport
      const scaleFactor = currentPosterScale > 0 ? currentPosterScale : 1;
      const deltaX = (e.clientX - dragStartX) / scaleFactor;
      const deltaY = (e.clientY - dragStartY) / scaleFactor;

      portraitState.x = Math.round(Math.min(150, Math.max(-150, initialPanX + deltaX)));
      portraitState.y = Math.round(Math.min(200, Math.max(-200, initialPanY + deltaY)));
      applyPortraitTransform();
    });

    const stopDrag = (e) => {
      if (isDragging) {
        isDragging = false;
        try { portraitFrame.releasePointerCapture(e.pointerId); } catch (_) {}
      }
    };
    portraitFrame.addEventListener('pointerup', stopDrag);
    portraitFrame.addEventListener('pointercancel', stopDrag);

    // Mouse wheel inside portrait frame to zoom
    portraitFrame.addEventListener('wheel', (e) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -5 : 5;
      portraitState.zoom = Math.min(250, Math.max(50, portraitState.zoom + delta));
      applyPortraitTransform();
    }, { passive: false });
  }

  // Sliders and buttons bindings for Portrait
  $('portraitZoom')?.addEventListener('input', (e) => {
    portraitState.zoom = parseInt(e.target.value, 10);
    applyPortraitTransform();
  });
  $('portraitX')?.addEventListener('input', (e) => {
    portraitState.x = parseInt(e.target.value, 10);
    applyPortraitTransform();
  });
  $('portraitY')?.addEventListener('input', (e) => {
    portraitState.y = parseInt(e.target.value, 10);
    applyPortraitTransform();
  });

  $('rotatePortraitBtn')?.addEventListener('click', () => {
    portraitState.rotate = (portraitState.rotate + 90) % 360;
    applyPortraitTransform();
    showToast(`تم تدوير الصورة إلى ${portraitState.rotate}°`);
  });

  $('centerPortraitBtn')?.addEventListener('click', () => {
    portraitState.zoom = 100;
    portraitState.x = 0;
    portraitState.y = 0;
    portraitState.rotate = 0;
    applyPortraitTransform();
    showToast('تمت إعادة توسيط وضبط موضع الصورة.');
  });

  // -------------------------------------------------------------
  // 5. Image File Readers & Uploader Cards
  // -------------------------------------------------------------
  async function handleImageFile(file, imgId, thumbId, storageKey, makeTransparent = false) {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      showToast('من فضلك اختر ملف صورة صالح (JPG, PNG, WebP).');
      return;
    }

    const reader = new FileReader();
    reader.onload = async (e) => {
      let finalDataUrl = e.target.result;

      if (makeTransparent) {
        showToast('جارٍ معالجة وتفريغ خلفية الصورة…', 1500);
        finalDataUrl = await removeWhiteBackground(finalDataUrl);
      }

      if ($(imgId)) $(imgId).src = finalDataUrl;
      if (thumbId && $(thumbId)) $(thumbId).src = finalDataUrl;

      // Save to IndexedDB
      await setStoredImage(storageKey, finalDataUrl);
      showToast('تم تحديث الصورة وحفظها بنجاح!');
    };
    reader.onerror = () => showToast('تعذر قراءة ملف الصورة، جرب صورة أخرى.');
    reader.readAsDataURL(file);
  }

  // Portrait Upload
  $('portraitUpload')?.addEventListener('change', (e) => {
    handleImageFile(e.target.files[0], 'outPortrait', 'portraitThumb', 'portrait');
  });

  // Signature Upload
  $('signatureUpload')?.addEventListener('change', (e) => {
    const isTrans = $('transparentSignatureCheck')?.checked ?? true;
    handleImageFile(e.target.files[0], 'outSignature', 'signatureThumb', 'signature', isTrans);
  });

  // Logos Upload
  $('ministryUpload')?.addEventListener('change', (e) => {
    const isTrans = $('transparentLogosCheck')?.checked ?? true;
    handleImageFile(e.target.files[0], 'logoMinistry', 'thumbMinistry', 'logo_ministry', isTrans);
  });
  $('unionUpload')?.addEventListener('change', (e) => {
    const isTrans = $('transparentLogosCheck')?.checked ?? true;
    handleImageFile(e.target.files[0], 'logoUnion', 'thumbUnion', 'logo_union', isTrans);
  });
  $('federationUpload')?.addEventListener('change', (e) => {
    const isTrans = $('transparentLogosCheck')?.checked ?? true;
    handleImageFile(e.target.files[0], 'logoFederation', 'thumbFederation', 'logo_federation', isTrans);
  });

  // Drag and Drop helpers for dropzones
  function setupDropzone(dropzoneId, inputId, onFile) {
    const dz = $(dropzoneId);
    if (!dz) return;

    ['dragenter', 'dragover'].forEach(name => {
      dz.addEventListener(name, (e) => {
        e.preventDefault();
        e.stopPropagation();
        dz.classList.add('dragover');
      });
    });

    ['dragleave', 'drop'].forEach(name => {
      dz.addEventListener(name, (e) => {
        e.preventDefault();
        e.stopPropagation();
        dz.classList.remove('dragover');
      });
    });

    dz.addEventListener('drop', (e) => {
      const dt = e.dataTransfer;
      if (dt && dt.files && dt.files.length) {
        onFile(dt.files[0]);
      }
    });

    // Clicking anywhere on dropzone (except file input itself) triggers file picker
    dz.addEventListener('click', (e) => {
      if (e.target.tagName !== 'INPUT') {
        $(inputId)?.click();
      }
    });
  }

  setupDropzone('portraitDropzone', 'portraitUpload', (file) => {
    handleImageFile(file, 'outPortrait', 'portraitThumb', 'portrait');
  });
  setupDropzone('signatureDropzone', 'signatureUpload', (file) => {
    const isTrans = $('transparentSignatureCheck')?.checked ?? true;
    handleImageFile(file, 'outSignature', 'signatureThumb', 'signature', isTrans);
  });

  // Reset Individual Images to Defaults
  $('resetPortraitBtn')?.addEventListener('click', async () => {
    const def = getDefaultAsset('sample-portrait.jpg');
    $('outPortrait').src = def;
    if ($('portraitThumb')) $('portraitThumb').src = def;
    await setStoredImage('portrait', null);
    portraitState.zoom = 100;
    portraitState.x = 0;
    portraitState.y = 0;
    portraitState.rotate = 0;
    applyPortraitTransform();
    showToast('تمت استعادة الصورة الشخصية الأصلية.');
  });

  $('resetSignatureBtn')?.addEventListener('click', async () => {
    const def = getDefaultAsset('sample-signature.jpg');
    $('outSignature').src = def;
    if ($('signatureThumb')) $('signatureThumb').src = def;
    await setStoredImage('signature', null);
    showToast('تمت استعادة صورة التوقيع الأصلية.');
  });

  $('resetMinistryBtn')?.addEventListener('click', async () => {
    const def = getDefaultAsset('logo-ministry.jpg');
    $('logoMinistry').src = def;
    if ($('thumbMinistry')) $('thumbMinistry').src = def;
    await setStoredImage('logo_ministry', null);
    showToast('تمت استعادة شعار الوزارة الأصلي.');
  });

  $('resetUnionBtn')?.addEventListener('click', async () => {
    const def = getDefaultAsset('logo-union.jpg');
    $('logoUnion').src = def;
    if ($('thumbUnion')) $('thumbUnion').src = def;
    await setStoredImage('logo_union', null);
    showToast('تمت استعادة شعار الاتحاد الأصلي.');
  });

  $('resetFederationBtn')?.addEventListener('click', async () => {
    const def = getDefaultAsset('logo-federation.jpg');
    $('logoFederation').src = def;
    if ($('thumbFederation')) $('thumbFederation').src = def;
    await setStoredImage('logo_federation', null);
    showToast('تمت استعادة شعار الكيانات الشبابية الأصلي.');
  });

  // -------------------------------------------------------------
  // 6. Text Updates & Dynamic Typography
  // -------------------------------------------------------------
  function lines(value) {
    return (value || '').split(/\n+/).map(s => s.trim()).filter(Boolean);
  }

  function fillList(targetId, items, numbered) {
    const target = $(targetId);
    if (!target) return;
    target.replaceChildren();
    const max = numbered ? 6 : 5;
    items.slice(0, max).forEach(item => {
      const li = document.createElement('li');
      li.textContent = item;
      target.appendChild(li);
    });
  }

  function text(name) {
    return form.elements[name]?.value?.trim() || '';
  }

  function update() {
    $('outDecisionTitle').textContent = text('decisionTitle') || 'قرار إداري';
    $('outMeetingDate').textContent = text('meetingDate') || '—';
    $('outDecisionNumber').textContent = text('decisionNumber') ? `رقم ${text('decisionNumber')}` : '';
    $('outIntro').textContent = text('intro');
    $('outAssignmentLabel').textContent = text('assignmentLabel') || 'تكليف';
    $('outPersonName').textContent = text('personName') || 'اسم الشخص';
    $('outJobTitle').textContent = text('jobTitle') || 'المسمى الوظيفي';
    $('outJobSubtitle').textContent = text('jobSubtitle');
    $('outArticle2').textContent = text('article2');
    $('outArticle3').textContent = text('article3');
    $('outArticle4').textContent = text('article4');
    $('outSignerName').textContent = text('signerName');
    $('outSignerTitle').textContent = text('signerTitle');
    $('outIssueDate').textContent = text('issueDate') || '—';

    fillList('outCv', lines(text('cv')), true);
    fillList('outTasks', lines(text('tasks')), false);

    // Dynamic Font Scaling for Long Headings to prevent overflow
    const title = $('outDecisionTitle');
    title.style.fontSize = text('decisionTitle').length > 34 ? '36px' : '43px';

    const person = $('outPersonName');
    person.style.fontSize = text('personName').length > 19 ? '46px' : '57px';

    const job = $('outJobTitle');
    job.style.fontSize = text('jobTitle').length > 38 ? '23px' : '27px';

    saveLocal();
  }

  // -------------------------------------------------------------
  // 7. Responsive Viewport Poster Resizer
  // -------------------------------------------------------------
  function resizePoster() {
    if (!viewport || !poster) return;
    const available = Math.max(260, viewport.clientWidth - 24);
    currentPosterScale = Math.min(1, available / 1254);
    poster.style.transform = `scale(${currentPosterScale})`;
    viewport.style.height = `${1254 * currentPosterScale + 24}px`;

    const indicator = $('scaleIndicator');
    if (indicator) {
      indicator.textContent = `${Math.round(currentPosterScale * 100)}%`;
    }
  }

  // -------------------------------------------------------------
  // 8. Storage: LocalStorage & Restoring Saved State
  // -------------------------------------------------------------
  function saveLocal() {
    try {
      const values = {};
      [...form.querySelectorAll('input:not([type=file]):not([type=range]), textarea')].forEach(el => {
        values[el.name] = el.value;
      });
      values._portraitState = portraitState;
      localStorage.setItem('decisionMakerForm', JSON.stringify(values));
    } catch (_) {}
  }

  async function loadState() {
    // 1. Text Inputs and Portrait State
    try {
      const saved = JSON.parse(localStorage.getItem('decisionMakerForm') || 'null');
      if (saved) {
        Object.entries(saved).forEach(([name, value]) => {
          if (name === '_portraitState' && value) {
            Object.assign(portraitState, value);
          } else if (form.elements[name]) {
            form.elements[name].value = value;
          }
        });
      }
    } catch (_) {}

    // 2. Images from IndexedDB (or fallback to DEFAULT_ASSETS)
    const storedPortrait = await getStoredImage('portrait');
    const portraitSrc = storedPortrait || getDefaultAsset('sample-portrait.jpg');
    $('outPortrait').src = portraitSrc;
    if ($('portraitThumb')) $('portraitThumb').src = portraitSrc;

    const storedSig = await getStoredImage('signature');
    const sigSrc = storedSig || getDefaultAsset('sample-signature.jpg');
    $('outSignature').src = sigSrc;
    if ($('signatureThumb')) $('signatureThumb').src = sigSrc;

    const storedMin = await getStoredImage('logo_ministry');
    const minSrc = storedMin || getDefaultAsset('logo-ministry.jpg');
    $('logoMinistry').src = minSrc;
    if ($('thumbMinistry')) $('thumbMinistry').src = minSrc;

    const storedUnion = await getStoredImage('logo_union');
    const unionSrc = storedUnion || getDefaultAsset('logo-union.jpg');
    $('logoUnion').src = unionSrc;
    if ($('thumbUnion')) $('thumbUnion').src = unionSrc;

    const storedFed = await getStoredImage('logo_federation');
    const fedSrc = storedFed || getDefaultAsset('logo-federation.jpg');
    $('logoFederation').src = fedSrc;
    if ($('thumbFederation')) $('thumbFederation').src = fedSrc;

    applyPortraitTransform();
    update();
  }

  // -------------------------------------------------------------
  // 9. High Fidelity Image Export (PNG & JPG) & Clipboard Copy
  // -------------------------------------------------------------
  async function generatePosterCanvas(scale = 2) {
    if (typeof html2canvas !== 'function') {
      throw new Error('تعذر تحميل أداة إنشاء الصورة.');
    }

    // Wait for fonts to be loaded
    if (document.fonts) {
      try { await document.fonts.ready; } catch (_) {}
    }

    document.body.classList.add('exporting');
    const prevTransform = poster.style.transform;
    poster.style.transform = 'none';

    // Wait 1 frame for layout recalculation
    await new Promise(r => requestAnimationFrame(r));

    try {
      const canvas = await html2canvas(poster, {
        scale: scale,
        backgroundColor: '#f8f5f2',
        useCORS: true,
        allowTaint: false,
        logging: false,
        width: 1254,
        height: 1254,
        windowWidth: 1400
      });
      return canvas;
    } finally {
      poster.style.transform = prevTransform;
      document.body.classList.remove('exporting');
      resizePoster();
    }
  }

  function getExportFilename(extension = 'png') {
    const person = text('personName') || 'قرار';
    const num = text('decisionNumber') ? `-${text('decisionNumber')}` : '';
    const clean = person.replace(/[\\/:*?"<>|]/g, '').trim().replace(/\s+/g, '-');
    return `قرار-إداري-${clean}${num}.${extension}`;
  }

  async function exportImage(format = 'png') {
    const btn = $('downloadBtn');
    const originalText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<span>⏳</span> جارٍ تجهيز الصورة…';
    showToast('جارٍ تصدير التصميم بدقة عالية…');

    try {
      const canvas = await generatePosterCanvas(2); // 2508x2508
      const link = document.createElement('a');

      if (format === 'jpg' || format === 'jpeg') {
        link.download = getExportFilename('jpg');
        link.href = canvas.toDataURL('image/jpeg', 0.92);
      } else {
        link.download = getExportFilename('png');
        link.href = canvas.toDataURL('image/png');
      }

      link.click();
      showToast('تم تحميل صورة القرار بنجاح!');
    } catch (err) {
      console.error(err);
      showToast('حدثت مشكلة أثناء إنشاء الصورة. جرب خيار الطباعة إلى PDF.');
    } finally {
      btn.disabled = false;
      btn.innerHTML = originalText;
    }
  }

  async function copyImageToClipboard() {
    const btn = $('copyBtn');
    const originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'جارٍ النسخ…';
    showToast('جارٍ نسخ الصورة إلى الحافظة…');

    try {
      const canvas = await generatePosterCanvas(1.5);
      canvas.toBlob(async (blob) => {
        if (!blob) {
          showToast('تعذر إنشاء بيانات الصورة للنسخ.');
          return;
        }
        try {
          if (navigator.clipboard && navigator.clipboard.write) {
            await navigator.clipboard.write([
              new ClipboardItem({ 'image/png': blob })
            ]);
            showToast('تم نسخ الصورة بنجاح! يمكنك الآن لصقها في أي مكان (Ctrl+V).');
          } else {
            showToast('خاصية النسخ المباشر غير مدعومة في متصفحك، استخدم زر التحميل.');
          }
        } catch (e) {
          console.error(e);
          showToast('تعذر الوصول للحافظة، يمكنك استخدام زر التحميل.');
        } finally {
          btn.disabled = false;
          btn.textContent = originalText;
        }
      }, 'image/png');
    } catch (err) {
      console.error(err);
      btn.disabled = false;
      btn.textContent = originalText;
      showToast('حدثت مشكلة أثناء معالجة الصورة.');
    }
  }

  // Download buttons binding
  $('downloadBtn')?.addEventListener('click', () => exportImage('png'));
  $('downloadPngOpt')?.addEventListener('click', () => {
    $('downloadMenu')?.classList.remove('show');
    exportImage('png');
  });
  $('downloadJpgOpt')?.addEventListener('click', () => {
    $('downloadMenu')?.classList.remove('show');
    exportImage('jpg');
  });

  // Dropdown toggle
  const downloadMoreBtn = $('downloadMoreBtn');
  const downloadMenu = $('downloadMenu');
  if (downloadMoreBtn && downloadMenu) {
    downloadMoreBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      downloadMenu.classList.toggle('show');
      downloadMoreBtn.setAttribute('aria-expanded', downloadMenu.classList.contains('show'));
    });
    document.addEventListener('click', () => {
      downloadMenu.classList.remove('show');
      downloadMoreBtn.setAttribute('aria-expanded', 'false');
    });
  }

  // Copy to Clipboard
  $('copyBtn')?.addEventListener('click', copyImageToClipboard);

  // Print button
  $('printBtn')?.addEventListener('click', () => window.print());

  // Global Reset Form
  $('resetBtn')?.addEventListener('click', async () => {
    if (!confirm('هل تريد بالتأكيد إعادة النموذج والصور إلى الوضع الافتراضي؟')) return;

    // Reset textual values
    Object.entries(defaults).forEach(([name, value]) => {
      if (form.elements[name]) form.elements[name].value = value;
    });

    // Clear saved images from IndexedDB
    await clearStoredImages();
    localStorage.removeItem('decisionMakerForm');

    // Restore default assets
    $('outPortrait').src = getDefaultAsset('sample-portrait.jpg');
    if ($('portraitThumb')) $('portraitThumb').src = getDefaultAsset('sample-portrait.jpg');

    $('outSignature').src = getDefaultAsset('sample-signature.jpg');
    if ($('signatureThumb')) $('signatureThumb').src = getDefaultAsset('sample-signature.jpg');

    $('logoMinistry').src = getDefaultAsset('logo-ministry.jpg');
    if ($('thumbMinistry')) $('thumbMinistry').src = getDefaultAsset('logo-ministry.jpg');

    $('logoUnion').src = getDefaultAsset('logo-union.jpg');
    if ($('thumbUnion')) $('thumbUnion').src = getDefaultAsset('logo-union.jpg');

    $('logoFederation').src = getDefaultAsset('logo-federation.jpg');
    if ($('thumbFederation')) $('thumbFederation').src = getDefaultAsset('logo-federation.jpg');

    // Reset file inputs
    ['portraitUpload', 'signatureUpload', 'ministryUpload', 'unionUpload', 'federationUpload'].forEach(id => {
      if ($(id)) $(id).value = '';
    });

    // Reset portrait transforms
    portraitState.zoom = 100;
    portraitState.x = 0;
    portraitState.y = 0;
    portraitState.rotate = 0;
    applyPortraitTransform();

    update();
    showToast('تمت إعادة ضبط النموذج بالكامل للقيم الافتراضية.');
  });

  // Form listeners
  form.addEventListener('input', update);
  form.addEventListener('change', update);

  // -------------------------------------------------------------
  // 10. Startup Initializations
  // -------------------------------------------------------------
  loadState();

  const observer = new ResizeObserver(resizePoster);
  if (viewport) observer.observe(viewport);
  window.addEventListener('resize', resizePoster);
  resizePoster();
})();
