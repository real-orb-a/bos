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
      const item = getFormData();
      window.bosAPI.graphics.enqueue(item);
    });

    btnClearQueue.addEventListener('click', () => {
      window.bosAPI.graphics.clearQueue();
    });

  }

  function getFormData() {
    return {
      title: inputLtTitle.value.trim() || 'UNDER REVIEW',
      subtitle: inputLtSubtitle.value.trim(),
      value: inputLtValue.value.trim(),
      duration: parseInt(inputLtDuration.value, 10) || 5,
      position: selectLtPosition.value,
      style: 'standard',
      color: inputLtColor.value || '#eab308'
    };
  }

  function showCurrentMessage() {
    const data = getFormData();
    window.bosAPI.graphics.showLowerThird(data);
  }

  async function loadPresets() {
    try {
      const presets = await window.bosAPI.graphics.getPresets();
      presetContainer.innerHTML = '';
      presets.forEach(p => {
        const btn = document.createElement('button');
        btn.className = 'preset-btn';
        btn.innerHTML = `
          <span class="preset-title">${p.title}</span>
          <span class="preset-sub">${p.subtitle || ''}</span>
        `;
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
      div.innerHTML = `
        <div>
          <strong style="color:#ffffff;">${idx + 1}. ${item.title}</strong>
          <span style="color:var(--text-dim); margin-left:8px; font-size:11px;">${item.subtitle || ''} (${item.duration}s)</span>
        </div>
        <button class="queue-remove-btn" title="Remove">✕</button>
      `;
      div.querySelector('.queue-remove-btn').addEventListener('click', () => {
        window.bosAPI.graphics.removeFromQueue(item.id);
      });
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
