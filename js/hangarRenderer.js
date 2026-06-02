import { calculateRocketCOGAtPad, calculateCenterOfPressure } from './physics.js';
import {
    SEGMENT_PALETTE,
    drawCylinderBody,
    drawTankRegion,
    drawInterstageRing,
    drawEngineSection,
    drawFairing,
    drawPayloadBay,
} from './rocketVisual.js';

const SEGMENT_LABELS = ['S1', 'S2', 'PL', 'FN'];

function drawHangarBackground(ctx, cw, ch) {
    const bg = ctx.createLinearGradient(0, 0, 0, ch);
    bg.addColorStop(0, '#0a0e12');
    bg.addColorStop(0.55, '#06080a');
    bg.addColorStop(1, '#030405');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, cw, ch);

    const spot = ctx.createRadialGradient(cw / 2, ch * 0.45, 0, cw / 2, ch * 0.45, ch * 0.55);
    spot.addColorStop(0, 'rgba(0, 120, 90, 0.08)');
    spot.addColorStop(1, 'transparent');
    ctx.fillStyle = spot;
    ctx.fillRect(0, 0, cw, ch);

    const floorY = ch - 36;
    const floorGrad = ctx.createLinearGradient(0, floorY - 40, 0, ch);
    floorGrad.addColorStop(0, 'transparent');
    floorGrad.addColorStop(0.5, 'rgba(255, 136, 0, 0.06)');
    floorGrad.addColorStop(1, 'rgba(255, 136, 0, 0.12)');
    ctx.fillStyle = floorGrad;
    ctx.fillRect(0, floorY - 40, cw, ch - floorY + 40);

    ctx.strokeStyle = 'rgba(255, 136, 0, 0.25)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, floorY);
    ctx.lineTo(cw, floorY);
    ctx.stroke();

    ctx.strokeStyle = 'rgba(0, 255, 200, 0.04)';
    ctx.lineWidth = 1;
    for (let x = 0; x < cw; x += 24) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, ch);
        ctx.stroke();
    }
}

function drawSegmentLabel(ctx, centerX, midY, label, isSelected) {
    ctx.font = isSelected ? 'bold 11px monospace' : '10px monospace';
    ctx.textAlign = 'center';
    const tw = ctx.measureText(label).width + 10;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
    ctx.fillRect(centerX - tw / 2, midY - 8, tw, 16);
    ctx.fillStyle = isSelected ? '#0ff' : 'rgba(200, 220, 230, 0.75)';
    ctx.fillText(label, centerX, midY + 4);
}

function drawMarkerLine(ctx, y, centerX, halfW, color, label) {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(centerX - halfW - 12, y);
    ctx.lineTo(centerX + halfW + 12, y);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.beginPath();
    ctx.arc(centerX - halfW - 16, y, 3, 0, Math.PI * 2);
    ctx.arc(centerX + halfW + 16, y, 3, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();

    ctx.font = '10px monospace';
    ctx.textAlign = 'left';
    ctx.fillStyle = color;
    ctx.fillText(label, centerX + halfW + 22, y + 4);
    ctx.restore();
}

function drawLaunchPad(ctx, centerX, y, rocketWidth) {
    const padW = rocketWidth * 1.35;
    const x = centerX - padW / 2;
    ctx.fillStyle = 'rgba(40, 45, 50, 0.9)';
    ctx.fillRect(x, y, padW, 8);
    ctx.strokeStyle = 'rgba(255, 136, 0, 0.4)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, padW - 1, 7);
    for (let i = 1; i < 4; i++) {
        const lx = x + (padW * i) / 4;
        ctx.beginPath();
        ctx.moveTo(lx, y);
        ctx.lineTo(lx, y + 8);
        ctx.strokeStyle = 'rgba(255, 136, 0, 0.2)';
        ctx.stroke();
    }
}

/**
 * Draw hangar rocket view; returns segment bounds for hit-testing (same shape as before).
 */
const SNAP_SEGMENT_NAMES = ['S1', 'S2', 'PL', 'FN'];

const RULER_MARGIN_LEFT = 52;
const RULER_MARGIN_BOTTOM = 34;

/** Pick a readable tick interval (1, 2, 5, 10, …) for a given span in meters. */
function chooseRulerStep(spanM, targetTicks = 7) {
    if (spanM <= 0) return 1;
    const rough = spanM / targetTicks;
    const mag = Math.pow(10, Math.floor(Math.log10(rough)));
    const norm = rough / mag;
    let nice;
    if (norm <= 1) nice = 1;
    else if (norm <= 2) nice = 2;
    else if (norm <= 5) nice = 5;
    else nice = 10;
    return nice * mag;
}

function formatRulerLabel(m) {
    if (m >= 10) return `${Math.round(m)}`;
    if (m >= 1) return Number(m.toFixed(1)).toString();
    return m.toFixed(2);
}

/**
 * Vertical height ruler (0 m at pad, totalLength at nose) + horizontal max-width ruler.
 */
function drawHangarRulers(ctx, opts) {
    const {
        rocketTopY,
        rocketBottomY,
        centerX,
        halfW,
        totalLengthM,
        maxDiamM,
        padY,
    } = opts;

    const rulerX = centerX - halfW - 18;
    const heightPx = rocketBottomY - rocketTopY;
    const widthPx = halfW * 2;
    const widthLeft = centerX - halfW;
    const widthRight = centerX + halfW;
    const widthRulerY = padY + 6;

    const tickColor = 'rgba(255, 136, 0, 0.55)';
    const labelColor = 'rgba(255, 180, 100, 0.85)';
    const lineColor = 'rgba(255, 136, 0, 0.25)';

    ctx.save();
    ctx.strokeStyle = tickColor;
    ctx.fillStyle = labelColor;
    ctx.lineWidth = 1;
    ctx.font = '9px monospace';

    // Extension lines: height (left of rocket)
    ctx.setLineDash([3, 4]);
    ctx.strokeStyle = lineColor;
    ctx.beginPath();
    ctx.moveTo(widthLeft, rocketTopY);
    ctx.lineTo(rulerX - 4, rocketTopY);
    ctx.moveTo(widthLeft, rocketBottomY);
    ctx.lineTo(rulerX - 4, rocketBottomY);
    ctx.stroke();
    ctx.setLineDash([]);

    // Vertical ruler spine + ticks
    ctx.strokeStyle = tickColor;
    ctx.beginPath();
    ctx.moveTo(rulerX, rocketTopY);
    ctx.lineTo(rulerX, rocketBottomY);
    ctx.stroke();

    const hStep = chooseRulerStep(totalLengthM);
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let m = 0; m <= totalLengthM + hStep * 0.001; m += hStep) {
        const t = totalLengthM > 0 ? m / totalLengthM : 0;
        const y = rocketBottomY - t * heightPx;
        ctx.beginPath();
        ctx.moveTo(rulerX - 7, y);
        ctx.lineTo(rulerX, y);
        ctx.stroke();
        ctx.fillText(formatRulerLabel(m), rulerX - 9, y);
    }

    // Total height callout at top
    ctx.textAlign = 'right';
    ctx.font = 'bold 9px monospace';
    ctx.fillText(`${totalLengthM.toFixed(1)} m`, rulerX - 9, rocketTopY - 8);
    ctx.font = '9px monospace';

    // Extension lines: width (below rocket)
    ctx.strokeStyle = lineColor;
    ctx.setLineDash([3, 4]);
    ctx.beginPath();
    ctx.moveTo(widthLeft, rocketBottomY);
    ctx.lineTo(widthLeft, widthRulerY + 10);
    ctx.moveTo(widthRight, rocketBottomY);
    ctx.lineTo(widthRight, widthRulerY + 10);
    ctx.stroke();
    ctx.setLineDash([]);

    // Horizontal width ruler (centered on rocket, max diameter span)
    ctx.strokeStyle = tickColor;
    ctx.beginPath();
    ctx.moveTo(widthLeft, widthRulerY);
    ctx.lineTo(widthRight, widthRulerY);
    ctx.stroke();

    // End caps
    ctx.beginPath();
    ctx.moveTo(widthLeft, widthRulerY - 4);
    ctx.lineTo(widthLeft, widthRulerY + 4);
    ctx.moveTo(widthRight, widthRulerY - 4);
    ctx.lineTo(widthRight, widthRulerY + 4);
    ctx.stroke();

    const wStep = chooseRulerStep(maxDiamM);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (let m = 0; m <= maxDiamM + wStep * 0.001; m += wStep) {
        const t = maxDiamM > 0 ? m / maxDiamM : 0;
        const x = widthLeft + t * widthPx;
        ctx.beginPath();
        ctx.moveTo(x, widthRulerY);
        ctx.lineTo(x, widthRulerY + 5);
        ctx.stroke();
        ctx.fillText(formatRulerLabel(m), x, widthRulerY + 7);
    }

    ctx.font = 'bold 9px monospace';
    ctx.fillText(`Ø ${maxDiamM.toFixed(1)} m`, centerX, widthRulerY + 18);

    ctx.restore();
}

function drawDiameterSnapGuide(ctx, segments, snapState, scale, centerX) {
    if (!snapState || !segments.length) return;
    const fromSeg = segments.find((s) => s.segmentIndex === snapState.fromIndex);
    const toSeg = segments.find((s) => s.segmentIndex === snapState.toIndex);
    if (!fromSeg || !toSeg) return;

    const snapW = snapState.value * scale;
    const xLeft = centerX - snapW / 2;
    const xRight = centerX + snapW / 2;
    const yTop = Math.min(fromSeg.yTop, toSeg.yTop) - 6;
    const yBottom = Math.max(fromSeg.yBottom, toSeg.yBottom) + 6;

    ctx.save();
    ctx.strokeStyle = 'rgba(0, 255, 255, 0.9)';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(xLeft, yTop);
    ctx.lineTo(xLeft, yBottom);
    ctx.moveTo(xRight, yTop);
    ctx.lineTo(xRight, yBottom);
    ctx.stroke();

    const yJoin = (fromSeg.yBottom + toSeg.yTop) / 2;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(xLeft - 10, yJoin);
    ctx.lineTo(xLeft, yJoin);
    ctx.moveTo(xRight, yJoin);
    ctx.lineTo(xRight + 10, yJoin);
    ctx.stroke();

    ctx.font = 'bold 10px monospace';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#0ff';
    const fromName = SNAP_SEGMENT_NAMES[snapState.fromIndex] || '?';
    const toName = SNAP_SEGMENT_NAMES[snapState.toIndex] || '?';
    ctx.fillText(`SNAP · Ø ${snapState.value.toFixed(1)} m (${fromName} = ${toName})`, centerX, yTop - 4);
    ctx.restore();
}

export function drawHangarRocket(canvas, config, uiState) {
    const { selectedSegmentIndex, hoveredSegmentIndex, segmentPopupOpen, diameterSnapState } = uiState;
    const pad = 28;
    const cw = canvas.clientWidth || 0;
    const ch = canvas.clientHeight || 0;
    if (cw <= 0 || ch <= 0) return null;

    if (canvas.width !== cw || canvas.height !== ch) {
        canvas.width = cw;
        canvas.height = ch;
    }
    const ctx = canvas.getContext('2d');
    const stages = config.stages;
    const payload = config.payload;
    const fairing = config.fairing;
    const totalLength = config.totalLength || (stages[0].length + stages[1].length + payload.length + fairing.length);
    const maxDiam = Math.max(stages[0].diameter, stages[1].diameter, payload.diameter, fairing.diameter);
    const drawWidth = cw - 2 * pad - RULER_MARGIN_LEFT;
    const drawHeight = ch - 2 * pad - 12 - RULER_MARGIN_BOTTOM;
    if (drawWidth <= 0 || drawHeight <= 0 || totalLength <= 0) return null;

    const scale = Math.min(drawHeight / totalLength, drawWidth / maxDiam);
    const centerX = pad + RULER_MARGIN_LEFT + drawWidth / 2;
    const bottomPad = pad + 10;
    const drawHeightUsed = totalLength * scale;
    const halfW = (maxDiam * scale) / 2;

    drawHangarBackground(ctx, cw, ch);

    const segments = [];
    let zBottom = 0;

    const segDefs = [
        { length: stages[0].length, diameter: stages[0].diameter, pathLength: 'stages.0.length', pathDiameter: 'stages.0.diameter', segmentIndex: 0, stage: stages[0], kind: 'stage' },
        { length: stages[1].length, diameter: stages[1].diameter, pathLength: 'stages.1.length', pathDiameter: 'stages.1.diameter', segmentIndex: 1, stage: stages[1], kind: 'stage' },
        { length: payload.length, diameter: payload.diameter, pathLength: 'payload.length', pathDiameter: 'payload.diameter', segmentIndex: 2, kind: 'payload' },
        { length: fairing.length, diameter: fairing.diameter, pathLength: 'fairing.length', pathDiameter: 'fairing.diameter', segmentIndex: 3, kind: 'fairing' },
    ];

    const padY = bottomPad + drawHeightUsed;

    for (let si = 0; si < segDefs.length; si++) {
        const seg = segDefs[si];
        const zTop = zBottom + seg.length;
        const yBottom = bottomPad + (1 - zBottom / totalLength) * drawHeightUsed;
        const yTop = bottomPad + (1 - zTop / totalLength) * drawHeightUsed;
        const segH = yBottom - yTop;
        const segW = seg.diameter * scale;
        const xLeft = centerX - segW / 2;
        const xRight = centerX + segW / 2;
        segments.push({
            bottom: zBottom,
            top: zTop,
            diameter: seg.diameter,
            pathLength: seg.pathLength,
            pathDiameter: seg.pathDiameter,
            yBottom,
            yTop,
            xLeft,
            xRight,
            segmentIndex: seg.segmentIndex,
        });

        const palette = SEGMENT_PALETTE[seg.segmentIndex];
        const isHighlight = seg.segmentIndex === selectedSegmentIndex || seg.segmentIndex === hoveredSegmentIndex;
        const isSelected = seg.segmentIndex === selectedSegmentIndex && segmentPopupOpen;
        const highlightState = { isSelected, isHighlight };

        if (si > 0) {
            drawInterstageRing(ctx, xLeft, yBottom, segW, palette);
        }

        if (seg.kind === 'fairing') {
            drawFairing(ctx, centerX, yTop, yBottom, xLeft, xRight, palette, highlightState);
        } else if (seg.kind === 'payload') {
            drawCylinderBody(ctx, xLeft, yTop, segW, segH, palette, highlightState);
            drawPayloadBay(ctx, xLeft, yTop, segW, segH);
        } else {
            const tankRatio = seg.stage.tankLengthRatio ?? 0.85;
            const engineLen = (seg.stage.engineLength ?? 2) * scale;
            const tankH = segH * tankRatio;
            const tankTop = yTop + (segH - tankH - engineLen);
            drawCylinderBody(ctx, xLeft, yTop, segW, segH, palette, highlightState);
            drawTankRegion(ctx, xLeft, Math.max(yTop, tankTop), segW, Math.max(0, tankH), palette.tank);
            drawEngineSection(ctx, centerX, yBottom, segW, engineLen, palette);
        }

        drawSegmentLabel(ctx, centerX, (yTop + yBottom) / 2, SEGMENT_LABELS[seg.segmentIndex], isSelected);
        zBottom = zTop;
    }

    drawDiameterSnapGuide(ctx, segments, diameterSnapState, scale, centerX);

    const rocketTopY = bottomPad;
    const rocketBottomY = bottomPad + drawHeightUsed;
    drawHangarRulers(ctx, {
        rocketTopY,
        rocketBottomY,
        centerX,
        halfW,
        totalLengthM: totalLength,
        maxDiamM: maxDiam,
        padY,
    });

    drawLaunchPad(ctx, centerX, padY, stages[0].diameter * scale);

    const cogData = calculateRocketCOGAtPad(config);
    const copPosition = calculateCenterOfPressure(0, totalLength);
    const cogY = bottomPad + (1 - cogData.cog / totalLength) * drawHeightUsed;
    const copY = bottomPad + (1 - copPosition / totalLength) * drawHeightUsed;
    drawMarkerLine(ctx, cogY, centerX, halfW, '#0f0', 'COG');
    drawMarkerLine(ctx, copY, centerX, halfW, '#fd0', 'CoP');

    const accelG = cogData.totalMass > 0 ? (stages[0].thrust / cogData.totalMass) / 9.81 : 0;
    ctx.font = '10px monospace';
    ctx.textAlign = 'right';
    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.fillRect(cw - pad - 130, pad - 2, 128, 16);
    ctx.fillStyle = accelG < 1 ? '#f66' : '#0f0';
    ctx.fillText(`Pad accel: ${accelG.toFixed(2)} g`, cw - pad, pad + 10);

    return {
        segments,
        pad,
        scale,
        centerX,
        drawHeight: drawHeightUsed,
        totalLength,
        bottomPad,
    };
}
