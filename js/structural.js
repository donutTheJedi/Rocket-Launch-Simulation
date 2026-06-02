import { G, EARTH_MASS } from './constants.js';
import { getRocketConfig } from './rocketConfig.js';
import { state, getAltitude, getTotalMass } from './state.js';
import {
    getCurrentThrust, getDrag, getAirspeed,
    getAtmosphericProperties, calculateRocketCOG, calculateFuelLevel,
    calculateNormalForceCoefficientDerivative, calculateAngleOfAttack, calculateCenterOfPressure
} from './physics.js';
import { registerMissionFailure } from './missionFailure.js';
import { isChallengeActive } from './challenge.js';

// Gauge ullage pressure for pump-fed LOX/RP-1 tanks (~0.5 bar gauge / 50 kPa)
export const ULLAGE_PRESSURE = 50e3;

const DEFAULT_FAILURE_GRACE_SECONDS = 3.5;
const CHALLENGE_FAILURE_GRACE_SECONDS = 1.0;

/** Seconds over yield before terminate mode destroys the vehicle. */
export function getStructuralFailureGraceSeconds() {
    return isChallengeActive() ? CHALLENGE_FAILURE_GRACE_SECONDS : DEFAULT_FAILURE_GRACE_SECONDS;
}

// Von Mises criterion for biaxial stress state (axial + hoop + shear)
function vonMises(sigmaAxial, sigmaHoop, tau) {
    const s1 = sigmaAxial;
    const s2 = sigmaHoop;
    return Math.sqrt(Math.max(0, s1 * s1 - s1 * s2 + s2 * s2 + 3 * tau * tau));
}

// Map utilization ratio to a CSS/canvas color
export function utilizationColor(u) {
    if (u < 0.5)  return '#00c800'; // green
    if (u < 0.75) return '#d4d400'; // yellow
    if (u < 1.0)  return '#e07000'; // orange
    return '#e00000';               // red (yielding)
}

// Interpolate utilization to an rgba color for canvas gradients
export function utilizationColorRgba(u, alpha = 1) {
    let r, g, b;
    if (u < 0.5) {
        const t = u / 0.5;
        r = Math.round(0 + t * 140);
        g = Math.round(200 - t * 0);
        b = 0;
    } else if (u < 0.75) {
        const t = (u - 0.5) / 0.25;
        r = Math.round(140 + t * 80);
        g = Math.round(200 - t * 88);
        b = 0;
    } else if (u < 1.0) {
        const t = (u - 0.75) / 0.25;
        r = Math.round(220 + t * 12);
        g = Math.round(112 - t * 112);
        b = 0;
    } else {
        r = 224; g = 0; b = 0;
    }
    return `rgba(${r},${g},${b},${alpha})`;
}

/**
 * Calculate stress at the three critical cross-sections each frame.
 *
 * Sections (during Stage 1 burn):
 *   0 – Base of Stage 1  (z = 0, max thrust + bending loads)
 *   1 – Interstage ring   (z = s1.length, lighter wall, no propellant)
 *   2 – Base of Stage 2   (z = s1.length, tank bottom for S2)
 *
 * Stress components per section:
 *   Hoop:    σ_h = (P_ullage + ρ·g_eff·h_prop) · r / t          [tank wall circumferential]
 *   Axial:   σ_a = m_above · g_eff / (2π·r·t)                   [compressive inertial load]
 *   g_eff:   (T−D)/m when thrusting; else local g (load factor, not g + T/m)
 *   Bending: σ_b = M · r / (π·r³·t) = M / (π·r²·t)             [from aero normal force]
 *   Shear:   τ   = V / (2π·r·t)                                  [from aero transverse force]
 *   Von Mises: √(σ² - σ·σ_h + σ_h² + 3τ²)   where σ = σ_a + σ_b
 */
export function calculateStructuralLoads() {
    const config = getRocketConfig();
    const altitude = getAltitude();
    const r_pos = Math.sqrt(state.x * state.x + state.y * state.y);
    const mass = getTotalMass();

    const gravity = G * EARTH_MASS / (r_pos * r_pos);

    const throttle = state.guidanceThrottle !== undefined ? state.guidanceThrottle
                   : (state.engineOn ? 1.0 : 0.0);
    const thrust = getCurrentThrust(altitude, throttle);

    const { airspeed, airVx, airVy } = getAirspeed();
    const dragForce = getDrag(altitude, airspeed);

    // Apparent gravity for hydrostatic head and inertial axial load (toward tank base).
    // Use load factor (T−D)/(mg) when thrusting — not g + T/m, which double-counts gravity.
    const thrustMinusDrag = Math.max(0, thrust - dragForce);
    let g_eff;
    if (state.engineOn && mass > 0 && thrustMinusDrag > 0) {
        g_eff = thrustMinusDrag / mass;
    } else {
        g_eff = gravity;
    }
    g_eff = Math.max(0, g_eff);

    // ── Aerodynamic normal force (bending / shear driver) ────────────────────
    let F_normal = 0;
    let rocketCOG = 0;

    const cogData = calculateRocketCOG();
    rocketCOG = cogData.cog;

    if (altitude < 80000 && airspeed > 1e-3) {
        const localUp = { x: state.x / r_pos, y: state.y / r_pos };
        const localEast = { x: localUp.y, y: -localUp.x };
        const bodyAxisX = Math.sin(state.rocketAngle) * localEast.x + Math.cos(state.rocketAngle) * localUp.x;
        const bodyAxisY = Math.sin(state.rocketAngle) * localEast.y + Math.cos(state.rocketAngle) * localUp.y;
        const aoa = calculateAngleOfAttack({ x: bodyAxisX, y: bodyAxisY }, airVx, airVy);

        if (Math.abs(aoa) > 1e-5) {
            const atm = getAtmosphericProperties(altitude);
            const mach = airspeed / atm.speedOfSound;
            const area = Math.PI * (config.stages[0].diameter / 2) ** 2;
            const q = 0.5 * atm.density * airspeed * airspeed;
            const cnAlpha = calculateNormalForceCoefficientDerivative(mach);
            F_normal = Math.abs(q * area * cnAlpha * aoa);
        }
    }

    const sections = [];

    if (state.currentStage === 0) {
        const s1 = config.stages[0];
        const s2 = config.stages[1];

        const m_s2_total = s2.dryMass + state.propellantRemaining[1];
        const m_payload  = config.payload.mass;
        const m_fairing  = !state.fairingJettisoned ? config.fairing.mass : 0;
        const m_above_all = mass; // everything is above the engine plane

        // ── Section 0: Base of Stage 1 (z = 0) ──────────────────────────────
        {
            const r = s1.diameter / 2;
            const t = s1.wallThickness;
            const A = 2 * Math.PI * r * t;
            const I = Math.PI * r ** 3 * t;

            const fuelInfo = calculateFuelLevel(0);
            const P_h = ULLAGE_PRESSURE + config.propellantDensity * g_eff * fuelInfo.fuelHeight;

            const sigma_hoop    = P_h * r / t;
            const sigma_axial   = m_above_all * g_eff / A;
            // Bending moment = F_n × distance from base (z=0) to rocket COG
            const M_bend        = F_normal * rocketCOG;
            const sigma_bending = M_bend * r / I;
            const tau           = F_normal / (2 * Math.PI * r * t);

            const sigma_vm = vonMises(sigma_axial + sigma_bending, sigma_hoop, tau);

            sections.push({
                name: 'Base S1',
                positionZ: 0,
                segmentIndex: 0,
                active: true,
                hoopStress:    sigma_hoop,
                axialStress:   sigma_axial,
                bendingStress: sigma_bending,
                shearStress:   tau,
                vonMises:      sigma_vm,
                yieldStress:   s1.yieldStress,
                utilization:   sigma_vm / s1.yieldStress
            });
        }

        // ── Section 1: Interstage ring (z = s1.length) ─────────────────────
        {
            const is   = config.interstage;
            const r    = s1.diameter / 2; // same outer diameter as S1
            const t    = is.wallThickness;
            const A    = 2 * Math.PI * r * t;
            const I    = Math.PI * r ** 3 * t;
            const z_is = s1.length;

            // Interstage is outside the pressurised tank — only ullage pressure acts
            const sigma_hoop = ULLAGE_PRESSURE * r / t;

            const m_above_is = m_s2_total + m_payload + m_fairing;
            const sigma_axial = m_above_is * g_eff / A;

            // Shear and bending scaled to fraction of total mass above this section
            const frac = m_above_is / Math.max(mass, 1);
            const V_is = F_normal * frac;

            // Approximate COG of mass above interstage
            const s2_len = s2.length;
            const cogAbove_is = z_is
                + (m_s2_total * s2_len / 2
                 + m_payload  * (s2_len + config.payload.length / 2)
                 + m_fairing  * (s2_len + config.payload.length + config.fairing.length / 3))
                / Math.max(m_above_is, 1);

            const M_bend        = V_is * Math.max(0, cogAbove_is - z_is);
            const sigma_bending = M_bend * r / I;
            const tau           = V_is / (2 * Math.PI * r * t);

            const sigma_vm = vonMises(sigma_axial + sigma_bending, sigma_hoop, tau);

            sections.push({
                name: 'Interstage',
                positionZ: z_is,
                segmentIndex: 1,
                active: true,
                hoopStress:    sigma_hoop,
                axialStress:   sigma_axial,
                bendingStress: sigma_bending,
                shearStress:   tau,
                vonMises:      sigma_vm,
                yieldStress:   is.yieldStress,
                utilization:   sigma_vm / is.yieldStress
            });
        }

        // ── Section 2: Base of Stage 2 (just above S2 engines) ─────────────
        {
            const r    = s2.diameter / 2;
            const t    = s2.wallThickness;
            const A    = 2 * Math.PI * r * t;
            const I    = Math.PI * r ** 3 * t;
            const z_s2 = s1.length;

            const fuelInfo = calculateFuelLevel(1);
            const P_h = ULLAGE_PRESSURE + config.propellantDensity * g_eff * fuelInfo.fuelHeight;

            const sigma_hoop = P_h * r / t;

            // Axial: only payload + fairing loads above S2 engine plane
            const m_above_s2  = m_payload + m_fairing;
            const sigma_axial = m_above_s2 * g_eff / A;

            const frac  = m_above_s2 / Math.max(mass, 1);
            const V_s2  = F_normal * frac;

            const cogAbove_s2 = z_s2 + s2.length
                + (m_payload * config.payload.length / 2
                 + m_fairing * (config.payload.length + config.fairing.length / 3))
                / Math.max(m_above_s2, 1);

            const M_bend        = V_s2 * Math.max(0, cogAbove_s2 - z_s2);
            const sigma_bending = M_bend * r / I;
            const tau           = V_s2 / (2 * Math.PI * r * t);

            const sigma_vm = vonMises(sigma_axial + sigma_bending, sigma_hoop, tau);

            sections.push({
                name: 'Base S2',
                positionZ: z_s2,
                segmentIndex: 2,
                active: true,
                hoopStress:    sigma_hoop,
                axialStress:   sigma_axial,
                bendingStress: sigma_bending,
                shearStress:   tau,
                vonMises:      sigma_vm,
                yieldStress:   s2.yieldStress,
                utilization:   sigma_vm / s2.yieldStress
            });
        }

    } else if (state.currentStage === 1) {
        // Stage 1 dropped — only Stage 2 structure remains
        const s2 = config.stages[1];
        const r  = s2.diameter / 2;
        const t  = s2.wallThickness;
        const A  = 2 * Math.PI * r * t;
        const I  = Math.PI * r ** 3 * t;

        const m_payload = config.payload.mass;
        const m_fairing = !state.fairingJettisoned ? config.fairing.mass : 0;

        const fuelInfo = calculateFuelLevel(1);
        const P_h = ULLAGE_PRESSURE + config.propellantDensity * Math.max(g_eff, 0) * fuelInfo.fuelHeight;

        const sigma_hoop    = P_h * r / t;
        const sigma_axial   = mass * g_eff / A;
        const M_bend        = F_normal * rocketCOG;
        const sigma_bending = M_bend * r / I;
        const tau           = F_normal / (2 * Math.PI * r * t);

        const sigma_vm = vonMises(sigma_axial + sigma_bending, sigma_hoop, tau);

        sections.push({
            name: 'Base S2',
            positionZ: 0,
            segmentIndex: 0,
            active: true,
            hoopStress:    sigma_hoop,
            axialStress:   sigma_axial,
            bendingStress: sigma_bending,
            shearStress:   tau,
            vonMises:      sigma_vm,
            yieldStress:   s2.yieldStress,
            utilization:   sigma_vm / s2.yieldStress
        });

        sections.push({ name: 'Interstage', active: false, utilization: 0 });
        sections.push({ name: 'Base S1',    active: false, utilization: 0 });
    } else {
        sections.push({ name: 'Base S1',  active: false, utilization: 0 });
        sections.push({ name: 'Interstage', active: false, utilization: 0 });
        sections.push({ name: 'Base S2',  active: false, utilization: 0 });
    }

    return sections;
}

/**
 * Check for structural overstress and handle failure logic.
 * Called from main.js each frame after calculateStructuralLoads().
 * @param {Array} sections - result of calculateStructuralLoads()
 * @param {Function} addEvent - event logger from events.js
 */
export function checkStructuralFailure(sections, addEvent) {
    if (!state.running) return;

    const overstressed = sections.some(s => s.active && s.utilization >= 1.0);

    if (overstressed) {
        if (state.structuralFailureTime === null) {
            state.structuralFailureTime = state.time;
            const worst = sections.filter(s => s.active).reduce((a, b) => a.utilization > b.utilization ? a : b);
            addEvent(`STRUCTURAL OVERSTRESS: ${worst.name} (${(worst.utilization * 100).toFixed(0)}% yield)`);
        }

        if (state.settings.structuralFailureMode === 'terminate') {
            const elapsed = state.time - state.structuralFailureTime;
            if (elapsed >= getStructuralFailureGraceSeconds()) {
                addEvent('STRUCTURAL FAILURE - VEHICLE LOST');
                registerMissionFailure('structural');
            }
        }
    } else {
        // Reset failure timer if stress drops back below yield
        state.structuralFailureTime = null;
    }
}
