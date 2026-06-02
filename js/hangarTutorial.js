import { setHangarTutorialHighlight, clearHangarTutorialHighlight } from './rocketBuilder.js';

const STORAGE_KEY = 'rocket-hangar-tutorial-v1';

const STEPS = [
    {
        selectors: ['#hangar-canvas-wrap', '.hangar-segment-drawer[data-segment-index="0"]'],
        cardAnchorSelectors: ['#hangar-canvas-wrap'],
        cardPlacement: 'left',
        title: 'Edit your rocket',
        text: 'Stage 1 is the booster at the bottom. Click it on the rocket—or use the Stage 1 panel—to change thrust, size, and mass. Drag section edges to resize.',
        onEnter: ({ setDrawerOpen }) => {
            setDrawerOpen(false);
            setHangarTutorialHighlight(0);
        },
    },
    {
        selectors: ['#hangar-hamburger'],
        title: 'Settings menu',
        text: 'Open the menu for global options (propellant density, fairing jettison altitude) and to reset your design to defaults.',
        onEnter: ({ setDrawerOpen }) => {
            setDrawerOpen(false);
            clearHangarTutorialHighlight();
        },
    },
    {
        selectors: ['#hangar-launch-btn'],
        title: 'Ready to fly',
        text: 'When your vehicle looks good, open the menu and choose Proceed to Launch Pad to fly your custom rocket in the simulator.',
        onEnter: ({ setDrawerOpen }) => {
            clearHangarTutorialHighlight();
            setDrawerOpen(true);
        },
        onLeave: ({ setDrawerOpen }) => setDrawerOpen(false),
        finishLabel: 'Got it',
    },
];

function isTutorialComplete() {
    try {
        return localStorage.getItem(STORAGE_KEY) === '1';
    } catch (_) {
        return false;
    }
}

function markTutorialComplete() {
    try {
        localStorage.setItem(STORAGE_KEY, '1');
    } catch (_) {
        /* private mode */
    }
}

function getElements(selectors) {
    const nodes = [];
    for (const sel of selectors) {
        document.querySelectorAll(sel).forEach((el) => nodes.push(el));
    }
    return nodes.filter((el) => el && el.offsetParent !== null || el.getBoundingClientRect().width > 0);
}

function unionRect(elements, pad = 10) {
    const rects = elements.map((el) => el.getBoundingClientRect());
    if (!rects.length) return null;
    let top = Infinity;
    let left = Infinity;
    let right = -Infinity;
    let bottom = -Infinity;
    for (const r of rects) {
        top = Math.min(top, r.top);
        left = Math.min(left, r.left);
        right = Math.max(right, r.right);
        bottom = Math.max(bottom, r.bottom);
    }
    return {
        top: top - pad,
        left: left - pad,
        width: right - left + pad * 2,
        height: bottom - top + pad * 2,
    };
}

function positionSpotlight(spotlight, rect) {
    if (!rect) {
        spotlight.style.display = 'none';
        return;
    }
    spotlight.style.display = 'block';
    spotlight.style.top = `${rect.top}px`;
    spotlight.style.left = `${rect.left}px`;
    spotlight.style.width = `${rect.width}px`;
    spotlight.style.height = `${rect.height}px`;
}

function positionCard(card, rect, placement = 'auto') {
    const margin = 16;
    card.style.maxWidth = `${Math.min(280, window.innerWidth - margin * 2)}px`;
    card.style.visibility = 'hidden';
    card.style.display = 'block';

    const cardH = card.offsetHeight;
    const cardW = card.offsetWidth;
    let top;
    let left;

    if (rect && placement === 'left') {
        left = rect.left - margin - cardW;
        const stats = document.getElementById('hangar-summary');
        const statsR = stats?.getBoundingClientRect();
        if (left < margin || (statsR && left + cardW > statsR.left - margin)) {
            left = margin;
        }
        top = rect.top + rect.height / 2 - cardH / 2;
        if (statsR) {
            top = Math.max(statsR.bottom + margin, top);
        }
        top = Math.max(margin, Math.min(window.innerHeight - cardH - margin, top));
    } else if (rect && placement === 'right') {
        left = rect.right + margin;
        if (left + cardW > window.innerWidth - margin) {
            left = window.innerWidth - cardW - margin;
        }
        top = rect.top + rect.height / 2 - cardH / 2;
        top = Math.max(margin, Math.min(window.innerHeight - cardH - margin, top));
    } else {
        left = Math.max(margin, Math.min(
            window.innerWidth - cardW - margin,
            rect ? rect.left + rect.width / 2 - cardW / 2 : (window.innerWidth - cardW) / 2,
        ));

        if (rect && rect.bottom + margin + cardH < window.innerHeight) {
            top = rect.bottom + margin;
        } else if (rect && rect.top - margin - cardH > 0) {
            top = rect.top - margin - cardH;
        } else {
            top = Math.max(margin, (window.innerHeight - cardH) / 2);
            left = (window.innerWidth - cardW) / 2;
        }
    }

    card.style.top = `${top}px`;
    card.style.left = `${left}px`;
    card.style.visibility = 'visible';
}

export function initHangarTutorial({ setDrawerOpen }) {
    if (isTutorialComplete()) return;

    const root = document.getElementById('hangar-tutorial');
    const spotlight = document.getElementById('hangar-tutorial-spotlight');
    const card = document.getElementById('hangar-tutorial-card');
    const titleEl = document.getElementById('hangar-tutorial-title');
    const textEl = document.getElementById('hangar-tutorial-text');
    const stepEl = document.getElementById('hangar-tutorial-step');
    const nextBtn = document.getElementById('hangar-tutorial-next');
    const skipBtn = document.getElementById('hangar-tutorial-skip');

    if (!root || !spotlight || !card || !nextBtn) return;

    let stepIndex = 0;
    const ctx = { setDrawerOpen };

    function teardown() {
        STEPS[stepIndex]?.onLeave?.(ctx);
        clearHangarTutorialHighlight();
        setDrawerOpen(false);
        root.setAttribute('hidden', '');
        document.body.classList.remove('hangar-tutorial-active');
        window.removeEventListener('resize', onResize);
    }

    function finish() {
        markTutorialComplete();
        teardown();
    }

    function showStep(index) {
        const prev = STEPS[stepIndex];
        if (prev && index !== stepIndex) prev.onLeave?.(ctx);

        stepIndex = index;
        const step = STEPS[stepIndex];
        step.onEnter?.(ctx);

        titleEl.textContent = step.title;
        textEl.textContent = step.text;
        stepEl.textContent = `${stepIndex + 1} / ${STEPS.length}`;
        nextBtn.textContent = step.finishLabel || (stepIndex === STEPS.length - 1 ? 'Done' : 'Next');

        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                const elements = getElements(step.selectors);
                const rect = unionRect(elements.length ? elements : [document.body], 12);
                const cardAnchors = getElements(step.cardAnchorSelectors || step.selectors);
                const cardRect = unionRect(cardAnchors.length ? cardAnchors : (elements.length ? elements : [document.body]), 12);
                positionSpotlight(spotlight, rect);
                positionCard(card, cardRect, step.cardPlacement || 'auto');
            });
        });
    }

    function onResize() {
        showStep(stepIndex);
    }

    function start() {
        document.body.classList.add('hangar-tutorial-active');
        root.removeAttribute('hidden');
        showStep(0);
        window.addEventListener('resize', onResize);
    }

    nextBtn.addEventListener('click', () => {
        if (stepIndex >= STEPS.length - 1) finish();
        else showStep(stepIndex + 1);
    });

    skipBtn?.addEventListener('click', finish);

    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            setTimeout(start, 120);
        });
    });
}
