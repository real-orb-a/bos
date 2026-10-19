// Graphics & Lower-Third Controller Module
window.GraphicsModule = (function() {
  const activeGraphicCard = document.getElementById('active-graphic-card');
  const activeLtTitle = document.getElementById('active-lt-title');
  const activeLtTimer = document.getElementById('active-lt-timer');
  const btnHideLowerthird = document.getElementById('btn-hide-lowerthird');

  const inputLtTitle = document.getElementById('input-lt-title');
  const inputLtSubtitle = document.getElementById('input-lt-subtitle');
  const inputLtValue = document.getElementById('input-lt-value');
  const inputLtDuration = document.getElementById('input-lt-duration');
  const selectLtPosition = document.getElementById('select-lt-position');
  const inputLtColor = document.getElementById('input-lt-color');

  const btnShowLowerthird = document.getElementById('btn-show-lowerthird');
  const btnQueueLowerthird = document.getElementById('btn-queue-lowerthird');
  const presetContainer = document.getElementById('preset-buttons-container');
  const graphicsQueueList = document.getElementById('graphics-queue-list');
  const btnClearQueue = document.getElementById('btn-clear-queue');

  function init() {
    bindEvents();
    loadPresets();
    loadQueue();
    listenIpc();
  }

  function bindEvents() {
    btnShowLowerthird.addEventListener('click', () => {
      showCurrentMessage();
    });

    btnHideLowerthird.addEventListener('click', () => {
      window.bosAPI.graphics.hideLowerThird();
    });

    btnQueueLowerthird.addEventListener('click', () => {
      const item = getValidatedFormData();
      if (item) window.bosAPI.graphics.enqueue(item);
    });

    btnClearQueue.addEventListener('click', () => {
      window.bosAPI.graphics.clearQueue();
    });

  }

  // A blank title used to be silently replaced with "UNDER REVIEW" and sent to air.
  function getValidatedFormData() {
    if (!inputLtTitle.value.trim()) {
      inputLtTitle.setAttribute('aria-invalid', 'true');
      inputLtTitle.focus();
      window.BOSUI.toast('Enter a title before showing or queueing a message.', { type: 'warning' });
      return null;
    }
    inputLtTitle.removeAttribute('aria-invalid');
    return getFormData();
  }

  function getFormData() {
    return {
      title: inputLtTitle.value.trim(),
      subtitle: inputLtSubtitle.value.trim(),
      value: inputLtValue.value.trim(),
      duration: parseInt(inputLtDuration.value, 10) || 5,
      position: selectLtPosition.value,
      style: 'standard',
      color: inputLtColor.value || '#eab308'
    };
  }

  function showCurrentMessage() {
    const data = getValidatedFormData();
    if (data) window.bosAPI.graphics.showLowerThird(data);
  }

  async function loadPresets() {
    try {
      const presets = await window.bosAPI.graphics.getPresets();
      presetContainer.innerHTML = '';
      presets.forEach(p => {
        const btn = document.createElement('button');
        btn.className = 'preset-btn';
        btn.type = 'button';
        btn.title = 'Show on air now';
        const presetTitle = document.createElement('span');
        presetTitle.className = 'preset-title';
        presetTitle.textContent = p.title;
        const presetSub = document.createElement('span');
        presetSub.className = 'preset-sub';
        presetSub.textContent = p.subtitle || '';
        btn.append(presetTitle, presetSub);
        btn.addEventListener('click', () => {
          inputLtTitle.value = p.title;
          inputLtSubtitle.value = p.subtitle || '';
          inputLtDuration.value = p.duration || 5;
          // Immediately show preset on air
          window.bosAPI.graphics.showLowerThird({
            title: p.title,
            subtitle: p.subtitle,
            duration: p.duration,
            style: 'standard',
            position: selectLtPosition.value,
            color: inputLtColor.value || '#eab308'
          });
        });
        presetContainer.appendChild(btn);
      });
    } catch (e) {
      console.error('Error loading presets:', e);
    }
  }

  async function loadQueue() {
    try {
      const queueState = await window.bosAPI.graphics.getQueue();
      renderQueue(queueState);
    } catch (e) {
      console.error('Error loading queue:', e);
    }
  }

  function renderQueue(queueState) {
    if (!queueState) return;

    // Active graphic
    if (queueState.active) {
      activeGraphicCard.classList.add('on-air');
      activeLtTitle.textContent = queueState.active.title;
      activeLtTimer.textContent = `${String(queueState.active.remainingSeconds).padStart(2, '0')}s REMAINING`;
    } else {
      activeGraphicCard.classList.remove('on-air');
      activeLtTitle.textContent = 'NO GRAPHIC ON AIR';
      activeLtTimer.textContent = 'READY';
    }

    // Queued items
    const queued = queueState.queued || [];
    if (queued.length === 0) {
      graphicsQueueList.innerHTML = '<div class="empty-queue-hint">Queue is empty</div>';
      return;
    }

    graphicsQueueList.innerHTML = '';
    queued.forEach((item, idx) => {
      const div = document.createElement('div');
      div.className = 'queue-item';

      const label = document.createElement('div');
      const strong = document.createElement('span');
      strong.className = 'queue-item-title';
      strong.textContent = `${idx + 1}. ${item.title}`;
      const meta = document.createElement('span');
      meta.className = 'queue-item-meta';
      meta.textContent = `${item.subtitle || ''} (${item.duration}s)`;
      label.append(strong, meta);

      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'queue-remove-btn';
      remove.title = 'Remove from queue';
      remove.setAttribute('aria-label', `Remove ${item.title} from queue`);
      remove.innerHTML = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>';
      remove.addEventListener('click', () => {
        window.bosAPI.graphics.removeFromQueue(item.id);
      });

      div.append(label, remove);
      graphicsQueueList.appendChild(div);
    });
  }

  function listenIpc() {
    window.bosAPI.graphics.onQueueUpdated((queueState) => {
      renderQueue(queueState);
    });
  }

  return { init, showCurrentMessage };
})();
