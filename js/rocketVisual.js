/**
 * Shared rocket profile drawing (hangar + in-flight simulator).
 * Stack coordinates: z = 0 at engine/base, increases toward nose.
 */

export const SEGMENT_PALETTE = [
    { shell: ['#2e343c', '#5c6674', '#252b32'], tank: 'rgba(40, 90, 130, 0.55)', ring: '#1a1f26' },
    { shell: ['#2a3038', '#566070', '#222830'], tank: 'rgba(35, 85, 125, 0.5)', ring: '#181d24' },
    { shell: ['#1e3a4a', '#4a7898', '#182e3c'], tank: 'rgba(60, 120, 160, 0.35)', ring: '#142430' },
    { shell: ['#4a2828', '#8a5050', '#3a2020'], tank: null, ring: '#2a1818' },
];

/**
 * @param {Object} config
 * @param {{ currentStage?: number, fairingJettisoned?: boolean }} flightState
 */
export function getFlightRocketLength(config, flightState = {}) {
    const { currentStage = 0, fairingJettisoned = false } = flightState;
    let len = 0;
    const stages = config.stages || [];
    for (let i = currentStage; i < stages.length; i++) {
        len += stages[i].length || 0;
    }
    len += config.payload?.length || 0;
    if (!fairingJettisoned) len += config.fairing?.length || 0;
    return len;
}

/**
 * @param {Object} config
 * @param {{ currentStage?: number, fairingJettisoned?: boolean }} flightState
 */
export function getFlightMaxDiameter(config, flightState = {}) {
    const { currentStage = 0, fairingJettisoned = false } = flightState;
    let maxD = 0;
    const stages = config.stages || [];
    for (let i = currentStage; i < stages.length; i++) {
        maxD = Math.max(maxD, stages[i].diameter || 0);
    }
    maxD = Math.max(maxD, config.payload?.diameter || 0);
    if (!fairingJettisoned) maxD = Math.max(maxD, config.fairing?.diameter || 0);
    return maxD;
}

/**
 * @param {Object} config
 * @param {{ currentStage?: number, fairingJettisoned?: boolean }} flightState
 * @returns {Array<{ zBottom, zTop, diameter, kind, stage?, segmentIndex }>}
 */
export function buildFlightSegments(config, flightState = {}) {
    const { currentStage = 0, fairingJettisoned = false } = flightState;
    const segments = [];
    let z = 0;
    const stages = config.stages || [];

    if (currentStage === 0 && stages[0]) {
        segments.push({
            zBottom: z,
            zTop: z + stages[0].length,
            diameter: stages[0].diameter,
            kind: 'stage',
            stage: stages[0],
            segmentIndex: 0,
        });
        z += stages[0].length;
    }
    if (currentStage <= 1 && stages[1]) {
        segments.push({
            zBottom: z,
            zTop: z + stages[1].length,
            diameter: stages[1].diameter,
            kind: 'stage',
            stage: stages[1],
            segmentIndex: 1,
        });
        z += stages[1].length;
    }
    if (config.payload) {
        segments.push({
            zBottom: z,
            zTop: z + config.payload.length,
            diameter: config.payload.diameter,
            kind: 'payload',
            segmentIndex: 2,
        });
        z += config.payload.length;
    }
    if (!fairingJettisoned && config.fairing) {
        segments.push({
            zBottom: z,
            zTop: z + config.fairing.length,
            diameter: config.fairing.diameter,
            kind: 'fairing',
            segmentIndex: 3,
        });
    }
    return segments;
}

export function computeVisibilityScale(rocketLenM, metersPerPixel, minPixelSize = 12) {
    if (!rocketLenM || rocketLenM <= 0) return 1;
    return Math.max(1, (minPixelSize * metersPerPixel) / rocketLenM);
}

export function drawCylinderBody(ctx, xLeft, yTop, width, height, palette, highlightState = {}) {
    const { isSelected = false, isHighlight = false } = highlightState;
    const xRight = xLeft + width;
    const midX = xLeft + width / 2;

    if (isSelected) {
        ctx.save();
        ctx.shadowColor = 'rgba(0, 255, 255, 0.65)';
        ctx.shadowBlur = 18;
    } else if (isHighlight) {
        ctx.save();
        ctx.shadowColor = 'rgba(255, 136, 0, 0.35)';
        ctx.shadowBlur = 12;
    }

    const bodyGrad = ctx.createLinearGradient(xLeft, 0, xRight, 0);
    bodyGrad.addColorStop(0, palette.shell[0]);
    bodyGrad.addColorStop(0.35, palette.shell[1]);
    bodyGrad.addColorStop(0.5, palette.shell[1]);
    bodyGrad.addColorStop(0.65, palette.shell[1]);
    bodyGrad.addColorStop(1, palette.shell[0]);
    ctx.fillStyle = bodyGrad;
    ctx.fillRect(xLeft, yTop, width, height);

    const highlightGrad = ctx.createLinearGradient(midX - width * 0.12, 0, midX + width * 0.05, 0);
    highlightGrad.addColorStop(0, 'rgba(255, 255, 255, 0)');
    highlightGrad.addColorStop(0.5, 'rgba(255, 255, 255, 0.12)');
    highlightGrad.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = highlightGrad;
    ctx.fillRect(xLeft, yTop, width, height);

    if (isSelected || isHighlight) ctx.restore();

    ctx.strokeStyle = isSelected ? '#0ff' : isHighlight ? 'rgba(255, 136, 0, 0.8)' : 'rgba(180, 190, 200, 0.45)';
    ctx.lineWidth = isSelected ? 2.5 : 1;
    ctx.strokeRect(xLeft + 0.5, yTop + 0.5, width - 1, height - 1);
}

export function drawTankRegion(ctx, xLeft, yTop, width, tankHeight, tankColor) {
    if (!tankColor || tankHeight <= 2) return;
    const pad = width * 0.06;
    ctx.fillStyle = tankColor;
    ctx.fillRect(xLeft + pad, yTop, width - pad * 2, tankHeight);
    ctx.strokeStyle = 'rgba(100, 180, 220, 0.35)';
    ctx.lineWidth = 1;
    ctx.strokeRect(xLeft + pad + 0.5, yTop + 0.5, width - pad * 2 - 1, tankHeight - 1);
}

export function drawInterstageRing(ctx, xLeft, y, width, palette) {
    const h = Math.max(3, width * 0.04);
    ctx.fillStyle = palette.ring;
    ctx.fillRect(xLeft, y - h / 2, width, h);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(xLeft, y);
    ctx.lineTo(xLeft + width, y);
    ctx.stroke();
}

export function drawEngineSection(ctx, centerX, yBottom, width, engineHeight, palette) {
    if (engineHeight < 4) return;
    const xLeft = centerX - width / 2;
    const yTop = yBottom - engineHeight;
    const engGrad = ctx.createLinearGradient(xLeft, yTop, xLeft + width, yTop);
    engGrad.addColorStop(0, '#1a1e24');
    engGrad.addColorStop(0.5, '#3a424c');
    engGrad.addColorStop(1, '#1a1e24');
    ctx.fillStyle = engGrad;
    ctx.fillRect(xLeft, yTop, width, engineHeight);

    const bellW = width * 0.72;
    const bellH = Math.min(engineHeight * 0.55, bellW * 0.35);
    const bellTop = yBottom - bellH;
    const bx = centerX - bellW / 2;
    ctx.fillStyle = '#2a3038';
    ctx.beginPath();
    ctx.moveTo(bx, bellTop);
    ctx.lineTo(centerX - bellW * 0.38, yBottom);
    ctx.lineTo(centerX + bellW * 0.38, yBottom);
    ctx.lineTo(bx + bellW, bellTop);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(120, 130, 140, 0.6)';
    ctx.lineWidth = 1;
    ctx.stroke();

    const exhaust = ctx.createRadialGradient(centerX, yBottom + 2, 0, centerX, yBottom + 2, width * 0.35);
    exhaust.addColorStop(0, 'rgba(255, 136, 0, 0.35)');
    exhaust.addColorStop(0.6, 'rgba(255, 80, 0, 0.08)');
    exhaust.addColorStop(1, 'transparent');
    ctx.fillStyle = exhaust;
    ctx.fillRect(centerX - width * 0.4, yBottom - 2, width * 0.8, engineHeight * 0.5);
}

export function drawFairing(ctx, centerX, yTop, yBottom, xLeft, xRight, palette, highlightState = {}) {
    const { isSelected = false, isHighlight = false } = highlightState;
    const width = xRight - xLeft;
    const noseR = width * 0.22;

    ctx.save();
    if (isSelected) {
        ctx.shadowColor = 'rgba(0, 255, 255, 0.65)';
        ctx.shadowBlur = 18;
    } else if (isHighlight) {
        ctx.shadowColor = 'rgba(255, 136, 0, 0.35)';
        ctx.shadowBlur = 12;
    }

    const grad = ctx.createLinearGradient(xLeft, yTop, xRight, yTop);
    grad.addColorStop(0, palette.shell[0]);
    grad.addColorStop(0.45, palette.shell[1]);
    grad.addColorStop(1, palette.shell[0]);

    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(centerX, yTop - noseR * 0.35);
    ctx.quadraticCurveTo(centerX + width * 0.15, yTop + noseR * 0.2, xRight, yBottom);
    ctx.lineTo(xLeft, yBottom);
    ctx.quadraticCurveTo(centerX - width * 0.15, yTop + noseR * 0.2, centerX, yTop - noseR * 0.35);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = isSelected ? '#0ff' : isHighlight ? 'rgba(255, 136, 0, 0.8)' : 'rgba(200, 160, 160, 0.5)';
    ctx.lineWidth = isSelected ? 2.5 : 1;
    ctx.stroke();
    ctx.restore();

    ctx.fillStyle = 'rgba(255, 255, 255, 0.06)';
    ctx.beginPath();
    ctx.moveTo(centerX, yTop);
    ctx.lineTo(centerX + width * 0.08, yBottom - (yBottom - yTop) * 0.3);
    ctx.lineTo(centerX, yBottom - (yBottom - yTop) * 0.25);
    ctx.closePath();
    ctx.fill();
}

export function drawPayloadBay(ctx, xLeft, yTop, width, height) {
    const inset = width * 0.18;
    ctx.fillStyle = 'rgba(20, 50, 70, 0.7)';
    ctx.fillRect(xLeft + inset, yTop + height * 0.15, width - inset * 2, height * 0.7);
    ctx.strokeStyle = 'rgba(0, 200, 255, 0.25)';
    ctx.setLineDash([4, 4]);
    ctx.strokeRect(xLeft + inset + 0.5, yTop + height * 0.15 + 0.5, width - inset * 2 - 1, height * 0.7 - 1);
    ctx.setLineDash([]);
}

function zToY(z, rocketLen, scale, yBase, noseUp) {
    if (noseUp) return yBase + z * scale;
    return yBase - z * scale;
}

function drawEngineFlame(ctx, centerX, yEngineBase, width, flameScale, gimbalAngleDeg) {
    ctx.save();
    const gimbalAngleRad = (gimbalAngleDeg || 0) * Math.PI / 180;
    ctx.rotate(gimbalAngleRad);

    const flameLen = width * (1.2 + Math.random() * 0.6) * flameScale;
    const halfW = width * 0.22;

    ctx.beginPath();
    ctx.moveTo(-halfW, yEngineBase);
    ctx.quadraticCurveTo(-halfW * 1.4, yEngineBase - flameLen * 0.5, 0, yEngineBase - flameLen);
    ctx.quadraticCurveTo(halfW * 1.4, yEngineBase - flameLen * 0.5, halfW, yEngineBase);
    ctx.fillStyle = `rgb(255, ${80 + Math.random() * 60}, 0)`;
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(-halfW * 0.5, yEngineBase);
    ctx.quadraticCurveTo(-halfW * 0.7, yEngineBase - flameLen * 0.35, 0, yEngineBase - flameLen * 0.6);
    ctx.quadraticCurveTo(halfW * 0.7, yEngineBase - flameLen * 0.35, halfW * 0.5, yEngineBase);
    ctx.fillStyle = `rgb(255, ${200 + Math.random() * 55}, ${100 + Math.random() * 80})`;
    ctx.fill();

    ctx.restore();
}

/**
 * Draw the configured rocket profile in local coordinates.
 * @param {CanvasRenderingContext2D} ctx
 * @param {Object} options
 * @param {Object} options.config
 * @param {number} [options.currentStage]
 * @param {boolean} [options.fairingJettisoned]
 * @param {number} [options.visibilityScale] - >=1 size boost when zoomed out
 * @param {boolean} [options.noseUp=true] - +Y toward nose (flight sim); false for UI diagrams
 * @param {boolean} [options.showFlame]
 * @param {number} [options.gimbalAngleDeg]
 */
export function drawFlightRocket(ctx, options) {
    const {
        config,
        currentStage = 0,
        fairingJettisoned = false,
        visibilityScale = 1,
        noseUp = true,
        showFlame = false,
        gimbalAngleDeg = 0,
    } = options;

    const flightState = { currentStage, fairingJettisoned };
    const rocketLen = getFlightRocketLength(config, flightState);
    if (rocketLen <= 0) return { rocketLen: 0 };

    const segments = buildFlightSegments(config, flightState);
    const scale = visibilityScale;
    const yBase = noseUp ? (-rocketLen * scale) / 2 : (rocketLen * scale) / 2;
    const centerX = 0;

    for (let si = 0; si < segments.length; si++) {
        const seg = segments[si];
        const yBottom = zToY(seg.zBottom, rocketLen, scale, yBase, noseUp);
        const yTop = zToY(seg.zTop, rocketLen, scale, yBase, noseUp);
        const yMin = Math.min(yTop, yBottom);
        const yMax = Math.max(yTop, yBottom);
        const segH = yMax - yMin;
        const segW = seg.diameter * scale;
        const xLeft = centerX - segW / 2;
        const xRight = centerX + segW / 2;
        const palette = SEGMENT_PALETTE[seg.segmentIndex] || SEGMENT_PALETTE[0];

        if (si > 0) {
            const joinY = noseUp ? yMin : yMax;
            drawInterstageRing(ctx, xLeft, joinY, segW, palette);
        }

        if (seg.kind === 'fairing') {
            const fairTop = noseUp ? yMax : yMin;
            const fairBottom = noseUp ? yMin : yMax;
            drawFairing(ctx, centerX, fairTop, fairBottom, xLeft, xRight, palette, {});
        } else if (seg.kind === 'payload') {
            drawCylinderBody(ctx, xLeft, yMin, segW, segH, palette, {});
            drawPayloadBay(ctx, xLeft, yMin, segW, segH);
        } else {
            const tankRatio = seg.stage.tankLengthRatio ?? 0.85;
            const engineLen = (seg.stage.engineLength ?? 2) * scale;
            const tankH = segH * tankRatio;
            const tankTop = noseUp ? yMax - tankH - engineLen : yMin + engineLen;
            drawCylinderBody(ctx, xLeft, yMin, segW, segH, palette, {});
            const tankY = noseUp ? Math.max(yMin, tankTop) : Math.min(yMax - tankH, tankTop);
            drawTankRegion(ctx, xLeft, tankY, segW, Math.max(0, tankH), palette.tank);
            const engineBaseY = noseUp ? yMin : yMax;
            drawEngineSection(ctx, centerX, engineBaseY, segW, engineLen, palette);
        }
    }

    if (showFlame && segments.length > 0) {
        const first = segments[0];
        if (first.kind === 'stage') {
            const yEngine = zToY(first.zBottom, rocketLen, scale, yBase, noseUp);
            const flameW = first.diameter * scale;
            drawEngineFlame(ctx, centerX, yEngine, flameW, 1, gimbalAngleDeg);
        }
    }

    return { rocketLen, segments };
}
