import { getRocketConfig, setRocketConfig, resetToDefault, getMaxPropellantForStage } from './rocketConfig.js';
import { drawHangarRocket } from './hangarRenderer.js';

let onConfigChange = null;

function applyConfig(config) {
    setRocketConfig(config);
    onConfigChange?.();
}

const SEGMENT_DEFS = [
    { index: 0, title: 'Stage 1', pathPrefix: 'stages.0.', shortLabel: 'S1' },
    { index: 1, title: 'Stage 2', pathPrefix: 'stages.1.', shortLabel: 'S2' },
    { index: 2, title: 'Payload', pathPrefix: 'payload.', shortLabel: 'PL' },
    { index: 3, title: 'Fairing', pathPrefix: 'fairing.', shortLabel: 'FN' },
];

const GLOBAL_PATHS = new Set(['fairingJettisonAlt', 'propellantDensity']);

const ROCKET_BUILDER_SCHEMA = [
    { path: 'stages.0.dryMass', label: 'Dry mass (kg)', min: 5000, max: 50000, step: 100, tab: 'basic' },
    { path: 'stages.0.thrust', label: 'Thrust SL (N)', min: 1e6, max: 15e6, step: 100000, tab: 'basic' },
    { path: 'stages.0.thrustVac', label: 'Thrust vac (N)', min: 1e6, max: 15e6, step: 100000, tab: 'basic' },
    { path: 'stages.0.diameter', label: 'Diameter (m)', min: 2, max: 6, step: 0.1, tab: 'basic' },
    { path: 'stages.0.length', label: 'Length (m)', min: 20, max: 60, step: 1, tab: 'basic' },
    { path: 'stages.0.propellantMass', label: 'Propellant (kg)', min: 100000, max: 600000, step: 1000, tab: 'basic', locked: true },
    { path: 'stages.0.isp', label: 'Isp SL (s)', min: 250, max: 350, step: 1, tab: 'advanced' },
    { path: 'stages.0.ispVac', label: 'Isp vac (s)', min: 280, max: 380, step: 1, tab: 'advanced' },
    { path: 'stages.0.tankLengthRatio', label: 'Tank ratio', min: 0.5, max: 0.95, step: 0.01, tab: 'advanced' },
    { path: 'stages.0.engineLength', label: 'Engine length (m)', min: 1, max: 5, step: 0.1, tab: 'advanced' },
    { path: 'stages.0.dryMassEngineFraction', label: 'Engine mass frac', min: 0.3, max: 0.8, step: 0.05, tab: 'advanced' },
    { path: 'stages.0.gimbalMaxAngle', label: 'Gimbal max (°)', min: 1, max: 15, step: 0.5, tab: 'advanced' },
    { path: 'stages.0.gimbalRate', label: 'Gimbal rate (°/s)', min: 5, max: 30, step: 0.5, tab: 'advanced' },
    { path: 'stages.0.gimbalPoint', label: 'Gimbal point (m)', min: 0.2, max: 1.5, step: 0.1, tab: 'advanced' },
    { path: 'stages.1.dryMass', label: 'Dry mass (kg)', min: 1000, max: 8000, step: 100, tab: 'basic' },
    { path: 'stages.1.thrust', label: 'Thrust SL (N)', min: 100000, max: 2e6, step: 10000, tab: 'basic' },
    { path: 'stages.1.thrustVac', label: 'Thrust vac (N)', min: 100000, max: 2e6, step: 10000, tab: 'basic' },
    { path: 'stages.1.diameter', label: 'Diameter (m)', min: 2, max: 6, step: 0.1, tab: 'basic' },
    { path: 'stages.1.length', label: 'Length (m)', min: 5, max: 25, step: 0.5, tab: 'basic' },
    { path: 'stages.1.propellantMass', label: 'Propellant (kg)', min: 20000, max: 150000, step: 500, tab: 'basic', locked: true },
    { path: 'stages.1.isp', label: 'Isp SL (s)', min: 300, max: 360, step: 1, tab: 'advanced' },
    { path: 'stages.1.ispVac', label: 'Isp vac (s)', min: 320, max: 380, step: 1, tab: 'advanced' },
    { path: 'stages.1.tankLengthRatio', label: 'Tank ratio', min: 0.5, max: 0.95, step: 0.01, tab: 'advanced' },
    { path: 'stages.1.engineLength', label: 'Engine length (m)', min: 0.5, max: 4, step: 0.1, tab: 'advanced' },
    { path: 'stages.1.dryMassEngineFraction', label: 'Engine mass frac', min: 0.3, max: 0.8, step: 0.05, tab: 'advanced' },
    { path: 'stages.1.gimbalMaxAngle', label: 'Gimbal max (°)', min: 1, max: 15, step: 0.5, tab: 'advanced' },
    { path: 'stages.1.gimbalRate', label: 'Gimbal rate (°/s)', min: 5, max: 25, step: 0.5, tab: 'advanced' },
    { path: 'stages.1.gimbalPoint', label: 'Gimbal point (m)', min: 0.2, max: 1, step: 0.1, tab: 'advanced' },
    { path: 'payload.mass', label: 'Mass (kg)', min: 1000, max: 30000, step: 500, tab: 'basic' },
    { path: 'payload.length', label: 'Length (m)', min: 2, max: 15, step: 0.5, tab: 'basic' },
    { path: 'payload.diameter', label: 'Diameter (m)', min: 2, max: 6, step: 0.1, tab: 'basic' },
    { path: 'fairing.mass', label: 'Mass (kg)', min: 500, max: 3000, step: 50, tab: 'basic' },
    { path: 'fairing.length', label: 'Length (m)', min: 2, max: 10, step: 0.5, tab: 'basic' },
    { path: 'fairing.diameter', label: 'Diameter (m)', min: 2, max: 6, step: 0.1, tab: 'basic' },
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

let rocketBuilderDiagramState = {
    segments: [],
    pad: 0,
    scale: 0,
    centerX: 0,
    drawHeight: 0,
    totalLength: 0,
    bottomPad: 0,
};

let rocketBuilderActiveHandle = null;
let selectedSegmentIndex = null;
let hoveredSegmentIndex = null;
let segmentPopupTab = 'basic';
let segmentPopupOpen = false;

const BOUNDARY_HIT_PX = 8;
const DIAMETER_HIT_PX = 10;
/** Minimum half-width (px) for clicking a segment body (visual can be thinner). */
const MIN_SEGMENT_BODY_HIT_HALF_PX = 18;
/** Segments narrower than this on canvas skip edge drag (use drawers / popup to edit width). */
const MIN_SEG_WIDTH_FOR_DIAMETER_DRAG_PX = 24;

/** How much mouse movement affects size (lower = less sensitive). */
const DIAMETER_DRAG_SENSITIVITY = 0.4;
const LENGTH_DRAG_SENSITIVITY = 0.55;

/** Snap width to another section when within this many canvas pixels. */
const SNAP_DIAMETER_PX = 2;

/** Set while diameter drag is magnetically snapped (for guide drawing). */
let diameterSnapState = null;

function getDiameterSnapTargets(segmentIndex, config) {
    const targets = [];
    const add = (index, diameter) => {
        if (index !== segmentIndex && typeof diameter === 'number') {
            targets.push({ index, diameter });
        }
    };
    add(0, config.stages[0]?.diameter);
    add(1, config.stages[1]?.diameter);
    add(2, config.payload?.diameter);
    add(3, config.fairing?.diameter);
    return targets;
}

function snapDiameterToTargets(rawDiam, targets, thresholdM) {
    let best = null;
    let bestDist = thresholdM;
    for (const t of targets) {
        const dist = Math.abs(rawDiam - t.diameter);
        if (dist <= bestDist) {
            bestDist = dist;
            best = t;
        }
    }
    if (best) {
        return { diameter: best.diameter, snapTarget: best };
    }
    return { diameter: rawDiam, snapTarget: null };
}

function beginDragHandle(handle, offsetX, offsetY) {
    const config = getRocketConfig();
    const seg = rocketBuilderDiagramState.segments[handle.segmentIndex];
    return {
        ...handle,
        startMouseX: offsetX,
        startMouseY: offsetY,
        startDiameter: seg.diameter,
        startLength: getByPath(config, seg.pathLength),
    };
}

function getSchemaEntry(path) {
    return ROCKET_BUILDER_SCHEMA.find((e) => e.path === path);
}

function schemaForSegment(segmentIndex, tab) {
    const prefix = SEGMENT_DEFS[segmentIndex]?.pathPrefix;
    if (!prefix) return [];
    return ROCKET_BUILDER_SCHEMA.filter((e) => e.path.startsWith(prefix) && e.tab === tab);
}

function globalSchema() {
    return ROCKET_BUILDER_SCHEMA.filter((e) => GLOBAL_PATHS.has(e.path));
}

function formatOneDecimal(num) {
    const n = typeof num === 'number' ? num : parseFloat(num);
    return isNaN(n) ? '' : Number(n).toFixed(1);
}

function syncBuilderInput(path, value, root = document) {
    const num = typeof value === 'number' ? value : parseFloat(value);
    const str = formatOneDecimal(num);
    const inputs = root === document
        ? document.querySelectorAll(`[data-path="${path}"]`)
        : root.querySelectorAll(`[data-path="${path}"]`);
    const active = document.activeElement;
    inputs.forEach((input) => {
        if (input === active) return;
        input.value = str;
        const valSpan = input.parentElement?.querySelector('.rocket-builder-value');
        if (valSpan) valSpan.textContent = str;
    });
}

function attachBuilderInputBehavior(input) {
    if (input.disabled) return;

    input.addEventListener('focus', () => {
        requestAnimationFrame(() => input.select());
    });

    input.addEventListener('keydown', (e) => {
        if (e.metaKey || e.ctrlKey || e.altKey || e.key.length > 1) return;
        if (!/^[\d.-]$/.test(e.key)) return;
        const v = input.value.trim();
        if (v === '' || v === '-' || v === '.') return;
        const n = parseFloat(v);
        if (isNaN(n) || n !== 0) return;
        const start = input.selectionStart ?? 0;
        const end = input.selectionEnd ?? 0;
        if (start !== end) return;
        if (e.key === '.' || e.key === '-') return;
        input.value = '';
    });
}

function syncAllBuilderInputs(config = getRocketConfig()) {
    ROCKET_BUILDER_SCHEMA.forEach((entry) => {
        const val = entry.locked && entry.path.startsWith('stages.') && entry.path.endsWith('.propellantMass')
            ? getMaxPropellantForStage(config.stages[entry.path === 'stages.0.propellantMass' ? 0 : 1], config.propellantDensity ?? 923)
            : getByPath(config, entry.path);
        if (typeof val === 'number') syncBuilderInput(entry.path, val);
    });
}

function collectFormValues() {
    const byPath = new Map();
    const ingest = (root) => {
        if (!root) return;
        root.querySelectorAll('[data-path]').forEach((input) => {
            if (input.value === '') return;
            const num = parseFloat(input.value);
            if (!isNaN(num)) byPath.set(input.dataset.path, num);
        });
    };
    ingest(document.getElementById('hangar-segment-drawers'));
    ingest(document.getElementById('hangar-global-fields'));
    if (segmentPopupOpen) ingest(document.getElementById('segment-popup-content'));
    return byPath;
}

function drawRocketBuilderDiagram() {
    const canvas = document.getElementById('rocket-builder-canvas');
    if (!canvas) return;
    const state = drawHangarRocket(canvas, getRocketConfig(), {
        selectedSegmentIndex,
        hoveredSegmentIndex,
        segmentPopupOpen,
        diameterSnapState,
    });
    if (state) rocketBuilderDiagramState = state;
}

function toCanvasCoords(canvas, e) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / (rect.width || 1);
    const scaleY = canvas.height / (rect.height || 1);
    return {
        x: (e.clientX - rect.left) * scaleX,
        y: (e.clientY - rect.top) * scaleY,
        clientX: e.clientX,
        clientY: e.clientY,
    };
}

function hitTestDragHandle(offsetX, offsetY) {
    const st = rocketBuilderDiagramState;
    if (!st.segments.length) return null;
    for (let i = 0; i < st.segments.length; i++) {
        const seg = st.segments[i];
        if (Math.abs(offsetY - seg.yTop) <= BOUNDARY_HIT_PX && offsetX >= seg.xLeft - 12 && offsetX <= seg.xRight + 12) {
            return { type: 'boundary', segmentIndex: i };
        }
    }
    for (let i = 0; i < st.segments.length; i++) {
        const seg = st.segments[i];
        const segW = seg.xRight - seg.xLeft;
        if (segW < MIN_SEG_WIDTH_FOR_DIAMETER_DRAG_PX) continue;
        const inY = offsetY >= seg.yTop && offsetY <= seg.yBottom;
        if (inY && offsetX >= seg.xLeft - DIAMETER_HIT_PX && offsetX <= seg.xLeft + DIAMETER_HIT_PX) {
            return { type: 'diameter', segmentIndex: i, side: 'left' };
        }
        if (inY && offsetX >= seg.xRight - DIAMETER_HIT_PX && offsetX <= seg.xRight + DIAMETER_HIT_PX) {
            return { type: 'diameter', segmentIndex: i, side: 'right' };
        }
    }
    return null;
}

function hitTestSegmentBody(offsetX, offsetY) {
    const st = rocketBuilderDiagramState;
    for (let i = st.segments.length - 1; i >= 0; i--) {
        const seg = st.segments[i];
        if (offsetY < seg.yTop || offsetY > seg.yBottom) continue;
        if (Math.abs(offsetY - seg.yTop) <= BOUNDARY_HIT_PX) continue;

        const cx = (seg.xLeft + seg.xRight) / 2;
        const halfHit = Math.max((seg.xRight - seg.xLeft) / 2, MIN_SEGMENT_BODY_HIT_HALF_PX);
        if (offsetX < cx - halfHit || offsetX > cx + halfHit) continue;

        const segW = seg.xRight - seg.xLeft;
        if (segW >= MIN_SEG_WIDTH_FOR_DIAMETER_DRAG_PX) {
            if (offsetX <= seg.xLeft + DIAMETER_HIT_PX || offsetX >= seg.xRight - DIAMETER_HIT_PX) continue;
        }

        return i;
    }
    return null;
}

function applyDragHandle(handle, offsetX, offsetY) {
    const st = rocketBuilderDiagramState;
    const config = JSON.parse(JSON.stringify(getRocketConfig()));
    const seg = st.segments[handle.segmentIndex];
    const entryLen = getSchemaEntry(seg.pathLength);
    const entryDiam = getSchemaEntry(seg.pathDiameter);

    if (handle.type === 'boundary') {
        diameterSnapState = null;
        const deltaY = offsetY - handle.startMouseY;
        const deltaZ = -(deltaY / st.drawHeight) * st.totalLength * LENGTH_DRAG_SENSITIVITY;
        let newLength = handle.startLength + deltaZ;
        if (entryLen) {
            newLength = Math.max(Number(entryLen.min), Math.min(Number(entryLen.max), newLength));
        }
        setByPath(config, seg.pathLength, newLength);
        const si = handle.segmentIndex;
        if (si <= 1) {
            config.stages[si].propellantMass = getMaxPropellantForStage(config.stages[si], config.propellantDensity ?? 923);
        }
        applyConfig(config);
        if (segmentPopupOpen && selectedSegmentIndex === handle.segmentIndex) {
            populateSegmentPopupContent(segmentPopupTab);
        }
    } else {
        const deltaPx = offsetX - handle.startMouseX;
        const deltaDiam = (2 * deltaPx / st.scale) * DIAMETER_DRAG_SENSITIVITY;
        const sign = handle.side === 'right' ? 1 : -1;
        let newDiam = handle.startDiameter + sign * deltaDiam;
        if (entryDiam) {
            newDiam = Math.max(Number(entryDiam.min), Math.min(Number(entryDiam.max), newDiam));
        }
        const snapThresholdM = SNAP_DIAMETER_PX / st.scale;
        const snapTargets = getDiameterSnapTargets(handle.segmentIndex, config);
        const { diameter: snappedDiam, snapTarget } = snapDiameterToTargets(newDiam, snapTargets, snapThresholdM);
        newDiam = snappedDiam;
        diameterSnapState = snapTarget
            ? { value: snappedDiam, fromIndex: snapTarget.index, toIndex: handle.segmentIndex }
            : null;
        setByPath(config, seg.pathDiameter, newDiam);
        const si = handle.segmentIndex;
        if (si <= 1) {
            config.stages[si].propellantMass = getMaxPropellantForStage(config.stages[si], config.propellantDensity ?? 923);
        }
        applyConfig(config);
        if (segmentPopupOpen && selectedSegmentIndex === handle.segmentIndex) {
            populateSegmentPopupContent(segmentPopupTab);
        }
    }
    syncAllBuilderInputs(config);
    drawRocketBuilderDiagram();
}

function buildFormRows(container, entries, config, rowClassName = 'rocket-builder-row') {
    container.innerHTML = '';
    entries.forEach((entry) => {
        const { path, label, min, max, step } = entry;
        const val = entry.locked && path.startsWith('stages.') && path.endsWith('.propellantMass')
            ? getMaxPropellantForStage(config.stages[path === 'stages.0.propellantMass' ? 0 : 1], config.propellantDensity ?? 923)
            : getByPath(config, path);
        const row = document.createElement('div');
        row.className = rowClassName;
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
        if (entry.locked) {
            input.disabled = true;
            input.readOnly = true;
            input.title = 'Calculated from tank volume (length × diameter)';
        }
        const disp = formatOneDecimal(typeof val === 'number' ? val : 0);
        input.value = disp;
        attachBuilderInputBehavior(input);
        input.addEventListener('input', () => updateConfigFromForms());
        input.addEventListener('change', () => formatBuilderInputElement(input));
        const valSpan = document.createElement('span');
        valSpan.className = 'rocket-builder-value';
        valSpan.textContent = disp;
        row.appendChild(labelEl);
        row.appendChild(input);
        row.appendChild(valSpan);
        container.appendChild(row);
    });
}

function formatBuilderInputElement(input) {
    const valSpan = input.parentElement?.querySelector('.rocket-builder-value');
    const str = formatOneDecimal(input.value);
    input.value = str;
    if (valSpan) valSpan.textContent = str;
}

function applyFormFormatting(root) {
    root.querySelectorAll('[data-path]').forEach((input) => formatBuilderInputElement(input));
}

function updateConfigFromForms() {
    const config = JSON.parse(JSON.stringify(getRocketConfig()));
    collectFormValues().forEach((num, path) => setByPath(config, path, num));
    const density = config.propellantDensity ?? 923;
    for (let i = 0; i < config.stages.length; i++) {
        config.stages[i].propellantMass = getMaxPropellantForStage(config.stages[i], density);
    }
    applyConfig(config);
    syncAllBuilderInputs(config);
    drawRocketBuilderDiagram();
}

function positionSegmentPopup(clientX, clientY) {
    const popup = document.getElementById('segment-popup');
    if (!popup) return;
    const w = 300;
    const h = 380;
    const margin = 12;
    let left = clientX + margin;
    let top = clientY + margin;
    left = Math.min(Math.max(margin, left), window.innerWidth - w - margin);
    top = Math.min(Math.max(margin, top), window.innerHeight - h - margin);
    popup.style.left = `${left}px`;
    popup.style.top = `${top}px`;
}

function setActiveSegmentDrawer(segmentIndex) {
    document.querySelectorAll('.hangar-segment-drawer').forEach((el) => {
        const idx = Number(el.dataset.segmentIndex);
        const active = idx === segmentIndex;
        el.open = active;
        el.classList.toggle('hangar-segment-drawer--active', active);
    });
}

function openSegmentPopup(segmentIndex, clientX, clientY, tab = 'basic') {
    selectedSegmentIndex = segmentIndex;
    segmentPopupOpen = true;
    segmentPopupTab = tab;
    const popup = document.getElementById('segment-popup');
    const title = document.getElementById('segment-popup-title');
    if (title) title.textContent = SEGMENT_DEFS[segmentIndex]?.title || 'Section';
    positionSegmentPopup(clientX, clientY);
    if (popup) popup.removeAttribute('hidden');
    populateSegmentPopupContent(tab);
    setActiveSegmentDrawer(segmentIndex);
    drawRocketBuilderDiagram();
}

function openSegmentAdvancedPanel(segmentIndex) {
    const canvas = document.getElementById('rocket-builder-canvas');
    const cx = canvas ? canvas.getBoundingClientRect().left + canvas.getBoundingClientRect().width / 2 : window.innerWidth / 2;
    const cy = canvas ? canvas.getBoundingClientRect().top + canvas.getBoundingClientRect().height / 2 : window.innerHeight / 2;
    if (schemaForSegment(segmentIndex, 'advanced').length === 0) {
        openSegmentPopup(segmentIndex, cx, cy, 'basic');
        return;
    }
    openSegmentPopup(segmentIndex, cx, cy, 'advanced');
}

function closeSegmentPopup() {
    segmentPopupOpen = false;
    document.getElementById('segment-popup')?.setAttribute('hidden', '');
    const openDrawer = document.querySelector('.hangar-segment-drawer[open]');
    selectedSegmentIndex = openDrawer ? Number(openDrawer.dataset.segmentIndex) : null;
    document.querySelectorAll('.hangar-segment-drawer').forEach((el) => {
        el.classList.toggle('hangar-segment-drawer--active', el === openDrawer);
    });
    drawRocketBuilderDiagram();
}

function populateSegmentPopupContent(tab) {
    if (selectedSegmentIndex === null) return;
    segmentPopupTab = tab;
    const content = document.getElementById('segment-popup-content');
    if (!content) return;
    const config = getRocketConfig();
    const entries = schemaForSegment(selectedSegmentIndex, tab);
    buildFormRows(content, entries, config);
    document.querySelectorAll('.segment-popup-tab').forEach((btn) => btn.classList.remove('active'));
    document.getElementById(`segment-popup-tab-${tab}`)?.classList.add('active');
}

function populateGlobalFields() {
    const container = document.getElementById('hangar-global-fields');
    if (!container) return;
    buildFormRows(container, globalSchema(), getRocketConfig());
}

function populateHangarSegmentDrawers() {
    const config = getRocketConfig();
    SEGMENT_DEFS.forEach(({ index, title }) => {
        const body = document.getElementById(`hangar-drawer-body-${index}`);
        if (!body) return;
        buildFormRows(body, schemaForSegment(index, 'basic'), config, 'hangar-drawer-row');
        const moreBtn = document.querySelector(`.hangar-drawer-more-btn[data-segment-index="${index}"]`);
        if (moreBtn) {
            moreBtn.style.display = schemaForSegment(index, 'advanced').length > 0 ? '' : 'none';
        }
    });
}

function initHangarSegmentDrawers() {
    populateHangarSegmentDrawers();

    document.querySelectorAll('.hangar-drawer-more-btn').forEach((btn) => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            openSegmentAdvancedPanel(Number(btn.dataset.segmentIndex));
        });
    });

    document.querySelectorAll('.hangar-segment-drawer').forEach((drawer) => {
        drawer.addEventListener('toggle', () => {
            if (!drawer.open) return;
            const idx = Number(drawer.dataset.segmentIndex);
            document.querySelectorAll('.hangar-segment-drawer').forEach((other) => {
                if (other !== drawer) other.open = false;
            });
            selectedSegmentIndex = idx;
            hoveredSegmentIndex = idx;
            drawRocketBuilderDiagram();
        });
    });
}

function initHangarCanvas() {
    const canvas = document.getElementById('rocket-builder-canvas');
    const wrap = document.getElementById('hangar-canvas-wrap');
    if (!canvas || !wrap) return;

    const sizeAndDraw = () => {
        drawRocketBuilderDiagram();
    };
    sizeAndDraw();
    new ResizeObserver(sizeAndDraw).observe(wrap);

    canvas.addEventListener('mousedown', (e) => {
        const { x, y, clientX, clientY } = toCanvasCoords(canvas, e);
        const handle = hitTestDragHandle(x, y);
        if (handle) {
            rocketBuilderActiveHandle = beginDragHandle(handle, x, y);
            e.preventDefault();
            return;
        }
        const segIdx = hitTestSegmentBody(x, y);
        if (segIdx !== null) {
            openSegmentPopup(segIdx, clientX, clientY);
            e.preventDefault();
            return;
        }
        closeSegmentPopup();
    });

    canvas.addEventListener('mousemove', (e) => {
        const { x, y } = toCanvasCoords(canvas, e);
        if (rocketBuilderActiveHandle) {
            document.body.style.cursor = rocketBuilderActiveHandle.type === 'boundary' ? 'ns-resize' : 'ew-resize';
            document.body.style.userSelect = 'none';
            applyDragHandle(rocketBuilderActiveHandle, x, y);
            return;
        }
        const handle = hitTestDragHandle(x, y);
        if (handle) {
            canvas.style.cursor = handle.type === 'boundary' ? 'ns-resize' : 'ew-resize';
            hoveredSegmentIndex = null;
            drawRocketBuilderDiagram();
            return;
        }
        const segIdx = hitTestSegmentBody(x, y);
        hoveredSegmentIndex = segIdx;
        canvas.style.cursor = segIdx !== null ? 'pointer' : 'default';
        drawRocketBuilderDiagram();
    });

    const endDrag = () => {
        if (rocketBuilderActiveHandle) {
            rocketBuilderActiveHandle = null;
            diameterSnapState = null;
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            applyFormFormatting(document.getElementById('segment-popup-content') || document);
            syncAllBuilderInputs();
            drawRocketBuilderDiagram();
        }
    };
    document.addEventListener('mouseup', endDrag);
    canvas.addEventListener('mouseleave', () => {
        if (!rocketBuilderActiveHandle) {
            hoveredSegmentIndex = null;
            canvas.style.cursor = 'default';
            drawRocketBuilderDiagram();
        }
    });
}

function initHangarBuilder() {
    populateGlobalFields();
    initHangarSegmentDrawers();
    initHangarCanvas();

    document.getElementById('segment-popup-close')?.addEventListener('click', closeSegmentPopup);
    document.getElementById('segment-popup-tab-basic')?.addEventListener('click', () => populateSegmentPopupContent('basic'));
    document.getElementById('segment-popup-tab-advanced')?.addEventListener('click', () => populateSegmentPopupContent('advanced'));

    document.getElementById('rocket-builder-reset-btn')?.addEventListener('click', () => {
        resetToDefault();
        closeSegmentPopup();
        populateGlobalFields();
        populateHangarSegmentDrawers();
        onConfigChange?.();
        drawRocketBuilderDiagram();
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeSegmentPopup();
    });
}

export function setHangarTutorialHighlight(segmentIndex) {
    segmentPopupOpen = false;
    document.getElementById('segment-popup')?.setAttribute('hidden', '');
    selectedSegmentIndex = segmentIndex;
    hoveredSegmentIndex = segmentIndex;
    setActiveSegmentDrawer(segmentIndex);
    drawRocketBuilderDiagram();
}

export function clearHangarTutorialHighlight() {
    hoveredSegmentIndex = null;
    selectedSegmentIndex = null;
    document.querySelectorAll('.hangar-segment-drawer').forEach((el) => {
        el.classList.remove('hangar-segment-drawer--active');
    });
    drawRocketBuilderDiagram();
}

export function initRocketBuilder(options = {}) {
    onConfigChange = options.onConfigChange ?? null;
    if (options.hangarMode || document.body.classList.contains('hangar-page')) {
        initHangarBuilder();
    }
}
