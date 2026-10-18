// The Claude subscription's usage windows (5-hour and weekly), from the rate_limit_event lines
// that claude writes to its stream-json output and claude-wrap.exe passes on (/usage).
const fs = require('fs');
const { t } = require('../i18n');
const { timeText } = require('../sidebar/time');

// The windows the side bar shows, in its order, with their short label and their name.
// seven_day_overage_included, a weekly bucket that only some accounts have, is left out.
const WINDOWS = [
  { key: 'five_hour', words: () => ({ label: t('5 hours'), name: t('5-hour limit') }) },
  { key: 'seven_day', words: () => ({ label: t('Week'), name: t('Weekly limit') }) },
];
// From this share of a window on, it shows as a warning.
const WARN_AT = 0.8;
const STALE_AFTER = 15 * 60 * 1000;

// utilization is the share used (0-1, above 1 past the cap); resetsAt is in unix seconds.
const isWindow = (window) => Number.isFinite(window?.utilization) && Number.isInteger(window?.resetsAt);

// The windows a rate_limit_event carries: key -> { utilization, resetsAt }. The event names them
// in rate_limit_info.unifiedWindows, which claude marks as internal: anything else gives {}.
function windowsOf(event) {
  const windows = event?.type === 'rate_limit_event' ? event.rate_limit_info?.unifiedWindows : null;
  const result = {};
  for (const { key } of WINDOWS) {
    const window = windows?.[key];
    if (isWindow(window)) result[key] = { utilization: window.utilization, resetsAt: window.resetsAt };
  }
  return result;
}

// The latest value of each window, kept in a file so it shows again after a restart. claude
// only reports the windows when a rounded share or a reset time moves, so a window an event
// lacks keeps its value (as the Claude Code extension does), until it resets.
class UsageTracker {
  constructor(file) {
    this.file = file;
    // key -> { utilization, resetsAt, at }; at is when it came (ms).
    this.windows = {};
    this.latest = -Infinity;
    this.status = 'Waiting for usage';
    let saved = {};
    try {
      saved = JSON.parse(fs.readFileSync(file, 'utf8')).windows || {};
    } catch {
      // Nothing yet.
    }
    for (const { key } of WINDOWS) {
      const window = saved[key];
      if (isWindow(window) && Number.isFinite(window.at)) {
        this.windows[key] = { utilization: window.utilization, resetsAt: window.resetsAt, at: window.at };
      }
    }
  }

  // Takes a rate_limit_event. Returns true when it had a window.
  take(event, now = Date.now()) {
    const windows = windowsOf(event);
    if (!Object.keys(windows).length) return false;
    this.latest = now;
    this.status = '';
    for (const [key, window] of Object.entries(windows)) this.windows[key] = { ...window, at: now };
    this.save();
    return true;
  }

  // Forgets the windows that have reset: their new share comes with a later response. Returns
  // true when one was forgotten.
  expire(now = Date.now()) {
    const reset = Object.keys(this.windows).filter((key) => this.windows[key].resetsAt * 1000 <= now);
    for (const key of reset) delete this.windows[key];
    if (reset.length) this.save();
    return reset.length > 0;
  }

  view(now = Date.now()) {
    return usageView(this.windows, now);
  }

  // A full quota read replaces missing windows, but cannot overwrite a newer live event.
  refresh(windows, at, now = Date.now()) {
    if (at < this.latest) return;
    this.latest = at;
    this.windows = {};
    for (const { key } of WINDOWS) if (isWindow(windows[key])) this.windows[key] = { ...windows[key], at: now };
    this.status = Object.keys(this.windows).length ? '' : 'Usage unavailable';
    this.save();
  }

  providerView(now = Date.now()) {
    const windows = this.view(now).map((window) => now - this.windows[window.key].at < STALE_AFTER ? window : {
      ...window, percent: null, level: 'unknown', detail: t('Stale usage'),
      title: [t('Stale usage'), window.resets, window.received].filter(Boolean).join('\n'),
    });
    return { windows, status: windows.length ? '' : t(this.status || 'Waiting for refresh') };
  }

  save() {
    try {
      fs.writeFileSync(this.file, `${JSON.stringify({ windows: this.windows }, null, 2)}\n`);
    } catch {
      // Shown until the app closes anyway.
    }
  }
}

// What the side bar shows for each window that has not reset: { key, label, percent, level,
// resets, title }. level is 'ok', 'warn' (from WARN_AT) or 'over' (the cap reached).
function usageView(windows, now = Date.now()) {
  return WINDOWS.filter(({ key }) => windows[key] && windows[key].resetsAt * 1000 > now).map(({ key, words }) => {
    const { label, name } = words();
    const { utilization, resetsAt, at } = windows[key];
    const percent = Math.round(utilization * 100);
    const resets = new Date(resetsAt * 1000);
    const title = [t('{name}: {percent}% used', { name, percent }), t('Resets {time}', { time: timeText(resets, now, { weekday: true }) })];
    if (Number.isFinite(at)) title.push(t('Received {time}', { time: timeText(new Date(at), now) }));
    return {
      key,
      label,
      percent,
      level: utilization >= 1 ? 'over' : utilization >= WARN_AT ? 'warn' : 'ok',
      resets: t('Resets {time}', { time: timeText(resets, now) }),
      resetTime: timeText(resets, now),
      received: Number.isFinite(at) ? t('Received {time}', { time: timeText(new Date(at), now) }) : '',
      title: title.join('\n'),
    };
  });
}

module.exports = { UsageTracker, usageView, windowsOf };
