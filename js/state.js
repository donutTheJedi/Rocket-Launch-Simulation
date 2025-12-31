import { EARTH_RADIUS, EARTH_ROTATION, ROCKET_CONFIG } from './constants.js';

// Game state object
export const state = {
    running: false,
    time: 0,
    timeWarp: 1,
    x: 0,
    y: EARTH_RADIUS,
    vx: 0,
    vy: 0,
    currentStage: 0,
    propellantRemaining: [ROCKET_CONFIG.stages[0].propellantMass, ROCKET_CONFIG.stages[1].propellantMass],
    fairingJettisoned: false,
    maxQ: 0,
    events: [],
    apoapsis: 0,
    periapsis: 0,
    engineOn: false,
    trail: [],
    manualZoom: 1.0,
    autoZoom: true,
    cameraMode: 'rocket', // 'rocket' or 'earth'
    burnMode: null, // null, 'prograde', 'retrograde', 'normal', 'anti-normal', 'radial', 'anti-radial'
    burnStartTime: null, // Time when current burn started
    guidancePhase: 'pre-launch',
    guidancePitch: 90.0,
    guidanceThrottle: 1.0
};

// Initialize/reset state
export function initState() {
    // Initialize rocket at pad position
    const x0 = 0;
    const y0 = EARTH_RADIUS;
    
    // Atmospheric velocity at rocket's position (rotating with Earth)
    // Rocket should start with this velocity so airspeed is ~0
    // Earth rotates counterclockwise (eastward)
    const atmVx0 = EARTH_ROTATION * y0;  // perpendicular to position vector (eastward)
    const atmVy0 = -EARTH_ROTATION * x0;
    
    state.running = false;
    state.time = 0;
    state.timeWarp = 1;
    state.x = x0;
    state.y = y0;
    state.vx = atmVx0;  // Match atmospheric velocity so airspeed is ~0
    state.vy = atmVy0;
    state.currentStage = 0;
    state.propellantRemaining = [ROCKET_CONFIG.stages[0].propellantMass, ROCKET_CONFIG.stages[1].propellantMass];
    state.fairingJettisoned = false;
    state.maxQ = 0;
    state.events = [];
    state.apoapsis = 0;
    state.periapsis = 0;
    state.engineOn = false;
    state.trail = [];
    state.manualZoom = 1.0;
    state.autoZoom = true;
    state.cameraMode = 'rocket';
    state.burnMode = null;
    state.burnStartTime = null;
    state.guidancePhase = 'pre-launch';
    state.guidancePitch = 90.0;
    state.guidanceThrottle = 1.0;
    
    document.getElementById('event-list').innerHTML = '';
}

// Get total rocket mass
export function getTotalMass() {
    let mass = ROCKET_CONFIG.payload;
    if (!state.fairingJettisoned) mass += ROCKET_CONFIG.fairingMass;
    for (let i = state.currentStage; i < ROCKET_CONFIG.stages.length; i++) {
        mass += ROCKET_CONFIG.stages[i].dryMass + state.propellantRemaining[i];
    }
    return mass;
}

// Get current altitude
export function getAltitude() {
    return Math.sqrt(state.x * state.x + state.y * state.y) - EARTH_RADIUS;
}

// Get pitch (from guidance system or default)
export function getPitch(time) {
    // Use guidance system pitch (pitch from horizontal: 0° = east, 90° = up)
    // Convert to pitch from vertical for backward compatibility (90° = up, 0° = horizontal)
    if (state.guidancePitch !== undefined) {
        return state.guidancePitch; // Guidance system already uses correct convention
    }
    // Fallback if guidance hasn't run yet
    return 90.0;
}

