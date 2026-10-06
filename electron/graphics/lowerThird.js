const EventEmitter = require('events');

class LowerThirdGraphicsController extends EventEmitter {
  constructor(configManager) {
    super();
    this.config = configManager;
    this.isVisible = false;
    this.currentData = null;
    this.dismissTimer = null;
    this.remainingSeconds = 0;
    this.timerInterval = null;
  }

  show(data = {}) {
    const title = data.title || 'UNDER REVIEW';
    const subtitle = data.subtitle || 'DECISION PENDING';
    const duration = data.duration !== undefined ? data.duration : (this.config.get('graphics.defaultLowerThirdDuration') || 5);
    const position = data.position || 'bottom-left';
    const animation = data.animation || this.config.get('graphics.animationStyle') || 'slide-in';
    const style = data.style || 'standard'; // 'standard', 'f1-banner', 'alert'
    const color = data.color || this.config.get('graphics.lowerThirdColor') || ''; // house accent
    const badge = data.badge || ''; // right-block label (defaults to 'BROADCAST' in the overlay)
    const value = data.value || ''; // right-block highlight value (e.g. "+2ND")

    this._clearTimers();
    this.isVisible = true;
    this.currentData = {
      title,
      subtitle,
      badge,
      value,
      duration,
      position,
      animation,
      style,
      color,
      timestamp: Date.now()
    };

    if (duration > 0) {
      this.remainingSeconds = duration;
      this.timerInterval = setInterval(() => {
        this.remainingSeconds--;
        this.emit('tick', { remainingSeconds: this.remainingSeconds, current: this.currentData });
        if (this.remainingSeconds <= 0) {
          this.hide();
        }
      }, 1000);
    }

    const payload = {
      type: 'LOWER_THIRD_SHOW',
      data: this.currentData
    };

    this.emit('show', payload);
    return payload;
  }

  hide() {
    this._clearTimers();
    this.isVisible = false;
    this.remainingSeconds = 0;
    const payload = {
      type: 'LOWER_THIRD_HIDE',
      timestamp: Date.now()
    };
    this.emit('hide', payload);
    return payload;
  }

  _clearTimers() {
    if (this.dismissTimer) {
      clearTimeout(this.dismissTimer);
      this.dismissTimer = null;
    }
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
  }

  getState() {
    return {
      isVisible: this.isVisible,
      currentData: this.currentData,
      remainingSeconds: this.remainingSeconds
    };
  }
}

module.exports = LowerThirdGraphicsController;
