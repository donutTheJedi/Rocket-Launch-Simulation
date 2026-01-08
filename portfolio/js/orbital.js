import { G, EARTH_MASS, EARTH_RADIUS, ROCKET_CONFIG } from './constants.js';
import { state } from './state.js';

// ============================================================================
// Predict orbit from current state (vacuum assumption)
// ============================================================================
export function predictOrbit(stateObj) {
    const r = Math.sqrt(stateObj.x * stateObj.x + stateObj.y * stateObj.y);
    const v = Math.sqrt(stateObj.vx * stateObj.vx + stateObj.vy * stateObj.vy);
    const mu = G * EARTH_MASS;
    
    // Specific orbital energy: ε = v²/2 - μ/r
    const energy = (v * v / 2) - (mu / r);
    
    // Semi-major axis: a = -μ/(2ε)
    // If energy ≥ 0, we're on escape trajectory
    if (energy >= 0) {
        return {
            apoapsis: Infinity,
            periapsis: r - EARTH_RADIUS,
            semiMajorAxis: Infinity,
            eccentricity: 1,
            energy: energy,
            isEscape: true
        };
    }
    
    const semiMajorAxis = -mu / (2 * energy);
    
    // Angular momentum: h = r × v (magnitude in 2D)
    const angularMomentum = stateObj.x * stateObj.vy - stateObj.y * stateObj.vx;
    
    // Eccentricity: e = √(1 + 2εh²/μ²)
    const eSquared = 1 + (2 * energy * angularMomentum * angularMomentum) / (mu * mu);
    const eccentricity = Math.sqrt(Math.max(0, eSquared));
    
    // Apoapsis and periapsis
    const apoapsis = semiMajorAxis * (1 + eccentricity) - EARTH_RADIUS;
    const periapsis = semiMajorAxis * (1 - eccentricity) - EARTH_RADIUS;
    
    return {
        apoapsis: apoapsis,
        periapsis: periapsis,
        semiMajorAxis: semiMajorAxis,
        eccentricity: eccentricity,
        energy: energy,
        angularMomentum: angularMomentum,
        isEscape: false
    };
}

// ============================================================================
// Compute remaining delta-v from propellant (Tsiolkovsky equation)
// ============================================================================
export function computeRemainingDeltaV(stateObj) {
    // Δv = Isp × g₀ × ln(m_initial / m_final)
    
    const g0 = 9.81;
    let totalDeltaV = 0;
    
    // Current stage
    if (stateObj.currentStage < ROCKET_CONFIG.stages.length) {
        const stage = ROCKET_CONFIG.stages[stateObj.currentStage];
        const propellant = stateObj.propellantRemaining[stateObj.currentStage];
        
        if (propellant > 0) {
            // Mass at start of current burn
            let massInitial = ROCKET_CONFIG.payload;
            if (!stateObj.fairingJettisoned) massInitial += ROCKET_CONFIG.fairingMass;
            
            // Add current stage
            massInitial += stage.dryMass + propellant;
            
            // Add future stages
            for (let i = stateObj.currentStage + 1; i < ROCKET_CONFIG.stages.length; i++) {
                massInitial += ROCKET_CONFIG.stages[i].dryMass + stateObj.propellantRemaining[i];
            }
            
            // Mass at end (after burning current stage propellant)
            const massFinal = massInitial - propellant;
            
            // Use vacuum Isp (we're mostly concerned with vacuum performance)
            const isp = stage.ispVac;
            
            // Tsiolkovsky rocket equation
            totalDeltaV += isp * g0 * Math.log(massInitial / massFinal);
        }
    }
    
    // Future stages (full burns)
    for (let i = stateObj.currentStage + 1; i < ROCKET_CONFIG.stages.length; i++) {
        const stage = ROCKET_CONFIG.stages[i];
        const propellant = stateObj.propellantRemaining[i];
        
        if (propellant > 0) {
            // Mass at start of this stage's burn
            let massInitial = ROCKET_CONFIG.payload;
            // Fairing should be jettisoned by upper stage
            massInitial += stage.dryMass + propellant;
            
            // Add any stages after this
            for (let j = i + 1; j < ROCKET_CONFIG.stages.length; j++) {
                massInitial += ROCKET_CONFIG.stages[j].dryMass + stateObj.propellantRemaining[j];
            }
            
            const massFinal = massInitial - propellant;
            const isp = stage.ispVac;
            
            totalDeltaV += isp * g0 * Math.log(massInitial / massFinal);
        }
    }
    
    return totalDeltaV;
}

// ============================================================================
// Compute total delta-v at launch (for progress tracking)
// ============================================================================
export function computeInitialDeltaV() {
    const g0 = 9.81;
    let totalDeltaV = 0;
    
    for (let i = 0; i < ROCKET_CONFIG.stages.length; i++) {
        const stage = ROCKET_CONFIG.stages[i];
        const propellant = stage.propellantMass;
        
        // Mass at start of this stage
        let massInitial = ROCKET_CONFIG.payload + ROCKET_CONFIG.fairingMass;
        massInitial += stage.dryMass + propellant;
        
        for (let j = i + 1; j < ROCKET_CONFIG.stages.length; j++) {
            massInitial += ROCKET_CONFIG.stages[j].dryMass + ROCKET_CONFIG.stages[j].propellantMass;
        }
        
        const massFinal = massInitial - propellant;
        
        // Use vacuum Isp for simplicity (slight overestimate for stage 1)
        const isp = stage.ispVac;
        
        totalDeltaV += isp * g0 * Math.log(massInitial / massFinal);
    }
    
    return totalDeltaV;
}

// ============================================================================
// Calculate orbital elements and update state
// ============================================================================
export function calculateOrbitalElements() {
    const r = Math.sqrt(state.x * state.x + state.y * state.y);
    const v = Math.sqrt(state.vx * state.vx + state.vy * state.vy);
    const mu = G * EARTH_MASS;
    const energy = (v * v / 2) - (mu / r);
    const a = -mu / (2 * energy);
    const h = state.x * state.vy - state.y * state.vx;
    const e = Math.sqrt(Math.max(0, 1 + (2 * energy * h * h) / (mu * mu)));
    
    if (a > 0 && e < 1) {
        state.apoapsis = a * (1 + e) - EARTH_RADIUS;
        state.periapsis = a * (1 - e) - EARTH_RADIUS;
    } else {
        state.apoapsis = Infinity;
        state.periapsis = a * (1 - e) - EARTH_RADIUS;
    }
}

