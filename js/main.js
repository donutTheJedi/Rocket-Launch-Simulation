import { EARTH_RADIUS, EARTH_ROTATION, KARMAN_LINE, GUIDANCE_CONFIG } from './constants.js';
import { getRocketConfig, setRocketConfig, resetToDefault } from './rocketConfig.js';
import { state, initState, getAltitude, getTotalMass, resetCurrentMission, spawnInOrbit } from './state.js';
import { getGravity, getCurrentThrust, getMassFlowRate, getAtmosphericDensity, getAirspeed, getDrag, 
         integrateRotationalDynamics, getRocketThrustDirection, calculateCommandedGimbal,
         calculateAngleOfAttack, calculateAerodynamicForces, calculateAerodynamicTorque } from './physics.js';
import { calculateOrbitalElements } from './orbital.js';
import { computeGuidance, guidanceState, resetGuidance } from './guidance.js';
import { addEvent } from './events.js';
import { updateTelemetry } from './telemetry.js';
import { initRenderer, resize, render } from './renderer.js';
import { initInput } from './input.js';

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
                const guidance = computeGuidance(state, actualStepDt);
                
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
                
                // Detect and log burn start events (only on first sub-step to avoid spam)
                if (step === 0 && guidance.phase === 'vacuum-guidance' && guidance.debug && guidance.debug.reason) {
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

// Menu functions
function showMenu() {
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
            
            // If no mission mode is selected, default to guided mode
            if (state.gameMode === null || state.gameMode === undefined) {
                const input = document.getElementById('target-altitude-input');
                const targetAlt = input ? parseFloat(input.value) * 1000 : 500000;
                startMission('guided', { targetAltitude: targetAlt });
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
        } else {
            modeDisplay.textContent = 'No mission selected';
        }
    }
}

function startMission(mode, options = {}) {
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
        const altitude = options.altitude || 500000;
        state.gameMode = 'orbital';
        state.orbitalSpawnAltitude = altitude;
        spawnInOrbit(altitude);
        resetGuidance();
        hideMenu();
    }
    updateUIForMode();
}

function updateUIForMode() {
    const launchBtn = document.getElementById('launch-btn');
    const manualControls = document.getElementById('manual-pitch-controls');
    const pitchProgram = document.getElementById('pitch-program');
    const isMobile = window.innerWidth <= 768;
    
    if (state.gameMode === 'manual') {
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
    
    // Show launch button only for manual and guided modes
    if (launchBtn) {
        if (state.gameMode === 'orbital') {
            launchBtn.style.display = 'none';
        } else if (state.gameMode !== null) {
            launchBtn.style.display = 'inline-block';
        }
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

// ========== Rocket builder ==========
// Schema: path, label, min, max, step, tab ('basic' | 'advanced')
const ROCKET_BUILDER_SCHEMA = [
    // Stage 1 - Basic: thrust, mass, diameter, length, propellant, drag coeff
    { path: 'stages.0.dryMass', label: 'Stage 1 Dry mass (kg)', min: 5000, max: 50000, step: 100, tab: 'basic' },
    { path: 'stages.0.propellantMass', label: 'Stage 1 Propellant (kg)', min: 100000, max: 600000, step: 1000, tab: 'basic' },
    { path: 'stages.0.thrust', label: 'Stage 1 Thrust SL (N)', min: 1e6, max: 15e6, step: 100000, tab: 'basic' },
    { path: 'stages.0.thrustVac', label: 'Stage 1 Thrust vac (N)', min: 1e6, max: 15e6, step: 100000, tab: 'basic' },
    { path: 'stages.0.diameter', label: 'Stage 1 Diameter (m)', min: 2, max: 6, step: 0.1, tab: 'basic' },
    { path: 'stages.0.length', label: 'Stage 1 Length (m)', min: 20, max: 60, step: 1, tab: 'basic' },
    { path: 'stages.0.dragCoeff', label: 'Stage 1 Drag coeff', min: 0.2, max: 0.5, step: 0.01, tab: 'basic' },
    // Stage 1 - Advanced
    { path: 'stages.0.isp', label: 'Stage 1 Isp SL (s)', min: 250, max: 350, step: 1, tab: 'advanced' },
    { path: 'stages.0.ispVac', label: 'Stage 1 Isp vac (s)', min: 280, max: 380, step: 1, tab: 'advanced' },
    { path: 'stages.0.tankLengthRatio', label: 'Stage 1 Tank ratio', min: 0.5, max: 0.95, step: 0.01, tab: 'advanced' },
    { path: 'stages.0.engineLength', label: 'Stage 1 Engine length (m)', min: 1, max: 5, step: 0.1, tab: 'advanced' },
    { path: 'stages.0.dryMassEngineFraction', label: 'Stage 1 Engine mass frac', min: 0.3, max: 0.8, step: 0.05, tab: 'advanced' },
    { path: 'stages.0.gimbalMaxAngle', label: 'Stage 1 Gimbal max (°)', min: 1, max: 15, step: 0.5, tab: 'advanced' },
    { path: 'stages.0.gimbalRate', label: 'Stage 1 Gimbal rate (°/s)', min: 5, max: 30, step: 0.5, tab: 'advanced' },
    { path: 'stages.0.gimbalPoint', label: 'Stage 1 Gimbal point (m)', min: 0.2, max: 1.5, step: 0.1, tab: 'advanced' },
    // Stage 2 - Basic
    { path: 'stages.1.dryMass', label: 'Stage 2 Dry mass (kg)', min: 1000, max: 8000, step: 100, tab: 'basic' },
    { path: 'stages.1.propellantMass', label: 'Stage 2 Propellant (kg)', min: 20000, max: 150000, step: 500, tab: 'basic' },
    { path: 'stages.1.thrust', label: 'Stage 2 Thrust SL (N)', min: 100000, max: 2e6, step: 10000, tab: 'basic' },
    { path: 'stages.1.thrustVac', label: 'Stage 2 Thrust vac (N)', min: 100000, max: 2e6, step: 10000, tab: 'basic' },
    { path: 'stages.1.diameter', label: 'Stage 2 Diameter (m)', min: 2, max: 6, step: 0.1, tab: 'basic' },
    { path: 'stages.1.length', label: 'Stage 2 Length (m)', min: 5, max: 25, step: 0.5, tab: 'basic' },
    { path: 'stages.1.dragCoeff', label: 'Stage 2 Drag coeff', min: 0.2, max: 0.5, step: 0.01, tab: 'basic' },
    // Stage 2 - Advanced
    { path: 'stages.1.isp', label: 'Stage 2 Isp SL (s)', min: 300, max: 360, step: 1, tab: 'advanced' },
    { path: 'stages.1.ispVac', label: 'Stage 2 Isp vac (s)', min: 320, max: 380, step: 1, tab: 'advanced' },
    { path: 'stages.1.tankLengthRatio', label: 'Stage 2 Tank ratio', min: 0.5, max: 0.95, step: 0.01, tab: 'advanced' },
    { path: 'stages.1.engineLength', label: 'Stage 2 Engine length (m)', min: 0.5, max: 4, step: 0.1, tab: 'advanced' },
    { path: 'stages.1.dryMassEngineFraction', label: 'Stage 2 Engine mass frac', min: 0.3, max: 0.8, step: 0.05, tab: 'advanced' },
    { path: 'stages.1.gimbalMaxAngle', label: 'Stage 2 Gimbal max (°)', min: 1, max: 15, step: 0.5, tab: 'advanced' },
    { path: 'stages.1.gimbalRate', label: 'Stage 2 Gimbal rate (°/s)', min: 5, max: 25, step: 0.5, tab: 'advanced' },
    { path: 'stages.1.gimbalPoint', label: 'Stage 2 Gimbal point (m)', min: 0.2, max: 1, step: 0.1, tab: 'advanced' },
    // Payload - Basic
    { path: 'payload.mass', label: 'Payload mass (kg)', min: 1000, max: 30000, step: 500, tab: 'basic' },
    { path: 'payload.length', label: 'Payload length (m)', min: 2, max: 15, step: 0.5, tab: 'basic' },
    { path: 'payload.diameter', label: 'Payload diameter (m)', min: 2, max: 6, step: 0.1, tab: 'basic' },
    // Fairing - Basic
    { path: 'fairing.mass', label: 'Fairing mass (kg)', min: 500, max: 3000, step: 50, tab: 'basic' },
    { path: 'fairing.length', label: 'Fairing length (m)', min: 2, max: 10, step: 0.5, tab: 'basic' },
    { path: 'fairing.diameter', label: 'Fairing diameter (m)', min: 2, max: 6, step: 0.1, tab: 'basic' },
    // Global - Advanced
    { path: 'fairingJettisonAlt', label: 'Fairing jettison alt (m)', min: 80000, max: 150000, step: 1000, tab: 'advanced' },
    { path: 'propellantDensity', label: 'Propellant density (kg/m³)', min: 800, max: 1200, step: 10, tab: 'advanced' },
];

function getByPath(obj, path) {
    const parts = path.split('.');
    let cur = obj;
    for (const p of parts) {
        cur = cur[p];
        if (cur === undefined) return undefined;
    }
    return cur;
}

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

let rocketBuilderActiveTab = 'basic';

function populateRocketBuilderContent(tab) {
    const t = tab !== undefined ? tab : rocketBuilderActiveTab;
    rocketBuilderActiveTab = t;
    const content = document.getElementById('rocket-builder-content');
    if (!content) return;
    const config = getRocketConfig();
    content.innerHTML = '';
    content.classList.remove('basic-tab', 'advanced-tab');
    content.classList.add(t === 'basic' ? 'basic-tab' : 'advanced-tab');

    const schemaForTab = ROCKET_BUILDER_SCHEMA.filter((entry) => entry.tab === t);

    if (t === 'basic') {
        // Basic: single column params + resizable diagram (rectangle) that doesn't scroll
        const layout = document.createElement('div');
        layout.className = 'rocket-builder-basic-layout';
        const paramsContainer = document.createElement('div');
        paramsContainer.className = 'rocket-builder-params';
        const resizer = document.createElement('div');
        resizer.className = 'rocket-builder-resizer';
        resizer.setAttribute('aria-label', 'Drag to resize diagram');
        const diagramContainer = document.createElement('div');
        diagramContainer.className = 'rocket-builder-diagram';
        const DIAGRAM_MIN = 120;
        const DIAGRAM_MAX = 420;
        const DIAGRAM_DEFAULT = 220;
        diagramContainer.style.width = DIAGRAM_DEFAULT + 'px';
        const rect = document.createElement('div');
        rect.className = 'rocket-builder-diagram-rect';
        diagramContainer.appendChild(rect);
        layout.appendChild(paramsContainer);
        layout.appendChild(resizer);
        layout.appendChild(diagramContainer);
        content.appendChild(layout);

        function sizeDiagramRect() {
            const pad = 30;
            const w = diagramContainer.clientWidth - pad;
            const h = diagramContainer.clientHeight - pad;
            if (w <= 0 || h <= 0) {
                rect.style.width = '160px';
                rect.style.height = '200px';
                return;
            }
            const scaleByWidth = w / 160;
            const scaleByHeight = h / 200;
            const scale = Math.min(scaleByWidth, scaleByHeight);
            const rectW = 160 * scale;
            const rectH = 200 * scale;
            rect.style.width = rectW + 'px';
            rect.style.height = rectH + 'px';
        }
        sizeDiagramRect();
        const diagramResizeObserver = new ResizeObserver(() => sizeDiagramRect());
        diagramResizeObserver.observe(diagramContainer);

        // Drag to resize diagram
        resizer.addEventListener('mousedown', (e) => {
            e.preventDefault();
            const startX = e.clientX;
            const startWidth = diagramContainer.offsetWidth;
            const onMove = (moveEvent) => {
                const delta = startX - moveEvent.clientX;
                const newWidth = Math.min(DIAGRAM_MAX, Math.max(DIAGRAM_MIN, startWidth + delta));
                diagramContainer.style.width = newWidth + 'px';
            };
            const onUp = () => {
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
                document.body.style.cursor = '';
                document.body.style.userSelect = '';
            };
            document.body.style.cursor = 'col-resize';
            document.body.style.userSelect = 'none';
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        });

        schemaForTab.forEach(({ path, label, min, max, step }) => {
            const isNewSection = path === 'stages.0.dryMass' || path === 'stages.1.dryMass' || path === 'payload.mass' || path === 'fairing.mass' || path === 'fairingJettisonAlt';
            if (isNewSection) {
                const name = path === 'stages.0.dryMass' ? 'Stage 1' : path === 'stages.1.dryMass' ? 'Stage 2' : path === 'payload.mass' ? 'Payload' : path === 'fairing.mass' ? 'Fairing' : 'Global';
                const h = document.createElement('h4');
                h.className = 'rocket-builder-section';
                h.textContent = name;
                paramsContainer.appendChild(h);
            }
            const val = getByPath(config, path);
            const row = document.createElement('div');
            row.className = 'rocket-builder-row';
            const labelEl = document.createElement('label');
            labelEl.textContent = label;
            labelEl.htmlFor = `rocket-builder-${path.replace(/\./g, '-')}`;
            const input = document.createElement('input');
            input.type = 'number';
            input.id = input.name = `rocket-builder-${path.replace(/\./g, '-')}`;
            input.dataset.path = path;
            input.min = min;
            input.max = max;
            input.step = step;
            input.value = typeof val === 'number' ? val : 0;
            input.addEventListener('input', applyRocketBuilderForm);
            input.addEventListener('change', applyRocketBuilderForm);
            const valSpan = document.createElement('span');
            valSpan.className = 'rocket-builder-value';
            valSpan.textContent = input.value;
            row.appendChild(labelEl);
            row.appendChild(input);
            row.appendChild(valSpan);
            paramsContainer.appendChild(row);
        });
    } else {
        // Advanced: double column grid as before
        schemaForTab.forEach(({ path, label, min, max, step }) => {
            const isNewSection = path === 'stages.0.dryMass' || path === 'stages.1.dryMass' || path === 'payload.mass' || path === 'fairing.mass' || path === 'fairingJettisonAlt';
            if (isNewSection) {
                const name = path === 'stages.0.dryMass' ? 'Stage 1' : path === 'stages.1.dryMass' ? 'Stage 2' : path === 'payload.mass' ? 'Payload' : path === 'fairing.mass' ? 'Fairing' : 'Global';
                const h = document.createElement('h4');
                h.className = 'rocket-builder-section';
                h.textContent = name;
                content.appendChild(h);
            }
            const val = getByPath(config, path);
            const row = document.createElement('div');
            row.className = 'rocket-builder-row';
            const labelEl = document.createElement('label');
            labelEl.textContent = label;
            labelEl.htmlFor = `rocket-builder-${path.replace(/\./g, '-')}`;
            const input = document.createElement('input');
            input.type = 'number';
            input.id = input.name = `rocket-builder-${path.replace(/\./g, '-')}`;
            input.dataset.path = path;
            input.min = min;
            input.max = max;
            input.step = step;
            input.value = typeof val === 'number' ? val : 0;
            input.addEventListener('input', applyRocketBuilderForm);
            input.addEventListener('change', applyRocketBuilderForm);
            const valSpan = document.createElement('span');
            valSpan.className = 'rocket-builder-value';
            valSpan.textContent = input.value;
            row.appendChild(labelEl);
            row.appendChild(input);
            row.appendChild(valSpan);
            content.appendChild(row);
        });
    }

    // Update tab button active state
    document.querySelectorAll('.rocket-builder-tab').forEach((btn) => btn.classList.remove('active'));
    const activeBtn = document.getElementById(`rocket-builder-tab-${t}`);
    if (activeBtn) activeBtn.classList.add('active');
}

function applyRocketBuilderForm() {
    const config = JSON.parse(JSON.stringify(getRocketConfig()));
    ROCKET_BUILDER_SCHEMA.forEach(({ path }) => {
        const input = document.querySelector(`[data-path="${path}"]`);
        if (input && input.value !== '') {
            const num = parseFloat(input.value);
            if (!isNaN(num)) setByPath(config, path, num);
        }
    });
    setRocketConfig(config);
    // Update value displays
    ROCKET_BUILDER_SCHEMA.forEach(({ path }) => {
        const input = document.querySelector(`[data-path="${path}"]`);
        const valSpan = input?.parentElement?.querySelector('.rocket-builder-value');
        if (input && valSpan) valSpan.textContent = input.value;
    });
}

function showRocketBuilder() {
    const overlay = document.getElementById('rocket-builder-overlay');
    const wrapper = document.getElementById('rocket-builder-wrapper');
    if (overlay && wrapper) {
        rocketBuilderActiveTab = 'basic';
        populateRocketBuilderContent('basic');
        overlay.style.display = 'block';
        wrapper.style.display = 'flex';
        setTimeout(() => {
            overlay.classList.add('show');
            wrapper.classList.add('show');
        }, 10);
    }
}

function hideRocketBuilder() {
    const overlay = document.getElementById('rocket-builder-overlay');
    const wrapper = document.getElementById('rocket-builder-wrapper');
    if (overlay && wrapper) {
        overlay.classList.remove('show');
        wrapper.classList.remove('show');
        setTimeout(() => {
            overlay.style.display = 'none';
            wrapper.style.display = 'none';
        }, 300);
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
    const presetBtns = document.querySelectorAll('.preset-btn');
    const buildRocketBtn = document.getElementById('build-rocket-btn');
    const rocketBuilderCloseBtn = document.getElementById('rocket-builder-close-btn');
    const rocketBuilderDoneBtn = document.getElementById('rocket-builder-done-btn');
    const rocketBuilderOverlay = document.getElementById('rocket-builder-overlay');
    const rocketBuilderResetBtn = document.getElementById('rocket-builder-reset-btn');
    
    if (menuBtn) {
        menuBtn.addEventListener('click', showMenu);
    }
    
    if (menuCloseBtn) {
        menuCloseBtn.addEventListener('click', hideMenu);
    }
    
    if (menuOverlay) {
        menuOverlay.addEventListener('click', hideMenu);
    }
    
    if (buildRocketBtn) {
        buildRocketBtn.addEventListener('click', showRocketBuilder);
    }
    if (rocketBuilderCloseBtn) {
        rocketBuilderCloseBtn.addEventListener('click', hideRocketBuilder);
    }
    if (rocketBuilderDoneBtn) {
        rocketBuilderDoneBtn.addEventListener('click', hideRocketBuilder);
    }
    if (rocketBuilderOverlay) {
        rocketBuilderOverlay.addEventListener('click', hideRocketBuilder);
    }
    if (rocketBuilderResetBtn) {
        rocketBuilderResetBtn.addEventListener('click', () => {
            resetToDefault();
            populateRocketBuilderContent(rocketBuilderActiveTab);
        });
    }
    const rocketBuilderTabBasic = document.getElementById('rocket-builder-tab-basic');
    const rocketBuilderTabAdvanced = document.getElementById('rocket-builder-tab-advanced');
    if (rocketBuilderTabBasic) {
        rocketBuilderTabBasic.addEventListener('click', () => populateRocketBuilderContent('basic'));
    }
    if (rocketBuilderTabAdvanced) {
        rocketBuilderTabAdvanced.addEventListener('click', () => populateRocketBuilderContent('advanced'));
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
    
    presetBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            presetBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
        });
    });
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
    initState();
    resetGuidance();
    initInput();
    initMenu();
    initTopLinksPosition();
    initMobileUI();
    showMenu(); // Show menu on startup
    updateTelemetry();
    requestAnimationFrame(loop);
}

// Start when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}

