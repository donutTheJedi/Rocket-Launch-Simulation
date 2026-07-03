import { EARTH_RADIUS, EARTH_ROTATION, KARMAN_LINE, GUIDANCE_CONFIG } from './constants.js';
import { getRocketConfig, isCustomRocket, resetToDefault } from './rocketConfig.js';
import { updateRocketSummary } from './rocketSummary.js';
import { state, initState, getAltitude, getTotalMass, resetCurrentMission, spawnInOrbit } from './state.js';
import { getGravity, getCurrentThrust, getMassFlowRate, getAtmosphericDensity, getAirspeed, getDrag, 
         integrateRotationalDynamics, getRocketThrustDirection, calculateCommandedGimbal,
         calculateAngleOfAttack, calculateAerodynamicForces, calculateAerodynamicTorque,
         calculateRocketCOGAtPad, calculateCenterOfPressure } from './physics.js';
import { calculateOrbitalElements } from './orbital.js';
import { computeGuidance, guidanceState, resetGuidance } from './guidance.js';
import { cubicGuidanceState, resetCubicGuidance, computeCubicVacuumGuidance } from './cubicGuidance.js';
import { addEvent } from './events.js';
import { calculateStructuralLoads, checkStructuralFailure } from './structural.js';
import { updateTelemetry } from './telemetry.js';
import { initRenderer, resize, render } from './renderer.js';
import { initInput } from './input.js';
import { registerMissionFailure, initMissionFailureDialog, dismissMissionFailureDialog } from './missionFailure.js';
import {
    loadPersistedSettings,
    isChallengeActive,
    startChallengeFromMenu,
    resetChallengeEverything,
    confirmExitChallenge,
} from './challenge.js';

// Update physics simulation
function update(dt) {
    if (!state.running) return;
    const rocketConfig = getRocketConfig();
    
    // Update manual pitch if in manual mode (use original dt before time warp for consistent turning speed)
    if (window.updateManualPitch) {
        window.updateManualPitch(dt);
    }
    
    dt *= state.timeWarp;
    const maxDt = 1.0;
    if (dt > maxDt) {
        dt = maxDt;
    }
    const altitude = getAltitude();
    const r = Math.sqrt(state.x * state.x + state.y * state.y);
    const velocity = Math.sqrt(state.vx * state.vx + state.vy * state.vy);
    
    if (r < EARTH_RADIUS && state.time > 1 && state.engineOn) {
        addEvent("MISSION FAILURE - Ground impact");
        registerMissionFailure('impact');
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
    // In orbital mode, always allow burns. Otherwise, check pitch program completion.
    const pitchProgramComplete = state.gameMode === 'orbital' || state.time > 600 || (!state.engineOn && altitude > 150000);
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
        // Closed-loop guidance system (will be called per sub-step for accuracy)
        thrustDir = null; // Will be computed in sub-stepping loop
    }
    
    // Enable engine for burn modes
    // In orbital mode, always allow burns if conditions are met
    if (state.burnMode && pitchProgramComplete && !state.engineOn && altitude > 150000 && 
        state.currentStage < rocketConfig.stages.length && 
        state.propellantRemaining[state.currentStage] > 0) {
        state.engineOn = true;
    }
    
    // Adaptive sub-stepping
    const inOrbit = altitude > 150000 && !state.engineOn;
    const maxStepSize = inOrbit ? 0.01 : 0.05;
    const steps = Math.max(1, Math.ceil(dt / maxStepSize));
    const maxSteps = 1000;
    const actualSteps = Math.min(steps, maxSteps);
    const actualStepDt = dt / actualSteps;
    
    // Check if aerodynamic forces are enabled (only in gimbal control mode)
    const aeroForcesEnabled = state.settings.enableAerodynamicForces && 
                               state.settings.controlMode === 'gimbal';
    
    for (let step = 0; step < actualSteps; step++) {
        const rStep = Math.sqrt(state.x * state.x + state.y * state.y);
        const altitudeStep = rStep - EARTH_RADIUS;
        const velocityStep = Math.sqrt(state.vx * state.vx + state.vy * state.vy);
        
        // Recalculate local reference frame for each sub-step (position changes)
        const localUpStep = { x: state.x / rStep, y: state.y / rStep };
        const localEastStep = { x: localUpStep.y, y: -localUpStep.x };
        
        // Compute guidance for each sub-step if not in burn mode
        let targetPitchDeg = 90;  // Default: straight up
        let throttleStep = 1.0;
        
        // If in burn mode, calculate target orientation
        if (thrustDir && state.burnMode) {
            const velocity = Math.sqrt(state.vx * state.vx + state.vy * state.vy);
            const prograde = velocity > 0 ? { x: state.vx / velocity, y: state.vy / velocity } : { x: 0, y: 0 };
            const radial = localUpStep;
            const h = state.x * state.vy - state.y * state.vx;
            const normal = h > 0 ? { x: -localUpStep.y, y: localUpStep.x } : { x: localUpStep.y, y: -localUpStep.x };
            
            let targetDir;
            switch (state.burnMode) {
                case 'prograde':
                    targetDir = prograde;
                    break;
                case 'retrograde':
                    targetDir = { x: -prograde.x, y: -prograde.y };
                    break;
                case 'normal':
                    targetDir = normal;
                    break;
                case 'anti-normal':
                    targetDir = { x: -normal.x, y: -normal.y };
                    break;
                case 'radial':
                    targetDir = radial;
                    break;
                case 'anti-radial':
                    targetDir = { x: -radial.x, y: -radial.y };
                    break;
                default:
                    targetDir = prograde;
            }
            
            // Convert target direction to pitch angle
            // Pitch is angle from horizontal (local east)
            const dotUp = targetDir.x * localUpStep.x + targetDir.y * localUpStep.y;
            const dotEast = targetDir.x * localEastStep.x + targetDir.y * localEastStep.y;
            targetPitchDeg = Math.atan2(dotUp, dotEast) * 180 / Math.PI;
            throttleStep = 1.0;
        }
        
        if (!thrustDir) {
            // Skip guidance in orbital mode (user uses burn controls)
            if (state.gameMode === 'orbital') {
                // No thrust in orbital mode unless using burn controls
                throttleStep = 0;
                // Keep rocket oriented prograde when coasting
                const velocity = Math.sqrt(state.vx * state.vx + state.vy * state.vy);
                if (velocity > 0) {
                    const prograde = { x: state.vx / velocity, y: state.vy / velocity };
                    const dotUp = prograde.x * localUpStep.x + prograde.y * localUpStep.y;
                    const dotEast = prograde.x * localEastStep.x + prograde.y * localEastStep.y;
                    targetPitchDeg = Math.atan2(dotUp, dotEast) * 180 / Math.PI;
                }
            } else {
                // Guidance mode - update every sub-step for accuracy
                // Cubic mode uses standard ascent guidance in atmosphere, then cubic solver in vacuum.
                let guidance;
                if (state.gameMode === 'cubic' && altitudeStep >= GUIDANCE_CONFIG.atmosphereLimit && state.currentStage >= 1) {
                    const speed = Math.sqrt(state.vx * state.vx + state.vy * state.vy);
                    const flightPathAngleDeg = speed > 1e-6
                        ? Math.atan2(
                            state.vx * localUpStep.x + state.vy * localUpStep.y,
                            state.vx * localEastStep.x + state.vy * localEastStep.y
                        ) * 180 / Math.PI
                        : 0;
                    guidance = computeCubicVacuumGuidance(state, altitudeStep, flightPathAngleDeg);
                } else {
                    guidance = computeGuidance(state, actualStepDt);
                }
                
                // In manual mode, use manual pitch but store guidance recommendation
                if (state.gameMode === 'manual' && state.manualPitch !== null) {
                    // Store guidance recommendation
                    state.guidanceRecommendation = guidance.pitch;
                    targetPitchDeg = state.manualPitch;
                    throttleStep = guidance.throttle; // Still use guidance throttle
                } else {
                    // Normal guidance mode
                    targetPitchDeg = guidance.pitch;
                    throttleStep = guidance.throttle;
                }
                
                // Update state with latest guidance (will be overwritten each sub-step, last one persists)
                state.guidancePhase = guidance.phase;
                state.guidancePitch = guidance.pitch;
                state.guidanceThrottle = guidance.throttle;
                state.guidanceDebug = guidance.debug;
                state.guidanceIsRetrograde = guidanceState.isRetrograde;
                
                // Detect and log guidance-specific burn events (only on first sub-step to avoid spam).
                // Suppress these in Manual mode to keep mission events pilot-focused.
                const shouldLogGuidanceEvents = state.gameMode === 'guided' || state.gameMode === 'cubic';
                if (shouldLogGuidanceEvents && step === 0 && guidance.phase === 'vacuum-guidance' && guidance.debug && guidance.debug.reason) {
                    const reason = guidance.debug.reason;
                    const useDirectAscent = guidance.debug.useDirectAscent;
                    
                    // Direct ascent strategy: Prograde burn to raise periapsis (check this FIRST)
                    if (useDirectAscent && 
                        (reason.includes('Direct ascent') && reason.includes('raising periapsis')) && 
                        !guidanceState.circularizationBurnStarted && 
                        state.engineOn && 
                        guidance.throttle > 0) {
                        guidanceState.circularizationBurnStarted = true;  // Reuse flag to prevent re-triggering
                        addEvent(`Direct ascent burn - raising periapsis to target`);
                    }
                    // Traditional strategy: Circularization burn at apoapsis (only if NOT direct ascent)
                    // Only announce if more than 25 minutes have passed (avoids false positives during ascent)
                    else if (!useDirectAscent && 
                        state.time >= 1500 && 
                        (reason.includes('Starting circularization') || reason.includes('circularizing')) && 
                        !guidanceState.circularizationBurnStarted && 
                        state.engineOn && 
                        guidance.throttle > 0) {
                        guidanceState.circularizationBurnStarted = true;
                        const deltaV = guidance.debug.circDeltaV || 0;
                        const burnTime = guidance.debug.circBurnTime || 0;
                        addEvent(`Circularization burn start (Δv: ${(deltaV/1000).toFixed(1)} km/s, ${burnTime.toFixed(1)}s)`);
                    }
                    
                    // Retrograde burn at periapsis (both strategies)
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
        } else {
            // Manual burn mode
            throttleStep = 1.0;
        }
        
        // Calculate commanded gimbal angle to achieve target pitch
        // In gimbal control mode for manual, use the direct manual gimbal input
        if (state.gameMode === 'manual' && state.settings.controlMode === 'gimbal') {
            state.commandedGimbal = state.manualGimbal;
        } else {
            state.commandedGimbal = calculateCommandedGimbal(targetPitchDeg, actualStepDt);
        }
        
        // Get current thrust for rotational dynamics
        const thrustStep = getCurrentThrust(altitudeStep, throttleStep);
        
        // Integrate rotational dynamics (updates gimbal angle, angular velocity, rocket angle)
        // Pass local reference frame for aerodynamic torque calculation (only if enabled)
        if (aeroForcesEnabled) {
            integrateRotationalDynamics(thrustStep, actualStepDt, localUpStep, localEastStep);
        } else {
            integrateRotationalDynamics(thrustStep, actualStepDt);
        }
        
        // Get actual thrust direction based on rocket orientation and gimbal
        const thrustDirStep = getRocketThrustDirection(localUpStep, localEastStep);
        
        const gravityStep = getGravity(rStep);
        const gxStep = -gravityStep * state.x / rStep;
        const gyStep = -gravityStep * state.y / rStep;
        
        const thrustAccelStep = thrustStep / mass;
        const taxStep = thrustAccelStep * thrustDirStep.x;
        const tayStep = thrustAccelStep * thrustDirStep.y;
        
        const atmVxStep = EARTH_ROTATION * state.y;
        const atmVyStep = -EARTH_ROTATION * state.x;
        const airVxStep = state.vx - atmVxStep;
        const airVyStep = state.vy - atmVyStep;
        const airspeedStep = Math.sqrt(airVxStep * airVxStep + airVyStep * airVyStep);
        
        // Calculate aerodynamic forces with angle of attack
        // Only apply if enabled in settings and in gimbal control mode
        let daxStep = 0;
        let dayStep = 0;
        
        if (aeroForcesEnabled && altitudeStep < 70000 && airspeedStep > 1e-3) {
            // Calculate rocket body axis direction
            const bodyAxisX = Math.sin(state.rocketAngle) * localEastStep.x + Math.cos(state.rocketAngle) * localUpStep.x;
            const bodyAxisY = Math.sin(state.rocketAngle) * localEastStep.y + Math.cos(state.rocketAngle) * localUpStep.y;
            const bodyAxis = { x: bodyAxisX, y: bodyAxisY };
            
            // Calculate angle of attack
            const aoa = calculateAngleOfAttack(bodyAxis, airVxStep, airVyStep);
            
            // Calculate aerodynamic forces
            const aeroForces = calculateAerodynamicForces(
                altitudeStep, airspeedStep, aoa, bodyAxis, airVxStep, airVyStep, 
                localUpStep, localEastStep
            );
            
            // Apply aerodynamic forces as acceleration
            const aeroAccelX = aeroForces.F_aero_x / mass;
            const aeroAccelY = aeroForces.F_aero_y / mass;
            
            daxStep = aeroAccelX;
            dayStep = aeroAccelY;
        } else {
            // Fallback to simple drag for very high altitude, zero airspeed, or when aero forces disabled
            const dragStep = getDrag(altitudeStep, airspeedStep);
            const dragAccelStep = airspeedStep > 0 ? dragStep / mass : 0;
            daxStep = airspeedStep > 0 ? -dragAccelStep * airVxStep / airspeedStep : 0;
            dayStep = airspeedStep > 0 ? -dragAccelStep * airVyStep / airspeedStep : 0;
        }
        
        const axStep = gxStep + taxStep + daxStep;
        const ayStep = gyStep + tayStep + dayStep;
        
        // Symplectic Euler integrator
        state.vx += axStep * actualStepDt;
        state.vy += ayStep * actualStepDt;
        state.x += state.vx * actualStepDt;
        state.y += state.vy * actualStepDt;
        
        // Propellant consumption per sub-step (using actual throttle for this step)
        if (state.engineOn && state.currentStage < rocketConfig.stages.length) {
            state.propellantRemaining[state.currentStage] -= getMassFlowRate(altitudeStep, throttleStep) * actualStepDt;
        }
    }
    
    // Calculate force unit vectors for force diagram (after all sub-steps, use final values)
    const rFinal = Math.sqrt(state.x * state.x + state.y * state.y);
    const localUpFinal = { x: state.x / rFinal, y: state.y / rFinal };
    const localEastFinal = { x: localUpFinal.y, y: -localUpFinal.x };
    
    state.forceVectors.gravity = { x: -localUpFinal.x, y: -localUpFinal.y };
    
    if (state.engineOn && state.currentStage < rocketConfig.stages.length &&
        state.propellantRemaining[state.currentStage] > 0) {
        state.forceVectors.thrust = getRocketThrustDirection(localUpFinal, localEastFinal);
    } else {
        state.forceVectors.thrust = { x: 0, y: 0 };
    }
    
    const altFinal = getAltitude();
    const inAtmosphere = altFinal < KARMAN_LINE;
    const { airspeed, airVx, airVy } = getAirspeed();
    if (inAtmosphere && airspeed > 0.1) {
        state.forceVectors.drag = { x: -airVx / airspeed, y: -airVy / airspeed };
    } else {
        state.forceVectors.drag = { x: 0, y: 0 };
    }
    
    // Calculate aerodynamic force vector for force diagram
    // Only show if aerodynamic forces are enabled
    if (aeroForcesEnabled && altFinal < 70000 && airspeed > 1e-3) {
        // Calculate rocket body axis direction
        const bodyAxisX = Math.sin(state.rocketAngle) * localEastFinal.x + Math.cos(state.rocketAngle) * localUpFinal.x;
        const bodyAxisY = Math.sin(state.rocketAngle) * localEastFinal.y + Math.cos(state.rocketAngle) * localUpFinal.y;
        const bodyAxis = { x: bodyAxisX, y: bodyAxisY };
        
        // Calculate angle of attack
        const aoa = calculateAngleOfAttack(bodyAxis, airVx, airVy);
        
        // Calculate aerodynamic forces
        const aeroForces = calculateAerodynamicForces(
            altFinal, airspeed, aoa, bodyAxis, airVx, airVy, 
            localUpFinal, localEastFinal
        );
        
        // Calculate unit vector for force diagram
        const aeroMag = Math.sqrt(aeroForces.F_aero_x * aeroForces.F_aero_x + aeroForces.F_aero_y * aeroForces.F_aero_y);
        if (aeroMag > 1e-6) {
            state.forceVectors.aero = {
                x: aeroForces.F_aero_x / aeroMag,
                y: aeroForces.F_aero_y / aeroMag
            };
        } else {
            state.forceVectors.aero = { x: 0, y: 0 };
        }
    } else {
        state.forceVectors.aero = { x: 0, y: 0 };
    }
    
    // Check for stage depletion after all sub-steps
    if (state.currentStage < rocketConfig.stages.length && 
        state.propellantRemaining[state.currentStage] <= 0) {
        state.propellantRemaining[state.currentStage] = 0;
        if (state.currentStage === 0) {
            addEvent("MECO");
            state.currentStage = 1;
            addEvent("Stage separation");
            addEvent("SES-1");
            // Reset cubic guidance so it re-solves fresh for the new stage.
            // Must be called on every stage separation; omitting it leaves
            // burnStartTime / T from stage 1, which causes an immediate
            // profile-horizon re-solve before stage 2 params are valid.
            resetCubicGuidance();
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
    
    if (!state.fairingJettisoned && altitude > rocketConfig.fairingJettisonAlt) {
        state.fairingJettisoned = true;
        addEvent("Fairing jettison");
    }
    
    // Dynamic pressure
    const { airspeed: airspeedForQ } = getAirspeed();
    const dynPress = 0.5 * getAtmosphericDensity(altitude) * airspeedForQ * airspeedForQ;
    if (dynPress > state.maxQ) state.maxQ = dynPress;
    
    calculateOrbitalElements();

    // Structural integrity — compute every frame, store in state for telemetry + renderer
    state.structuralData = calculateStructuralLoads();
    checkStructuralFailure(state.structuralData, addEvent);

    // Add to trail
    if (state.time % 0.1 < dt * state.timeWarp) {
        state.trail.push({ x: state.x, y: state.y });
        if (state.trail.length > 10000) state.trail.shift();
    }
    
    // Gravity turn events are guidance-mode cues, so hide them in Manual mode.
    const shouldLogGuidanceEvents = state.gameMode === 'guided' || state.gameMode === 'cubic';
    if (shouldLogGuidanceEvents && state.time >= 10.0 && !state.events.some(e => e.text.includes("Gravity turn kick"))) {
        addEvent("Gravity turn kick");
    }
    if (shouldLogGuidanceEvents && state.time >= 13.0 && !state.events.some(e => e.text.includes("Gravity turn active"))) {
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

// Menu functions
function showMenu() {
    dismissMissionFailureDialog();
    const menuPanel = document.getElementById('menu-panel');
    const menuOverlay = document.getElementById('menu-overlay');
    if (menuPanel && menuOverlay) {
        menuPanel.style.display = 'block';
        menuOverlay.style.display = 'block';
        setTimeout(() => {
            menuPanel.classList.add('show');
        }, 10);
        const wasRunning = state.running;
        state.running = false;
        updateCurrentModeDisplay();
        updateUIForMode();
        updateGuidanceModeAvailability();
        updateRocketSummary();
        syncSettingsUI();
        updateChallengeActiveNote();
        if (wasRunning) {
            const pauseBtn = document.getElementById('pause-btn');
            if (pauseBtn) {
                pauseBtn.textContent = 'PAUSE';
            }
        }
    }
}

function hideMenu() {
    const menuPanel = document.getElementById('menu-panel');
    const menuOverlay = document.getElementById('menu-overlay');
    if (menuPanel && menuOverlay) {
        menuPanel.classList.remove('show');
        setTimeout(() => {
            menuPanel.style.display = 'none';
            menuOverlay.style.display = 'none';
            
            // If no mission mode is selected, default to manual (or challenge → manual)
            if (state.gameMode === null || state.gameMode === undefined) {
                startMission('manual');
            }
        }, 300);
    }
}

function updateCurrentModeDisplay() {
    const modeDisplay = document.getElementById('current-mode-display');
    if (modeDisplay) {
        if (state.gameMode === 'manual') {
            modeDisplay.textContent = 'Current Mode: Manual Control';
        } else if (state.gameMode === 'guided') {
            modeDisplay.textContent = `Current Mode: Guided Launch (${(state.targetAltitude / 1000).toFixed(0)}km target)`;
        } else if (state.gameMode === 'orbital') {
            modeDisplay.textContent = `Current Mode: Orbital (${(state.orbitalSpawnAltitude / 1000).toFixed(0)}km)`;
        } else if (state.gameMode === 'cubic') {
            modeDisplay.textContent = `Current Mode: Cubic Guidance (${(state.targetAltitude / 1000).toFixed(0)}km target)`;
        } else {
            modeDisplay.textContent = 'No mission selected';
        }
    }
}

function startMission(mode, options = {}) {
    const launchBtn = document.getElementById('launch-btn');
    const pauseBtn = document.getElementById('pause-btn');

    // Always reset launch/pause controls when selecting a mission from the menu.
    // Without this, switching modes after a prior launch can leave LAUNCH disabled,
    // which makes the new mode appear to not start.
    if (launchBtn) {
        launchBtn.disabled = false;
        launchBtn.style.display = 'inline-block';
        launchBtn.textContent = (mode === 'orbital') ? 'START' : 'LAUNCH';
    }
    if (pauseBtn) {
        pauseBtn.style.display = 'none';
        pauseBtn.textContent = 'PAUSE';
    }

    if (mode === 'manual') {
        state.gameMode = 'manual';
        state.manualPitch = 90;
        initState();
        resetGuidance();
        hideMenu();
    } else if (mode === 'guided') {
        const targetAlt = options.targetAltitude || 500000;
        state.gameMode = 'guided';
        state.targetAltitude = targetAlt;
        GUIDANCE_CONFIG.targetAltitude = targetAlt;
        initState();
        resetGuidance();
        hideMenu();
    } else if (mode === 'orbital') {
        if (isChallengeActive()) return;
        const altitude = options.altitude || 500000;
        state.gameMode = 'orbital';
        state.orbitalSpawnAltitude = altitude;
        spawnInOrbit(altitude);
        resetGuidance();
        hideMenu();
    } else if (mode === 'cubic') {
        const targetAlt = options.targetAltitude || 500000;
        state.gameMode = 'cubic';
        state.targetAltitude = targetAlt;
        GUIDANCE_CONFIG.targetAltitude = targetAlt;
        initState();
        resetGuidance();
        resetCubicGuidance();
        console.log(`[Mode] Cubic guidance selected (target ${(targetAlt / 1000).toFixed(0)} km)`);
        hideMenu();
    }
    state.running = false;
    state.engineOn = false;
    updateUIForMode();
}

function updateUIForMode() {
    const launchBtn = document.getElementById('launch-btn');
    const manualControls = document.getElementById('manual-pitch-controls');
    const pitchProgram = document.getElementById('pitch-program');
    const isMobile = window.innerWidth <= 768;

    if (state.gameMode === 'cubic') {
        if (manualControls) {
            manualControls.style.display = 'none';
            manualControls.classList.remove('mobile-bottom-right');
        }
        if (pitchProgram) pitchProgram.style.display = 'block';
    } else if (state.gameMode === 'manual') {
        if (manualControls) {
            manualControls.style.display = 'block';
            // On mobile, position in bottom right (outside hamburger menu)
            if (isMobile) {
                manualControls.classList.add('mobile-bottom-right');
                // Make sure it's not in the mobile panel - move to body if it's in any container
                const mobilePanel = document.getElementById('mobile-ui-panel');
                if (mobilePanel && mobilePanel.contains(manualControls)) {
                    document.body.appendChild(manualControls);
                }
            } else {
                manualControls.classList.remove('mobile-bottom-right');
            }
        }
        if (pitchProgram) pitchProgram.style.display = 'none';
    } else {
        if (manualControls) {
            manualControls.style.display = 'none';
            manualControls.classList.remove('mobile-bottom-right');
        }
        if (pitchProgram && state.gameMode !== 'orbital') {
            pitchProgram.style.display = 'block';
        } else if (pitchProgram) {
            pitchProgram.style.display = 'none';
        }
    }
    
    // Show launch button for all modes; orbital shows "START" instead of "LAUNCH"
    if (launchBtn && state.gameMode !== null) {
        launchBtn.style.display = 'inline-block';
        launchBtn.textContent = (state.gameMode === 'orbital') ? 'START' : 'LAUNCH';
    }
}

// Export for use in input.js
window.updateUIForMode = updateUIForMode;

// Update top-links (docs, GitHub) position based on events panel width
function updateTopLinksPosition() {
    const eventsPanel = document.getElementById('events');
    const topLinks = document.getElementById('top-links');
    
    if (!eventsPanel || !topLinks) return;
    
    const eventsRect = eventsPanel.getBoundingClientRect();
    const buffer = 10; // 10px buffer
    
    // Get the right position of the events panel
    const eventsRight = window.innerWidth - eventsRect.right;
    
    // Position top-links to the left of events panel with buffer
    topLinks.style.right = `${eventsRight + eventsRect.width + buffer}px`;
}

// Initialize top-links positioning
function initTopLinksPosition() {
    const eventsPanel = document.getElementById('events');
    const topLinks = document.getElementById('top-links');
    
    if (!eventsPanel || !topLinks) return;
    
    // Update position initially (use requestAnimationFrame to ensure DOM is ready)
    requestAnimationFrame(() => {
        updateTopLinksPosition();
    });
    
    // Watch for changes to events panel size
    if (window.ResizeObserver) {
        const resizeObserver = new ResizeObserver(() => {
            requestAnimationFrame(() => {
                updateTopLinksPosition();
            });
        });
        resizeObserver.observe(eventsPanel);
    }
    
    // Also update on window resize
    window.addEventListener('resize', () => {
        requestAnimationFrame(() => {
            updateTopLinksPosition();
        });
    });
}

function updateGuidanceModeAvailability() {
    const cubicCard = document.querySelector('.menu-mode-card[data-mode="cubic"]');
    const custom = isCustomRocket();

    if (cubicCard) cubicCard.classList.toggle('guidance-disabled', custom);

    if (custom) {
        const selected = document.querySelector('.menu-mode-card.selected');
        if (selected && selected.dataset.mode === 'cubic') {
            selected.classList.remove('selected');
            document.querySelectorAll('.menu-mode-info').forEach(b => { b.style.display = 'none'; });
            const launchBtn = document.getElementById('menu-launch-btn');
            if (launchBtn) { launchBtn.disabled = true; launchBtn.textContent = 'SELECT A MODE'; }
        }
    }
}

function updateChallengeCardUI() {
    const challenge = isChallengeActive();
    const card = document.getElementById('challenge-card');
    const label = document.getElementById('challenge-card-label');
    const sub = document.getElementById('challenge-card-sub');
    const badgeMain = document.getElementById('challenge-card-badge-main');
    const badgeSub = document.getElementById('challenge-card-badge-sub');

    card?.classList.toggle('menu-mode-card--challenge-exit', challenge);
    if (label) label.textContent = challenge ? 'EXIT CHALLENGE' : 'CHALLENGE';
    if (sub) sub.textContent = challenge ? 'Reset to defaults' : 'Extreme difficulty';
    if (badgeMain) badgeMain.textContent = challenge ? 'EXIT' : 'HARD';
    if (badgeSub) badgeSub.textContent = challenge ? 'Are you sure?' : 'Design & fly';
}

function exitChallengeFromMenu() {
    if (!confirmExitChallenge()) return;

    resetChallengeEverything(state.settings);
    state.gameMode = null;
    state.manualPitch = null;
    state.manualGimbal = 0;
    initState();
    resetGuidance();
    resetCubicGuidance();

    document.querySelectorAll('.menu-mode-card.selected').forEach((c) => c.classList.remove('selected'));
    document.querySelectorAll('.menu-mode-info').forEach((b) => { b.style.display = 'none'; });
    const modeInfoBox = document.getElementById('mode-info-box');
    if (modeInfoBox) modeInfoBox.style.display = 'none';
    const menuLaunchBtn = document.getElementById('menu-launch-btn');
    if (menuLaunchBtn) {
        menuLaunchBtn.disabled = true;
        menuLaunchBtn.textContent = 'SELECT A MODE';
    }

    updateRocketSummary();
    updateGuidanceModeAvailability();
    updateChallengeActiveNote();
    syncSettingsUI();
    if (window.updateControlModeUI) window.updateControlModeUI();
    updateCurrentModeDisplay();
    updateUIForMode();
    updateTelemetry();
}

function preselectChallengeManualMode() {
    state.gameMode = 'manual';
    state.manualPitch = 90;
    initState();
    resetGuidance();

    document.querySelectorAll('.menu-mode-card.selected').forEach((c) => c.classList.remove('selected'));
    const manualCard = document.querySelector('.menu-mode-card[data-mode="manual"]');
    if (manualCard) manualCard.classList.add('selected');

    document.querySelectorAll('.menu-mode-info').forEach((b) => { b.style.display = 'none'; });
    const infoBlock = document.querySelector('.menu-mode-info[data-mode="manual"]');
    if (infoBlock) infoBlock.style.display = '';
    const modeInfoBox = document.getElementById('mode-info-box');
    if (modeInfoBox) modeInfoBox.style.display = '';

    const menuLaunchBtn = document.getElementById('menu-launch-btn');
    if (menuLaunchBtn) {
        menuLaunchBtn.disabled = false;
        menuLaunchBtn.textContent = 'LAUNCH — MANUAL CONTROL';
    }

    updateUIForMode();
    updateCurrentModeDisplay();
}

function updateChallengeActiveNote() {
    const challenge = isChallengeActive();
    const note = document.getElementById('menu-challenge-active-note');
    if (note) note.style.display = challenge ? '' : 'none';

    const settingsSection = document.getElementById('menu-settings-section');
    if (settingsSection) settingsSection.style.display = challenge ? 'none' : '';

    updateChallengeCardUI();

    const orbitalCard = document.querySelector('.menu-mode-card[data-mode="orbital"]');
    if (orbitalCard) orbitalCard.classList.toggle('guidance-disabled', challenge);

    if (challenge) {
        const selected = document.querySelector('.menu-mode-card.selected');
        if (selected && selected.dataset.mode === 'orbital') {
            selected.classList.remove('selected');
            document.querySelectorAll('.menu-mode-info').forEach(b => { b.style.display = 'none'; });
            const modeInfoBox = document.getElementById('mode-info-box');
            if (modeInfoBox) modeInfoBox.style.display = 'none';
            const launchBtn = document.getElementById('menu-launch-btn');
            if (launchBtn) {
                launchBtn.disabled = true;
                launchBtn.textContent = 'SELECT A MODE';
            }
        }
    }
}

// Initialize menu event handlers
function initMenu() {
    const menuBtn = document.getElementById('menu-btn');
    const menuCloseBtn = document.getElementById('menu-close-btn');
    const menuOverlay = document.getElementById('menu-overlay');
    const startManualBtn = document.getElementById('start-manual-btn');
    const startGuidedBtn = document.getElementById('start-guided-btn');
    const startOrbitalBtn = document.getElementById('start-orbital-btn');
    const startCubicBtn = document.getElementById('start-cubic-btn');
    const presetBtns = document.querySelectorAll('.preset-btn');
    
    window.showMenu = showMenu;

    if (menuBtn) {
        menuBtn.addEventListener('click', showMenu);
    }
    
    if (menuCloseBtn) {
        menuCloseBtn.addEventListener('click', hideMenu);
    }
    
    if (menuOverlay) {
        menuOverlay.addEventListener('click', hideMenu);
    }

    const resetRocketBtn = document.getElementById('reset-rocket-btn');
    if (resetRocketBtn) {
        resetRocketBtn.addEventListener('click', () => {
            resetToDefault();
            updateRocketSummary();
            updateGuidanceModeAvailability();
        });
    }
    
    if (startManualBtn) {
        startManualBtn.addEventListener('click', () => {
            startMission('manual');
        });
    }
    
    if (startGuidedBtn) {
        startGuidedBtn.addEventListener('click', () => {
            const input = document.getElementById('target-altitude-input');
            const targetAlt = input ? parseFloat(input.value) * 1000 : 500000;
            startMission('guided', { targetAltitude: targetAlt });
        });
    }
    
    if (startOrbitalBtn) {
        startOrbitalBtn.addEventListener('click', () => {
            const activePreset = document.querySelector('.preset-btn.active');
            const altitude = activePreset ? parseFloat(activePreset.dataset.altitude) * 1000 : 500000;
            startMission('orbital', { altitude: altitude });
        });
    }

    if (startCubicBtn) {
        startCubicBtn.addEventListener('click', () => {
            const altInput  = document.getElementById('cubic-altitude-input');
            const targetAlt = altInput ? parseFloat(altInput.value) * 1000 : 500000;
            startMission('cubic', { targetAltitude: targetAlt });
        });
    }
    
    presetBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            presetBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
        });
    });

    // ── Mode card selection + mode info box ──
    const modeCards = document.querySelectorAll('.menu-mode-card');
    const modeInfoBlocks = document.querySelectorAll('.menu-mode-info');
    const modeInfoBox = document.getElementById('mode-info-box');
    const launchBtn = document.getElementById('menu-launch-btn');

    const launchLabels = {
        manual: 'LAUNCH — MANUAL CONTROL',
        guided: 'LAUNCH — GUIDED',
        cubic:  'LAUNCH — CUBIC GUIDANCE',
        orbital: 'SPAWN IN ORBIT',
    };

    const challengeCard = document.getElementById('challenge-card');
    if (challengeCard) {
        challengeCard.addEventListener('click', () => {
            if (isChallengeActive()) {
                exitChallengeFromMenu();
            } else {
                startChallengeFromMenu();
            }
        });
    }

    modeCards.forEach(card => {
        card.addEventListener('click', () => {
            if (!card.dataset.mode) return;
            const mode = card.dataset.mode;
            modeCards.forEach(c => c.classList.remove('selected'));
            card.classList.add('selected');
            modeInfoBlocks.forEach(b => { b.style.display = 'none'; });
            const infoBlock = document.querySelector(`.menu-mode-info[data-mode="${mode}"]`);
            if (infoBlock) { infoBlock.style.display = ''; }
            if (modeInfoBox) modeInfoBox.style.display = '';
            if (launchBtn) {
                launchBtn.disabled = false;
                launchBtn.textContent = launchLabels[mode] || 'LAUNCH';
            }
        });
    });

    if (launchBtn) {
        launchBtn.addEventListener('click', () => {
            const selected = document.querySelector('.menu-mode-card.selected');
            if (!selected) return;
            const mode = selected.dataset.mode;
            if (mode === 'manual' && startManualBtn)   startManualBtn.click();
            else if (mode === 'guided' && startGuidedBtn) startGuidedBtn.click();
            else if (mode === 'cubic'  && startCubicBtn)  startCubicBtn.click();
            else if (mode === 'orbital' && startOrbitalBtn) startOrbitalBtn.click();
        });
    }

    // ── Settings: control mode row ──
    const controlModeRow = document.getElementById('settings-control-mode-row');
    const controlModeVal = document.getElementById('settings-control-mode-val');
    if (controlModeRow) {
        controlModeRow.addEventListener('click', () => {
            const isGimbal = state.settings.controlMode === 'gimbal';
            if (isGimbal) {
                document.getElementById('control-turnrate-btn')?.click();
            } else {
                document.getElementById('control-gimbal-btn')?.click();
            }
            if (controlModeVal) {
                controlModeVal.textContent = isGimbal ? 'TURN RATE ›' : 'GIMBAL ›';
            }
        });
    }

    // ── Settings: aero forces toggle ──
    const aeroToggle = document.getElementById('aero-forces-toggle');
    if (aeroToggle) {
        aeroToggle.addEventListener('change', () => {
            if (aeroToggle.checked) {
                document.getElementById('aero-forces-on-btn')?.click();
            } else {
                document.getElementById('aero-forces-off-btn')?.click();
            }
        });
    }

    // ── Settings: structural failure toggle ──
    const structToggle = document.getElementById('struct-fail-toggle');
    if (structToggle) {
        structToggle.addEventListener('change', () => {
            if (structToggle.checked) {
                document.getElementById('struct-fail-terminate-btn')?.click();
            } else {
                document.getElementById('struct-fail-warn-btn')?.click();
            }
        });
    }
}

function syncSettingsUI() {
    const controlModeVal = document.getElementById('settings-control-mode-val');
    const aeroToggle     = document.getElementById('aero-forces-toggle');
    const structToggle   = document.getElementById('struct-fail-toggle');
    if (controlModeVal) {
        controlModeVal.textContent = state.settings.controlMode === 'gimbal' ? 'GIMBAL ›' : 'TURN RATE ›';
    }
    if (aeroToggle)  aeroToggle.checked  = state.settings.enableAerodynamicForces === true;
    if (structToggle) structToggle.checked = state.settings.structuralFailureMode === 'terminate';
}

// Initialize mobile UI panel
function initMobileUI() {
    const hamburger = document.getElementById('mobile-menu-toggle');
    const mobilePanel = document.getElementById('mobile-ui-panel');
    const controls = document.getElementById('controls');
    const quickActions = document.getElementById('quick-actions');
    const topLinks = document.getElementById('top-links');
    const pitchProgram = document.getElementById('pitch-program');
    const manualPitchControls = document.getElementById('manual-pitch-controls');
    const burnControls = document.getElementById('burn-controls');
    
    const controlsContainer = document.getElementById('mobile-controls-container');
    const githubContainer = document.getElementById('mobile-github-container');
    const pitchContainer = document.getElementById('mobile-pitch-container');
    
    if (!hamburger || !mobilePanel) return;
    
    function isMobile() {
        return window.innerWidth <= 768;
    }
    
    function movePanelsToMobile() {
        if (!isMobile()) return;
        
        if (controls && controlsContainer && !controlsContainer.contains(controls)) {
            controlsContainer.appendChild(controls);
        }
        if (topLinks && githubContainer && !githubContainer.contains(topLinks)) {
            githubContainer.appendChild(topLinks);
        }
        if (pitchProgram && pitchContainer && !pitchContainer.contains(pitchProgram)) {
            pitchContainer.appendChild(pitchProgram);
        }
        // Manual pitch controls: only move to mobile panel if NOT in manual mode
        // In manual mode, they stay in body and are positioned in bottom right
        if (manualPitchControls && state.gameMode !== 'manual' && pitchContainer && !pitchContainer.contains(manualPitchControls)) {
            pitchContainer.appendChild(manualPitchControls);
        }
        // Burn controls stay in body, not moved to mobile panel
    }
    
    function movePanelsBack() {
        if (isMobile()) return;
        
        const body = document.body;
        if (controls && !body.contains(controls)) {
            body.appendChild(controls);
        }
        if (topLinks && !body.contains(topLinks)) {
            body.appendChild(topLinks);
        }
        if (pitchProgram && !body.contains(pitchProgram)) {
            body.appendChild(pitchProgram);
        }
        if (manualPitchControls && !body.contains(manualPitchControls)) {
            body.appendChild(manualPitchControls);
        }
        // Burn controls stay in body
    }
    
    // Toggle mobile panel
    function toggleMobilePanel() {
        hamburger.classList.toggle('active');
        mobilePanel.classList.toggle('show');
    }
    
    // Close mobile panel when clicking outside
    function closeMobilePanel(e) {
        if (mobilePanel.classList.contains('show') && 
            !mobilePanel.contains(e.target) && 
            !hamburger.contains(e.target)) {
            hamburger.classList.remove('active');
            mobilePanel.classList.remove('show');
        }
    }
    
    hamburger.addEventListener('click', toggleMobilePanel);
    document.addEventListener('click', closeMobilePanel);
    
    // Move panels on init and resize
    if (isMobile()) {
        movePanelsToMobile();
    } else {
        movePanelsBack();
    }
    
    window.addEventListener('resize', () => {
        if (isMobile()) {
            movePanelsToMobile();
        } else {
            movePanelsBack();
        }
        // Update UI positioning when switching between mobile/desktop
        if (typeof updateUIForMode === 'function') {
            updateUIForMode();
        }
    });
}

// Initialize application
function init() {
    const canvas = document.getElementById('canvas');
    initRenderer(canvas);
    resize();
    loadPersistedSettings(state.settings);
    initState();
    resetGuidance();
    initInput();
    initMissionFailureDialog();
    dismissMissionFailureDialog();
    initMenu();
    if (window.updateControlModeUI) window.updateControlModeUI();
    syncSettingsUI();
    initTopLinksPosition();
    initMobileUI();
    updateRocketSummary();
    updateGuidanceModeAvailability();
    updateChallengeActiveNote();
    showMenu(); // Show menu on startup
    if (isChallengeActive()) {
        preselectChallengeManualMode();
    }
    updateTelemetry();
    requestAnimationFrame(loop);
}

// Start when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}

