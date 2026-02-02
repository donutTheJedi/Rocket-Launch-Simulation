import { 
    G, 
    EARTH_MASS, 
    EARTH_ROTATION,
    ATM_SCALE_HEIGHT, 
    SEA_LEVEL_PRESSURE, 
    SEA_LEVEL_DENSITY
} from './constants.js';
import { getRocketConfig } from './rocketConfig.js';
import { state, getTotalMass } from './state.js';

/**
 * ============================================================================
 * US Standard Atmosphere 1976 Model
 * ============================================================================
 * 
 * Implements the atmospheric model from 0 to 86 km geometric altitude.
 * Uses piecewise linear temperature profiles with geopotential altitude corrections.
 * 
 * PRIMARY REFERENCE
 * U.S. Standard Atmosphere, 1976
 * Published by: NOAA, NASA, and USAF
 * Document: NOAA-S/T 76-1562
 */

// Effective Earth radius for geopotential altitude conversion
// Source: US Std Atm 1976, defined for geopotential height relationship
const EARTH_RADIUS_GEOPOTENTIAL = 6356766;        // m

// Standard acceleration of gravity at sea level
const G0 = 9.80665;                  // m/s²

// Mean molar mass of dry air (molecular weight)
const M0 = 0.0289644;                // kg/mol

// Universal gas constant
const R_STAR = 8.31447;              // J/(mol·K)

// Sea-level reference values (from US Std Atm 1976, Table 3)
const T0 = 288.15;                   // Temperature (K) = 15°C
const P0 = 101325;                   // Pressure (Pa) = 1 atm
const RHO0 = 1.225;                  // Density (kg/m³)

/**
 * Atmospheric layer definitions (from US Std Atm 1976, Table 4)
 * Each layer has: base geopotential altitude (m), base temperature (K), 
 *                 temperature lapse rate (K/m), base pressure (Pa)
 */
const LAYERS = [
    { h: 0,     T: 288.15,  L: -0.0065,  P: 101325 },      // Troposphere base
    { h: 11000, T: 216.65,  L: 0,        P: 22632.1 },     // Tropopause base
    { h: 20000, T: 216.65,  L: 0.001,    P: 5474.89 },     // Stratosphere I base
    { h: 32000, T: 228.65,  L: 0.0028,   P: 868.019 },     // Stratosphere II base
    { h: 47000, T: 270.65,  L: 0,        P: 110.906 },     // Stratopause base
    { h: 51000, T: 270.65,  L: -0.0028,  P: 66.9389 },     // Mesosphere I base
    { h: 71000, T: 214.65,  L: -0.002,   P: 3.95642 }      // Mesosphere II base
];

const MAX_GEOPOTENTIAL = 84852;  // Maximum valid geopotential altitude (m)

/**
 * Convert geometric altitude to geopotential altitude
 * @param {number} z - Geometric altitude (m)
 * @returns {number} Geopotential altitude (m)
 */
function geometricToGeopotential(z) {
    return (EARTH_RADIUS_GEOPOTENTIAL * z) / (EARTH_RADIUS_GEOPOTENTIAL + z);
}

/**
 * Find the atmospheric layer index for a given geopotential altitude
 * @param {number} h - Geopotential altitude (m)
 * @returns {number} Layer index (0-6)
 */
function getLayerIndex(h) {
    for (let i = LAYERS.length - 1; i >= 0; i--) {
        if (h >= LAYERS[i].h) return i;
    }
    return 0;
}

/**
 * Calculate atmospheric temperature at a given geopotential altitude
 * @param {number} h - Geopotential altitude (m)
 * @returns {number} Temperature (K)
 */
function getTemperatureAtGeopotential(h) {
    const i = getLayerIndex(h);
    const layer = LAYERS[i];
    return layer.T + layer.L * (h - layer.h);
}

/**
 * Calculate atmospheric pressure at a given geopotential altitude
 * Uses different formulas for isothermal vs. gradient layers
 * @param {number} h - Geopotential altitude (m)
 * @returns {number} Pressure (Pa)
 */
function getPressureAtGeopotential(h) {
    const i = getLayerIndex(h);
    const layer = LAYERS[i];
    const deltaH = h - layer.h;
    
    if (Math.abs(layer.L) < 1e-10) {
        // Isothermal layer: P = P_b * exp(-g0*M0*(h-h_b)/(R*T_b))
        const exponent = -G0 * M0 * deltaH / (R_STAR * layer.T);
        return layer.P * Math.exp(exponent);
    } else {
        // Gradient layer: P = P_b * (T_b / T)^(g0*M0/(R*L))
        const T = layer.T + layer.L * deltaH;
        const exponent = G0 * M0 / (R_STAR * layer.L);
        return layer.P * Math.pow(layer.T / T, exponent);
    }
}

/**
 * Get complete atmospheric properties at a given geometric altitude
 * @param {number} altitude - Geometric altitude (m)
 * @returns {Object} { temperature, pressure, density, speedOfSound, dynamicViscosity }
 */
export function getAtmosphericProperties(altitude) {
    // Handle negative altitudes (below sea level)
    if (altitude < 0) {
        altitude = 0;
    }
    
    // Convert to geopotential altitude
    const h = geometricToGeopotential(altitude);
    
    // Handle altitudes above model validity (86 km geometric ≈ 84.852 km geopotential)
    if (h > MAX_GEOPOTENTIAL) {
        // Return exponential extrapolation for very high altitudes
        const hClamped = MAX_GEOPOTENTIAL;
        const T = getTemperatureAtGeopotential(hClamped);
        const P = getPressureAtGeopotential(hClamped);
        
        // Simple exponential decay above 86 km
        const scaleHeight = R_STAR * T / (M0 * G0);
        const extraH = h - MAX_GEOPOTENTIAL;
        const Pextra = P * Math.exp(-extraH / scaleHeight);
        const rho = (Pextra * M0) / (R_STAR * T);
        
        return {
            temperature: T,
            pressure: Pextra,
            density: rho,
            speedOfSound: Math.sqrt(1.4 * R_STAR * T / M0),
            dynamicViscosity: getSutherlandViscosity(T),
            geopotentialAltitude: h,
            layer: 6,
            isExtrapolated: true
        };
    }
    
    // Calculate properties within model validity
    const T = getTemperatureAtGeopotential(h);
    const P = getPressureAtGeopotential(h);
    const rho = (P * M0) / (R_STAR * T);  // Ideal gas law
    
    return {
        temperature: T,                                    // K
        pressure: P,                                       // Pa
        density: rho,                                      // kg/m³
        speedOfSound: Math.sqrt(1.4 * R_STAR * T / M0),   // m/s (gamma = 1.4 for air)
        dynamicViscosity: getSutherlandViscosity(T),       // Pa·s
        geopotentialAltitude: h,
        layer: getLayerIndex(h),
        isExtrapolated: false
    };
}

/**
 * Get atmospheric density using US Standard Atmosphere 1976
 * Drop-in replacement for simple exponential model
 * @param {number} altitude - Geometric altitude (m)
 * @returns {number} Air density (kg/m³)
 */
export function getAtmosphericDensity(altitude) {
    return getAtmosphericProperties(altitude).density;
}

/**
 * Get atmospheric pressure at altitude using US Standard Atmosphere 1976
 * @param {number} altitude - Geometric altitude (m)
 * @returns {number} Pressure (Pa)
 */
export function getAtmosphericPressure(altitude) {
    return getAtmosphericProperties(altitude).pressure;
}

/**
 * ============================================================================
 * SUTHERLAND'S VISCOSITY LAW
 * ============================================================================
 * Calculate dynamic viscosity using Sutherland's formula (1893)
 * 
 * Formula: μ = μ₀ * (T/T₀)^(3/2) * (T₀ + S)/(T + S)
 * 
 * Constants for air:
 *   μ₀ = 1.716e-5 Pa·s (reference viscosity)
 *   T₀ = 273.15 K (reference temperature)
 *   S  = 110.4 K (Sutherland's constant for air)
 * 
 * @param {number} T - Temperature (K)
 * @returns {number} Dynamic viscosity (Pa·s)
 */
function getSutherlandViscosity(T) {
    const mu0 = 1.716e-5;    // Reference viscosity (Pa·s)
    const T0 = 273.15;       // Reference temperature (K)
    const S = 110.4;         // Sutherland's constant for air (K)
    
    return mu0 * Math.pow(T / T0, 1.5) * (T0 + S) / (T + S);
}

/**
 * Calculate Mach number
 * @param {number} velocity - Velocity (m/s)
 * @param {number} altitude - Geometric altitude (m)
 * @returns {number} Mach number
 */
export function getMachNumber(velocity, altitude) {
    const atm = getAtmosphericProperties(altitude);
    return velocity / atm.speedOfSound;
}

/**
 * Calculate dynamic pressure (q)
 * @param {number} altitude - Geometric altitude (m)
 * @param {number} velocity - Velocity (m/s)
 * @returns {number} Dynamic pressure (Pa)
 */
export function getDynamicPressure(altitude, velocity) {
    const rho = getAtmosphericDensity(altitude);
    return 0.5 * rho * velocity * velocity;
}

// For comparison: original simple exponential model
export function getAtmosphericDensitySimple(altitude) {
    const rho0 = 1.225;           // Sea level density (kg/m³)
    const H = 8500;               // Scale height (m)
    return rho0 * Math.exp(-altitude / H);
}

/**
 * Compare the two atmospheric models
 * Useful for validation and understanding the differences
 * @param {number} altitude - Geometric altitude (m)
 * @returns {Object} Comparison data
 */
export function compareModels(altitude) {
    const usStd = getAtmosphericDensity(altitude);
    const simple = getAtmosphericDensitySimple(altitude);
    const percentDiff = ((usStd - simple) / usStd) * 100;
    
    return {
        altitude,
        usStandardDensity: usStd,
        simpleDensity: simple,
        percentDifference: percentDiff
    };
}

// Get gravity at radius r
export function getGravity(r) {
    return G * EARTH_MASS / (r * r);
}

// Get current thrust (adjusted for altitude and throttle)
export function getCurrentThrust(altitude, throttle = 1.0) {
    if (!state.engineOn || state.currentStage >= getRocketConfig().stages.length) return 0;
    if (state.propellantRemaining[state.currentStage] <= 0) return 0;
    
    const stage = getRocketConfig().stages[state.currentStage];
    const pressureRatio = getAtmosphericPressure(altitude) / SEA_LEVEL_PRESSURE;
    const baseThrust = stage.thrust * pressureRatio + stage.thrustVac * (1 - pressureRatio);
    return baseThrust * throttle;
}

// Get mass flow rate
export function getMassFlowRate(altitude, throttle = 1.0) {
    if (!state.engineOn || state.currentStage >= getRocketConfig().stages.length) return 0;
    if (state.propellantRemaining[state.currentStage] <= 0) return 0;
    
    const stage = getRocketConfig().stages[state.currentStage];
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

/**
 * ============================================================================
 * MACH-DEPENDENT DRAG COEFFICIENT MODEL
 * ============================================================================
 * 
 * Based on Saturn V wind tunnel data (NASA TM X-53770) scaled for slender
 * launch vehicles using fineness ratio (length/diameter).
 * 
 * Key phenomena modeled:
 * - Subsonic: Skin friction dominates, Cd relatively constant
 * - Transonic (M 0.8-1.2): Sharp drag rise due to shock wave formation
 * - Supersonic: Gradual decrease as shocks stabilize
 * - Hypersonic: Asymptotic approach to minimum
 * 
 * REFERENCES:
 * [1] NASA TM X-53770, "Results of several experimental investigations of the
 *     static aerodynamic characteristics for the Apollo/Saturn V launch vehicle"
 *     Walker, C.E., Marshall Space Flight Center, 1968
 * [2] Braeunig, R.A., "Basics of Space Flight: Aerodynamics"
 *     http://braeunig.us/space/aerodyn_wip.htm
 * [3] "Drag Coefficient Prediction, Chapter 1" (DATCOM-derived methods)
 *     http://www.braeunig.us/space/pdf/Drag_Coefficient_Prediction.pdf
 * 
 * @param {number} mach - Mach number
 * @returns {number} Drag coefficient (referenced to cross-sectional area)
 */
export function getMachDragCoefficient(mach) {
    // Fineness ratio from rocket config
    const finenessRatio = getRocketConfig().totalLength / getRocketConfig().stages[0].diameter;
    
    // Fineness ratio adjustment factor
    // Higher L/D = lower drag coefficient (more streamlined)
    // Reference: L/D = 11 (Saturn V), baseline Cd values
    // Adjustment scales linearly with inverse fineness ratio
    const finenessAdjustment = Math.min(1.0, 11 / finenessRatio);
    
    let baseCd;
    
    if (mach < 0.6) {
        // Low subsonic: constant, skin friction dominated
        baseCd = 0.30;
    }
    else if (mach < 0.8) {
        // Subsonic approaching transonic: slight increase begins
        const t = (mach - 0.6) / 0.2;
        baseCd = 0.30 + t * 0.02;
    }
    else if (mach < 1.0) {
        // Transonic drag rise: rapid increase due to shock formation
        // Smooth cubic interpolation for realistic transition
        const t = (mach - 0.8) / 0.2;
        const smoothT = t * t * (3 - 2 * t);  // Smoothstep
        baseCd = 0.32 + smoothT * 0.18;  // Rise from 0.32 to 0.50
    }
    else if (mach < 1.2) {
        // Transonic peak region: maximum drag around M = 1.05
        if (mach < 1.05) {
            baseCd = 0.50 + (mach - 1.0) * 0.4;  // Slight rise to peak ~0.52
        } else {
            baseCd = 0.52 - (mach - 1.05) * 0.4;  // Decrease from peak
        }
    }
    else if (mach < 2.0) {
        // Supersonic: gradual decrease as shocks become more oblique
        const t = (mach - 1.2) / 0.8;
        baseCd = 0.46 - t * 0.10;  // Decrease from 0.46 to 0.36
    }
    else if (mach < 3.0) {
        // High supersonic: continued decrease
        const t = (mach - 2.0) / 1.0;
        baseCd = 0.36 - t * 0.06;  // Decrease from 0.36 to 0.30
    }
    else if (mach < 5.0) {
        // Approaching hypersonic: slow decrease
        const t = (mach - 3.0) / 2.0;
        baseCd = 0.30 - t * 0.05;  // Decrease from 0.30 to 0.25
    }
    else {
        // Hypersonic: asymptotic minimum
        baseCd = 0.22 + 0.03 * Math.exp(-(mach - 5.0) / 3.0);
    }
    
    return baseCd * finenessAdjustment;
}

/**
 * Get drag force using US Standard Atmosphere 1976 with Mach-dependent Cd
 * @param {number} altitude - Geometric altitude (m)
 * @param {number} airspeed - Airspeed (m/s)
 * @param {Object} stage - Optional rocket stage configuration (if not provided, uses current stage from state)
 * @returns {number} Drag force (N)
 */
export function getDrag(altitude, airspeed, stage = null) {
    // Use provided stage or get from state
    if (!stage) {
        if (state.currentStage >= getRocketConfig().stages.length) return 0;
        stage = getRocketConfig().stages[state.currentStage];
    }
    
    const atm = getAtmosphericProperties(altitude);
    const density = atm.density;
    const speedOfSound = atm.speedOfSound;
    const area = Math.PI * (stage.diameter / 2) ** 2;
    
    // Calculate Mach number
    const mach = airspeed / speedOfSound;
    
    // Get Mach-dependent drag coefficient
    const Cd = getMachDragCoefficient(mach);
    
    return 0.5 * density * airspeed * airspeed * Cd * area;
}

/**
 * Get current drag coefficient (for telemetry display)
 * @param {number} altitude - Geometric altitude (m)
 * @param {number} airspeed - Airspeed (m/s)
 * @returns {Object} { cd, mach } - Current drag coefficient and Mach number
 */
export function getCurrentDragCoefficient(altitude, airspeed) {
    // Safety check for valid inputs
    if (!isFinite(altitude) || altitude < 0) {
        return { cd: 0, mach: 0 };
    }
    
    // Allow airspeed to be 0 (rocket on ground before launch)
    if (!isFinite(airspeed)) {
        return { cd: 0, mach: 0 };
    }
    
    const atm = getAtmosphericProperties(altitude);
    
    // Safety check for speed of sound
    if (!isFinite(atm.speedOfSound) || atm.speedOfSound <= 0) {
        return { cd: 0, mach: 0 };
    }
    
    // Calculate Mach number (can be 0 if airspeed is 0)
    const mach = airspeed / atm.speedOfSound;
    
    // Get drag coefficient (works even for Mach 0)
    const cd = getMachDragCoefficient(mach);
    
    // Ensure we return valid numbers
    return { 
        cd: isFinite(cd) && cd >= 0 ? cd : 0, 
        mach: isFinite(mach) && mach >= 0 ? mach : 0 
    };
}

/**
 * ============================================================================
 * CENTER OF GRAVITY (COG) CALCULATIONS
 * ============================================================================
 * 
 * Dynamically calculates the rocket's center of gravity based on:
 * - Current fuel levels in each stage
 * - Fuel distribution within cylindrical tanks
 * - Mass distribution of dry components (engines, structure, payload)
 * 
 * The rocket is modeled as stacked cylindrical sections from bottom to top:
 * - Stage 1: Engines at bottom, propellant tank above
 * - Stage 2: Mounted on Stage 1, similar configuration
 * - Payload: On top of Stage 2
 * - Fairing: Covers payload (until jettisoned)
 * 
 * COG is measured from the bottom of the rocket (engine bells)
 */

/**
 * Calculate current fuel level (height) in a stage's tank
 * Models the tank as a perfect cylinder
 * 
 * @param {number} stageIndex - Index of the stage (0 or 1)
 * @returns {Object} { fuelHeight, tankHeight, fillFraction }
 */
export function calculateFuelLevel(stageIndex) {
    const stage = getRocketConfig().stages[stageIndex];
    const propellantRemaining = state.propellantRemaining[stageIndex];
    
    // Tank dimensions (cylinder)
    const tankRadius = stage.diameter / 2;
    const tankCrossSection = Math.PI * tankRadius * tankRadius;  // m²
    const tankHeight = stage.length * stage.tankLengthRatio;     // m
    
    // Calculate initial fuel volume from density
    const initialFuelVolume = stage.propellantMass / getRocketConfig().propellantDensity;  // m³
    
    // Current fuel volume
    const currentFuelVolume = propellantRemaining / getRocketConfig().propellantDensity;  // m³
    
    // Current fuel height in tank (fuel fills from bottom)
    const fuelHeight = currentFuelVolume / tankCrossSection;  // m
    
    // Fill fraction (0 to 1)
    const fillFraction = propellantRemaining / stage.propellantMass;
    
    return {
        fuelHeight: Math.min(fuelHeight, tankHeight),  // Can't exceed tank height
        tankHeight,
        fillFraction,
        tankCrossSection,
        currentFuelVolume,
        initialFuelVolume
    };
}

/**
 * Calculate COG of a single stage relative to its bottom
 * 
 * Stage layout (from bottom):
 * - Engine section: 0 to engineLength
 * - Tank section: engineLength to (engineLength + tankHeight)
 * - Upper structure: remaining length
 * 
 * @param {number} stageIndex - Index of the stage (0 or 1)
 * @returns {Object} { stageCOG, totalMass, fuelMass, dryMass }
 */
export function calculateStageCOG(stageIndex) {
    const stage = getRocketConfig().stages[stageIndex];
    const propellantRemaining = state.propellantRemaining[stageIndex];
    
    // Get fuel level info
    const fuelInfo = calculateFuelLevel(stageIndex);
    
    // Stage geometry
    const engineLength = stage.engineLength;
    const tankHeight = fuelInfo.tankHeight;
    const tankBottom = engineLength;  // Tank starts above engine section
    
    // Dry mass distribution
    const engineMass = stage.dryMass * stage.dryMassEngineFraction;
    const structureMass = stage.dryMass * (1 - stage.dryMassEngineFraction);
    
    // COG positions (from stage bottom)
    const engineCOG = engineLength / 2;  // Engine COG at center of engine section
    const structureCOG = stage.length / 2;  // Structure distributed along stage
    
    // Fuel COG: center of current fuel column (from stage bottom)
    // Fuel fills from tank bottom upward
    const fuelCOG = tankBottom + (fuelInfo.fuelHeight / 2);
    
    // Calculate weighted COG
    const totalMass = stage.dryMass + propellantRemaining;
    
    if (totalMass === 0) {
        return { stageCOG: stage.length / 2, totalMass: 0, fuelMass: 0, dryMass: 0 };
    }
    
    const momentSum = (engineMass * engineCOG) + 
                      (structureMass * structureCOG) + 
                      (propellantRemaining * fuelCOG);
    
    const stageCOG = momentSum / totalMass;
    
    return {
        stageCOG,
        totalMass,
        fuelMass: propellantRemaining,
        dryMass: stage.dryMass,
        fuelHeight: fuelInfo.fuelHeight,
        fillFraction: fuelInfo.fillFraction
    };
}

/**
 * Calculate the overall rocket COG from the bottom of the rocket
 * 
 * Rocket stack (from bottom):
 * - Stage 1: 0 to stage1.length (if not jettisoned)
 * - Stage 2: stage1.length to (stage1.length + stage2.length)
 * - Payload: top of Stage 2 to (top + payload.length)
 * - Fairing: on top (if not jettisoned)
 * 
 * @returns {Object} Complete COG analysis
 */
export function calculateRocketCOG() {
    const stages = getRocketConfig().stages;
    const payload = getRocketConfig().payload;
    const fairing = getRocketConfig().fairing;
    
    let totalMass = 0;
    let momentSum = 0;
    let currentBottom = 0;  // Tracks bottom position of each component
    
    const components = [];
    
    // Stage 1 (if current stage is 0)
    if (state.currentStage === 0) {
        const stage1COG = calculateStageCOG(0);
        const stage1Position = currentBottom + stage1COG.stageCOG;
        
        totalMass += stage1COG.totalMass;
        momentSum += stage1COG.totalMass * stage1Position;
        
        components.push({
            name: 'Stage 1',
            mass: stage1COG.totalMass,
            position: stage1Position,
            fuelFraction: stage1COG.fillFraction,
            bottom: currentBottom,
            length: stages[0].length
        });
        
        currentBottom += stages[0].length;
    }
    
    // Stage 2 (if current stage is 0 or 1)
    if (state.currentStage <= 1) {
        const stage2COG = calculateStageCOG(1);
        const stage2Position = currentBottom + stage2COG.stageCOG;
        
        totalMass += stage2COG.totalMass;
        momentSum += stage2COG.totalMass * stage2Position;
        
        components.push({
            name: 'Stage 2',
            mass: stage2COG.totalMass,
            position: stage2Position,
            fuelFraction: stage2COG.fillFraction,
            bottom: currentBottom,
            length: stages[1].length
        });
        
        currentBottom += stages[1].length;
    }
    
    // Payload (always present)
    const payloadCOG = currentBottom + (payload.length / 2);
    totalMass += payload.mass;
    momentSum += payload.mass * payloadCOG;
    
    components.push({
        name: 'Payload',
        mass: payload.mass,
        position: payloadCOG,
        bottom: currentBottom,
        length: payload.length
    });
    
    currentBottom += payload.length;
    
    // Fairing (if not jettisoned)
    if (!state.fairingJettisoned) {
        // Fairing is a cone, COG is at ~1/3 from base for uniform cone
        const fairingCOG = currentBottom + (fairing.length / 3);
        totalMass += fairing.mass;
        momentSum += fairing.mass * fairingCOG;
        
        components.push({
            name: 'Fairing',
            mass: fairing.mass,
            position: fairingCOG,
            bottom: currentBottom,
            length: fairing.length
        });
        
        currentBottom += fairing.length;
    }
    
    // Calculate overall COG
    const overallCOG = totalMass > 0 ? momentSum / totalMass : 0;
    const rocketLength = currentBottom;
    
    // COG as fraction of rocket length (0 = bottom, 1 = top)
    const cogFraction = rocketLength > 0 ? overallCOG / rocketLength : 0.5;
    
    return {
        cog: overallCOG,                    // COG from rocket bottom (m)
        cogFraction,                         // COG as fraction of length (0-1)
        totalMass,                           // Total rocket mass (kg)
        rocketLength,                        // Current rocket length (m)
        components,                          // Breakdown by component
        // Fuel levels for telemetry
        stage1Fuel: state.currentStage === 0 ? calculateFuelLevel(0) : null,
        stage2Fuel: state.currentStage <= 1 ? calculateFuelLevel(1) : null
    };
}

/**
 * Calculate COG for the full rocket at pad (both stages, full propellant, fairing on).
 * Does not depend on flight state. Used by the Rocket Builder diagram.
 *
 * @param {Object} [config] - Rocket config (default: getRocketConfig())
 * @returns {Object} { cog, cogFraction, rocketLength, components }
 */
export function calculateRocketCOGAtPad(config) {
    const cfg = config || getRocketConfig();
    const stages = cfg.stages;
    const payload = cfg.payload;
    const fairing = cfg.fairing;

    let totalMass = 0;
    let momentSum = 0;
    let currentBottom = 0;
    const components = [];

    // Helper: stage COG from config and propellant mass (no state)
    function stageCOGFromConfig(c, stageIndex, propellantMass) {
        const st = c.stages[stageIndex];
        const tankRadius = st.diameter / 2;
        const tankCrossSection = Math.PI * tankRadius * tankRadius;
        const tankHeight = st.length * st.tankLengthRatio;
        const currentFuelVolume = propellantMass / c.propellantDensity;
        const fuelHeight = Math.min(currentFuelVolume / tankCrossSection, tankHeight);
        const engineLength = st.engineLength;
        const tankBottom = engineLength;
        const engineMass = st.dryMass * st.dryMassEngineFraction;
        const structureMass = st.dryMass * (1 - st.dryMassEngineFraction);
        const engineCOG = engineLength / 2;
        const structureCOG = st.length / 2;
        const fuelCOG = tankBottom + (fuelHeight / 2);
        const mass = st.dryMass + propellantMass;
        if (mass === 0) return { stageCOG: st.length / 2, totalMass: 0 };
        const moment = (engineMass * engineCOG) + (structureMass * structureCOG) + (propellantMass * fuelCOG);
        return { stageCOG: moment / mass, totalMass: mass };
    }

    // Stage 1 (full propellant)
    const s1 = stageCOGFromConfig(cfg, 0, stages[0].propellantMass);
    const s1Position = currentBottom + s1.stageCOG;
    totalMass += s1.totalMass;
    momentSum += s1.totalMass * s1Position;
    components.push({ name: 'Stage 1', mass: s1.totalMass, position: s1Position, bottom: currentBottom, length: stages[0].length });
    currentBottom += stages[0].length;

    // Stage 2 (full propellant)
    const s2 = stageCOGFromConfig(cfg, 1, stages[1].propellantMass);
    const s2Position = currentBottom + s2.stageCOG;
    totalMass += s2.totalMass;
    momentSum += s2.totalMass * s2Position;
    components.push({ name: 'Stage 2', mass: s2.totalMass, position: s2Position, bottom: currentBottom, length: stages[1].length });
    currentBottom += stages[1].length;

    // Payload
    const payloadCOG = currentBottom + (payload.length / 2);
    totalMass += payload.mass;
    momentSum += payload.mass * payloadCOG;
    components.push({ name: 'Payload', mass: payload.mass, position: payloadCOG, bottom: currentBottom, length: payload.length });
    currentBottom += payload.length;

    // Fairing (cone COG at ~1/3 from base)
    const fairingCOG = currentBottom + (fairing.length / 3);
    totalMass += fairing.mass;
    momentSum += fairing.mass * fairingCOG;
    components.push({ name: 'Fairing', mass: fairing.mass, position: fairingCOG, bottom: currentBottom, length: fairing.length });
    currentBottom += fairing.length;

    const rocketLength = currentBottom;
    const overallCOG = totalMass > 0 ? momentSum / totalMass : 0;
    const cogFraction = rocketLength > 0 ? overallCOG / rocketLength : 0.5;

    return { cog: overallCOG, cogFraction, rocketLength, totalMass, components };
}

/**
 * ============================================================================
 * GIMBAL AND ROTATIONAL DYNAMICS
 * ============================================================================
 * 
 * Models the rotational motion of the rocket due to gimbaled thrust.
 * 
 * Torque Equation:
 *   τ = T * sin(δ) * L(t)
 * 
 * Where:
 *   T = Thrust force (N)
 *   δ = Gimbal angle from rocket centerline (radians)
 *   L(t) = Moment arm - distance from gimbal point to COG (m)
 * 
 * Angular Dynamics:
 *   τ = I(t) * α
 *   α = θ̈ = τ / I(t)
 * 
 * Where:
 *   I(t) = Moment of inertia about COG (kg·m²)
 *   α = Angular acceleration (rad/s²)
 */

/**
 * Calculate moment of inertia about the rocket's COG
 * Uses parallel axis theorem: I_total = Σ(I_component + m * d²)
 * 
 * Each component is modeled as a cylinder rotating about an axis
 * perpendicular to its length:
 *   I_cylinder = (1/12) * m * L² + (1/4) * m * R²
 * 
 * @returns {Object} { momentOfInertia, cogPosition }
 */
export function calculateMomentOfInertia() {
    const cogData = calculateRocketCOG();
    const cogPosition = cogData.cog;  // COG from rocket bottom
    const stages = getRocketConfig().stages;
    
    let totalMOI = 0;
    let currentBottom = 0;
    
    // Stage 1 (if not jettisoned)
    if (state.currentStage === 0) {
        const stage = stages[0];
        const radius = stage.diameter / 2;
        
        // Engine mass contribution
        const engineMass = stage.dryMass * stage.dryMassEngineFraction;
        const engineCOG = currentBottom + stage.engineLength / 2;
        const engineDist = engineCOG - cogPosition;
        // Model engine as a point mass for simplicity
        totalMOI += engineMass * engineDist * engineDist;
        
        // Structure mass contribution (distributed along stage)
        const structureMass = stage.dryMass * (1 - stage.dryMassEngineFraction);
        const structureCOG = currentBottom + stage.length / 2;
        const structureDist = structureCOG - cogPosition;
        // Cylinder MOI about perpendicular axis through center
        const structureMOILocal = (1/12) * structureMass * stage.length * stage.length;
        totalMOI += structureMOILocal + structureMass * structureDist * structureDist;
        
        // Propellant mass contribution
        const fuelInfo = calculateFuelLevel(0);
        const propellantMass = state.propellantRemaining[0];
        if (propellantMass > 0 && fuelInfo.fuelHeight > 0) {
            const tankBottom = currentBottom + stage.engineLength;
            const fuelCOG = tankBottom + fuelInfo.fuelHeight / 2;
            const fuelDist = fuelCOG - cogPosition;
            // Cylinder MOI for fuel column
            const fuelMOILocal = (1/12) * propellantMass * fuelInfo.fuelHeight * fuelInfo.fuelHeight + 
                                 (1/4) * propellantMass * radius * radius;
            totalMOI += fuelMOILocal + propellantMass * fuelDist * fuelDist;
        }
        
        currentBottom += stage.length;
    }
    
    // Stage 2 (if not jettisoned)
    if (state.currentStage <= 1) {
        const stage = stages[1];
        const radius = stage.diameter / 2;
        
        // Engine mass contribution
        const engineMass = stage.dryMass * stage.dryMassEngineFraction;
        const engineCOG = currentBottom + stage.engineLength / 2;
        const engineDist = engineCOG - cogPosition;
        totalMOI += engineMass * engineDist * engineDist;
        
        // Structure mass contribution
        const structureMass = stage.dryMass * (1 - stage.dryMassEngineFraction);
        const structureCOG = currentBottom + stage.length / 2;
        const structureDist = structureCOG - cogPosition;
        const structureMOILocal = (1/12) * structureMass * stage.length * stage.length;
        totalMOI += structureMOILocal + structureMass * structureDist * structureDist;
        
        // Propellant mass contribution
        const fuelInfo = calculateFuelLevel(1);
        const propellantMass = state.propellantRemaining[1];
        if (propellantMass > 0 && fuelInfo.fuelHeight > 0) {
            const tankBottom = currentBottom + stage.engineLength;
            const fuelCOG = tankBottom + fuelInfo.fuelHeight / 2;
            const fuelDist = fuelCOG - cogPosition;
            const fuelMOILocal = (1/12) * propellantMass * fuelInfo.fuelHeight * fuelInfo.fuelHeight + 
                                 (1/4) * propellantMass * radius * radius;
            totalMOI += fuelMOILocal + propellantMass * fuelDist * fuelDist;
        }
        
        currentBottom += stage.length;
    }
    
    // Payload contribution
    const payload = getRocketConfig().payload;
    const payloadCOG = currentBottom + payload.length / 2;
    const payloadDist = payloadCOG - cogPosition;
    const payloadRadius = payload.diameter / 2;
    const payloadMOILocal = (1/12) * payload.mass * payload.length * payload.length + 
                            (1/4) * payload.mass * payloadRadius * payloadRadius;
    totalMOI += payloadMOILocal + payload.mass * payloadDist * payloadDist;
    currentBottom += payload.length;
    
    // Fairing contribution (if not jettisoned)
    if (!state.fairingJettisoned) {
        const fairing = getRocketConfig().fairing;
        // Fairing is a cone - COG at 1/3 height, MOI approximated
        const fairingCOG = currentBottom + fairing.length / 3;
        const fairingDist = fairingCOG - cogPosition;
        // Cone MOI about perpendicular axis through apex: I = (3/10)*m*R² + (1/10)*m*h²
        const fairingRadius = fairing.diameter / 2;
        const fairingMOILocal = (3/10) * fairing.mass * fairingRadius * fairingRadius + 
                                (1/10) * fairing.mass * fairing.length * fairing.length;
        totalMOI += fairingMOILocal + fairing.mass * fairingDist * fairingDist;
    }
    
    return {
        momentOfInertia: totalMOI,
        cogPosition: cogPosition
    };
}

/**
 * Calculate the gimbal moment arm - distance from gimbal point to COG
 * The gimbal point is at the bottom of the current stage's engine
 * 
 * @returns {number} Moment arm in meters (positive = COG above gimbal)
 */
export function calculateGimbalMomentArm() {
    if (state.currentStage >= getRocketConfig().stages.length) {
        return 0;
    }
    
    const stage = getRocketConfig().stages[state.currentStage];
    const cogData = calculateRocketCOG();
    
    // Gimbal point is relative to the bottom of the current active stage
    // For stage 0: gimbal at 0 + gimbalPoint
    // For stage 1: gimbal at 0 + gimbalPoint (stage 1 is now bottom after separation)
    const gimbalPointFromRocketBottom = stage.gimbalPoint;
    
    // Moment arm = COG position - gimbal position
    // Positive when COG is above gimbal (normal case)
    const momentArm = cogData.cog - gimbalPointFromRocketBottom;
    
    return momentArm;
}

/**
 * Calculate the torque produced by gimbaled thrust
 * τ = T * sin(δ) * L
 * 
 * @param {number} thrust - Current thrust force (N)
 * @param {number} gimbalAngleDeg - Gimbal angle in degrees
 * @returns {number} Torque in N·m (positive = clockwise rotation in our frame)
 */
export function calculateGimbalTorque(thrust, gimbalAngleDeg) {
    if (thrust <= 0 || !state.engineOn) {
        return 0;
    }
    
    const gimbalAngleRad = gimbalAngleDeg * Math.PI / 180;
    const momentArm = calculateGimbalMomentArm();
    
    // Torque = T * sin(δ) * L
    // Sign convention: positive gimbal (thrust tilted right) 
    // creates positive torque (clockwise rotation = pitching down/east)
    const torque = thrust * Math.sin(gimbalAngleRad) * momentArm;
    
    return torque;
}

/**
 * Calculate angular acceleration from gimbal torque
 * α = τ / I
 * 
 * @param {number} thrust - Current thrust force (N)
 * @param {number} gimbalAngleDeg - Gimbal angle in degrees
 * @returns {Object} { angularAccel, torque, momentOfInertia, momentArm }
 */
export function calculateAngularAcceleration(thrust, gimbalAngleDeg) {
    const moiData = calculateMomentOfInertia();
    const torque = calculateGimbalTorque(thrust, gimbalAngleDeg);
    
    // Avoid division by zero
    const moi = Math.max(moiData.momentOfInertia, 1);
    
    const angularAccel = torque / moi;
    
    return {
        angularAccel,                    // rad/s²
        torque,                          // N·m
        momentOfInertia: moiData.momentOfInertia,  // kg·m²
        momentArm: calculateGimbalMomentArm(),     // m
        cogPosition: moiData.cogPosition           // m from bottom
    };
}

/**
 * Update gimbal angle with rate limiting (actuator dynamics)
 * 
 * @param {number} commandedAngle - Desired gimbal angle (degrees)
 * @param {number} currentAngle - Current gimbal angle (degrees)
 * @param {number} dt - Time step (seconds)
 * @returns {number} New gimbal angle (degrees)
 */
export function updateGimbalAngle(commandedAngle, currentAngle, dt) {
    if (state.currentStage >= getRocketConfig().stages.length) {
        return 0;
    }
    
    const stage = getRocketConfig().stages[state.currentStage];
    const maxAngle = stage.gimbalMaxAngle;
    const maxRate = stage.gimbalRate;  // degrees/second
    
    // Clamp commanded angle to gimbal limits
    const clampedCommand = Math.max(-maxAngle, Math.min(maxAngle, commandedAngle));
    
    // Calculate angle difference
    const angleDiff = clampedCommand - currentAngle;
    
    // Rate-limited movement
    const maxChange = maxRate * dt;
    let newAngle;
    
    if (Math.abs(angleDiff) <= maxChange) {
        newAngle = clampedCommand;
    } else {
        newAngle = currentAngle + Math.sign(angleDiff) * maxChange;
    }
    
    return newAngle;
}

/**
 * Integrate rotational dynamics for one time step
 * Updates angular velocity and rocket angle
 * 
 * @param {number} thrust - Current thrust (N)
 * @param {number} dt - Time step (seconds)
 * @param {Object} localUp - Local up unit vector {x, y} (optional, for aerodynamic torque)
 * @param {Object} localEast - Local east unit vector {x, y} (optional, for aerodynamic torque)
 * @returns {Object} { angularVelocity, rocketAngle, gimbalAngle }
 */
export function integrateRotationalDynamics(thrust, dt, localUp = null, localEast = null) {
    // Update gimbal angle (actuator dynamics)
    const newGimbalAngle = updateGimbalAngle(state.commandedGimbal, state.gimbalAngle, dt);
    state.gimbalAngle = newGimbalAngle;
    
    // Calculate angular acceleration from gimbal
    const dynamics = calculateAngularAcceleration(thrust, state.gimbalAngle);
    let totalAngularAccel = dynamics.angularAccel;
    
    // Add aerodynamic torque if in atmosphere
    const altitude = Math.sqrt(state.x * state.x + state.y * state.y) - 6.371e6;
    if (altitude < 70000 && localUp && localEast) {
        const { airspeed, airVx, airVy } = getAirspeed();
        
        if (airspeed > 1e-3) {
            // Calculate rocket body axis direction
            const bodyAxisX = Math.sin(state.rocketAngle) * localEast.x + Math.cos(state.rocketAngle) * localUp.x;
            const bodyAxisY = Math.sin(state.rocketAngle) * localEast.y + Math.cos(state.rocketAngle) * localUp.y;
            const bodyAxis = { x: bodyAxisX, y: bodyAxisY };
            
            // Calculate angle of attack
            const aoa = calculateAngleOfAttack(bodyAxis, airVx, airVy);
            
            // Calculate aerodynamic torque
            const aeroTorque = calculateAerodynamicTorque(
                altitude, airspeed, aoa, bodyAxis, airVx, airVy, localUp, localEast
            );
            
            // Add aerodynamic angular acceleration
            const moiData = calculateMomentOfInertia();
            const moi = Math.max(moiData.momentOfInertia, 1);
            const aeroAngularAccel = aeroTorque.torque / moi;
            
            totalAngularAccel += aeroAngularAccel;
        }
    }
    
    // Integrate angular velocity: ω += α * dt
    state.angularVelocity += totalAngularAccel * dt;
    
    // Add some angular damping in atmosphere (aerodynamic stability)
    // This simulates the stabilizing effect of fins/body aerodynamics
    // Note: This is now redundant with aerodynamic torque, but kept for backward compatibility
    if (altitude < 70000) {
        const { airspeed } = getAirspeed();
        const density = getAtmosphericDensity(altitude);
        // Simple damping model: stronger at lower altitude and higher airspeed
        const dampingCoeff = 0.01 * density * airspeed * airspeed / 1e6;
        state.angularVelocity *= (1 - dampingCoeff * dt);
    }
    
    // Integrate rocket angle: θ += ω * dt
    state.rocketAngle += state.angularVelocity * dt;
    
    // Keep angle in reasonable bounds (optional, for display purposes)
    while (state.rocketAngle > Math.PI * 2) state.rocketAngle -= Math.PI * 2;
    while (state.rocketAngle < -Math.PI * 2) state.rocketAngle += Math.PI * 2;
    
    return {
        angularVelocity: state.angularVelocity,
        rocketAngle: state.rocketAngle,
        gimbalAngle: state.gimbalAngle,
        angularAccel: totalAngularAccel,
        torque: dynamics.torque,
        momentOfInertia: dynamics.momentOfInertia
    };
}

/**
 * Get the rocket's thrust direction based on its orientation and gimbal
 * 
 * @param {Object} localUp - Unit vector pointing up (away from Earth center)
 * @param {Object} localEast - Unit vector pointing east
 * @returns {Object} { x, y } - Unit thrust direction vector
 */
export function getRocketThrustDirection(localUp, localEast) {
    // Rocket angle is measured from local vertical (up)
    // 0 = pointing straight up, positive = tilted east (clockwise)
    const rocketAngle = state.rocketAngle;
    const gimbalAngleRad = state.gimbalAngle * Math.PI / 180;
    
    // Thrust direction is along rocket axis, modified by gimbal
    // Rocket pointing direction (without gimbal)
    const rocketDirX = Math.sin(rocketAngle) * localEast.x + Math.cos(rocketAngle) * localUp.x;
    const rocketDirY = Math.sin(rocketAngle) * localEast.y + Math.cos(rocketAngle) * localUp.y;
    
    // With gimbal, thrust is deflected from rocket axis
    // Perpendicular to rocket direction (for gimbal deflection)
    const perpX = Math.cos(rocketAngle) * localEast.x - Math.sin(rocketAngle) * localUp.x;
    const perpY = Math.cos(rocketAngle) * localEast.y - Math.sin(rocketAngle) * localUp.y;
    
    // Thrust direction = rocket direction + gimbal deflection
    const thrustX = Math.cos(gimbalAngleRad) * rocketDirX + Math.sin(gimbalAngleRad) * perpX;
    const thrustY = Math.cos(gimbalAngleRad) * rocketDirY + Math.sin(gimbalAngleRad) * perpY;
    
    // Normalize (should already be unit vector, but ensure it)
    const mag = Math.sqrt(thrustX * thrustX + thrustY * thrustY);
    
    return {
        x: thrustX / mag,
        y: thrustY / mag
    };
}

/**
 * Calculate the commanded gimbal angle to achieve a target pitch
 * This is used by the guidance system
 * 
 * Sign convention:
 *   - rocketAngle = 0 means pointing straight up (along local vertical)
 *   - Positive rocketAngle = tilted east (clockwise from up)
 *   - pitch = 90° - rocketAngle (in degrees)
 *   - Positive gimbal creates positive torque → increases rocketAngle → decreases pitch
 *   - Therefore: to INCREASE pitch, we need NEGATIVE gimbal
 * 
 * @param {number} targetPitchDeg - Desired pitch angle (degrees from horizontal)
 * @param {number} dt - Time step for predictive control
 * @returns {number} Commanded gimbal angle (degrees)
 */
export function calculateCommandedGimbal(targetPitchDeg, dt) {
    // Current rocket orientation (from local vertical)
    // Convert to pitch from horizontal for comparison
    const currentPitchRad = (Math.PI / 2) - state.rocketAngle;
    const currentPitchDeg = currentPitchRad * 180 / Math.PI;
    
    // Pitch error (positive = need to pitch up)
    const pitchError = targetPitchDeg - currentPitchDeg;  // degrees
    
    // PD controller gains
    const Kp = 1.5;   // Proportional gain (degrees gimbal per degree error)
    const Kd = 0.8;   // Derivative gain (degrees gimbal per degree/sec angular rate)
    
    // Current angular velocity in degrees/sec
    // Positive angularVelocity = rocketAngle increasing = pitch decreasing
    const angularVelDeg = state.angularVelocity * 180 / Math.PI;
    
    // Desired angular velocity to reduce pitch error
    // To increase pitch (positive error), we need negative angular velocity
    // Time constant ~2 seconds for smooth response
    const desiredAngularVelDeg = -pitchError / 2.0;
    const angularVelError = desiredAngularVelDeg - angularVelDeg;
    
    // Gimbal command
    // Negative Kp because: positive pitch error → need negative gimbal
    // Positive Kd because: if angularVelError is negative (rotating too fast positive),
    //                      we need negative gimbal to slow down
    let gimbalCommand = -Kp * pitchError + Kd * angularVelError;
    
    // Clamp to gimbal limits
    if (state.currentStage < getRocketConfig().stages.length) {
        const maxGimbal = getRocketConfig().stages[state.currentStage].gimbalMaxAngle;
        gimbalCommand = Math.max(-maxGimbal, Math.min(maxGimbal, gimbalCommand));
    }
    
    return gimbalCommand;
}

/**
 * ============================================================================
 * AERODYNAMIC FORCES WITH ANGLE OF ATTACK
 * ============================================================================
 * 
 * Implements aerodynamic forces when rocket body axis is not aligned with
 * airspeed vector (angle of attack ≠ 0). Creates normal forces perpendicular
 * to body axis and torques about center of gravity.
 */

/**
 * Calculate center of pressure (CP) position from rocket bottom
 * CP depends on geometry and Mach number
 * 
 * @param {number} mach - Mach number
 * @param {number} rocketLength - Total rocket length (m)
 * @returns {number} CP position from rocket bottom (m)
 */
export function calculateCenterOfPressure(mach, rocketLength) {
    let cpFraction;
    
    if (mach < 0.8) {
        // Subsonic: CP at 50% of rocket length
        cpFraction = 0.5;
    } else if (mach <= 1.2) {
        // Transonic: CP shifts aft (toward tail)
        cpFraction = 0.5 + 0.1 * (mach - 0.8) / 0.4;
    } else {
        // Supersonic: CP at 60% of rocket length (further aft)
        cpFraction = 0.6;
    }
    
    return cpFraction * rocketLength;
}

/**
 * Calculate angle of attack (AOA) between rocket body axis and airspeed vector
 * Preserves sign to determine normal force direction
 * 
 * @param {Object} bodyAxis - Body axis direction vector {x, y}
 * @param {number} airVx - Airspeed x component (m/s)
 * @param {number} airVy - Airspeed y component (m/s)
 * @returns {number} Angle of attack in radians (signed)
 */
export function calculateAngleOfAttack(bodyAxis, airVx, airVy) {
    const airspeedMag = Math.sqrt(airVx * airVx + airVy * airVy);
    
    // Zero airspeed = zero AOA
    if (airspeedMag < 1e-6) {
        return 0;
    }
    
    // Normalize body axis
    const bodyMag = Math.sqrt(bodyAxis.x * bodyAxis.x + bodyAxis.y * bodyAxis.y);
    if (bodyMag < 1e-6) {
        return 0;
    }
    
    const bodyUnitX = bodyAxis.x / bodyMag;
    const bodyUnitY = bodyAxis.y / bodyMag;
    
    // Unit airspeed vector
    const airspeedUnitX = airVx / airspeedMag;
    const airspeedUnitY = airVy / airspeedMag;
    
    // 2D cross product gives signed value
    const cross = bodyUnitX * airspeedUnitY - bodyUnitY * airspeedUnitX;
    const dot = bodyUnitX * airspeedUnitX + bodyUnitY * airspeedUnitY;
    
    // AOA = atan2(cross, dot) preserves sign
    const aoa = Math.atan2(cross, dot);
    
    return aoa;
}

/**
 * Calculate normal force coefficient derivative (CN_alpha)
 * Force per radian of angle of attack
 * 
 * @param {number} mach - Mach number
 * @returns {number} CN_alpha (1/radian)
 */
export function calculateNormalForceCoefficientDerivative(mach) {
    if (mach < 0.8) {
        // Subsonic: Prandtl-Glauert correction increases CN_alpha
        const denominator = Math.sqrt(1 - mach * mach);
        if (denominator < 1e-6) return 2; // Avoid division by zero
        return 2 / denominator;
    } else if (mach <= 1.2) {
        // Transonic: Interpolate between subsonic and supersonic
        const cnAlphaSubsonic = 2 / Math.sqrt(1 - 0.8 * 0.8);
        const cnAlphaSupersonic = 4 / Math.sqrt(1.2 * 1.2 - 1);
        const t = (mach - 0.8) / 0.4; // 0 to 1 across transonic
        return cnAlphaSubsonic * (1 - t) + cnAlphaSupersonic * t;
    } else {
        // Supersonic: CN_alpha decreases as Mach increases
        const denominator = Math.sqrt(mach * mach - 1);
        if (denominator < 1e-6) return 4; // Avoid division by zero
        return 4 / denominator;
    }
}

/**
 * Calculate aerodynamic forces (normal and axial)
 * 
 * @param {number} altitude - Geometric altitude (m)
 * @param {number} airspeed - Airspeed magnitude (m/s)
 * @param {number} aoa - Angle of attack (radians)
 * @param {Object} bodyAxis - Body axis direction vector {x, y}
 * @param {number} airVx - Airspeed x component (m/s)
 * @param {number} airVy - Airspeed y component (m/s)
 * @param {Object} localUp - Local up unit vector {x, y}
 * @param {Object} localEast - Local east unit vector {x, y}
 * @param {Object} stage - Rocket stage configuration (optional)
 * @returns {Object} { F_normal, F_axial, F_aero_x, F_aero_y, normal_dir, axial_dir }
 */
export function calculateAerodynamicForces(altitude, airspeed, aoa, bodyAxis, airVx, airVy, localUp, localEast, stage = null) {
    // Use provided stage or get from state
    if (!stage) {
        if (state.currentStage >= getRocketConfig().stages.length) {
            return {
                F_normal: 0,
                F_axial: 0,
                F_aero_x: 0,
                F_aero_y: 0,
                normal_dir: { x: 0, y: 0 },
                axial_dir: { x: 0, y: 0 }
            };
        }
        stage = getRocketConfig().stages[state.currentStage];
    }
    
    // Zero airspeed or zero AOA = no normal force
    if (airspeed < 1e-6 || Math.abs(aoa) < 1e-6) {
        // Just use existing drag model for axial force
        const drag = getDrag(altitude, airspeed, stage);
        const dragDirX = airspeed > 0 ? -airVx / airspeed : 0;
        const dragDirY = airspeed > 0 ? -airVy / airspeed : 0;
        
        return {
            F_normal: 0,
            F_axial: drag,
            F_aero_x: drag * dragDirX,
            F_aero_y: drag * dragDirY,
            normal_dir: { x: 0, y: 0 },
            axial_dir: { x: dragDirX, y: dragDirY }
        };
    }
    
    // Get atmospheric properties
    const atm = getAtmosphericProperties(altitude);
    const density = atm.density;
    const mach = airspeed / atm.speedOfSound;
    
    // Reference area
    const area = Math.PI * (stage.diameter / 2) ** 2;
    
    // Dynamic pressure
    const q = 0.5 * density * airspeed * airspeed;
    
    // Normal force coefficient
    const cnAlpha = calculateNormalForceCoefficientDerivative(mach);
    const cn = cnAlpha * aoa; // CN = CN_alpha * AOA
    
    // Normal force magnitude
    const F_normal = q * area * cn;
    
    // Axial force coefficient (use existing drag model with cos(AOA) correction)
    const caBase = getMachDragCoefficient(mach);
    const ca = caBase * Math.cos(aoa); // For small angles, cos(AOA) ≈ 1
    
    // Axial force magnitude
    const F_axial = q * area * ca;
    
    // Normalize body axis
    const bodyMag = Math.sqrt(bodyAxis.x * bodyAxis.x + bodyAxis.y * bodyAxis.y);
    const bodyUnitX = bodyAxis.x / bodyMag;
    const bodyUnitY = bodyAxis.y / bodyMag;
    
    // Normal force direction: project airspeed onto plane perpendicular to body axis
    const airspeedUnitX = airVx / airspeed;
    const airspeedUnitY = airVy / airspeed;
    
    // Remove component parallel to body axis
    const dotParallel = bodyUnitX * airspeedUnitX + bodyUnitY * airspeedUnitY;
    let perpX = airspeedUnitX - dotParallel * bodyUnitX;
    let perpY = airspeedUnitY - dotParallel * bodyUnitY;
    
    // Normalize perpendicular component
    const perpMag = Math.sqrt(perpX * perpX + perpY * perpY);
    let normalDirX = 0;
    let normalDirY = 0;
    
    if (perpMag > 1e-6) {
        normalDirX = perpX / perpMag;
        normalDirY = perpY / perpMag;
    }
    
    // Axial force direction (opposite to body axis)
    const axialDirX = -bodyUnitX;
    const axialDirY = -bodyUnitY;
    
    // Total aerodynamic force components
    const F_aero_x = F_normal * normalDirX + F_axial * axialDirX;
    const F_aero_y = F_normal * normalDirY + F_axial * axialDirY;
    
    return {
        F_normal,
        F_axial,
        F_aero_x,
        F_aero_y,
        normal_dir: { x: normalDirX, y: normalDirY },
        axial_dir: { x: axialDirX, y: axialDirY },
        cn,
        ca,
        cnAlpha
    };
}

/**
 * Calculate aerodynamic torque about center of gravity
 * 
 * @param {number} altitude - Geometric altitude (m)
 * @param {number} airspeed - Airspeed magnitude (m/s)
 * @param {number} aoa - Angle of attack (radians)
 * @param {Object} bodyAxis - Body axis direction vector {x, y}
 * @param {number} airVx - Airspeed x component (m/s)
 * @param {number} airVy - Airspeed y component (m/s)
 * @param {Object} localUp - Local up unit vector {x, y}
 * @param {Object} localEast - Local east unit vector {x, y}
 * @returns {Object} { torque, momentArm, cpPosition, cogPosition }
 */
export function calculateAerodynamicTorque(altitude, airspeed, aoa, bodyAxis, airVx, airVy, localUp, localEast) {
    // Zero airspeed or zero AOA = no torque
    if (airspeed < 1e-6 || Math.abs(aoa) < 1e-6) {
        return {
            torque: 0,
            momentArm: 0,
            cpPosition: 0,
            cogPosition: 0
        };
    }
    
    // Get rocket geometry
    const cogData = calculateRocketCOG();
    const cogPosition = cogData.cog; // From rocket bottom
    const rocketLength = cogData.rocketLength;
    
    // Get Mach number
    const atm = getAtmosphericProperties(altitude);
    const mach = airspeed / atm.speedOfSound;
    
    // Calculate CP position
    const cpPosition = calculateCenterOfPressure(mach, rocketLength);
    
    // Moment arm (CP - COG, both from rocket bottom)
    const momentArm = cpPosition - cogPosition;
    
    // Calculate normal force (only normal force creates torque)
    if (state.currentStage >= getRocketConfig().stages.length) {
        return {
            torque: 0,
            momentArm,
            cpPosition,
            cogPosition
        };
    }
    
    const stage = getRocketConfig().stages[state.currentStage];
    const aeroForces = calculateAerodynamicForces(
        altitude, airspeed, aoa, bodyAxis, airVx, airVy, localUp, localEast, stage
    );
    
    const F_normal = aeroForces.F_normal;
    
    // Torque = F_normal * moment_arm
    // Positive torque rotates rocket clockwise (pitch down)
    const torque = F_normal * momentArm;
    
    return {
        torque,
        momentArm,
        cpPosition,
        cogPosition
    };
}

