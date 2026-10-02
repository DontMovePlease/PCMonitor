'use strict';

const COMPONENTS = Object.freeze(['cpu', 'gpu']);
const MAX_REASONABLE_C = Object.freeze({ cpu: 125, gpu: 120 });
const DEFAULT_TEMPERATURE_THRESHOLDS = Object.freeze({
  cpu: Object.freeze({ warning: 85, critical: 95 }),
  gpu: Object.freeze({ warning: 78, critical: 85 })
});

function readThreshold(env, key, fallback) {
  if (env[key] === undefined || String(env[key]).trim() === '') return fallback;
  const value = Number(env[key]);
  return Number.isFinite(value) && value >= 0 && value <= 120 ? value : fallback;
}

function loadTemperatureThresholds(env = process.env) {
  const result = {
    cpu: {
      warning: readThreshold(env, 'PC_MONITOR_CPU_TEMP_WARNING_C', DEFAULT_TEMPERATURE_THRESHOLDS.cpu.warning),
      critical: readThreshold(env, 'PC_MONITOR_CPU_TEMP_CRITICAL_C', DEFAULT_TEMPERATURE_THRESHOLDS.cpu.critical)
    },
    gpu: {
      warning: readThreshold(env, 'PC_MONITOR_GPU_TEMP_WARNING_C', DEFAULT_TEMPERATURE_THRESHOLDS.gpu.warning),
      critical: readThreshold(env, 'PC_MONITOR_GPU_TEMP_CRITICAL_C', DEFAULT_TEMPERATURE_THRESHOLDS.gpu.critical)
    }
  };

  for (const component of COMPONENTS) {
    if (result[component].warning >= result[component].critical) {
      result[component] = { ...DEFAULT_TEMPERATURE_THRESHOLDS[component] };
    }
  }
  return result;
}

function classifyTemperature(component, temperatureC, thresholds = DEFAULT_TEMPERATURE_THRESHOLDS) {
  if (!Number.isFinite(temperatureC)) return 'unavailable';
  if (temperatureC >= thresholds[component].critical) return 'critical';
  if (temperatureC >= thresholds[component].warning) return 'warning';
  return 'normal';
}

class TemperatureManager {
  constructor({ thresholds = loadTemperatureThresholds(), staleAfterMs = 45000, providers = {} } = {}) {
    this.thresholds = thresholds;
    this.staleAfterMs = staleAfterMs;
    this.sequence = 0;
    this.events = [];
    this.states = Object.fromEntries(COMPONENTS.map(component => {
      const provider = providers[component] || {};
      return [component, {
        defaultSource: provider.source || null,
        defaultNote: provider.note || 'Temperature provider has not produced a reading.',
        source: provider.source || null,
        note: provider.note || 'Temperature provider has not produced a reading.',
        available: false,
        temperatureC: null,
        sampledAt: null,
        alertLevel: 'normal',
        lastAlertSampleAt: null
      }];
    }));
  }

  setReading(component, reading = {}) {
    const state = this.states[component];
    if (!state) return false;

    const hasNumericTemperature = reading.temperatureC !== null
      && reading.temperatureC !== undefined
      && reading.temperatureC !== '';
    const temperatureC = Number(reading.temperatureC);
    const sampledAt = Number(reading.sampledAt) || Date.now();
    const valid = reading.available === true
      && hasNumericTemperature
      && Number.isFinite(temperatureC)
      && temperatureC >= 0
      && temperatureC <= MAX_REASONABLE_C[component]
      && Number.isFinite(sampledAt)
      && sampledAt > 0
      && sampledAt <= Date.now() + 30000;

    if (!valid) {
      this.setUnavailable(component, reading.source || state.source, reading.error || reading.note || 'Sensor returned an invalid or unavailable reading.');
      return false;
    }

    state.available = true;
    state.temperatureC = Math.round(temperatureC * 10) / 10;
    state.sampledAt = sampledAt;
    state.source = reading.source || state.source;
    state.note = reading.note || null;
    state.suppressAlerts = reading.suppressAlerts === true;

    if (!state.suppressAlerts && state.lastAlertSampleAt !== sampledAt) {
      this._updateAlert(component, state.temperatureC, sampledAt);
      state.lastAlertSampleAt = sampledAt;
    }
    return true;
  }

  setUnavailable(component, source, note) {
    const state = this.states[component];
    if (!state) return;
    state.available = false;
    state.source = source || state.source;
    state.note = note || 'Temperature sensor is unavailable.';
    // Retain the last validated reading and timestamp so the UI can label it stale.
  }

  reset() {
    this.events = [];
    for (const component of COMPONENTS) {
      this.clearReading(component);
    }
  }

  clearReading(component) {
      this.events = this.events.filter(event => event.component !== component);
      const state = this.states[component];
      if (!state) return;
      state.source = state.defaultSource;
      state.note = state.defaultNote;
      state.available = false;
      state.temperatureC = null;
      state.sampledAt = null;
      state.alertLevel = 'normal';
      state.lastAlertSampleAt = null;
      state.suppressAlerts = false;
  }

  _updateAlert(component, temperatureC, sampledAt) {
    const state = this.states[component];
    const previous = state.alertLevel;
    const next = classifyTemperature(component, temperatureC, this.thresholds);
    if (next === previous) return;
    state.alertLevel = next;

    let type;
    let message;
    if (next === 'warning' || next === 'critical') {
      type = next;
      message = `${component.toUpperCase()} temperature ${next}: ${temperatureC}°C.`;
    } else if (next === 'normal' && (previous === 'warning' || previous === 'critical')) {
      type = 'recovered';
      message = `${component.toUpperCase()} temperature recovered: ${temperatureC}°C.`;
    } else if (previous === 'critical' && next === 'warning') {
      type = 'warning';
      message = `${component.toUpperCase()} temperature returned to warning range: ${temperatureC}°C.`;
    } else {
      return;
    }

    this.events.push({
      id: ++this.sequence,
      component,
      type,
      from: previous,
      to: next,
      temperatureC,
      sampledAt,
      message
    });
    if (this.events.length > 20) this.events.shift();
  }

  snapshot(now = Date.now()) {
    const readings = {};
    const alerts = {};

    for (const component of COMPONENTS) {
      const state = this.states[component];
      const hasReading = Number.isFinite(state.temperatureC) && Number.isFinite(state.sampledAt);
      const ageMs = hasReading ? Math.max(0, now - state.sampledAt) : null;
      const stale = hasReading && (!state.available || ageMs > this.staleAfterMs);
      const status = !hasReading ? 'unavailable' : stale ? 'stale' : 'available';

      readings[component] = {
        available: status === 'available',
        stale,
        status,
        temperatureC: hasReading ? state.temperatureC : null,
        source: state.source,
        sampledAt: hasReading ? state.sampledAt : null,
        ageMs,
        note: state.note
      };

      const level = hasReading && !state.suppressAlerts ? state.alertLevel : 'unavailable';
      alerts[component] = {
        level,
        active: (level === 'warning' || level === 'critical') && status === 'available',
        sensorStatus: status,
        temperatureC: hasReading ? state.temperatureC : null,
        sampledAt: hasReading ? state.sampledAt : null,
        thresholds: { ...this.thresholds[component] }
      };
    }

    return {
      readings,
      alerts: {
        thresholds: this.thresholds,
        current: alerts,
        events: this.events.slice(-20)
      }
    };
  }
}

module.exports = {
  TemperatureManager,
  DEFAULT_TEMPERATURE_THRESHOLDS,
  loadTemperatureThresholds,
  classifyTemperature
};
