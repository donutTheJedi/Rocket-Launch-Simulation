import { getRocketConfig, isCustomRocket } from './rocketConfig.js';

function formatMass(kg) {
    if (kg >= 1000) return `${(kg / 1000).toFixed(1)} t`;
    return `${Math.round(kg)} kg`;
}

function formatThrust(n) {
    if (n >= 1e6) return `${(n / 1e6).toFixed(2)} MN`;
    if (n >= 1000) return `${(n / 1000).toFixed(0)} kN`;
    return `${Math.round(n)} N`;
}

/**
 * Update rocket summary stats in the simulator menu or hangar summary bay.
 * @param {ParentNode} [root] - Scope for queries; defaults to document. Use hangar #hangar-summary element on builder page.
 */
export function updateRocketSummary(root = document) {
    const config = getRocketConfig();
    const G = 9.81;
    const isHangar = root.id === 'hangar-summary';
    const p = isHangar ? 'hangar' : 'menu';

    const q = (id) => root.querySelector(`#${id}`) || document.getElementById(id);

    const totalDryMass = config.stages.reduce((s, st) => s + st.dryMass, 0)
                       + (config.payload?.mass || 0)
                       + (config.fairing?.mass || 0);
    const totalPropellant = config.stages.reduce((s, st) => s + st.propellantMass, 0);
    const totalMass = totalDryMass + totalPropellant;

    const twr = config.stages[0].thrust / (totalMass * G);
    const vacIsp = config.stages[config.stages.length - 1].ispVac;

    let remainingMass = totalMass;
    let totalDV = 0;
    for (const stage of config.stages) {
        const m0 = remainingMass;
        const m1 = remainingMass - stage.propellantMass;
        if (m1 > 0) totalDV += stage.ispVac * G * Math.log(m0 / m1);
        remainingMass = m1 - stage.dryMass;
    }

    const twrScore = twr < 1.0 ? 0.05 : twr < 1.2 ? 0.5 : twr < 2.5 ? 1.0 : 0.7;
    const dvScore = Math.min(1, totalDV / 9400);
    const readiness = Math.round((twrScore * 0.4 + dvScore * 0.6) * 100);
    const readinessLabel = readiness < 40 ? 'CRITICAL' : readiness < 65 ? 'MARGINAL' : readiness < 88 ? 'NOMINAL' : 'OPTIMAL';

    const titleEl = q(`${p}-rocket-title`);
    const metaEl = q(`${p}-rocket-meta`);
    const dryEl = q(`${p}-stat-drymass`);
    const twrEl = q(`${p}-stat-twr`);
    const ispEl = q(`${p}-stat-isp`);
    const rdyLabel = q(`${p}-readiness-label`);
    const rdyFill = q(`${p}-readiness-fill`);
    const advisory = q(`${p}-advisory`);
    const advisoryTxt = q(`${p}-advisory-text`);

    if (titleEl) titleEl.textContent = config.name || (isCustomRocket() ? 'CUSTOM ROCKET' : 'FALCON-9 MK1');
    if (metaEl) metaEl.textContent = `${config.stages.length} STAGES · ${config.propellantType || 'KEROLOX'}`;
    if (dryEl) dryEl.textContent = totalDryMass >= 1000 ? `${(totalDryMass / 1000).toFixed(0)}t` : `${totalDryMass}kg`;
    if (twrEl) twrEl.textContent = twr.toFixed(2);
    if (ispEl) ispEl.textContent = `${vacIsp}s`;

    if (isHangar) {
        const totalMassEl = q('hangar-stat-totalmass');
        const heightEl = q('hangar-stat-height');
        const widthEl = q('hangar-stat-width');
        const thrustS1El = q('hangar-stat-thrust-s1');
        const thrustS2El = q('hangar-stat-thrust-s2');

        const totalHeight = config.totalLength
            ?? (config.stages.reduce((s, st) => s + st.length, 0)
                + (config.payload?.length || 0)
                + (config.fairing?.length || 0));
        const maxWidth = Math.max(
            ...config.stages.map((st) => st.diameter),
            config.payload?.diameter || 0,
            config.fairing?.diameter || 0
        );

        if (totalMassEl) totalMassEl.textContent = formatMass(totalMass);
        if (heightEl) heightEl.textContent = `${totalHeight.toFixed(1)} m`;
        if (widthEl) widthEl.textContent = `${maxWidth.toFixed(1)} m`;
        if (thrustS1El && config.stages[0]) thrustS1El.textContent = formatThrust(config.stages[0].thrust);
        if (thrustS2El && config.stages[1]) thrustS2El.textContent = formatThrust(config.stages[1].thrust);
    }

    if (rdyLabel) rdyLabel.textContent = `${readiness}% — ${readinessLabel}`;
    if (rdyFill) rdyFill.style.width = `${readiness}%`;
    if (rdyFill) {
        rdyFill.style.background = readiness < 40 ? '#f44' : readiness < 65 ? '#fa0' : '#0f0';
    }

    let warnText = '';
    if (twr < 1.2) warnText = `TWR of ${twr.toFixed(2)} may be insufficient to lift off. Reduce payload mass or increase S1 thrust.`;
    else if (totalDV < 8000) warnText = `Estimated ΔV of ${(totalDV / 1000).toFixed(1)} km/s is below LEO minimum (~9.4 km/s). Add propellant or reduce dry mass.`;

    if (advisory) advisory.style.display = warnText ? '' : 'none';
    if (advisoryTxt) advisoryTxt.textContent = warnText;
}
