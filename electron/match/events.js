const EventEmitter = require('events');

class EventLogger extends EventEmitter {
  constructor() {
    super();
    this.events = [];
  }

  recordEvent(type, details = {}) {
    const event = {
      id: `evt_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      timestamp: Date.now(),
      isoTime: new Date().toISOString(),
      displayTime: new Date().toLocaleTimeString(),
      type,
      ...details
    };
    this.events.unshift(event);
    // Keep max 200 events in memory
    if (this.events.length > 200) {
      this.events.pop();
    }
    this.emit('eventAdded', event);
    return event;
  }

  getEvents(limit = 50) {
    return this.events.slice(0, limit);
  }

  clearEvents() {
    this.events = [];
    this.emit('eventsCleared');
  }
}

module.exports = EventLogger;
