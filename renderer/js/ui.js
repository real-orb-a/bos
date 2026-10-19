// Shared UI helpers: non-blocking toasts and an in-app confirmation dialog.
// Replaces alert()/confirm(), which block the whole window (including the live clock display).
window.BOSUI = (function () {
  const ICONS = {
    close: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>'
  };

  function toast(message, options) {
    const opts = Object.assign({ type: 'info', duration: 4000 }, options);
    const region = document.getElementById('toast-region');
    if (!region) { console.warn('[BOSUI] toast region missing:', message); return null; }

    // Keep the stack short so an error storm cannot cover the controls.
    while (region.children.length >= 4) region.removeChild(region.firstChild);

    const node = document.createElement('div');
    node.className = `toast ${opts.type}`;
    node.setAttribute('role', opts.type === 'error' ? 'alert' : 'status');

    const text = document.createElement('span');
    text.textContent = String(message);
    node.appendChild(text);

    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'toast-close';
    close.setAttribute('aria-label', 'Dismiss message');
    close.innerHTML = ICONS.close;
    close.addEventListener('click', () => node.remove());
    node.appendChild(close);

    region.appendChild(node);
    // Errors stay longer; duration 0 keeps the toast until dismissed.
    const duration = opts.type === 'error' && options && options.duration === undefined ? 8000 : opts.duration;
    if (duration > 0) setTimeout(() => node.remove(), duration);
    return node;
  }

  let confirmState = null;

  function ensureConfirmDialog() {
    let backdrop = document.getElementById('confirm-modal');
    if (backdrop) return backdrop;
    backdrop = document.createElement('div');
    backdrop.id = 'confirm-modal';
    backdrop.className = 'modal-backdrop hidden';
    backdrop.innerHTML = `
      <div class="modal-dialog confirm-dialog" role="alertdialog" aria-modal="true"
           aria-labelledby="confirm-title" aria-describedby="confirm-message">
        <div class="modal-header"><h2 id="confirm-title"></h2></div>
        <div class="confirm-body" id="confirm-message"></div>
        <div class="modal-footer">
          <button type="button" class="action-btn-secondary" id="confirm-cancel"></button>
          <button type="button" class="primary-action-btn" id="confirm-ok"></button>
        </div>
      </div>`;
    document.body.appendChild(backdrop);

    backdrop.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); settle(false); }
      if (e.key === 'Tab') { // keep focus inside the dialog
        const buttons = [backdrop.querySelector('#confirm-cancel'), backdrop.querySelector('#confirm-ok')];
        const first = buttons[0];
        const last = buttons[1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    });
    backdrop.querySelector('#confirm-cancel').addEventListener('click', () => settle(false));
    backdrop.querySelector('#confirm-ok').addEventListener('click', () => settle(true));
    return backdrop;
  }

  function settle(result) {
    if (!confirmState) return;
    const { resolve, returnFocus } = confirmState;
    confirmState = null;
    document.getElementById('confirm-modal').classList.add('hidden');
    if (returnFocus && typeof returnFocus.focus === 'function') returnFocus.focus();
    resolve(result);
  }

  /** Resolves true only if the operator explicitly confirms. Cancel is focused by default. */
  function confirm(options) {
    const opts = Object.assign({ title: 'Are you sure?', message: '', confirmLabel: 'CONFIRM', cancelLabel: 'CANCEL' }, options);
    if (confirmState) settle(false);
    const backdrop = ensureConfirmDialog();
    backdrop.querySelector('#confirm-title').textContent = opts.title;
    backdrop.querySelector('#confirm-message').textContent = opts.message;
    backdrop.querySelector('#confirm-ok').textContent = opts.confirmLabel;
    backdrop.querySelector('#confirm-cancel').textContent = opts.cancelLabel;
    return new Promise((resolve) => {
      confirmState = { resolve, returnFocus: document.activeElement };
      backdrop.classList.remove('hidden');
      backdrop.querySelector('#confirm-cancel').focus();
    });
  }

  /** True while any modal dialog is on screen (used to suspend global hotkeys). */
  function isModalOpen() {
    return !!document.querySelector('.modal-backdrop:not(.hidden)');
  }

  return { toast, confirm, isModalOpen };
})();
