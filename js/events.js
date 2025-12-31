import { G, EARTH_MASS, EARTH_RADIUS, KARMAN_LINE, ROCKET_CONFIG, GUIDANCE_CONFIG } from './constants.js';
import { state, getAltitude, getTotalMass } from './state.js';
import { getMassFlowRate } from './physics.js';
import { predictOrbit } from './orbital.js';

// Format time as MM:SS.ms
export function formatTime(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 100);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}`;
}

// Format T-minus countdown
export function formatTMinus(seconds) {
    if (seconds <= 0) return '00:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

// Add mission event
export function addEvent(text) {
    const timeStr = formatTime(state.time);
    state.events.push({ time: timeStr, text });
    const eventList = document.getElementById('event-list');
    const eventDiv = document.createElement('div');
    eventDiv.className = 'event';
    eventDiv.innerHTML = `<span class="event-time">T+${timeStr}</span> ${text}`;
    eventList.insertBefore(eventDiv, eventList.firstChild);
}

// ============================================================================
// Calculate upcoming burn events
// ============================================================================
export function calculateBurnEvents() {
    const altitude = getAltitude();
    const r = Math.sqrt(state.x * state.x + state.y * state.y);
    const velocity = Math.sqrt(state.vx * state.vx + state.vy * state.vy);
    const localUp = { x: state.x / r, y: state.y / r };
    const localEast = { x: localUp.y, y: -localUp.x };
    const vVertical = state.vx * localUp.x + state.vy * localUp.y;
    const vHorizontal = state.vx * localEast.x + state.vy * localEast.y;
    const isAscending = vVertical > 0;
    
    // Only calculate burn events if we're in vacuum (above atmosphere)
    if (altitude < GUIDANCE_CONFIG.atmosphereLimit) {
        return [];
    }
    
    const orbit = predictOrbit(state);
    const mu = G * EARTH_MASS;
    const tolerance = 10000; // 10km
    const apoError = orbit.apoapsis - GUIDANCE_CONFIG.targetAltitude;
    const periError = orbit.periapsis - GUIDANCE_CONFIG.targetAltitude;
    
    const events = [];
    
    // PHASE 2: Circularization burn at apoapsis
    if (periError < -tolerance && apoError >= -tolerance) {
        // Calculate time to apoapsis
        const altitudeToApoapsis = orbit.apoapsis - altitude;
        let timeToApoapsis = 0;
        if (isAscending && altitudeToApoapsis > 0) {
            timeToApoapsis = altitudeToApoapsis / Math.max(1, vVertical);
        }
        
        // Calculate circularization delta-v and burn time
        const r_apo = EARTH_RADIUS + orbit.apoapsis;
        const v_circular = Math.sqrt(mu / r_apo);
        const v_at_apo = orbit.semiMajorAxis > 0 
            ? Math.sqrt(mu * (2 / r_apo - 1 / orbit.semiMajorAxis))
            : velocity;
        const circularizationDeltaV = Math.max(0, v_circular - v_at_apo);
        
        let circularizationBurnTime = 0;
        if (state.currentStage < ROCKET_CONFIG.stages.length && circularizationDeltaV > 0) {
            const stage = ROCKET_CONFIG.stages[state.currentStage];
            const currentMass = getTotalMass();
            const thrust = stage.thrustVac;
            if (thrust > 0) {
                circularizationBurnTime = circularizationDeltaV * currentMass / thrust;
            }
        }
        
        const burnStartTimeBeforeApo = circularizationBurnTime / 2;
        
        // Only add event if we're ascending and haven't reached burn start time yet
        if (isAscending && timeToApoapsis > burnStartTimeBeforeApo && circularizationBurnTime > 0) {
            const timeUntilBurnStart = timeToApoapsis - burnStartTimeBeforeApo;
            if (timeUntilBurnStart > 0 && timeUntilBurnStart < 10000) {
                events.push({ 
                    time: timeUntilBurnStart, 
                    name: 'Circularization burn start',
                    type: 'circularization',
                    burnTime: circularizationBurnTime,
                    deltaV: circularizationDeltaV
                });
            }
        }
    }
    
    // PHASE 3: Retrograde burn at periapsis (edge case)
    if (periError >= -tolerance && apoError > tolerance) {
        // Calculate time to periapsis
        const altitudeToPeriapsis = altitude - orbit.periapsis;
        let timeToPeriapsis = Infinity;
        
        if (!isAscending && altitudeToPeriapsis > 0) {
            timeToPeriapsis = altitudeToPeriapsis / Math.max(1, -vVertical);
        }
        
        // Calculate retrograde delta-v and burn time
        const r_peri = EARTH_RADIUS + orbit.periapsis;
        const r_target = EARTH_RADIUS + GUIDANCE_CONFIG.targetAltitude;
        const a_target = (r_peri + r_target) / 2;
        const v_peri_target = Math.sqrt(mu * (2 / r_peri - 1 / a_target));
        const v_at_peri = orbit.semiMajorAxis > 0
            ? Math.sqrt(mu * (2 / r_peri - 1 / orbit.semiMajorAxis))
            : velocity;
        const retrogradeDeltaV = Math.max(0, v_at_peri - v_peri_target);
        
        let retrogradeBurnTime = 0;
        if (state.currentStage < ROCKET_CONFIG.stages.length && retrogradeDeltaV > 0) {
            const stage = ROCKET_CONFIG.stages[state.currentStage];
            const currentMass = getTotalMass();
            const thrust = stage.thrustVac;
            if (thrust > 0) {
                retrogradeBurnTime = retrogradeDeltaV * currentMass / thrust;
            }
        }
        
        const burnStartTimeBeforePeri = retrogradeBurnTime / 2;
        
        // Only add event if we're descending toward periapsis and haven't reached burn start time yet
        if (!isAscending && timeToPeriapsis > burnStartTimeBeforePeri && timeToPeriapsis < Infinity && retrogradeBurnTime > 0) {
            const timeUntilBurnStart = timeToPeriapsis - burnStartTimeBeforePeri;
            if (timeUntilBurnStart > 0 && timeUntilBurnStart < 10000) {
                events.push({ 
                    time: timeUntilBurnStart, 
                    name: 'Retrograde burn start',
                    type: 'retrograde',
                    burnTime: retrogradeBurnTime,
                    deltaV: retrogradeDeltaV
                });
            }
        }
    }
    
    return events;
}

// Get next upcoming event
export function getNextEvent() {
    const altitude = getAltitude();
    const velocity = Math.sqrt(state.vx * state.vx + state.vy * state.vy);
    const events = [];
    
    // Pitch program start (first pitch change at 10s)
    if (state.time < 10) {
        events.push({ time: 10 - state.time, name: 'Pitch program start' });
    }
    
    // Kármán line (100km)
    if (altitude < KARMAN_LINE && !state.events.some(e => e.text.includes("Kármán"))) {
        const vVert = (state.vx * state.x + state.vy * state.y) / Math.sqrt(state.x * state.x + state.y * state.y);
        if (vVert > 0) {
            const timeToKarman = (KARMAN_LINE - altitude) / vVert;
            if (timeToKarman > 0 && timeToKarman < 10000) {
                events.push({ time: timeToKarman, name: 'Kármán line' });
            }
        }
    }
    
    // Fairing jettison (110km)
    if (!state.fairingJettisoned && altitude < ROCKET_CONFIG.fairingJettisonAlt) {
        const vVert = (state.vx * state.x + state.vy * state.y) / Math.sqrt(state.x * state.x + state.y * state.y);
        if (vVert > 0) {
            const timeToFairing = (ROCKET_CONFIG.fairingJettisonAlt - altitude) / vVert;
            if (timeToFairing > 0 && timeToFairing < 10000) {
                events.push({ time: timeToFairing, name: 'Fairing jettison' });
            }
        }
    }
    
    // Stage separation (when stage 0 propellant runs out)
    if (state.currentStage === 0 && state.propellantRemaining[0] > 0 && state.engineOn) {
        const throttle = state.guidanceThrottle !== undefined ? state.guidanceThrottle : 1.0;
        const massFlowRate = getMassFlowRate(altitude, throttle);
        if (massFlowRate > 0) {
            const timeToSeparation = state.propellantRemaining[0] / massFlowRate;
            if (timeToSeparation > 0 && timeToSeparation < 10000) {
                events.push({ time: timeToSeparation, name: 'Stage separation' });
            }
        }
    }
    
    // Orbit (150km altitude and engine off)
    const inOrbit = altitude >= 150000 && !state.engineOn;
    if (!inOrbit && altitude < 150000) {
        const vVert = (state.vx * state.x + state.vy * state.y) / Math.sqrt(state.x * state.x + state.y * state.y);
        if (vVert > 0) {
            const timeToOrbit = (150000 - altitude) / vVert;
            if (timeToOrbit > 0 && timeToOrbit < 10000) {
                let totalTime = timeToOrbit;
                if (state.engineOn && state.currentStage < ROCKET_CONFIG.stages.length) {
                    const throttle = state.guidanceThrottle !== undefined ? state.guidanceThrottle : 1.0;
                    const massFlowRate = getMassFlowRate(altitude, throttle);
                    if (massFlowRate > 0 && state.propellantRemaining[state.currentStage] > 0) {
                        const timeToBurnout = state.propellantRemaining[state.currentStage] / massFlowRate;
                        totalTime = Math.max(timeToOrbit, timeToBurnout);
                    }
                }
                events.push({ time: totalTime, name: 'Orbit' });
            }
        }
    }
    
    // SECO (when stage 1 propellant runs out)
    if (state.currentStage === 1 && state.propellantRemaining[1] > 0 && state.engineOn) {
        const throttle = state.guidanceThrottle !== undefined ? state.guidanceThrottle : 1.0;
        const massFlowRate = getMassFlowRate(altitude, throttle);
        if (massFlowRate > 0) {
            const timeToSECO = state.propellantRemaining[1] / massFlowRate;
            if (timeToSECO > 0 && timeToSECO < 10000) {
                events.push({ time: timeToSECO, name: 'SECO' });
            }
        }
    }
    
    // Add burn events (circularization and retrograde)
    const burnEvents = calculateBurnEvents();
    events.push(...burnEvents);
    
    // Return the event with the shortest time
    if (events.length > 0) {
        events.sort((a, b) => a.time - b.time);
        return events[0];
    }
    return null;
}

