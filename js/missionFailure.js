import { state, resetCurrentMission } from './state.js';
import { isChallengeActive } from './challenge.js';
import { resetGuidance } from './guidance.js';
import { resetCubicGuidance } from './cubicGuidance.js';
import { updateTelemetry } from './telemetry.js';

let failureDialogOpen = false;

const FAILURE_COPY = {
    impact: {
        title: 'MISSION FAILURE',
        message: 'Ground impact — vehicle destroyed.',
    },
    structural: {
        title: 'STRUCTURAL FAILURE',
        message: 'Vehicle lost — structural limits exceeded.',
    },
};

export function dismissMissionFailureDialog() {
    failureDialogOpen = false;
    state.failureReason = null;
    const dialog = document.getElementById('failure-dialog');
    if (dialog) {
        dialog.hidden = true;
        dialog.style.display = 'none';
    }
}

export function registerMissionFailure(reason) {
    if (failureDialogOpen || state.failureReason) return;
    // Only end a mission that is actively simulating (not paused / menu open).
    if (!state.running) return;

    state.running = false;
    state.failureReason = reason;
    state.engineOn = false;

    const copy = FAILURE_COPY[reason] || FAILURE_COPY.impact;
    const titleEl = document.getElementById('failure-dialog-title');
    const messageEl = document.getElementById('failure-dialog-message');
    const restartBtn = document.getElementById('failure-restart-btn');
    const altBtn = document.getElementById('failure-alt-btn');
    const challenge = isChallengeActive();

    if (titleEl) titleEl.textContent = copy.title;
    if (messageEl) messageEl.textContent = copy.message;
    if (restartBtn) {
        restartBtn.textContent = challenge ? 'RESTART FROM PAD' : 'RESTART';
    }
    if (altBtn) {
        altBtn.textContent = challenge ? 'GO TO HANGAR' : 'GO TO MENU';
    }

    const dialog = document.getElementById('failure-dialog');
    if (dialog) {
        dialog.hidden = false;
        dialog.style.display = 'flex';
    }
    failureDialogOpen = true;
}

function restoreLaunchControls() {
    const launchBtn = document.getElementById('launch-btn');
    const pauseBtn = document.getElementById('pause-btn');
    if (launchBtn) {
        launchBtn.disabled = false;
        launchBtn.style.display = state.gameMode === 'orbital' ? 'none' : 'inline-block';
    }
    if (pauseBtn) {
        pauseBtn.style.display = 'none';
        pauseBtn.textContent = 'PAUSE';
    }
    if (window.updateUIForMode) window.updateUIForMode();
    updateTelemetry();
}

function restartFromPad() {
    dismissMissionFailureDialog();
    resetCurrentMission();
    resetGuidance();
    if (state.gameMode === 'cubic') resetCubicGuidance();
    restoreLaunchControls();
}

function goToMenu() {
    dismissMissionFailureDialog();
    resetCurrentMission();
    resetGuidance();
    if (state.gameMode === 'cubic') resetCubicGuidance();
    restoreLaunchControls();
    if (typeof window.showMenu === 'function') {
        window.showMenu();
    }
}

function goToHangar() {
    dismissMissionFailureDialog();
    window.location.href = 'builder.html';
}

export function initMissionFailureDialog() {
    document.getElementById('failure-restart-btn')?.addEventListener('click', restartFromPad);
    document.getElementById('failure-alt-btn')?.addEventListener('click', () => {
        if (isChallengeActive()) {
            goToHangar();
        } else {
            goToMenu();
        }
    });
}
