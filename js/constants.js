// Physical constants
export const G = 6.67430e-11;
export const EARTH_MASS = 5.972e24;
export const EARTH_RADIUS = 6.371e6;
export const EARTH_ROTATION = 7.2921159e-5;
export const KARMAN_LINE = 100000;
export const ATM_SCALE_HEIGHT = 8500;
export const SEA_LEVEL_PRESSURE = 101325;
export const SEA_LEVEL_DENSITY = 1.225;

// Rocket configuration (Falcon 9-like)
export const ROCKET_CONFIG = {
    stages: [
        {
            name: "Stage 1",
            dryMass: 22200,
            propellantMass: 395700,
            thrust: 7607000,
            thrustVac: 8227000,
            isp: 282,
            ispVac: 311,
            diameter: 3.7,
            length: 47,
            tankLengthRatio: 0.85,     // Fraction of stage length that is tank
            engineLength: 3.0,          // Length of engine section at bottom (m)
            dryMassEngineFraction: 0.6, // Fraction of dry mass in engines (bottom)
            dragCoeff: 0.3,
            // Gimbal configuration (Merlin 1D specs)
            gimbalMaxAngle: 5.0,        // degrees - max gimbal deflection
            gimbalRate: 20.0,           // degrees/second - gimbal actuator rate
            gimbalPoint: 0.5            // meters from stage bottom - gimbal pivot point
        },
        {
            name: "Stage 2",
            dryMass: 4000,
            propellantMass: 92670,
            thrust: 981000,
            thrustVac: 981000,
            isp: 348,
            ispVac: 348,
            diameter: 3.7,
            length: 14,
            tankLengthRatio: 0.80,     // Fraction of stage length that is tank
            engineLength: 2.0,          // Length of engine section at bottom (m)
            dryMassEngineFraction: 0.5, // Fraction of dry mass in engines (bottom)
            dragCoeff: 0.25,
            // Gimbal configuration (MVac specs)
            gimbalMaxAngle: 5.0,        // degrees - max gimbal deflection  
            gimbalRate: 15.0,           // degrees/second - gimbal actuator rate
            gimbalPoint: 0.3            // meters from stage bottom - gimbal pivot point
        }
    ],
    payload: {
        mass: 15000,
        length: 5,          // Payload section length (m)
        diameter: 3.7       // Same as rocket diameter
    },
    fairing: {
        mass: 1700,
        length: 4,          // Fairing length (m) - cone shape on top
        diameter: 3.7
    },
    fairingJettisonAlt: 110000,
    totalLength: 70,        // Total rocket length (m)
    
    // Propellant properties (RP-1/LOX mixture)
    // Average density of RP-1 (~820 kg/m³) and LOX (~1140 kg/m³)
    // Mixed at ~2.5:1 ratio by mass gives effective density ~911 kg/m³
    propellantDensity: 923  // kg/m³
};

// ============================================================================
// CLOSED-LOOP GUIDANCE SYSTEM v3
// ============================================================================
// 
// V3 PHILOSOPHY: Simple, priority-based guidance that focuses on what matters
// when it matters. In atmosphere, we DON'T optimize for orbit - we escape.
// Above atmosphere, we optimize for target orbit.
//
// PRIORITY SYSTEM:
//   1. HEIGHT      — Get above 70km (out of significant atmosphere)
//   2. MAX Q       — Don't exceed structural limits, follow prograde in atmo
//   3. ANGLE       — Correct orbit shape (apoapsis/periapsis) - ONLY above 70km
//   4. VELOCITY    — Throttle down near end to hit target precisely
//
// KEY INSIGHT: Don't try to optimize trajectory in atmosphere.
// Get high, get fast, THEN correct.
//
// ATMOSPHERIC PHASE (below 70km):
//   - Follow prograde (minimizes angle of attack and drag)
//   - Smooth altitude-based minimum pitch constraint (prevents premature pitchover)
//   - Turn rate limiting (prevents gravity turn from running away)
//   - Max Q protection (follow prograde exactly when near structural limits)
//
// VACUUM PHASE (above 70km):
//   - Active closed-loop guidance to reach target orbit
//   - Adjusts pitch based on apoapsis/periapsis errors
//   - Throttle control for precise orbit insertion
//
// ============================================================================
export const GUIDANCE_CONFIG = {
    // Target orbit
    targetAltitude: 500000,          // meters — target circular orbit
    
    // Atmosphere threshold
    atmosphereLimit: 70000,          // meters — above this, we're in "vacuum"
    
    // Max Q protection
    maxQ: 35000,                     // Pa — typical max Q for Falcon 9 ~32-35 kPa
    
    // Pitch constraints
    maxPitchCorrection: 10,          // degrees — max deviation from prograde in vacuum
    maxPitchRate: 2.0,               // degrees/second — physical rotation limit
    
    // Throttle control
    throttleDownMargin: 1.15,        // Start throttling when deltaV reserve > 115% needed
    minThrottle: 0.4,                // Don't throttle below 40%
    
    // Initial ascent
    initialPitch: 85,                // degrees — slight eastward tilt from start
    pitchKickStart: 10,               // seconds — when to start pitching from vertical
    pitchKickEnd: 15,                // seconds — when to reach initialPitch
};

// Launch latitude (Cape Canaveral)
export const LAUNCH_LATITUDE = 28.5 * Math.PI / 180;

