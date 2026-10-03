import { readFileSync } from "node:fs";

export class StorageDeferredError extends Error {
  constructor(decision) {
    super("Maintenance deferred: " + decision.reason);
    this.name = "StorageDeferredError";
    this.decision = decision;
  }
}

export function parseFullPressure(text) {
  const match = /^full\s+avg10=(\d+(?:\.\d+)?)\s/m.exec(text);
  if (!match || !Number.isFinite(Number(match[1]))) throw new Error("Invalid PSI");
  return Number(match[1]);
}

// Local observations only: no per-tick cloud API, shell or network request.
export function createStorageAdmission({
  read = path => readFileSync(path, "utf8"), now = () => Date.now(),
  ioPath = "/proc/pressure/io", memoryPath = "/proc/pressure/memory",
  ioMax = 5, memoryMax = 5, throttlePath = null, throttleMaxAgeMs = 600000,
  pressureCooldownMs = 300000, quietMs = 60000,
  partialBackoffMs = 1800000, maxBackoffMs = 7200000,
} = {}) {
  let quietUntil = 0, pressureUntil = 0, last = null, lastKind = null;
  const kinds = new Map();
  const kindOf = type => type.includes("embed") ? "embed" : "refresh";

  function observe() {
    const observation = { ioFullAvg10: null, memoryFullAvg10: null, throttle: "not_configured" };
    try {
      observation.ioFullAvg10 = parseFullPressure(read(ioPath));
      observation.memoryFullAvg10 = parseFullPressure(read(memoryPath));
    } catch {
      return { allowed: false, reason: "pressure_unavailable", observation };
    }
    if (throttlePath) {
      try {
        const value = JSON.parse(read(throttlePath));
        const time = Date.parse(value.observedAt);
        if (value.schemaVersion !== 1 || !Number.isFinite(time) || time > now() + 60000 ||
            now() - time > throttleMaxAgeMs || !Number.isFinite(value.throttledIOs) ||
            value.throttledIOs < 0) throw new Error("Invalid observation");
        observation.throttle = value.throttledIOs > 0 ? "throttled" : "clear";
      } catch {
        observation.throttle = "unavailable";
        return { allowed: false, reason: "throttle_unavailable", observation };
      }
    }
    const reason = observation.throttle === "throttled" ? "storage_throttled"
      : observation.ioFullAvg10 >= ioMax ? "io_pressure"
      : observation.memoryFullAvg10 >= memoryMax ? "memory_pressure" : null;
    return { allowed: reason === null, reason, observation };
  }

  function check(type, { running = false } = {}) {
    const time = now();
    const observed = observe();
    if (!observed.allowed) pressureUntil = Math.max(pressureUntil, time + pressureCooldownMs);
    const kind = kinds.get(kindOf(type));
    const until = Math.max(pressureUntil, running || kindOf(type) === lastKind ? 0 : quietUntil, running ? 0 : kind?.until || 0);
    const decision = !observed.allowed ? observed
      : time < until ? { ...observed, allowed: false, reason: "cooldown" } : observed;
    last = { ...decision, observedAt: new Date(time).toISOString(),
      retryAfter: !decision.allowed ? new Date(Math.max(time, until)).toISOString() : null };
    return last;
  }

  function admit(type) {
    const decision = check(type);
    if (!decision.allowed) throw new StorageDeferredError(decision);
  }

  function finished(job) {
    const type = kindOf(job.type), time = now(), previous = kinds.get(type);
    quietUntil = time + quietMs;
    lastKind = type;
    if (job.state === "partial" || job.state === "failed") {
      const failures = Math.min((previous?.failures || 0) + 1, 8);
      kinds.set(type, { failures, until: time + Math.min(maxBackoffMs, partialBackoffMs * 2 ** (failures - 1)) });
    } else kinds.set(type, { failures: 0, until: 0 });
  }

  function health() {
    return { last, quietUntil: new Date(quietUntil).toISOString(),
      pressureUntil: new Date(pressureUntil).toISOString(),
      backoff: Object.fromEntries([...kinds].map(([key, value]) => [key, {
        failures: value.failures, until: new Date(value.until).toISOString(),
      }])), cloudSignalConfigured: Boolean(throttlePath) };
  }
  return { check, admit, finished, health };
}
