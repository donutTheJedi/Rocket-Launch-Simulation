import { getDefaultRocketConfig, setRocketConfig, resetToDefault } from './rocketConfig.js';
import { ROCKET_BUILDER_SCHEMA } from './rocketBuilder.js';

export const CHALLENGE_SETTINGS = {
    controlMode: 'gimbal',
    enableAerodynamicForces: true,
    structuralFailureMode: 'terminate',
};

export const DEFAULT_SIM_SETTINGS = {
    controlMode: 'turnrate',
    enableAerodynamicForces: false,
    structuralFailureMode: 'warn',
};

const CHALLENGE_FLAG_KEY = 'rocket-sim-challenge-active';
const SETTINGS_KEY = 'rocket-sim-settings-v1';

function setByPath(obj, path, value) {
    const parts = path.split('.');
    let cur = obj;
    for (let i = 0; i < parts.length - 1; i++) {
        const p = parts[i];
        if (!(p in cur)) cur[p] = {};
        cur = cur[p];
    }
    cur[parts[parts.length - 1]] = value;
}

/** Build a rocket config with every builder field at its schema minimum. */
export function buildMinimumRocketConfig() {
    const config = getDefaultRocketConfig();
    for (const field of ROCKET_BUILDER_SCHEMA) {
        if (field.min !== undefined) {
            setByPath(config, field.path, field.min);
        }
    }
    return config;
}

/** Apply minimum-performance rocket (challenge starting point, not Falcon 9). */
export function applyChallengeRocketPreset() {
    setRocketConfig(buildMinimumRocketConfig());
}

export function saveChallengeSettings(settings = CHALLENGE_SETTINGS) {
    try {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
        localStorage.setItem(CHALLENGE_FLAG_KEY, '1');
    } catch (_) {
        /* quota / private mode */
    }
}

export function loadPersistedSettings(targetSettings) {
    try {
        const raw = localStorage.getItem(SETTINGS_KEY);
        if (!raw) return false;
        const data = JSON.parse(raw);
        if (data.controlMode) targetSettings.controlMode = data.controlMode;
        if (typeof data.enableAerodynamicForces === 'boolean') {
            targetSettings.enableAerodynamicForces = data.enableAerodynamicForces;
        }
        if (data.structuralFailureMode) {
            targetSettings.structuralFailureMode = data.structuralFailureMode;
        }
        return true;
    } catch (_) {
        return false;
    }
}

export function isChallengeActive() {
    try {
        return localStorage.getItem(CHALLENGE_FLAG_KEY) === '1';
    } catch (_) {
        return false;
    }
}

export function clearChallengeMode() {
    try {
        localStorage.removeItem(CHALLENGE_FLAG_KEY);
        localStorage.removeItem(SETTINGS_KEY);
    } catch (_) {
        /* ignore */
    }
}

/** Clear challenge flag, default rocket, and default sim settings object. */
export function resetChallengeEverything(targetSettings) {
    clearChallengeMode();
    resetToDefault();
    Object.assign(targetSettings, DEFAULT_SIM_SETTINGS);
}

export function confirmExitChallenge() {
    return window.confirm(
        'Exit challenge mode?\n\n' +
        'This will reset your rocket to the default Falcon-9 design and restore normal simulation settings (turn rate control, no aerodynamic forces, structural warnings only).'
    );
}

/** Enter challenge: minimum rocket once, then hangar for trial-and-error tweaks. */
export function startChallengeFromMenu() {
    applyChallengeRocketPreset();
    saveChallengeSettings();
    window.location.href = 'builder.html?challenge=1';
}

export function initChallengeHangar() {
    const params = new URLSearchParams(window.location.search);
    const enteringViaLink = params.get('challenge') === '1';

    if (enteringViaLink && !isChallengeActive()) {
        applyChallengeRocketPreset();
    }
    if (enteringViaLink) {
        saveChallengeSettings();
    }

    const banner = document.getElementById('hangar-challenge-banner');
    if (banner && isChallengeActive()) {
        banner.hidden = false;
    }
}
