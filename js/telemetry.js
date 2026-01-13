import { EARTH_RADIUS, ROCKET_CONFIG, KARMAN_LINE } from './constants.js';
import { state, getAltitude, getTotalMass, getPitch } from './state.js';
import { getAtmosphericDensity, getCurrentThrust, getAirspeed, getCurrentDragCoefficient, calculateRocketCOG, calculateFuelLevel } from './physics.js';
import { formatTime, formatTMinus, getNextEvent } from './events.js';
import { predictOrbit } from './orbital.js';

// Update all telemetry displays
export function updateTelemetry() {
    const altitude = getAltitude();
    const r = Math.sqrt(state.x * state.x + state.y * state.y);
    const velocity = Math.sqrt(state.vx * state.vx + state.vy * state.vy);
    
    const localUp = { x: state.x / r, y: state.y / r };
    const vVert = state.vx * localUp.x + state.vy * localUp.y;
    const vHoriz = Math.sqrt(Math.max(0, velocity * velocity - vVert * vVert));
    const downrange = Math.atan2(state.x, state.y) * EARTH_RADIUS;
    
    document.getElementById('time').textContent = formatTime(state.time);
    
    // Update T-minus countdown (central display)
    const nextEvent = getNextEvent();
    const tminusDisplay = document.getElementById('tminus-display');
    if (nextEvent && state.running && state.time > 0) {
        tminusDisplay.style.display = 'block';
        document.getElementById('tminus-time').textContent = 'T- ' + formatTMinus(nextEvent.time);
        document.getElementById('tminus-event-name').textContent = nextEvent.name.toUpperCase();
    } else {
        tminusDisplay.style.display = 'none';
    }
    document.getElementById('stage').textContent = state.currentStage + 1;
    document.getElementById('altitude').textContent = (altitude / 1000).toFixed(2) + ' km';
    document.getElementById('downrange').textContent = (downrange / 1000).toFixed(1) + ' km';
    document.getElementById('velocity').textContent = velocity.toFixed(0) + ' m/s';
    document.getElementById('vvel').textContent = vVert.toFixed(0) + ' m/s';
    document.getElementById('hvel').textContent = vHoriz.toFixed(0) + ' m/s';
    
    const throttle = state.guidanceThrottle !== undefined ? state.guidanceThrottle : 1.0;
    const thrust = getCurrentThrust(altitude, throttle);
    const mass = getTotalMass();
    document.getElementById('accel').textContent = (thrust / mass / 9.81).toFixed(2) + ' G';
    document.getElementById('maxq').textContent = (state.maxQ / 1000).toFixed(2) + ' kPa';
    
    // Get telemetry elements for atmospheric properties
    const dynpressEl = document.getElementById('dynpress');
    const dragCoeffEl = document.getElementById('dragcoeff');
    const machEl = document.getElementById('mach');
    
    if (altitude < KARMAN_LINE) {
        // In atmosphere - calculate and display values
        const { airspeed: airspeedForDisplay } = getAirspeed();
        if (dynpressEl) {
            dynpressEl.textContent = (0.5 * getAtmosphericDensity(altitude) * airspeedForDisplay * airspeedForDisplay / 1000).toFixed(2) + ' kPa';
            dynpressEl.parentElement.style.display = '';
        }
        
        // Calculate drag coefficient and Mach number
        const airspeedAbs = Math.abs(airspeedForDisplay || 0);
        const { cd, mach } = getCurrentDragCoefficient(altitude, airspeedAbs);
        
        // Ensure we have valid numbers before displaying
        const displayCd = (isFinite(cd) && cd >= 0) ? cd : 0;
        const displayMach = (isFinite(mach) && mach >= 0) ? mach : 0;
        
        if (dragCoeffEl) {
            dragCoeffEl.textContent = displayCd.toFixed(3);
            dragCoeffEl.parentElement.style.display = '';
        }
        if (machEl) {
            machEl.textContent = displayMach.toFixed(2);
            machEl.parentElement.style.display = '';
        }
    } else {
        // In space - hide atmospheric telemetry
        if (dynpressEl) dynpressEl.parentElement.style.display = 'none';
        if (dragCoeffEl) dragCoeffEl.parentElement.style.display = 'none';
        if (machEl) machEl.parentElement.style.display = 'none';
    }
    document.getElementById('mass').textContent = mass.toFixed(0) + ' kg';
    
    const stage = ROCKET_CONFIG.stages[state.currentStage];
    if (stage) {
        document.getElementById('propellant').textContent = (state.propellantRemaining[state.currentStage] / stage.propellantMass * 100).toFixed(1) + '%';
    }
    document.getElementById('thrust').textContent = (thrust / 1000).toFixed(0) + ' kN';
    
    // Calculate and display COG
    const cogEl = document.getElementById('cog');
    const fuelLevelEl = document.getElementById('fuel-level');
    if (cogEl || fuelLevelEl) {
        try {
            const cogData = calculateRocketCOG();
            if (cogEl) {
                // Show COG from bottom and as percentage
                cogEl.textContent = cogData.cog.toFixed(1) + ' m (' + (cogData.cogFraction * 100).toFixed(0) + '%)';
            }
            if (fuelLevelEl && state.currentStage < ROCKET_CONFIG.stages.length) {
                // Show fuel level in current stage tank
                const fuelInfo = calculateFuelLevel(state.currentStage);
                fuelLevelEl.textContent = fuelInfo.fuelHeight.toFixed(1) + ' m / ' + fuelInfo.tankHeight.toFixed(1) + ' m';
            }
        } catch (e) {
            // Fallback if COG calculation fails
            if (cogEl) cogEl.textContent = '-- m';
            if (fuelLevelEl) fuelLevelEl.textContent = '-- m';
        }
    }
    
    const pitch = getPitch(state.time);
    document.getElementById('pitch').textContent = pitch.toFixed(1) + '°';
    
    // Display gimbal angle and turn rate
    const gimbalEl = document.getElementById('gimbal');
    const turnRateEl = document.getElementById('turn-rate');
    if (gimbalEl) {
        gimbalEl.textContent = state.gimbalAngle.toFixed(1) + '°';
    }
    if (turnRateEl) {
        const turnRateDegPerSec = state.angularVelocity * 180 / Math.PI;
        turnRateEl.textContent = turnRateDegPerSec.toFixed(1) + ' °/s';
    }
    
    // Check if fuel is available (used for mobile manual mode positioning)
    let hasFuel = false;
    if (state.currentStage < ROCKET_CONFIG.stages.length) {
        // Check current stage and future stages for remaining propellant
        for (let i = state.currentStage; i < ROCKET_CONFIG.stages.length; i++) {
            if (state.propellantRemaining[i] > 0) {
                hasFuel = true;
                break;
            }
        }
    }
    
    // Update pitch display based on mode
    const isMobile = window.innerWidth <= 768;
    const manualPitchControls = document.getElementById('manual-pitch-controls');
    
    if (state.gameMode === 'manual') {
        // Show manual pitch and guidance recommendation
        const manualPitchDisplay = document.getElementById('manual-pitch-display');
        const guidanceRec = document.getElementById('guidance-recommendation');
        const guidanceRecValue = document.getElementById('guidance-rec-value');
        
        if (manualPitchDisplay) {
            manualPitchDisplay.textContent = (state.manualPitch !== null ? state.manualPitch : pitch).toFixed(1) + '°';
        }
        
        if (guidanceRec && guidanceRecValue && state.guidanceRecommendation !== null) {
            guidanceRecValue.textContent = state.guidanceRecommendation.toFixed(1) + '°';
            guidanceRec.style.display = 'block';
        } else if (guidanceRec) {
            guidanceRec.style.display = 'none';
        }
        
        // Hide normal pitch program display
        const pitchProgram = document.getElementById('pitch-program');
        if (pitchProgram) pitchProgram.style.display = 'none';
        
        // Handle mobile positioning: show in bottom right when fuel available, hide when fuel runs out
        if (isMobile && manualPitchControls) {
            if (hasFuel) {
                // Show manual pitch controls in bottom right on mobile when fuel available
                manualPitchControls.style.display = 'block';
                manualPitchControls.classList.add('mobile-bottom-right');
                // Make sure it's not in the mobile panel - move to body if it's in any container
                const mobilePanel = document.getElementById('mobile-ui-panel');
                if (mobilePanel && mobilePanel.contains(manualPitchControls)) {
                    document.body.appendChild(manualPitchControls);
                }
            } else {
                // Hide manual pitch controls when fuel runs out
                manualPitchControls.style.display = 'none';
                manualPitchControls.classList.remove('mobile-bottom-right');
            }
        } else if (!isMobile && manualPitchControls) {
            // Desktop: show normally (not in bottom right)
            manualPitchControls.style.display = 'block';
            manualPitchControls.classList.remove('mobile-bottom-right');
        }
    } else {
        // Show normal pitch program
        document.getElementById('target-pitch').textContent = pitch.toFixed(1) + '°';
        document.getElementById('current-pitch').textContent = pitch.toFixed(1) + '°';
        document.getElementById('pitch-bar').style.width = (pitch / 90 * 100) + '%';
        
        const pitchProgram = document.getElementById('pitch-program');
        if (pitchProgram) pitchProgram.style.display = 'block';
        
        // On mobile, manual pitch controls should not be in bottom right when not in manual mode
        if (isMobile && manualPitchControls) {
            manualPitchControls.classList.remove('mobile-bottom-right');
        }
    }
    
    document.getElementById('apoapsis').textContent = state.apoapsis === Infinity ? 'ESCAPE' : (state.apoapsis / 1000).toFixed(1) + ' km';
    document.getElementById('periapsis').textContent = (state.periapsis / 1000).toFixed(1) + ' km';
    
    // Show guidance strategy and burn type if available
    const guidanceInfo = document.getElementById('guidance-info');
    if (guidanceInfo) {
        if (state.guidanceDebug && state.guidancePhase === 'vacuum-guidance' && state.engineOn) {
            const strategy = state.guidanceDebug.useDirectAscent ? 'Direct Ascent' : 'Traditional';
            const burnType = state.guidanceIsRetrograde ? 'RETROGRADE' : 'PROGRADE';
            guidanceInfo.textContent = `Strategy: ${strategy} | Burn: ${burnType}`;
            guidanceInfo.style.display = 'block';
        } else {
            guidanceInfo.style.display = 'none';
        }
    }
    
    // Show/hide burn controls when in orbit and pitch program is complete
    // In orbital mode, always show burn controls
    const pitchProgramComplete = state.gameMode === 'orbital' || state.time > 600 || (!state.engineOn && altitude > 150000);
    const burnControls = document.getElementById('burn-controls');
    
    if (!burnControls) return; // Safety check
    
    // Check if we're in orbit using orbital mechanics
    let inOrbit = false;
    if (altitude > 150000 && pitchProgramComplete) {
        try {
            const orbit = predictOrbit(state);
            // Consider in orbit if periapsis is above atmosphere (above 150km) and not escaping
            inOrbit = orbit && orbit.periapsis > 150000 && !orbit.isEscape;
        } catch (e) {
            // Fallback: if orbital prediction fails, use simple altitude check
            inOrbit = altitude > 150000 && !state.engineOn;
        }
    }
    
    // Update quick actions and controls positioning based on burn controls visibility
    const quickActions = document.getElementById('quick-actions');
    const controlsPanel = document.getElementById('controls');
    const wasVisible = burnControls.style.display === 'block';
    
    // Show burn controls in orbital mode or when in orbit
    // On mobile in manual mode: show in bottom right when fuel runs out (replacing manual pitch controls)
    if (state.gameMode === 'orbital') {
        // In orbital mode, always show controls directly on the left
        burnControls.style.display = 'block';
        burnControls.classList.add('in-orbit');
        if (isMobile) {
            burnControls.classList.remove('mobile-bottom-right');
        }
        if (quickActions) {
            quickActions.classList.remove('burn-controls-visible');
            quickActions.classList.add('burn-controls-in-orbit');
        }
        if (controlsPanel) {
            controlsPanel.classList.add('burn-controls-in-orbit');
        }
    } else if (inOrbit) {
        // Show controls when we've achieved orbit
        burnControls.style.display = 'block';
        burnControls.classList.add('in-orbit');
        
        // On mobile in manual mode: position in bottom right when fuel is out (replacing manual pitch)
        if (isMobile && state.gameMode === 'manual' && !hasFuel) {
            burnControls.classList.add('mobile-bottom-right');
        } else if (isMobile) {
            burnControls.classList.remove('mobile-bottom-right');
        }
        
        if (quickActions) {
            quickActions.classList.remove('burn-controls-visible');
            quickActions.classList.add('burn-controls-in-orbit');
        }
        if (controlsPanel) {
            controlsPanel.classList.add('burn-controls-in-orbit');
        }
    } else {
        // Hide controls if not in orbit (unless in manual mode on mobile with no fuel - wait for orbit)
        if (isMobile && state.gameMode === 'manual' && !hasFuel) {
            // Keep hidden until orbit is achieved
            burnControls.style.display = 'none';
        } else {
            burnControls.style.display = 'none';
        }
        burnControls.classList.remove('in-orbit', 'mobile-bottom-right');
        // Quick actions and controls return to default position
        if (quickActions) {
            quickActions.classList.remove('burn-controls-visible', 'burn-controls-in-orbit');
        }
        if (controlsPanel) {
            controlsPanel.classList.remove('burn-controls-in-orbit');
        }
        // Clear burn mode if not in orbit or pitch program still running
        if (state.burnMode) {
            state.burnMode = null;
            state.burnStartTime = null;
        }
    }
    
    // Show mode indicator in telemetry
    const modeLabel = document.querySelector('#telemetry .section:first-child .label');
    if (modeLabel && state.gameMode) {
        const modeText = state.gameMode === 'manual' ? 'Manual' : 
                        state.gameMode === 'guided' ? 'Guided' : 
                        state.gameMode === 'orbital' ? 'Orbital' : '';
        // Could add mode display here if needed
    }
    
    // Update active burn button and burn status
    const burnButtons = ['prograde', 'retrograde', 'normal', 'anti-normal', 'radial', 'anti-radial'];
    burnButtons.forEach(mode => {
        const btn = document.getElementById(`burn-${mode}-btn`);
        if (btn) {
            if (state.burnMode === mode) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        }
    });
    
    // Update burn status display
    const burnStatus = document.getElementById('burn-status');
    if (state.burnMode && state.burnStartTime !== null) {
        const burnDuration = state.time - state.burnStartTime;
        const burnNames = {
            'prograde': 'PROGRADE',
            'retrograde': 'RETROGRADE',
            'normal': 'NORMAL',
            'anti-normal': 'ANTI-NORMAL',
            'radial': 'RADIAL',
            'anti-radial': 'ANTI-RADIAL'
        };
        burnStatus.innerHTML = `
            <div style="color: #0ff; font-weight: bold;">BURNING: ${burnNames[state.burnMode]}</div>
            <div style="color: #0f0;">Duration: ${burnDuration.toFixed(1)}s</div>
        `;
    } else {
        burnStatus.innerHTML = '<div>Hold button to burn</div>';
    }
}

