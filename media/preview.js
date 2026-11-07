// @ts-check
(function () {
  const vscode = acquireVsCodeApi();

  const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));
  const stage = $('stage');
  const image = /** @type {HTMLImageElement} */ ($('image'));
  const message = $('message');
  const status = $('status');
  const zoomLabel = $('zoomLabel');
  const artboardSelect = /** @type {HTMLSelectElement} */ ($('artboard'));
  const setup = $('setup');
  const setupStatus = $('setupStatus');
  const downloadButton = /** @type {HTMLButtonElement} */ ($('download'));
  /** @type {Record<string, string>} */
  const S = JSON.parse(document.body.dataset.strings || '{}');

  const MIN_ZOOM = 0.02;
  const MAX_ZOOM = 64;
  const BACKGROUNDS = ['bg-checker', 'bg-light', 'bg-dark', 'bg-editor'];

  const saved = vscode.getState() || {};
  let background = BACKGROUNDS.includes(saved.background) ? saved.background : BACKGROUNDS[0];
  let zoom = 1;
  let x = 0;
  let y = 0;
  /** Size of the artwork in points (CSS px at 100 %). */
  let baseWidth = 0;
  let baseHeight = 0;
  let imageKey = '';
  let pendingFit = true;
  let lastInfo = '';

  setBackground(background);

  function setBackground(/** @type {string} */ name) {
    stage.classList.remove(...BACKGROUNDS);
    stage.classList.add(name);
    background = name;
    vscode.setState({ ...vscode.getState(), background });
  }

  function apply() {
    image.style.width = `${baseWidth}px`;
    image.style.height = `${baseHeight}px`;
    image.style.transform = `translate(${x}px, ${y}px) scale(${zoom})`;
    image.classList.toggle('pixelated', zoom >= 4);
    zoomLabel.textContent = `${Math.round(zoom * 100)}%`;
  }

  function fit() {
    if (!baseWidth || !baseHeight) return;
    const pad = 24;
    const w = Math.max(1, stage.clientWidth - pad * 2);
    const h = Math.max(1, stage.clientHeight - pad * 2);
    zoom = clamp(Math.min(w / baseWidth, h / baseHeight, 1));
    center();
  }

  function actualSize() {
    zoom = 1;
    center();
  }

  function center() {
    x = (stage.clientWidth - baseWidth * zoom) / 2;
    y = (stage.clientHeight - baseHeight * zoom) / 2;
    apply();
  }

  function clamp(/** @type {number} */ z) {
    return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
  }

  /** Zoom by `factor`, keeping the stage point (px, py) still. */
  function zoomAt(/** @type {number} */ factor, /** @type {number} */ px, /** @type {number} */ py) {
    const next = clamp(zoom * factor);
    const ratio = next / zoom;
    x = px - (px - x) * ratio;
    y = py - (py - y) * ratio;
    zoom = next;
    apply();
  }

  function zoomCenter(/** @type {number} */ factor) {
    zoomAt(factor, stage.clientWidth / 2, stage.clientHeight / 2);
  }

  function showMessage(/** @type {string} */ text, isError = false) {
    message.textContent = text;
    message.classList.toggle('error', isError);
    message.classList.toggle('visible', Boolean(text));
  }

  // --- toolbar -------------------------------------------------------------
  $('zoomIn').addEventListener('click', () => zoomCenter(1.25));
  $('zoomOut').addEventListener('click', () => zoomCenter(1 / 1.25));
  $('fit').addEventListener('click', fit);
  $('actual').addEventListener('click', actualSize);
  $('background').addEventListener('click', () => {
    setBackground(BACKGROUNDS[(BACKGROUNDS.indexOf(background) + 1) % BACKGROUNDS.length]);
  });
  $('refresh').addEventListener('click', () => vscode.postMessage({ type: 'refresh' }));
  $('openSource').addEventListener('click', () => vscode.postMessage({ type: 'openSource' }));
  $('openInApp').addEventListener('click', () => vscode.postMessage({ type: 'openInApp' }));
  downloadButton.addEventListener('click', () => vscode.postMessage({ type: 'download' }));
  $('selectCli').addEventListener('click', () => vscode.postMessage({ type: 'selectCli' }));
  artboardSelect.addEventListener('change', () => {
    pendingFit = true;
    vscode.postMessage({ type: 'artboard', index: Number(artboardSelect.value) });
  });

  // --- mouse ---------------------------------------------------------------
  stage.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const rect = stage.getBoundingClientRect();
      const factor = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0015));
      zoomAt(factor, e.clientX - rect.left, e.clientY - rect.top);
    },
    { passive: false },
  );

  /** @type {{x: number, y: number, ox: number, oy: number} | null} */
  let drag = null;
  stage.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 && e.button !== 1) return;
    if (!setup.hidden || !image.src) return;
    drag = { x: e.clientX, y: e.clientY, ox: x, oy: y };
    stage.setPointerCapture(e.pointerId);
    stage.classList.add('dragging');
  });
  stage.addEventListener('pointermove', (e) => {
    if (!drag) return;
    x = drag.ox + e.clientX - drag.x;
    y = drag.oy + e.clientY - drag.y;
    apply();
  });
  const endDrag = () => {
    drag = null;
    stage.classList.remove('dragging');
  };
  stage.addEventListener('pointerup', endDrag);
  stage.addEventListener('pointercancel', endDrag);
  stage.addEventListener('dblclick', fit);

  // --- keyboard ------------------------------------------------------------
  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLSelectElement) return;
    if (e.key === '+' || e.key === '=') zoomCenter(1.25);
    else if (e.key === '-') zoomCenter(1 / 1.25);
    else if (e.key === '0') fit();
    else if (e.key === '1') actualSize();
    else return;
    e.preventDefault();
  });

  new ResizeObserver(() => {
    if (pendingFit) fit();
  }).observe(stage);

  // --- messages from the extension ----------------------------------------
  window.addEventListener('message', (event) => {
    const msg = event.data;
    setup.hidden = msg.type !== 'setup';
    switch (msg.type) {
      case 'setup':
        stage.classList.remove('loading');
        image.style.visibility = 'hidden';
        showMessage('');
        status.textContent = '';
        downloadButton.disabled = Boolean(msg.downloading);
        setupStatus.textContent = msg.downloading ? S.downloading : '';
        break;

      case 'loading':
        stage.classList.add('loading');
        status.textContent = S.rendering;
        if (!image.src) showMessage(S.rendering);
        break;

      case 'error':
        stage.classList.remove('loading');
        status.textContent = S.error;
        showMessage(msg.message, true);
        break;

      case 'image': {
        const boards = /** @type {string[]} */ (msg.artboards || []);
        artboardSelect.hidden = boards.length < 2;
        artboardSelect.replaceChildren(
          ...boards.map((label, i) => {
            const option = document.createElement('option');
            option.value = String(i);
            option.textContent = `${i + 1}. ${label}`;
            return option;
          }),
        );
        artboardSelect.value = String(msg.index);

        const key = `${msg.index}|${msg.format}`;
        const loaded = new Image();
        loaded.onload = () => {
          const w = loaded.naturalWidth / msg.scale;
          const h = loaded.naturalHeight / msg.scale;
          const sizeChanged = Math.abs(w - baseWidth) > 0.5 || Math.abs(h - baseHeight) > 0.5;
          baseWidth = w;
          baseHeight = h;
          image.src = loaded.src;
          image.style.visibility = 'visible';
          stage.classList.remove('loading');
          showMessage('');
          if (pendingFit || key !== imageKey || sizeChanged) {
            fit();
            pendingFit = false;
          } else {
            apply();
          }
          imageKey = key;
          const warn = msg.warnings && msg.warnings.length
            ? ` · ⚠ ${S.warnings.replace('{0}', String(msg.warnings.length))}`
            : '';
          lastInfo = `${Math.round(w)}×${Math.round(h)} pt · ${msg.format.toUpperCase()} · ${msg.ms} ms${warn}`;
          status.textContent = lastInfo;
          status.title = (msg.warnings || []).join('\n');
        };
        loaded.onerror = () => {
          stage.classList.remove('loading');
          showMessage(S.imageFailed, true);
        };
        loaded.src = msg.src;
        break;
      }
    }
  });

  vscode.postMessage({ type: 'ready' });
})();
