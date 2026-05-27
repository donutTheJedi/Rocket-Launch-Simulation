import { ROCKET_CONFIG as DEFAULT_ROCKET_CONFIG } from './constants.js';

/**
 * Deep clone an object (handles nested objects and arrays).
 */
function deepClone(obj) {
    return JSON.parse(JSON.stringify(obj));
}

/**
 * Compute totalLength from stages + payload + fairing.
 */
function computeTotalLength(config) {
    let total = 0;
    for (const stage of config.stages) {
        total += stage.length;
    }
    total += config.payload.length;
    total += config.fairing.length;
    return total;
}

/**
 * Max propellant mass that fits in a stage's tank (cylinder: pi * r² * height).
 * @param {Object} stage - Stage config with diameter, length, tankLengthRatio
 * @param {number} propellantDensity - kg/m³
 * @returns {number} Max propellant mass (kg)
 */
export function getMaxPropellantForStage(stage, propellantDensity) {
    const r = (stage.diameter || 0) / 2;
    const tankHeight = (stage.length || 0) * (stage.tankLengthRatio ?? 0.85);
    const volume = Math.PI * r * r * tankHeight;
    return volume * (propellantDensity || 923);
}

/**
 * Ensure config has valid structure, recompute totalLength, and clamp propellant to tank capacity.
 */
function normalizeConfig(config) {
    const out = deepClone(config);
    out.totalLength = computeTotalLength(out);
    const density = out.propellantDensity ?? 923;

    // Structural defaults for backward compatibility with older configs.
    const DEFAULT_WALL_THICKNESS = 0.004;
    const DEFAULT_YIELD_STRESS = 276e6;
    const INTERSTAGE_DEFAULT_WALL_THICKNESS = 0.003;
    const INTERSTAGE_DEFAULT_YIELD_STRESS = 200e6;

    for (let i = 0; i < out.stages.length; i++) {
        const stage = out.stages[i];
        stage.wallThickness = stage.wallThickness ?? DEFAULT_WALL_THICKNESS;
        stage.yieldStress = stage.yieldStress ?? DEFAULT_YIELD_STRESS;
    }

    out.fairing = out.fairing || {};
    out.fairing.wallThickness = out.fairing.wallThickness ?? DEFAULT_WALL_THICKNESS;
    out.fairing.yieldStress = out.fairing.yieldStress ?? DEFAULT_YIELD_STRESS;

    out.interstage = out.interstage || {};
    out.interstage.wallThickness = out.interstage.wallThickness ?? INTERSTAGE_DEFAULT_WALL_THICKNESS;
    out.interstage.yieldStress = out.interstage.yieldStress ?? INTERSTAGE_DEFAULT_YIELD_STRESS;

    for (let i = 0; i < out.stages.length; i++) {
        const stage = out.stages[i];
        const maxProp = getMaxPropellantForStage(stage, density);
        if (stage.propellantMass > maxProp) {
            stage.propellantMass = maxProp;
        }
    }
    return out;
}

// Mutable current config (deep clone of default on init)
let currentConfig = normalizeConfig(DEFAULT_ROCKET_CONFIG);
let customRocketActive = false;

/**
 * Get the current rocket config (used by simulation).
 * @returns {Object} Current rocket configuration (do not mutate; use setRocketConfig to change).
 */
export function getRocketConfig() {
    return currentConfig;
}

/**
 * Set the current rocket config. Validates structure and recomputes totalLength.
 * @param {Object} config - New rocket configuration (will be deep-cloned).
 */
export function setRocketConfig(config) {
    if (!config || !config.stages || !Array.isArray(config.stages) || config.stages.length < 2) {
        return;
    }
    if (!config.payload || !config.fairing) return;
    currentConfig = normalizeConfig(config);
    customRocketActive = true;
}

/**
 * Get a deep clone of the default rocket config (for "Reset to default" in builder).
 * @returns {Object} Default rocket configuration.
 */
export function getDefaultRocketConfig() {
    return deepClone(DEFAULT_ROCKET_CONFIG);
}

/**
 * Reset current config to default (convenience for builder).
 */
export function resetToDefault() {
    currentConfig = normalizeConfig(getDefaultRocketConfig());
    customRocketActive = false;
}

export function isCustomRocket() {
    return customRocketActive;
}
