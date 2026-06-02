import { initRocketBuilder } from './rocketBuilder.js';
import { updateRocketSummary } from './rocketSummary.js';
import { initHangarTutorial } from './hangarTutorial.js';

const hangarSummary = document.getElementById('hangar-summary');
const hamburger = document.getElementById('hangar-hamburger');
const drawer = document.getElementById('hangar-menu-drawer');
const backdrop = document.getElementById('hangar-backdrop');
const drawerClose = document.getElementById('hangar-drawer-close');

function refreshSummary() {
    updateRocketSummary(hangarSummary || document);
}

function setDrawerOpen(open) {
    drawer?.classList.toggle('open', open);
    backdrop?.toggleAttribute('hidden', !open);
    hamburger?.classList.toggle('active', open);
    hamburger?.setAttribute('aria-expanded', open ? 'true' : 'false');
}

hamburger?.addEventListener('click', () => {
    setDrawerOpen(!drawer?.classList.contains('open'));
});

drawerClose?.addEventListener('click', () => setDrawerOpen(false));
backdrop?.addEventListener('click', () => setDrawerOpen(false));

initRocketBuilder({
    hangarMode: true,
    onConfigChange: refreshSummary,
});

refreshSummary();

initHangarTutorial({ setDrawerOpen });
