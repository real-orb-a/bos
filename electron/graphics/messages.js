const EventEmitter = require('events');

class MessagesManager extends EventEmitter {
  constructor() {
    super();
    this.queue = [];
    this.activeGraphic = null;
    this.presets = [
      { id: 'under_review', title: 'UNDER REVIEW', subtitle: 'DECISION PENDING', style: 'alert', duration: 6 },
      { id: 'goal_check', title: 'GOAL CHECK', subtitle: 'POSSIBLE OFFSIDE', style: 'alert', duration: 6 },
      { id: 'decision_confirmed', title: 'DECISION CONFIRMED', subtitle: 'GOAL AWARDED', style: 'f1-banner', duration: 4 },
      { id: 'no_goal', title: 'NO GOAL', subtitle: 'DECISION OVERTURNED', style: 'alert', duration: 5 },
      { id: 'match_delayed', title: 'MATCH DELAYED', subtitle: 'WEATHER / SAFETY', style: 'standard', duration: 8 },
      { id: 'resuming_shortly', title: 'MATCH RESUMING SHORTLY', subtitle: 'PLAYERS ON PITCH', style: 'standard', duration: 6 },
      { id: 'technical_difficulty', title: 'TECHNICAL DIFFICULTY', subtitle: 'PLEASE STAND BY', style: 'standard', duration: 8 },
      { id: 'half_time', title: 'HALF TIME', subtitle: 'INTERVAL REPORT', style: 'standard', duration: 6 }
    ];
  }

  getPresets() {
    return this.presets;
  }

  enqueue(item) {
    const queueItem = {
      id: `q_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      title: item.title,
      subtitle: item.subtitle || '',
      duration: item.duration || 5,
      position: item.position || 'bottom-left',
      style: item.style || 'standard',
      timestamp: Date.now()
    };
    this.queue.push(queueItem);
    this.emit('queueUpdated', this.getQueueState());
    return queueItem;
  }

  dequeue() {
    if (this.queue.length === 0) return null;
    const item = this.queue.shift();
    this.emit('queueUpdated', this.getQueueState());
    return item;
  }

  removeItem(id) {
    this.queue = this.queue.filter(item => item.id !== id);
    this.emit('queueUpdated', this.getQueueState());
  }

  clearQueue() {
    this.queue = [];
    this.emit('queueUpdated', this.getQueueState());
  }

  getQueueState() {
    return {
      active: this.activeGraphic,
      queued: [...this.queue]
    };
  }
}

module.exports = MessagesManager;
