import { state } from './state.js';

function getPanel() {
    return document.getElementById('structural-panel');
}

function getDock() {
    return document.getElementById('telemetry-structural-dock');
}

function getFloatRoot() {
    return document.getElementById('structural-panel-float-root');
}

function updateDockButton() {
    const btn = document.getElementById('structural-panel-dock-btn');
    if (!btn) return;
    if (state.structuralPanelDocked) {
        btn.title = 'Pop out panel';
        btn.textContent = '⧉';
    } else {
        btn.title = 'Dock in telemetry';
        btn.textContent = '⊟';
    }
}

function applyFloatingPosition() {
    const panel = getPanel();
    if (!panel || state.structuralPanelDocked) return;
    const { x, y } = state.structuralPanelPosition;
    panel.style.left = `${x}px`;
    panel.style.top = `${y}px`;
}

/** Default slot: directly under the telemetry panel (FLIGHT / STRUCTURE tabs). */
function computeDefaultFloatingPosition() {
    const panel = getPanel();
    const telemetry = document.getElementById('telemetry');
    const gap = 8;
    const margin = 8;
    const fallback = { x: margin, y: 120 };

    if (!telemetry) {
        return panel ? clampPanelPosition(fallback.x, fallback.y, panel) : fallback;
    }

    const rect = telemetry.getBoundingClientRect();
    const x = rect.left;
    const y = rect.bottom + gap;
    return panel ? clampPanelPosition(x, y, panel) : { x, y };
}

function snapBelowTelemetry() {
    state.structuralPanelPosition = computeDefaultFloatingPosition();
    applyFloatingPosition();
}

function setDocked(docked) {
    const panel = getPanel();
    const dock = getDock();
    const floatRoot = getFloatRoot();
    if (!panel || !dock || !floatRoot) return;

    state.structuralPanelDocked = docked;

    if (docked) {
        panel.classList.remove('structural-panel--floating');
        panel.classList.add('structural-panel--docked');
        panel.style.left = '';
        panel.style.top = '';
        if (panel.parentElement !== dock) {
            dock.appendChild(panel);
        }
    } else {
        panel.classList.remove('structural-panel--docked');
        panel.classList.add('structural-panel--floating');
        if (panel.parentElement !== floatRoot) {
            floatRoot.appendChild(panel);
        }
        snapBelowTelemetry();
    }

    updateDockButton();
}

function clampPanelPosition(x, y, panel) {
    const margin = 8;
    const w = panel.offsetWidth || 280;
    const h = panel.offsetHeight || 400;
    const maxX = Math.max(margin, window.innerWidth - w - margin);
    const maxY = Math.max(margin, window.innerHeight - h - margin);
    return {
        x: Math.min(maxX, Math.max(margin, x)),
        y: Math.min(maxY, Math.max(margin, y))
    };
}

function canStartPanelDrag(e) {
    if (state.structuralPanelDocked) return false;
    if (e.target.closest('.structural-panel-dock-btn')) return false;
    if (e.target.closest('button')) return false;
    return true;
}

function setupDrag() {
    const panel = getPanel();
    if (!panel) return;

    let drag = null;

    panel.addEventListener('pointerdown', (e) => {
        if (!canStartPanelDrag(e)) return;

        const rect = panel.getBoundingClientRect();
        drag = {
            pointerId: e.pointerId,
            offsetX: e.clientX - rect.left,
            offsetY: e.clientY - rect.top
        };
        panel.setPointerCapture(e.pointerId);
        document.body.classList.add('structural-panel-dragging');
        e.preventDefault();
    });

    panel.addEventListener('pointermove', (e) => {
        if (!drag || e.pointerId !== drag.pointerId) return;
        const pos = clampPanelPosition(
            e.clientX - drag.offsetX,
            e.clientY - drag.offsetY,
            panel
        );
        state.structuralPanelPosition = pos;
        panel.style.left = `${pos.x}px`;
        panel.style.top = `${pos.y}px`;
    });

    const endDrag = (e) => {
        if (!drag || e.pointerId !== drag.pointerId) return;
        drag = null;
        document.body.classList.remove('structural-panel-dragging');
        try {
            panel.releasePointerCapture(e.pointerId);
        } catch (_) { /* already released */ }
    };

    panel.addEventListener('pointerup', endDrag);
    panel.addEventListener('pointercancel', endDrag);
}

/**
 * Show dock slot vs floating panel depending on telemetry tab and dock state.
 * @param {boolean} structuralTabActive - STRUCTURE tab is selected
 */
export function updateStructuralPanelVisibility(structuralTabActive) {
    const dock = getDock();
    const panel = getPanel();
    if (!dock || !panel) return;

    if (structuralTabActive && state.structuralPanelDocked) {
        dock.hidden = false;
    } else {
        dock.hidden = true;
    }

    panel.hidden = false;
    updateDockButton();
}

export function initStructuralPanel() {
    const dockBtn = document.getElementById('structural-panel-dock-btn');
    if (!getPanel() || !getDock()) return;

    setDocked(state.structuralPanelDocked);
    updateStructuralPanelVisibility(state.telemetryTab === 'structural');
    setupDrag();

    dockBtn?.addEventListener('click', (e) => {
        e.stopPropagation();
        const nextDocked = !state.structuralPanelDocked;
        setDocked(nextDocked);
        updateStructuralPanelVisibility(state.telemetryTab === 'structural');
    });

    window.addEventListener('resize', () => {
        if (!state.structuralPanelDocked) {
            const panel = getPanel();
            if (!panel) return;
            const pos = clampPanelPosition(
                state.structuralPanelPosition.x,
                state.structuralPanelPosition.y,
                panel
            );
            state.structuralPanelPosition = pos;
            applyFloatingPosition();
        }
    });
}
