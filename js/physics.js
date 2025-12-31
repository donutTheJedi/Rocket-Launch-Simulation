import { 
    G, 
    EARTH_MASS, 
    EARTH_ROTATION,
    ATM_SCALE_HEIGHT, 
    SEA_LEVEL_PRESSURE, 
    SEA_LEVEL_DENSITY,
    ROCKET_CONFIG 
} from './constants.js';
import { state, getTotalMass } from './state.js';

// Get atmospheric density at altitude
export function getAtmosphericDensity(altitude) {
    if (altitude > 150000) return 0;
    return SEA_LEVEL_DENSITY * Math.exp(-Math.max(0, altitude) / ATM_SCALE_HEIGHT);
}

// Get atmospheric pressure at altitude
export function getAtmosphericPressure(altitude) {
    if (altitude > 150000) return 0;
    return SEA_LEVEL_PRESSURE * Math.exp(-Math.max(0, altitude) / ATM_SCALE_HEIGHT);
}

// Get gravity at radius r
export function getGravity(r) {
    return G * EARTH_MASS / (r * r);
}

// Get current thrust (adjusted for altitude and throttle)
export function getCurrentThrust(altitude, throttle = 1.0) {
    if (!state.engineOn || state.currentStage >= ROCKET_CONFIG.stages.length) return 0;
    if (state.propellantRemaining[state.currentStage] <= 0) return 0;
    
    const stage = ROCKET_CONFIG.stages[state.currentStage];
    const pressureRatio = getAtmosphericPressure(altitude) / SEA_LEVEL_PRESSURE;
    const baseThrust = stage.thrust * pressureRatio + stage.thrustVac * (1 - pressureRatio);
    return baseThrust * throttle;
}

// Get mass flow rate
export function getMassFlowRate(altitude, throttle = 1.0) {
    if (!state.engineOn || state.currentStage >= ROCKET_CONFIG.stages.length) return 0;
    if (state.propellantRemaining[state.currentStage] <= 0) return 0;
    
    const stage = ROCKET_CONFIG.stages[state.currentStage];
    const pressureRatio = getAtmosphericPressure(altitude) / SEA_LEVEL_PRESSURE;
    const isp = stage.isp * pressureRatio + stage.ispVac * (1 - pressureRatio);
    return getCurrentThrust(altitude, throttle) / (isp * 9.81);
}

// Get airspeed (velocity relative to atmosphere)
export function getAirspeed() {
    // Atmospheric velocity at rocket's position (rotating with Earth)
    // Earth rotates counterclockwise (eastward), so velocity is perpendicular to position vector
    const atmVx = EARTH_ROTATION * state.y;  // perpendicular to position vector (eastward)
    const atmVy = -EARTH_ROTATION * state.x;
    
    // Airspeed (velocity relative to atmosphere)
    const airVx = state.vx - atmVx;
    const airVy = state.vy - atmVy;
    const airspeed = Math.sqrt(airVx * airVx + airVy * airVy);
    
    return { airspeed, airVx, airVy };
}

// Get drag force
export function getDrag(altitude, airspeed) {
    if (state.currentStage >= ROCKET_CONFIG.stages.length) return 0;
    const density = getAtmosphericDensity(altitude);
    const stage = ROCKET_CONFIG.stages[state.currentStage];
    const area = Math.PI * (stage.diameter / 2) ** 2;
    return 0.5 * density * airspeed * airspeed * stage.dragCoeff * area;
}

