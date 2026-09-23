/**
 * perfLogger.js
 * Comprehensive performance, latency, and Non-Functional Requirement (NFR) telemetry logger.
 * Tracks rolling frame rates, simulation tick budgets, unit demographics, and render counts.
 * Uses O(1) ring buffers instead of array shift() for zero-GC overhead.
 */

export class PerformanceLogger {
  constructor(options = {}) {
    this.rollingWindowSize = options.rollingWindowSize || 120;
    
    // Ring buffers for O(1) insert (no shift/splice)
    this._frameBuf = new Float64Array(this.rollingWindowSize);
    this._simBuf = new Float64Array(this.rollingWindowSize);
    this._frameHead = 0;
    this._frameCount = 0;
    this._simHead = 0;
    this._simCount = 0;
    
    this.metrics = {
      fps: 60,
      fpsAvg: 60,
      fpsMin: 60,
      frameTimeMs: 16.6,
      simTickMs: 0.5,
      simTickAvg: 0.5,
      simTickMax: 0.5,
      activeUnits: 0,
      totalUnits: 0,
      hexCount: 0,
      mapSizeText: '14x8',
      meshCount: 0,
      drawCalls: 0,
      triangles: 0,
      nfrStatus: 'OPTIMAL', // OPTIMAL (>=45fps), ACCEPTABLE (>=30fps), CRITICAL (<30fps)
      simBudgetStatus: 'OPTIMAL' // OPTIMAL (<2.0ms), ACCEPTABLE (<5.0ms), EXCEEDED (>=5.0ms)
    };

    this.lastLogTime = 0;
    this.logIntervalSec = options.logIntervalSec || 5.0;
  }

  /**
   * Records a rendered frame delta time in seconds
   */
  recordFrame(deltaSec) {
    if (!deltaSec || deltaSec <= 0) return;
    const ms = deltaSec * 1000.0;
    
    this._frameBuf[this._frameHead] = ms;
    this._frameHead = (this._frameHead + 1) % this.rollingWindowSize;
    if (this._frameCount < this.rollingWindowSize) this._frameCount++;

    // Compute rolling frame metrics
    let sum = 0;
    let maxFrame = 0;
    for (let i = 0; i < this._frameCount; i++) {
      const v = this._frameBuf[i];
      sum += v;
      if (v > maxFrame) maxFrame = v;
    }
    const avgMs = sum / this._frameCount;
    this.metrics.frameTimeMs = parseFloat(avgMs.toFixed(2));
    this.metrics.fps = Math.round(1000.0 / Math.max(1.0, ms));
    this.metrics.fpsAvg = Math.round(1000.0 / Math.max(1.0, avgMs));
    this.metrics.fpsMin = Math.round(1000.0 / Math.max(1.0, maxFrame));

    // NFR evaluation
    if (this.metrics.fpsAvg >= 45) {
      this.metrics.nfrStatus = 'OPTIMAL';
    } else if (this.metrics.fpsAvg >= 30) {
      this.metrics.nfrStatus = 'ACCEPTABLE';
    } else {
      this.metrics.nfrStatus = 'CRITICAL';
    }
  }

  /**
   * Records a LivingUnitManager simulation tick duration in milliseconds
   */
  recordSimTick(tickMs) {
    this._simBuf[this._simHead] = tickMs;
    this._simHead = (this._simHead + 1) % this.rollingWindowSize;
    if (this._simCount < this.rollingWindowSize) this._simCount++;

    let sum = 0;
    let max = 0;
    for (let i = 0; i < this._simCount; i++) {
      const v = this._simBuf[i];
      sum += v;
      if (v > max) max = v;
    }
    this.metrics.simTickMs = parseFloat(tickMs.toFixed(3));
    this.metrics.simTickAvg = parseFloat((sum / this._simCount).toFixed(3));
    this.metrics.simTickMax = parseFloat(max.toFixed(3));

    if (this.metrics.simTickAvg < 2.0) {
      this.metrics.simBudgetStatus = 'OPTIMAL';
    } else if (this.metrics.simTickAvg < 5.0) {
      this.metrics.simBudgetStatus = 'ACCEPTABLE';
    } else {
      this.metrics.simBudgetStatus = 'EXCEEDED';
    }
  }

  /**
   * Updates contextual scene metadata
   */
  setContext(ctx = {}) {
    if (ctx.activeUnits !== undefined) this.metrics.activeUnits = ctx.activeUnits;
    if (ctx.totalUnits !== undefined) this.metrics.totalUnits = ctx.totalUnits;
    if (ctx.hexCount !== undefined) this.metrics.hexCount = ctx.hexCount;
    if (ctx.mapSizeText !== undefined) this.metrics.mapSizeText = ctx.mapSizeText;
    if (ctx.meshCount !== undefined) this.metrics.meshCount = ctx.meshCount;
    if (ctx.drawCalls !== undefined) this.metrics.drawCalls = ctx.drawCalls;
    if (ctx.triangles !== undefined) this.metrics.triangles = ctx.triangles;
  }

  /**
   * Returns current telemetry snapshot
   */
  getMetrics() {
    return { ...this.metrics };
  }

  /**
   * Formats a concise one-line telemetry status string
   */
  getSummaryString() {
    return `FPS: ${this.metrics.fpsAvg} (${this.metrics.fpsMin} min) | Sim: ${this.metrics.simTickAvg}ms | Units: ${this.metrics.activeUnits}/${this.metrics.totalUnits} | Map: ${this.metrics.mapSizeText} (${this.metrics.hexCount} hexes) | NFR: ${this.metrics.nfrStatus}`;
  }

  /**
   * Logs a structured report to the console
   */
  logReport() {
    console.log(`[PERF TELEMETRY] ${this.getSummaryString()}`);
  }
}

// Global singleton instance for easy dev and test access
export const perfLogger = new PerformanceLogger();
if (typeof window !== 'undefined') {
  window.perfLogger = perfLogger;
  window.getPerfMetrics = () => perfLogger.getMetrics();
  window.logPerfReport = () => perfLogger.logReport();
}
