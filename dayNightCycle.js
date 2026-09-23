/**
 * dayNightCycle.js
 * Continuous 24-hour celestial illumination and day/night cycle simulation.
 * Controls sun/moon orbital lighting, ambient color temperatures, and UI clock dial.
 */

import * as THREE from 'three';

// Continuous 24-hour celestial illumination spline keyframes
const CELESTIAL_KEYFRAMES = [
  // h: hour, sun: sun color hex, sunInt: sun intensity, amb: ambient color hex, ambInt: ambient intensity, hemiSky: sky hex, hemiGnd: ground hex, hemiInt: hemi intensity, fog: fog/bg hex
  { h: 0.0,  sun: 0x93c5fd, sunInt: 0.40, amb: 0x1e1b4b, ambInt: 0.30, hemiSky: 0x1e1b4b, hemiGnd: 0x0f172a, hemiInt: 0.22, fog: 0x0b0f19 }, // Midnight
  { h: 4.5,  sun: 0x93c5fd, sunInt: 0.40, amb: 0x1e1b4b, ambInt: 0.30, hemiSky: 0x1e1b4b, hemiGnd: 0x0f172a, hemiInt: 0.22, fog: 0x0b0f19 }, // Late night
  { h: 5.5,  sun: 0xa5b4fc, sunInt: 0.70, amb: 0x2e1065, ambInt: 0.48, hemiSky: 0x312e81, hemiGnd: 0x1e1b4b, hemiInt: 0.35, fog: 0x121426 }, // Nautical twilight / pre-dawn
  { h: 6.5,  sun: 0xfde047, sunInt: 1.35, amb: 0xfbcfe8, ambInt: 0.78, hemiSky: 0xa78bfa, hemiGnd: 0x4c1d95, hemiInt: 0.52, fog: 0x1d1933 }, // Dawn sunrise / Rose gold
  { h: 8.0,  sun: 0xfef08a, sunInt: 2.05, amb: 0xfef3c7, ambInt: 1.10, hemiSky: 0x93c5fd, hemiGnd: 0x334155, hemiInt: 0.72, fog: 0x141e30 }, // Early morning golden
  { h: 10.0, sun: 0xffedd5, sunInt: 2.45, amb: 0xfffaed, ambInt: 1.32, hemiSky: 0xbae6fd, hemiGnd: 0x334155, hemiInt: 0.82, fog: 0x0f172a }, // Clear morning
  { h: 12.0, sun: 0xffedd5, sunInt: 2.50, amb: 0xfffaed, ambInt: 1.35, hemiSky: 0xbae6fd, hemiGnd: 0x334155, hemiInt: 0.85, fog: 0x0f172a }, // High noon
  { h: 15.0, sun: 0xffedd5, sunInt: 2.45, amb: 0xfffaed, ambInt: 1.32, hemiSky: 0xbae6fd, hemiGnd: 0x334155, hemiInt: 0.82, fog: 0x0f172a }, // Afternoon
  { h: 17.0, sun: 0xfef08a, sunInt: 2.25, amb: 0xfef3c7, ambInt: 1.22, hemiSky: 0x93c5fd, hemiGnd: 0x334155, hemiInt: 0.76, fog: 0x131a2e }, // Late afternoon golden
  { h: 18.3, sun: 0xfbbf24, sunInt: 1.90, amb: 0xfde68a, ambInt: 1.08, hemiSky: 0xa78bfa, hemiGnd: 0x475569, hemiInt: 0.68, fog: 0x1a1936 }, // Sunset golden hour
  { h: 19.5, sun: 0xf97316, sunInt: 1.35, amb: 0xc084fc, ambInt: 0.82, hemiSky: 0x818cf8, hemiGnd: 0x312e81, hemiInt: 0.54, fog: 0x211736 }, // Amber dusk
  { h: 20.8, sun: 0x818cf8, sunInt: 0.75, amb: 0x4338ca, ambInt: 0.52, hemiSky: 0x3730a3, hemiGnd: 0x1e1b4b, hemiInt: 0.38, fog: 0x151328 }, // Post-dusk twilight
  { h: 22.0, sun: 0x93c5fd, sunInt: 0.45, amb: 0x1e1b4b, ambInt: 0.34, hemiSky: 0x1e1b4b, hemiGnd: 0x0f172a, hemiInt: 0.26, fog: 0x0c101d }, // Nightfall
  { h: 24.0, sun: 0x93c5fd, sunInt: 0.40, amb: 0x1e1b4b, ambInt: 0.30, hemiSky: 0x1e1b4b, hemiGnd: 0x0f172a, hemiInt: 0.22, fog: 0x0b0f19 }  // Midnight (wrap)
];

export class DayNightCycle {
  constructor(options = {}) {
    this.scene = options.scene || null;
    this.sunLight = options.sunLight || null;
    this.ambientLight = options.ambientLight || null;
    this.hemiLight = options.hemiLight || null;
    this.renderer = options.renderer || null;

    // Time of day: 0.0 to 24.0 hours (starts at 10:00 morning)
    this.timeOfDay = (options.initialTime !== undefined) ? options.initialTime : 10.0;
    
    // Cycle speed: 1 real second = 0.20 game hours (5 real seconds = 1 hour, ~120s for full 24h day)
    this.speedMultiplier = options.speedMultiplier || 0.20;
    this.isPaused = Boolean(options.isPaused);

    // Current phase: "DAWN" | "DAY" | "DUSK" | "NIGHT"
    this.phase = "DAY";
    this.onPhaseChange = options.onPhaseChange || null;

    // UI elements
    this.domLabel = options.domLabel || (typeof document !== 'undefined' ? document.getElementById('daynight-label') : null);
    this.domCircle = options.domCircle || (typeof document !== 'undefined' ? document.getElementById('daynight-circle') : null);

    // Scratch color buffers for zero-allocation interpolation
    this._cSunTarget = new THREE.Color();
    this._cSunNext = new THREE.Color();
    this._cAmbTarget = new THREE.Color();
    this._cAmbNext = new THREE.Color();
    this._cHemiSkyTarget = new THREE.Color();
    this._cHemiSkyNext = new THREE.Color();
    this._cHemiGndTarget = new THREE.Color();
    this._cHemiGndNext = new THREE.Color();
    this._cFogTarget = new THREE.Color();
    this._cFogNext = new THREE.Color();

    // Throttling: lighting doesn't need per-frame updates since changes are gradual
    this._frameCounter = 0;
    this._lightingInterval = 3;   // Update lighting every 3rd frame
    this._uiInterval = 10;        // Update UI text every 10th frame
    this._accumulatedDt = 0;      // Accumulated delta for time advancement

    this.updateLighting(0.016, true);
    this.updateUI();
  }

  /**
   * Advances time and updates scene lighting (throttled for performance)
   * @param {number} deltaSec - Frame delta time in seconds
   */
  update(deltaSec) {
    if (this.isPaused || !deltaSec || deltaSec <= 0) return;

    // Time always advances every frame for accuracy
    this.timeOfDay = (this.timeOfDay + deltaSec * this.speedMultiplier) % 24.0;
    const oldPhase = this.phase;
    this.phase = this.calculatePhase(this.timeOfDay);

    if (oldPhase !== this.phase && this.onPhaseChange) {
      this.onPhaseChange(this.phase, this.timeOfDay);
    }

    this._frameCounter++;
    this._accumulatedDt += deltaSec;

    // Lighting: update every Nth frame (changes are imperceptibly gradual)
    if (this._frameCounter % this._lightingInterval === 0) {
      this.updateLighting(this._accumulatedDt);
      this._accumulatedDt = 0;
    }

    // UI text: update even less frequently (DOM writes are expensive)
    if (this._frameCounter % this._uiInterval === 0) {
      this.updateUI();
    }
  }

  /**
   * Determines time phase from hour of day
   */
  calculatePhase(h) {
    if (h >= 5.0 && h < 7.5) return "DAWN";
    if (h >= 7.5 && h < 17.5) return "DAY";
    if (h >= 17.5 && h < 21.0) return "DUSK";
    return "NIGHT";
  }

  /**
   * Evaluates the continuous celestial spline at hour h with smooth cosine interpolation
   */
  getSplineValues(h) {
    const clampedH = ((h % 24.0) + 24.0) % 24.0;
    let k0 = CELESTIAL_KEYFRAMES[0];
    let k1 = CELESTIAL_KEYFRAMES[1];

    for (let i = 0; i < CELESTIAL_KEYFRAMES.length - 1; i++) {
      if (clampedH >= CELESTIAL_KEYFRAMES[i].h && clampedH <= CELESTIAL_KEYFRAMES[i + 1].h) {
        k0 = CELESTIAL_KEYFRAMES[i];
        k1 = CELESTIAL_KEYFRAMES[i + 1];
        break;
      }
    }

    const span = k1.h - k0.h;
    const t = span > 0 ? (clampedH - k0.h) / span : 0;
    // Cosine smoothing for C1 continuous gradual transitions with zero inflection jerks
    const s = 0.5 * (1.0 - Math.cos(Math.PI * t));

    this._cSunTarget.setHex(k0.sun);
    this._cSunNext.setHex(k1.sun);
    this._cSunTarget.lerp(this._cSunNext, s);

    const sunInt = k0.sunInt + (k1.sunInt - k0.sunInt) * s;

    this._cAmbTarget.setHex(k0.amb);
    this._cAmbNext.setHex(k1.amb);
    this._cAmbTarget.lerp(this._cAmbNext, s);

    const ambInt = k0.ambInt + (k1.ambInt - k0.ambInt) * s;

    this._cHemiSkyTarget.setHex(k0.hemiSky);
    this._cHemiSkyNext.setHex(k1.hemiSky);
    this._cHemiSkyTarget.lerp(this._cHemiSkyNext, s);

    this._cHemiGndTarget.setHex(k0.hemiGnd);
    this._cHemiGndNext.setHex(k1.hemiGnd);
    this._cHemiGndTarget.lerp(this._cHemiGndNext, s);

    const hemiInt = k0.hemiInt + (k1.hemiInt - k0.hemiInt) * s;

    this._cFogTarget.setHex(k0.fog);
    this._cFogNext.setHex(k1.fog);
    this._cFogTarget.lerp(this._cFogNext, s);

    return {
      sunColor: this._cSunTarget,
      sunIntensity: sunInt,
      ambColor: this._cAmbTarget,
      ambIntensity: ambInt,
      hemiSkyColor: this._cHemiSkyTarget,
      hemiGndColor: this._cHemiGndTarget,
      hemiIntensity: hemiInt,
      fogColor: this._cFogTarget
    };
  }

  /**
   * Smoothly interpolates sun/moon directional light, ambient sky colors, and shadows
   */
  updateLighting(deltaSec = 0.016, immediate = false) {
    if (!this.sunLight || !this.ambientLight) return;

    const h = this.timeOfDay;
    // Calculate solar angle: 0 at 06:00, PI/2 at 12:00, PI at 18:00, 3PI/2 at 24:00
    const solarAngle = ((h - 6.0) / 24.0) * Math.PI * 2;
    const sunHeight = Math.sin(solarAngle);
    const sunAcross = Math.cos(solarAngle);

    // Position sun / moon along celestial orbital arc
    this.sunLight.position.set(sunAcross * 45, Math.max(10, Math.abs(sunHeight) * 45 + 8), 25);

    // Sample continuous spline values
    const spline = this.getSplineValues(h);

    // Direct continuous assignment for imperceptible smooth gradation
    this.sunLight.color.copy(spline.sunColor);
    this.sunLight.intensity = spline.sunIntensity;

    this.ambientLight.color.copy(spline.ambColor);
    this.ambientLight.intensity = spline.ambIntensity;

    if (this.hemiLight) {
      this.hemiLight.color.copy(spline.hemiSkyColor);
      this.hemiLight.groundColor.copy(spline.hemiGndColor);
      this.hemiLight.intensity = spline.hemiIntensity;
    }

    // Subtle atmospheric fog & background tint adjustment
    if (this.scene) {
      const lerpFactor = immediate ? 1.0 : Math.min(1.0, deltaSec * 5.0);
      if (this.scene.fog && this.scene.fog.color) {
        if (immediate) {
          this.scene.fog.color.copy(spline.fogColor);
        } else {
          this.scene.fog.color.lerp(spline.fogColor, lerpFactor);
        }
      }
      if (this.scene.background && this.scene.background.isColor) {
        if (immediate) {
          this.scene.background.copy(spline.fogColor);
        } else {
          this.scene.background.lerp(spline.fogColor, lerpFactor);
        }
      }
    }
  }


  /**
   * Updates top-right circular UI dial and time readout
   */
  updateUI() {
    if (this.domLabel) {
      const hours = Math.floor(this.timeOfDay);
      const mins = Math.floor((this.timeOfDay % 1.0) * 60);
      const strH = String(hours).padStart(2, '0');
      const strM = String(mins).padStart(2, '0');
      const phaseIcons = {
        DAWN: '🌅 Dawn',
        DAY: '☀️ Day',
        DUSK: '🌇 Dusk',
        NIGHT: '🌙 Night'
      };
      this.domLabel.textContent = `${strH}:${strM} ${phaseIcons[this.phase] || this.phase}`;
    }

    if (this.domCircle) {
      // Rotate celestial wheel: 12:00 = 0 deg (sun at top), 24:00 = 180 deg (moon at top)
      const deg = ((this.timeOfDay - 12.0) / 24.0) * 360;
      this.domCircle.style.transform = `rotate(${deg}deg)`;
    }
  }

  /**
   * Sets time directly to an hour of the day
   */
  setTime(hours) {
    this.timeOfDay = Math.max(0, Math.min(23.99, hours));
    this.phase = this.calculatePhase(this.timeOfDay);
    this.updateLighting(0.016, true);
    this.updateUI();
    if (this.onPhaseChange) this.onPhaseChange(this.phase, this.timeOfDay);
  }

  /**
   * Cycles to next major time phase on click
   */
  cycleNextPhase() {
    if (this.phase === "DAWN") this.setTime(12.0); // Jump to Day
    else if (this.phase === "DAY") this.setTime(18.5); // Jump to Dusk
    else if (this.phase === "DUSK") this.setTime(22.0); // Jump to Night
    else this.setTime(6.0); // Jump to Dawn
  }

  isDay() {
    return this.phase === "DAY" || this.phase === "DAWN";
  }

  isEvening() {
    return this.phase === "DUSK";
  }

  isNight() {
    return this.phase === "NIGHT";
  }
}
