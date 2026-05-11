import { G, EARTH_MASS, EARTH_RADIUS, GUIDANCE_CONFIG } from './constants.js';
import { getTotalMass, state } from './state.js';
import { getRocketConfig } from './rocketConfig.js';

const RESOLVE_INTERVAL = 5.0;
const WARM_START_ERROR_THRESHOLD      = 1e3;
const SOLUTION_ACCEPTANCE_ERROR_THRESHOLD = 1e6;
const CUBIC_THETA_MAX_DEG = 90;
const CUBIC_THETA_MIN_DEG = -15;
const CUBIC_THETA_MAX_RAD = CUBIC_THETA_MAX_DEG * Math.PI / 180;
const CUBIC_THETA_MIN_RAD = CUBIC_THETA_MIN_DEG * Math.PI / 180;
const ALPHA_MIN = -0.2;
const ALPHA_MAX = 0.2;
const BETA_MIN = -0.002;
const BETA_MAX = 0.002;
const MAX_ALPHA_STEP = 0.02;
const MAX_BETA_STEP = 0.0002;
const SINGULAR_WARN_INTERVAL = 15;

function clampCubicTheta(thetaRad) {
    return Math.max(CUBIC_THETA_MIN_RAD, Math.min(CUBIC_THETA_MAX_RAD, thetaRad));
}

function clampSolverParams(alpha, beta) {
    return {
        alpha: Math.max(ALPHA_MIN, Math.min(ALPHA_MAX, alpha)),
        beta: Math.max(BETA_MIN, Math.min(BETA_MAX, beta)),
    };
}

export let cubicGuidanceState = {
    alpha: 0,
    beta: 0,
    theta0: 0,
    T: 0,
    burnStartTime: null,   // reset on every accepted solve
    burnComplete: false,
    solved: false,
    lastSolveTime: -9999,
    iterLog: [],
    finalSummary: null,
    lastThrottleCommand: 0,
    lastSingularWarnTime: -9999,
    w_alt: 1.0,    // row-scaling for altitude residual (km) — purely numerical
    w_vy:  1.0,   // row-scaling for up-velocity residual (m/s)
};

export function resetCubicGuidance() {
    cubicGuidanceState.alpha              = 0;
    cubicGuidanceState.beta               = 0;
    cubicGuidanceState.theta0             = 0;
    cubicGuidanceState.T                  = 0;
    cubicGuidanceState.burnStartTime      = null;
    cubicGuidanceState.burnComplete       = false;
    cubicGuidanceState.solved             = false;
    cubicGuidanceState.lastSolveTime      = -9999;
    cubicGuidanceState.iterLog            = [];
    cubicGuidanceState.finalSummary       = null;
    cubicGuidanceState.lastThrottleCommand = 0;
    cubicGuidanceState.lastSingularWarnTime = -9999;
}

function finalizeCubicCommand(simState, command, cutoffSource = 'unknown') {
    const previousThrottle = cubicGuidanceState.lastThrottleCommand;
    if (previousThrottle > 0 && command.throttle <= 0) {
        const tBurn = cubicGuidanceState.burnStartTime !== null
            ? (simState.time - cubicGuidanceState.burnStartTime).toFixed(1)
            : 'n/a';
        console.log(
            `[CubicGuidance] Engine cutoff commanded at t=${simState.time.toFixed(1)}s (phase=${command.phase}, source=${cutoffSource}, t_burn=${tBurn}s)`
        );
    }
    cubicGuidanceState.lastThrottleCommand = command.throttle;
    return command;
}

// ---------------------------------------------------------------------------
// 2D inertial integrator with rotating local frame.
//
// x0, y0  : absolute inertial position at burn start (Earth center = origin, m)
// vx0, vy0: initial velocity in LOCAL ENU frame (east, up) in m/s
// theta(t) = theta0 + α·t + β·t²  (quadratic pitch profile in local frame)
//
// Integrates in the inertial frame; local frame is recomputed every step from
// the current position to account for Earth's curvature over the burn arc.
//
// Returns { x, y, vx, vy }
//   x, y : absolute inertial position at burn end (m)
//   vx   : eastward velocity in the LOCAL frame at burn END (m/s)
//   vy   : upward   velocity in the LOCAL frame at burn END (m/s)
// ---------------------------------------------------------------------------
function integrateSimplified(mi, mdot, F, theta0, alpha, beta, T, x0, y0, vx0, vy0) {
    const N  = Math.max(2000, Math.ceil(T * 10));
    const dt = T / N;

    // Convert initial local-frame velocity (east, up) → inertial frame
    const r0     = Math.sqrt(x0 * x0 + y0 * y0);
    let vInertX  = vx0 * (y0 / r0) + vy0 * (x0 / r0);
    let vInertY  = vx0 * (-x0 / r0) + vy0 * (y0 / r0);

    let x = x0;
    let y = y0;

    for (let i = 0; i < N; i++) {
        const t       = i * dt;
        const massAtT = mi - mdot * t;
        if (massAtT <= 0) break;

        // Current local frame (rotates with position)
        const r  = Math.sqrt(x * x + y * y);
        const eX =  y / r;   // localEast.x
        const eY = -x / r;   // localEast.y
        const uX =  x / r;   // localUp.x
        const uY =  y / r;   // localUp.y

        // Gravity toward Earth center
        const g  = G * EARTH_MASS / (r * r);

        // Quadratic pitch profile: theta in current local frame
        const theta = clampCubicTheta(theta0 + alpha * t + beta * t * t);

        // Thrust acceleration in inertial frame
        const a  = F / massAtT;
        const aX = a * (Math.cos(theta) * eX + Math.sin(theta) * uX);
        const aY = a * (Math.cos(theta) * eY + Math.sin(theta) * uY);

        vInertX += (aX - g * uX) * dt;
        vInertY += (aY - g * uY) * dt;
        x       += vInertX * dt;
        y       += vInertY * dt;
    }

    // Project final inertial velocity into the LOCAL frame at the final position
    const r_end  = Math.sqrt(x * x + y * y);
    const eX_end =  y / r_end;
    const eY_end = -x / r_end;
    const uX_end =  x / r_end;
    const uY_end =  y / r_end;

    return {
        x,
        y,
        vx: vInertX * eX_end + vInertY * eY_end,   // eastward at end
        vy: vInertX * uX_end + vInertY * uY_end,   // upward   at end
    };
}

// ---------------------------------------------------------------------------
// 2×2 linear system — closed-form solve, returns null if singular
// ---------------------------------------------------------------------------
function solve2x2(A, b) {
    const det = A[0][0] * A[1][1] - A[0][1] * A[1][0];
    if (Math.abs(det) < 1e-20) return null;
    return [
        ( A[1][1] * b[0] - A[0][1] * b[1]) / det,
        (-A[1][0] * b[0] + A[0][0] * b[1]) / det,
    ];
}

// Return the commanded angle (rad) from the quadratic profile at burn-elapsed time t_burn
export function getCubicTheta(t_burn) {
    const { theta0, alpha, beta } = cubicGuidanceState;
    return clampCubicTheta(theta0 + alpha * t_burn + beta * t_burn * t_burn);
}

// ---------------------------------------------------------------------------
// Compute 2 residuals for the square 2×2 system:
//   f[0] = altitude error in km   (scaled for numerical balance with f[1])
//   f[1] = up-velocity error (m/s)
//
// vx is NOT a residual — T is sized by the Δv budget to hit vx_target.
// Achieved vx is logged as a diagnostic after each solve.
//
// Convergence: |f[0]| < 0.5 km  |f[1]| < 0.1 m/s
// ---------------------------------------------------------------------------
function computeResiduals(res, targetAlt, vy_target) {
    const r_end = Math.sqrt(res.x * res.x + res.y * res.y);
    return [
        (r_end - EARTH_RADIUS - targetAlt) / 1000,   // f[0]: altitude error (km)
        res.vy - vy_target,                           // f[1]: up-velocity error (m/s)
    ];
}

// ---------------------------------------------------------------------------
// Gauss-Newton solver (overdetermined: 3 residuals, 2 unknowns)
// Finds (alpha, beta) for theta(t) = theta0 + α·t + β·t²
// ---------------------------------------------------------------------------
export function solveCubicGuidance(simState) {
    const r        = Math.sqrt(simState.x * simState.x + simState.y * simState.y);
    const altitude = r - EARTH_RADIUS;
    const targetAlt = GUIDANCE_CONFIG.targetAltitude;

    // Local ENU frame at current position
    const localUp   = { x: simState.x / r, y: simState.y / r };
    const localEast = { x: localUp.y,       y: -localUp.x     };

    // Current velocity in local frame (m/s)
    const vx0 = simState.vx * localEast.x + simState.vy * localEast.y;  // eastward
    const vy0 = simState.vx * localUp.x   + simState.vy * localUp.y;    // upward

    // Target: circular orbit — purely horizontal at targetAlt
    const mu        = G * EARTH_MASS;
    const r_target  = EARTH_RADIUS + targetAlt;
    const vx_target = Math.sqrt(mu / r_target);   // eastward orbital speed (m/s)
    const vy_target = 0;

    // Rocket parameters (vacuum values — above-atmosphere burn)
    const rocketConfig = getRocketConfig();
    const stageIdx = simState.currentStage;
    if (stageIdx >= rocketConfig.stages.length) {
        console.warn('[CubicGuidance] No active stage, skipping.');
        cubicGuidanceState.lastSolveTime = simState.time;
        return false;
    }
    const stage = rocketConfig.stages[stageIdx];
    const mi   = getTotalMass();
    const F    = stage.thrustVac;
    const mdot = F / (stage.ispVac * 9.80665);

    if (!isFinite(F) || !isFinite(mdot) || !isFinite(mi) || F <= 0 || mdot <= 0 || mi <= 0) {
        console.warn('[CubicGuidance] Invalid rocket params.', { stageIdx, F, mdot, mi });
        cubicGuidanceState.lastSolveTime = simState.time;
        return false;
    }

    // Required delta-v
    const dvx     = vx_target - vx0;
    const dvy     = vy_target - vy0;
    const delta_v = Math.sqrt(dvx * dvx + dvy * dvy);

    if (!isFinite(delta_v)) {
        cubicGuidanceState.lastSolveTime = simState.time;
        return false;
    }
    if (delta_v < 0.1) {
        cubicGuidanceState.burnComplete  = true;
        cubicGuidanceState.lastSolveTime = simState.time;
        return false;
    }

    // Tsiolkovsky burn time
    const exponent = -mdot * delta_v / F;
    const T_raw    = (mi / mdot) * (1 - Math.exp(exponent));

    const propRemain = simState.propellantRemaining?.[simState.currentStage] || 0;
    const T_prop     = propRemain / mdot;

    // If propellant is exhausted, stop trying to solve
    if (T_prop <= 0) {
        cubicGuidanceState.burnComplete  = true;
        cubicGuidanceState.lastSolveTime = simState.time;
        return false;
    }

    const T = Math.min(T_raw, 0.95 * T_prop);

    if (!isFinite(T) || T <= 0) {
        console.warn('[CubicGuidance] Invalid burn time.', { T, T_raw, T_prop, propRemain, mdot });
        cubicGuidanceState.lastSolveTime = simState.time;
        return false;
    }

    // Row-scaling for the 2×2 system — numerical balance only, not constraint weighting
    const W = [
        cubicGuidanceState.w_alt,   // scales the altitude row (km units)
        cubicGuidanceState.w_vy,    // scales the vy row (m/s units)
    ];

    // theta0 = current flight-path angle in local frame
    const theta0 = Math.atan2(vy0, vx0);

    // theta_f = 0 for circular equatorial orbit (purely eastward)
    const theta_f = 0;

    // Initial guess: linear sweep from theta0 to theta_f
    const alphaLinear = Math.max(-0.05, Math.min(0.05, (theta_f - theta0) / T));

    let alpha, beta;
    const prevError  = cubicGuidanceState.finalSummary?.totalError;
    const canWarmStart = cubicGuidanceState.solved &&
        isFinite(prevError) &&
        prevError < WARM_START_ERROR_THRESHOLD;
    if (canWarmStart) {
        alpha = cubicGuidanceState.alpha;
        beta  = cubicGuidanceState.beta;
    } else {
        alpha = alphaLinear;
        beta  = 0;
    }
    ({ alpha, beta } = clampSolverParams(alpha, beta));

    const iterLog = [];

    console.log(
        `[CubicGuidance] New solve: alt=${(altitude / 1000).toFixed(1)}km, target=${(targetAlt / 1000).toFixed(1)}km, T=${T.toFixed(1)}s, dv=${delta_v.toFixed(1)}m/s`
    );

    for (let iter = 0; iter < 20; iter++) {
        const res = integrateSimplified(mi, mdot, F, theta0, alpha, beta, T,
                                        simState.x, simState.y, vx0, vy0);
        const f   = computeResiduals(res, targetAlt, vy_target);
        // Scaled cost for line search and warm-start comparison
        const E   = (W[0]*f[0])**2 + (W[1]*f[1])**2;

        iterLog.push({ iter: iter + 1, alpha, beta, f0: f[0], f1: f[1], E,
                       vx_achieved: res.vx });

        console.log(
            `  iter ${String(iter+1).padStart(2)}: α=${alpha.toExponential(3)}  β=${beta.toExponential(3)}` +
            `  | Δalt=${f[0].toFixed(3)}km  Δvy=${f[1].toFixed(3)}m/s  vx=${res.vx.toFixed(1)}m/s  E=${E.toExponential(3)}`
        );

        // Convergence: |Δalt| < 0.5 km AND |Δvy| < 0.1 m/s
        if (Math.abs(f[0]) < 0.5 && Math.abs(f[1]) < 0.1) {
            console.log(`[CubicGuidance] Converged in ${iter + 1} iterations.`);
            break;
        }

        // Per-parameter relative epsilon for Jacobian finite differences
        const eps = [
            Math.max(1e-8,  Math.abs(alpha) * 1e-4) || 1e-6,
            Math.max(1e-10, Math.abs(beta)  * 1e-4) || 1e-8,
        ];

        // 2×2 Jacobian by finite differences — column j = (f(p+εⱼ) − f(p)) / εⱼ
        const Jcols = [alpha, beta].map((_, j) => {
            const p = [alpha, beta];
            p[j] += eps[j];
            const rp = integrateSimplified(mi, mdot, F, theta0, p[0], p[1], T,
                                           simState.x, simState.y, vx0, vy0);
            const fp = computeResiduals(rp, targetAlt, vy_target);
            return [
                (fp[0] - f[0]) / eps[j],   // ∂f_alt/∂param_j
                (fp[1] - f[1]) / eps[j],   // ∂f_vy /∂param_j
            ];
        });

        // Row-scaled square system: (S·J)·δ = −(S·f)
        // Jcols[j][i] = ∂f[i]/∂param[j], so J[row][col] = Jcols[col][row]
        const Js = [
            [W[0] * Jcols[0][0],  W[0] * Jcols[1][0]],   // altitude row
            [W[1] * Jcols[0][1],  W[1] * Jcols[1][1]],   // vy row
        ];
        const rhs = [-W[0] * f[0], -W[1] * f[1]];

        const delta = solve2x2(Js, rhs);
        if (!delta) {
            if (simState.time - cubicGuidanceState.lastSingularWarnTime >= SINGULAR_WARN_INTERVAL) {
                console.warn('[CubicGuidance] Singular Jacobian (likely due to angle clamp saturation), stopping this solve.');
                cubicGuidanceState.lastSingularWarnTime = simState.time;
            }
            break;
        }

        const boundedDelta = [
            Math.max(-MAX_ALPHA_STEP, Math.min(MAX_ALPHA_STEP, delta[0])),
            Math.max(-MAX_BETA_STEP, Math.min(MAX_BETA_STEP, delta[1])),
        ];

        // Backtracking line search — halve step until scaled cost decreases
        let step = 1.0;
        for (let ls = 0; ls < 6; ls++) {
            const candidate = clampSolverParams(
                alpha + step * boundedDelta[0],
                beta + step * boundedDelta[1]
            );
            const a2 = candidate.alpha;
            const b2 = candidate.beta;
            const r2 = integrateSimplified(mi, mdot, F, theta0, a2, b2, T,
                                           simState.x, simState.y, vx0, vy0);
            const f2 = computeResiduals(r2, targetAlt, vy_target);
            const E2 = (W[0]*f2[0])**2 + (W[1]*f2[1])**2;
            if (E2 < E) {
                alpha = a2; beta = b2;
                break;
            }
            if (ls === 5) {
                const fallback = clampSolverParams(
                    alpha + step * boundedDelta[0],
                    beta + step * boundedDelta[1]
                );
                alpha = fallback.alpha;
                beta = fallback.beta;
            }
            step *= 0.5;
        }
    }

    // Final evaluation
    const finalRes = integrateSimplified(mi, mdot, F, theta0, alpha, beta, T,
                                         simState.x, simState.y, vx0, vy0);
    const finalF   = computeResiduals(finalRes, targetAlt, vy_target);
    const finalE   = (W[0]*finalF[0])**2 + (W[1]*finalF[1])**2;
    const r_end    = Math.sqrt(finalRes.x * finalRes.x + finalRes.y * finalRes.y);
    const thetaEnd = theta0 + alpha*T + beta*T*T;

    console.log('[CubicGuidance] ==== FINAL SUMMARY ====');
    console.log(`  Burn time T = ${T.toFixed(1)} s`);
    console.log(`  α=${alpha.toExponential(4)}  β=${beta.toExponential(4)}`);
    console.log(`  Achieved: alt=${((r_end - EARTH_RADIUS)/1000).toFixed(2)} km  vx=${finalRes.vx.toFixed(2)} m/s (target ${vx_target.toFixed(2)})  vy=${finalRes.vy.toFixed(2)} m/s`);
    console.log(`  Target:   alt=${(targetAlt/1000).toFixed(2)} km  vy=${vy_target.toFixed(2)} m/s`);
    console.log(`  Errors:   Δalt=${(finalF[0]*1000).toFixed(0)} m  Δvy=${finalF[1].toFixed(3)} m/s  Δvx=${(finalRes.vx - vx_target).toFixed(2)} m/s (diagnostic)`);
    console.log(`  Scaled cost: ${finalE.toFixed(6)}`);

    if (finalE > SOLUTION_ACCEPTANCE_ERROR_THRESHOLD) {
        console.log(
            `[CubicGuidance] Solve rejected (E=${finalE.toFixed(3)} > ${SOLUTION_ACCEPTANCE_ERROR_THRESHOLD}). Keeping previous profile.`
        );
        cubicGuidanceState.lastSolveTime = simState.time;
        if (!cubicGuidanceState.solved) return false;
        return true;
    }

    cubicGuidanceState.alpha         = alpha;
    cubicGuidanceState.beta          = beta;
    cubicGuidanceState.theta0        = theta0;
    cubicGuidanceState.T             = T;
    cubicGuidanceState.burnStartTime = simState.time;
    cubicGuidanceState.solved        = true;
    cubicGuidanceState.lastSolveTime = simState.time;
    cubicGuidanceState.iterLog       = iterLog;
    cubicGuidanceState.finalSummary  = {
        achieved    : { alt: r_end - EARTH_RADIUS, vx: finalRes.vx, vy: finalRes.vy },
        target      : { alt: targetAlt, vx: vx_target, vy: vy_target },
        errors      : finalF,
        totalError  : finalE,
        burnTime    : T,
        theta0Deg   : theta0 * 180 / Math.PI,
        thetaEndDeg : thetaEnd * 180 / Math.PI,
        altitude    : altitude,
    };

    return true;
}

// ---------------------------------------------------------------------------
// Called every guidance tick in cubic mode while above atmosphere.
// Returns { pitch, throttle, phase, debug }  (pitch in degrees from horizontal)
// ---------------------------------------------------------------------------
export function computeCubicVacuumGuidance(simState, altitude, flightPathAngle) {
    const gs = cubicGuidanceState;

    const shouldSolve = !gs.solved ||
        (!gs.burnComplete && simState.time - gs.lastSolveTime >= RESOLVE_INTERVAL);

    if (shouldSolve && !gs.burnComplete) {
        solveCubicGuidance(simState);
    }

    if (!gs.solved) {
        return finalizeCubicCommand(
            simState,
            { pitch: flightPathAngle, throttle: 0, phase: 'cubic-initializing', debug: {} },
            'unsolved-initializing'
        );
    }

    if (gs.burnComplete) {
        return finalizeCubicCommand(
            simState,
            { pitch: flightPathAngle, throttle: 0, phase: 'cubic-burn-complete', debug: {} },
            'burn-complete'
        );
    }

    const t_burn = simState.time - gs.burnStartTime;

    if (t_burn >= gs.T) {
        const readyForNextSolve = (simState.time - gs.lastSolveTime) >= RESOLVE_INTERVAL;
        if (!readyForNextSolve) {
            const holdThetaRad = getCubicTheta(gs.T);
            return finalizeCubicCommand(
                simState,
                {
                    pitch: holdThetaRad * 180 / Math.PI,
                    throttle: 1.0,
                    phase: 'cubic-awaiting-resolve',
                    debug: { hold_theta_deg: (holdThetaRad * 180 / Math.PI).toFixed(2) },
                }
            );
        }

        solveCubicGuidance(simState);
        if (gs.burnComplete) {
            return finalizeCubicCommand(
                simState,
                { pitch: flightPathAngle, throttle: 0, phase: 'cubic-burn-complete', debug: {} },
                'post-resolve-burn-complete'
            );
        }
    }

    const thetaRad = getCubicTheta(Math.min(t_burn, gs.T));
    const pitchDeg = thetaRad * 180 / Math.PI;

    return finalizeCubicCommand(simState, {
        pitch: pitchDeg,
        throttle: 1.0,
        phase: 'cubic-burn',
        debug: {
            t_burn   : t_burn.toFixed(1),
            remaining: (gs.T - t_burn).toFixed(1),
            theta_deg: pitchDeg.toFixed(2),
            alpha    : gs.alpha.toExponential(3),
            beta     : gs.beta.toExponential(3),
        },
    });
}
