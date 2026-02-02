import { GUIDANCE_CONFIG } from './constants.js';
import { getRocketConfig } from './rocketConfig.js';
import { state, initState, getAltitude, resetCurrentMission } from './state.js';
import { resetGuidance } from './guidance.js';
import { addEvent } from './events.js';
import { updateTelemetry } from './telemetry.js';
import { getCanvas, resize } from './renderer.js';

// Speed settings
const speeds = [1, 2, 5, 10, 25, 50, 100, 500, 1000];
let speedIdx = 0;

// Active burn button tracking
let activeBurnButton = null;

// Stop the current burn
function stopBurn() {
    if (state.burnMode && state.burnStartTime !== null) {
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
        state.engineOn = false;
        activeBurnButton = null;
        // Mark that user has taken manual control - hide burn predictions
        state.manualBurnPerformed = true;
    }
}

// Setup burn button event handlers
function setupBurnButton(buttonId, burnMode) {
    const btn = document.getElementById(buttonId);
    if (!btn) return;
    
    btn.addEventListener('mousedown', (e) => {
        e.preventDefault();
        const altitude = getAltitude();
        // In orbital mode, always allow burns. Otherwise, check pitch program completion.
        const pitchProgramComplete = state.gameMode === 'orbital' || state.time > 600 || (!state.engineOn && altitude > 150000);
        if (pitchProgramComplete && altitude > 150000) {
            if (state.burnMode) {
                stopBurn();
            }
            state.burnMode = burnMode;
            state.burnStartTime = state.time;
            activeBurnButton = btn;
            addEvent(`${burnMode.toUpperCase()} burn started`);
        }
    });
    btn.addEventListener('mouseup', (e) => {
        e.preventDefault();
        if (state.burnMode === burnMode) {
            stopBurn();
        }
    });
    btn.addEventListener('mouseleave', () => {
        if (state.burnMode === burnMode && activeBurnButton === btn) {
            stopBurn();
        }
    });
}

// Initialize all input handlers
export function initInput() {
    // Window resize
    window.addEventListener('resize', resize);
    
    // Launch button
    document.getElementById('launch-btn').addEventListener('click', () => {
        if (!state.running && state.time === 0 && state.gameMode !== null && state.gameMode !== 'orbital') {
            console.log("console running")
            state.running = true;
            state.engineOn = true;
            addEvent("LIFTOFF!");
            document.getElementById('launch-btn').disabled = true;
            document.getElementById('launch-btn').style.display = 'none';
            document.getElementById('pause-btn').style.display = 'inline-block';
        }
    });
    
    // Pause button
    document.getElementById('pause-btn').addEventListener('click', () => {
        if (state.running) {
            state.running = false;
            document.getElementById('pause-btn').textContent = 'RESUME';
            addEvent("PAUSED");
        } else {
            state.running = true;
            document.getElementById('pause-btn').textContent = 'PAUSE';
            addEvent("RESUMED");
        }
    });
    
    // Reset button
    document.getElementById('reset-btn').addEventListener('click', () => {
        resetCurrentMission();
        resetGuidance();
        document.getElementById('launch-btn').disabled = false;
        if (state.gameMode !== 'orbital') {
            document.getElementById('launch-btn').style.display = 'inline-block';
        } else {
            document.getElementById('launch-btn').style.display = 'none';
        }
        document.getElementById('pause-btn').style.display = 'none';
        document.getElementById('pause-btn').textContent = 'PAUSE';
        
        // Update UI for current mode
        if (window.updateUIForMode) {
            window.updateUIForMode();
        }
        updateTelemetry();
    });
    
    // Speed button
    document.getElementById('speed-btn').addEventListener('click', () => {
        speedIdx = (speedIdx + 1) % speeds.length;
        state.timeWarp = speeds[speedIdx];
        document.getElementById('speed-btn').textContent = speeds[speedIdx] + 'x';
    });
    
    // Zoom out button
    document.getElementById('zoom-out-btn').addEventListener('click', () => {
        state.manualZoom /= 2.0;
        if (state.manualZoom < 0.1) state.manualZoom = 0.1;
    });
    
    // Zoom in button
    document.getElementById('zoom-in-btn').addEventListener('click', () => {
        state.manualZoom *= 2.0;
        if (state.cameraMode === 'rocket' && state.manualZoom > 10000) state.manualZoom = 10000;
    });
    
    // Auto zoom button
    document.getElementById('zoom-auto-btn').addEventListener('click', () => {
        state.autoZoom = !state.autoZoom;
        document.getElementById('zoom-auto-btn').textContent = state.autoZoom ? 'AUTO ZOOM' : 'MANUAL ZOOM';
        if (!state.autoZoom) {
            state.manualZoom = 1.0;
        }
    });
    
    // Camera button
    document.getElementById('camera-btn').addEventListener('click', () => {
        state.cameraMode = state.cameraMode === 'rocket' ? 'earth' : 'rocket';
        document.getElementById('camera-btn').textContent = state.cameraMode === 'rocket' ? 'FOLLOW ROCKET' : 'CENTER EARTH';
        if (state.cameraMode === 'earth') {
            state.manualZoom = 1.0;
            state.autoZoom = false;
        }
    });
    
    // Mouse wheel zoom
    const canvas = getCanvas();
    if (canvas) {
        canvas.addEventListener('wheel', (e) => {
            e.preventDefault();
            const zoomFactor = e.deltaY > 0 ? 1/1.3 : 1.3;
            state.manualZoom *= zoomFactor;
            if (state.manualZoom < 0.1) state.manualZoom = 0.1;
            if (state.cameraMode === 'rocket' && state.manualZoom > 10000) state.manualZoom = 10000;
        });
    }
    
    // Global mouseup listener for burn buttons
    document.addEventListener('mouseup', () => {
        if (state.burnMode && activeBurnButton) {
            stopBurn();
        }
    });
    
    // Setup burn buttons
    setupBurnButton('burn-prograde-btn', 'prograde');
    setupBurnButton('burn-retrograde-btn', 'retrograde');
    setupBurnButton('burn-normal-btn', 'normal');
    setupBurnButton('burn-anti-normal-btn', 'anti-normal');
    setupBurnButton('burn-radial-btn', 'radial');
    setupBurnButton('burn-anti-radial-btn', 'anti-radial');
    
    // Refuel button
    document.getElementById('refuel-btn').addEventListener('click', () => {
        if (state.currentStage < getRocketConfig().stages.length) {
            const refuelAmount = 5000;
            state.propellantRemaining[state.currentStage] += refuelAmount;
            if (state.propellantRemaining[state.currentStage] > getRocketConfig().stages[state.currentStage].propellantMass) {
                state.propellantRemaining[state.currentStage] = getRocketConfig().stages[state.currentStage].propellantMass;
            }
            addEvent(`Refueled: +${refuelAmount} kg propellant`);
        }
    });
    
    // Manual pitch controls (W/S keys)
    let pitchUpHeld = false;
    let pitchDownHeld = false;
    
    document.addEventListener('keydown', (e) => {
        if (state.gameMode === 'manual' && state.running) {
            if (e.key === 'w' || e.key === 'W') {
                pitchUpHeld = true;
                if (state.manualPitch === null) {
                    state.manualPitch = state.guidancePitch || 90;
                }
            }
            if (e.key === 's' || e.key === 'S') {
                pitchDownHeld = true;
                if (state.manualPitch === null) {
                    state.manualPitch = state.guidancePitch || 90;
                }
            }
        }
    });
    
    document.addEventListener('keyup', (e) => {
        if (e.key === 'w' || e.key === 'W') pitchUpHeld = false;
        if (e.key === 's' || e.key === 'S') pitchDownHeld = false;
    });
    
    // Manual pitch button controls
    const pitchUpBtn = document.getElementById('pitch-up-btn');
    const pitchDownBtn = document.getElementById('pitch-down-btn');
    
    if (pitchUpBtn) {
        pitchUpBtn.addEventListener('mousedown', () => {
            if (state.gameMode === 'manual') {
                pitchUpHeld = true;
                if (state.manualPitch === null) {
                    state.manualPitch = state.guidancePitch || 90;
                }
            }
        });
        pitchUpBtn.addEventListener('mouseup', () => pitchUpHeld = false);
        pitchUpBtn.addEventListener('mouseleave', () => pitchUpHeld = false);
    }
    
    if (pitchDownBtn) {
        pitchDownBtn.addEventListener('mousedown', () => {
            if (state.gameMode === 'manual') {
                pitchDownHeld = true;
                if (state.manualPitch === null) {
                    state.manualPitch = state.guidancePitch || 90;
                }
            }
        });
        pitchDownBtn.addEventListener('mouseup', () => pitchDownHeld = false);
        pitchDownBtn.addEventListener('mouseleave', () => pitchDownHeld = false);
    }
    
    // Update manual control in game loop (called from main.js)
    // Handles both turn rate mode and gimbal mode
    window.updateManualPitch = function(dt) {
        if (state.gameMode === 'manual' && state.running && state.manualPitch !== null) {
            // Scale dt by time warp so turn rate stays constant in simulation time
            const scaledDt = dt * state.timeWarp;
            // Cap to prevent large jumps when frame rate is low (up to 1 second of simulation time)
            const cappedDt = Math.min(scaledDt, 1.0);
            
            if (state.settings.controlMode === 'gimbal') {
                // Gimbal control mode: directly control gimbal angle
                const gimbalRate = getRocketConfig().stages[state.currentStage]?.gimbalRate || 15; // deg/s
                const maxGimbal = getRocketConfig().stages[state.currentStage]?.gimbalMaxAngle || 5;
                
                if (pitchUpHeld) {
                    // Pitch up = need negative gimbal (thrust vector tilted to rotate pitch up)
                    state.manualGimbal = Math.max(-maxGimbal, state.manualGimbal - gimbalRate * cappedDt);
                }
                if (pitchDownHeld) {
                    // Pitch down = need positive gimbal
                    state.manualGimbal = Math.min(maxGimbal, state.manualGimbal + gimbalRate * cappedDt);
                }
                
                // Return gimbal to neutral when no input (spring back effect)
                if (!pitchUpHeld && !pitchDownHeld) {
                    const returnRate = gimbalRate * 0.5; // Return at half speed
                    if (Math.abs(state.manualGimbal) < returnRate * cappedDt) {
                        state.manualGimbal = 0;
                    } else if (state.manualGimbal > 0) {
                        state.manualGimbal -= returnRate * cappedDt;
                    } else {
                        state.manualGimbal += returnRate * cappedDt;
                    }
                }
                
                // In gimbal mode, update manualPitch to match current rocket pitch
                // This prevents the guidance from trying to "correct" and allows natural rotation
                // Rocket angle is in radians, convert to pitch (degrees from horizontal)
                // rocketAngle: 0 = up, π/2 = horizontal east
                // pitch: 90° = up, 0° = horizontal
                const currentPitchRad = (Math.PI / 2) - state.rocketAngle;
                state.manualPitch = currentPitchRad * 180 / Math.PI;
            } else {
                // Turn rate control mode: control target pitch directly
                const pitchRate = GUIDANCE_CONFIG.maxPitchRate;
                if (pitchUpHeld) {
                    state.manualPitch = state.manualPitch + pitchRate * cappedDt;
                }
                if (pitchDownHeld) {
                    state.manualPitch = state.manualPitch - pitchRate * cappedDt;
                }
            }
            
            // Clamp pitch to valid range
            state.manualPitch = Math.max(-90, Math.min(90, state.manualPitch));
        }
    };
    
    // Settings toggle handlers
    const controlTurnRateBtn = document.getElementById('control-turnrate-btn');
    const controlGimbalBtn = document.getElementById('control-gimbal-btn');
    const controlModeDescription = document.getElementById('control-mode-description');
    
    function updateControlModeUI() {
        const isGimbalMode = state.settings.controlMode === 'gimbal';
        
        if (controlTurnRateBtn) {
            controlTurnRateBtn.classList.toggle('active', !isGimbalMode);
        }
        if (controlGimbalBtn) {
            controlGimbalBtn.classList.toggle('active', isGimbalMode);
        }
        if (controlModeDescription) {
            controlModeDescription.textContent = isGimbalMode 
                ? 'Control gimbal angle directly. Turn rate depends on thrust.'
                : 'Control target pitch angle. Gimbal adjusts automatically.';
        }
        
        // Show/hide aerodynamic forces setting (only in gimbal mode)
        const aeroForcesSetting = document.getElementById('aero-forces-setting');
        const aeroForcesDescription = document.getElementById('aero-forces-description');
        if (aeroForcesSetting) {
            aeroForcesSetting.style.display = isGimbalMode ? 'flex' : 'none';
        }
        if (aeroForcesDescription) {
            aeroForcesDescription.style.display = isGimbalMode ? 'block' : 'none';
        }
        
        // Update manual control UI labels
        const controlTitle = document.getElementById('manual-control-title');
        const pitchDisplay = document.getElementById('manual-pitch-display');
        const gimbalDisplay = document.getElementById('manual-gimbal-display');
        const pitchUpBtn = document.getElementById('pitch-up-btn');
        const pitchDownBtn = document.getElementById('pitch-down-btn');
        
        if (controlTitle) {
            controlTitle.textContent = isGimbalMode ? 'MANUAL GIMBAL CONTROL' : 'MANUAL PITCH CONTROL';
        }
        if (gimbalDisplay) {
            gimbalDisplay.style.display = isGimbalMode ? 'block' : 'none';
        }
        if (pitchUpBtn) {
            pitchUpBtn.innerHTML = isGimbalMode ? '↑ GIMBAL UP<br>(W Key)' : '↑ PITCH UP<br>(W Key)';
        }
        if (pitchDownBtn) {
            pitchDownBtn.innerHTML = isGimbalMode ? '↓ GIMBAL DOWN<br>(S Key)' : '↓ PITCH DOWN<br>(S Key)';
        }
    }
    
    // Aerodynamic forces toggle handlers
    const aeroForcesOffBtn = document.getElementById('aero-forces-off-btn');
    const aeroForcesOnBtn = document.getElementById('aero-forces-on-btn');
    
    function updateAerodynamicForcesUI() {
        const isEnabled = state.settings.enableAerodynamicForces;
        if (aeroForcesOffBtn) {
            aeroForcesOffBtn.classList.toggle('active', !isEnabled);
        }
        if (aeroForcesOnBtn) {
            aeroForcesOnBtn.classList.toggle('active', isEnabled);
        }
    }
    
    if (aeroForcesOffBtn) {
        aeroForcesOffBtn.addEventListener('click', () => {
            state.settings.enableAerodynamicForces = false;
            updateAerodynamicForcesUI();
        });
    }
    
    if (aeroForcesOnBtn) {
        aeroForcesOnBtn.addEventListener('click', () => {
            state.settings.enableAerodynamicForces = true;
            updateAerodynamicForcesUI();
        });
    }
    
    // Initialize aerodynamic forces UI
    updateAerodynamicForcesUI();
    
    // Settings hamburger toggle
    const settingsToggleBtn = document.getElementById('settings-toggle-btn');
    const settingsContent = document.getElementById('settings-content');
    
    if (settingsToggleBtn && settingsContent) {
        settingsToggleBtn.addEventListener('click', () => {
            const isVisible = settingsContent.style.display !== 'none';
            settingsContent.style.display = isVisible ? 'none' : 'block';
            settingsToggleBtn.classList.toggle('active', !isVisible);
        });
    }
    
    if (controlTurnRateBtn) {
        controlTurnRateBtn.addEventListener('click', () => {
            state.settings.controlMode = 'turnrate';
            state.manualGimbal = 0; // Reset gimbal when switching modes
            updateControlModeUI();
        });
    }
    
    if (controlGimbalBtn) {
        controlGimbalBtn.addEventListener('click', () => {
            state.settings.controlMode = 'gimbal';
            state.manualGimbal = 0; // Reset gimbal when switching modes
            updateControlModeUI();
        });
    }
    
    // Export update function for use elsewhere
    window.updateControlModeUI = updateControlModeUI;
    
    // Initialize UI state
    updateControlModeUI();
    
    // Add click handler for diagram expansion
    const diagramCanvas = getCanvas();
    if (diagramCanvas) {
        diagramCanvas.addEventListener('click', (e) => {
            const rect = diagramCanvas.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            
            // Check if click is on force diagram
            const diagramSize = state.expandedDiagram === 'forces' ? 300 : 120;
            const gap = 10;
            const rightMargin = 20;
            const eventsEl = document.getElementById('events');
            const top = eventsEl ? eventsEl.getBoundingClientRect().bottom + gap : 20 + 320 + gap;
            const centerX = state.expandedDiagram === 'forces' ? diagramCanvas.width / 2 : diagramCanvas.width - rightMargin - diagramSize / 2;
            const centerY = state.expandedDiagram === 'forces' ? diagramCanvas.height / 2 : top + diagramSize / 2;
            
            const forceDiagramLeft = centerX - diagramSize / 2;
            const forceDiagramRight = centerX + diagramSize / 2;
            const forceDiagramTop = centerY - diagramSize / 2;
            const forceDiagramBottom = centerY + diagramSize / 2;
            
            if (x >= forceDiagramLeft && x <= forceDiagramRight && 
                y >= forceDiagramTop && y <= forceDiagramBottom) {
                // Toggle force diagram expansion
                if (state.expandedDiagram === 'forces') {
                    state.expandedDiagram = null;
                } else {
                    state.expandedDiagram = 'forces';
                }
                return;
            }
            
            // Check if click is on rocket diagram
            const diagramWidth = state.expandedDiagram === 'rocket' ? 300 : 120;
            const diagramHeight = state.expandedDiagram === 'rocket' ? 450 : 180;
            const forceDiagramTopPos = eventsEl ? eventsEl.getBoundingClientRect().bottom + gap : 20 + 320 + gap;
            const rocketTop = state.expandedDiagram === 'rocket' ? (diagramCanvas.height - diagramHeight) / 2 : forceDiagramTopPos + 120 + gap;
            const rocketCenterX = state.expandedDiagram === 'rocket' ? diagramCanvas.width / 2 : diagramCanvas.width - rightMargin - diagramWidth / 2;
            const rocketCenterY = state.expandedDiagram === 'rocket' ? diagramCanvas.height / 2 : rocketTop + diagramHeight / 2;
            
            const rocketDiagramLeft = rocketCenterX - diagramWidth / 2;
            const rocketDiagramRight = rocketCenterX + diagramWidth / 2;
            const rocketDiagramTop = rocketCenterY - diagramHeight / 2;
            const rocketDiagramBottom = rocketCenterY + diagramHeight / 2;
            
            if (x >= rocketDiagramLeft && x <= rocketDiagramRight && 
                y >= rocketDiagramTop && y <= rocketDiagramBottom) {
                // Toggle rocket diagram expansion
                if (state.expandedDiagram === 'rocket') {
                    state.expandedDiagram = null;
                } else {
                    state.expandedDiagram = 'rocket';
                }
                return;
            }
        });
    }
}



