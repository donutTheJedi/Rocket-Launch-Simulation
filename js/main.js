import { EARTH_RADIUS, EARTH_ROTATION, KARMAN_LINE, ROCKET_CONFIG } from './constants.js';
import { state, initState, getAltitude, getTotalMass } from './state.js';
import { getGravity, getCurrentThrust, getMassFlowRate, getAtmosphericDensity, getAirspeed, getDrag } from './physics.js';
import { calculateOrbitalElements } from './orbital.js';
import { computeGuidance, guidanceState, resetGuidance } from './guidance.js';
import { addEvent } from './events.js';
import { updateTelemetry } from './telemetry.js';
import { initRenderer, resize, render } from './renderer.js';
import { initInput } from './input.js';

// Update physics simulation
function update(dt) {
    if (!state.running) return;
    
    dt *= state.timeWarp;
    const maxDt = 1.0;
    if (dt > maxDt) {
        dt = maxDt;
    }
    const altitude = getAltitude();
    const r = Math.sqrt(state.x * state.x + state.y * state.y);
    const velocity = Math.sqrt(state.vx * state.vx + state.vy * state.vy);
    
    if (r < EARTH_RADIUS && state.time > 1) {
        state.running = false;
        addEvent("MISSION FAILURE - Ground impact");
        return;
    }
    
    const mass = getTotalMass();
    
    // Gravity pointing toward Earth center
    const gravity = getGravity(r);
    const gx = -gravity * state.x / r;
    const gy = -gravity * state.y / r;
    
    // Local reference frame
    const localUp = { x: state.x / r, y: state.y / r };
    const localEast = { x: localUp.y, y: -localUp.x };
    
    // Calculate orbital directions if in orbit
    let thrustDir;
    const pitchProgramComplete = state.time > 600 || (!state.engineOn && altitude > 150000);
    if (state.burnMode && pitchProgramComplete && altitude > 150000) {
        const velocity = Math.sqrt(state.vx * state.vx + state.vy * state.vy);
        const prograde = velocity > 0 ? { x: state.vx / velocity, y: state.vy / velocity } : { x: 0, y: 0 };
        const radial = localUp;
        const h = state.x * state.vy - state.y * state.vx;
        const normal = h > 0 ? { x: -localUp.y, y: localUp.x } : { x: localUp.y, y: -localUp.x };
        
        switch (state.burnMode) {
            case 'prograde':
                thrustDir = prograde;
                break;
            case 'retrograde':
                thrustDir = { x: -prograde.x, y: -prograde.y };
                break;
            case 'normal':
                thrustDir = normal;
                break;
            case 'anti-normal':
                thrustDir = { x: -normal.x, y: -normal.y };
                break;
            case 'radial':
                thrustDir = radial;
                break;
            case 'anti-radial':
                thrustDir = { x: -radial.x, y: -radial.y };
                break;
            default:
                thrustDir = prograde;
        }
    } else {
        // Closed-loop guidance system
        const guidance = computeGuidance(state, dt);
        thrustDir = guidance.thrustDir;
        state.guidancePhase = guidance.phase;
        state.guidancePitch = guidance.pitch;
        state.guidanceThrottle = guidance.throttle;
        
        // Detect and log burn start events
        if (guidance.phase === 'vacuum-guidance' && guidance.debug.reason) {
            const reason = guidance.debug.reason;
            if ((reason.includes('Starting circularization') || reason.includes('At apoapsis — circularizing')) && 
                !guidanceState.circularizationBurnStarted && 
                state.engineOn && 
                guidance.throttle > 0) {
                guidanceState.circularizationBurnStarted = true;
                const deltaV = guidance.debug.circDeltaV || 0;
                const burnTime = guidance.debug.circBurnTime || 0;
                addEvent(`Circularization burn start (Δv: ${(deltaV/1000).toFixed(1)} km/s, ${burnTime.toFixed(1)}s)`);
            }
            
            if (reason.includes('Starting retrograde burn') && 
                !guidanceState.retrogradeBurnStarted && 
                state.engineOn && 
                guidance.throttle > 0) {
                guidanceState.retrogradeBurnStarted = true;
                const deltaV = guidance.debug.retroDeltaV || 0;
                const burnTime = guidance.debug.retroBurnTime || 0;
                addEvent(`Retrograde burn start (Δv: ${(deltaV/1000).toFixed(1)} km/s, ${burnTime.toFixed(1)}s)`);
            }
        }
    }
    
    // Enable engine for burn modes
    if (state.burnMode && pitchProgramComplete && !state.engineOn && altitude > 150000 && 
        state.currentStage < ROCKET_CONFIG.stages.length && 
        state.propellantRemaining[state.currentStage] > 0) {
        state.engineOn = true;
    }
    
    const throttle = state.guidanceThrottle !== undefined ? state.guidanceThrottle : 1.0;
    const thrust = getCurrentThrust(altitude, throttle);
    const thrustAccel = thrust / mass;
    const tax = thrustAccel * thrustDir.x;
    const tay = thrustAccel * thrustDir.y;
    
    const { airspeed, airVx, airVy } = getAirspeed();
    const drag = getDrag(altitude, airspeed);
    const dragAccel = airspeed > 0 ? drag / mass : 0;
    const dax = airspeed > 0 ? -dragAccel * airVx / airspeed : 0;
    const day = airspeed > 0 ? -dragAccel * airVy / airspeed : 0;
    
    // Adaptive sub-stepping
    const inOrbit = altitude > 150000 && !state.engineOn;
    const maxStepSize = inOrbit ? 0.01 : 0.05;
    const steps = Math.max(1, Math.ceil(dt / maxStepSize));
    const maxSteps = 1000;
    const actualSteps = Math.min(steps, maxSteps);
    const actualStepDt = dt / actualSteps;
    
    for (let step = 0; step < actualSteps; step++) {
        const rStep = Math.sqrt(state.x * state.x + state.y * state.y);
        const altitudeStep = rStep - EARTH_RADIUS;
        const velocityStep = Math.sqrt(state.vx * state.vx + state.vy * state.vy);
        
        const gravityStep = getGravity(rStep);
        const gxStep = -gravityStep * state.x / rStep;
        const gyStep = -gravityStep * state.y / rStep;
        
        const thrustStep = getCurrentThrust(altitudeStep, throttle);
        const thrustAccelStep = thrustStep / mass;
        const taxStep = thrustAccelStep * thrustDir.x;
        const tayStep = thrustAccelStep * thrustDir.y;
        
        const atmVxStep = EARTH_ROTATION * state.y;
        const atmVyStep = -EARTH_ROTATION * state.x;
        const airVxStep = state.vx - atmVxStep;
        const airVyStep = state.vy - atmVyStep;
        const airspeedStep = Math.sqrt(airVxStep * airVxStep + airVyStep * airVyStep);
        const dragStep = getDrag(altitudeStep, airspeedStep);
        const dragAccelStep = airspeedStep > 0 ? dragStep / mass : 0;
        const daxStep = airspeedStep > 0 ? -dragAccelStep * airVxStep / airspeedStep : 0;
        const dayStep = airspeedStep > 0 ? -dragAccelStep * airVyStep / airspeedStep : 0;
        
        const axStep = gxStep + taxStep + daxStep;
        const ayStep = gyStep + tayStep + dayStep;
        
        // Symplectic Euler integrator
        state.vx += axStep * actualStepDt;
        state.vy += ayStep * actualStepDt;
        state.x += state.vx * actualStepDt;
        state.y += state.vy * actualStepDt;
    }
    
    // Propellant consumption
    if (state.engineOn && state.currentStage < ROCKET_CONFIG.stages.length) {
        state.propellantRemaining[state.currentStage] -= getMassFlowRate(altitude, throttle) * dt;
        
        if (state.propellantRemaining[state.currentStage] <= 0) {
            state.propellantRemaining[state.currentStage] = 0;
            if (state.currentStage === 0) {
                addEvent("MECO");
                state.currentStage = 1;
                addEvent("Stage separation");
                addEvent("SES-1");
            } else {
                addEvent("SECO");
                state.engineOn = false;
                if (state.burnMode) {
                    const burnNames = {
                        'prograde': 'PROGRADE',
                        'retrograde': 'RETROGRADE',
                        'normal': 'NORMAL',
                        'anti-normal': 'ANTI-NORMAL',
                        'radial': 'RADIAL',
                        'anti-radial': 'ANTI-RADIAL'
                    };
                    const duration = state.burnStartTime ? (state.time - state.burnStartTime).toFixed(1) : '0.0';
                    addEvent(`${burnNames[state.burnMode]} burn ended - out of propellant (${duration}s)`);
                    state.burnMode = null;
                    state.burnStartTime = null;
                }
            }
        }
    }
    
    // Turn off burn mode if engine turns off
    if (state.burnMode && !state.engineOn && state.burnStartTime !== null) {
        const burnNames = {
            'prograde': 'PROGRADE',
            'retrograde': 'RETROGRADE',
            'normal': 'NORMAL',
            'anti-normal': 'ANTI-NORMAL',
            'radial': 'RADIAL',
            'anti-radial': 'ANTI-RADIAL'
        };
        const duration = (state.time - state.burnStartTime).toFixed(1);
        addEvent(`${burnNames[state.burnMode]} burn ended (${duration}s)`);
        state.burnMode = null;
        state.burnStartTime = null;
    }
    
    // Update burn duration tracking
    if (state.burnMode && state.burnStartTime === null) {
        state.burnStartTime = state.time;
    }
    
    if (!state.fairingJettisoned && altitude > ROCKET_CONFIG.fairingJettisonAlt) {
        state.fairingJettisoned = true;
        addEvent("Fairing jettison");
    }
    
    // Dynamic pressure
    const { airspeed: airspeedForQ } = getAirspeed();
    const dynPress = 0.5 * getAtmosphericDensity(altitude) * airspeedForQ * airspeedForQ;
    if (dynPress > state.maxQ) state.maxQ = dynPress;
    
    calculateOrbitalElements();
    
    // Add to trail
    if (state.time % 0.1 < dt * state.timeWarp) {
        state.trail.push({ x: state.x, y: state.y });
        if (state.trail.length > 10000) state.trail.shift();
    }
    
    // Gravity turn events
    if (state.time >= 10.0 && !state.events.some(e => e.text.includes("Gravity turn kick"))) {
        addEvent("Gravity turn kick");
    }
    if (state.time >= 13.0 && !state.events.some(e => e.text.includes("Gravity turn active"))) {
        addEvent("Gravity turn active - thrusting prograde");
    }
    
    if (altitude >= KARMAN_LINE && !state.events.some(e => e.text.includes("Kármán"))) {
        addEvent("Kármán line - SPACE!");
    }
    
    state.time += dt;
    updateTelemetry();
}

// Game loop
let lastTime = 0;
function loop(time) {
    const dt = Math.min((time - lastTime) / 1000, 0.1);
    lastTime = time;
    update(dt);
    render();
    requestAnimationFrame(loop);
}

// Initialize application
function init() {
    const canvas = document.getElementById('canvas');
    initRenderer(canvas);
    resize();
    initState();
    resetGuidance();
    initInput();
    updateTelemetry();
    requestAnimationFrame(loop);
}

// Start when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}

