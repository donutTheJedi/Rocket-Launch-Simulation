import { G, EARTH_MASS, EARTH_RADIUS, KARMAN_LINE, ROCKET_CONFIG } from './constants.js';
import { state, getAltitude } from './state.js';
import { computeGuidance } from './guidance.js';
import { calculateRocketCOG, calculateCenterOfPressure, getMachNumber, getAirspeed } from './physics.js';

// Canvas and context (set by init)
let canvas = null;
let ctx = null;

// Track previous rocket rotation angle for smooth interpolation
let previousRocketCanvasAngle = null;

// Initialize renderer with canvas element
export function initRenderer(canvasElement) {
    canvas = canvasElement;
    ctx = canvas.getContext('2d');
}

// Get canvas element
export function getCanvas() {
    return canvas;
}

// Resize canvas to window
export function resize() {
    if (canvas) {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
    }
}

// Main render function
export function render() {
    if (!ctx || !canvas) return;
    
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    const altitude = getAltitude();
    
    // ZOOM: Start at 2 m/px (very close), smoothly zoom out as altitude increases
    const minMPP = 2;
    const maxMPP = state.cameraMode === 'earth' ? Infinity : (EARTH_RADIUS * 20 / Math.min(canvas.width, canvas.height));
    
    let autoMetersPerPixel;
    if (state.cameraMode === 'earth') {
        const defaultEarthZoom = EARTH_RADIUS * 2.5 / Math.min(canvas.width, canvas.height);
        autoMetersPerPixel = defaultEarthZoom;
    } else if (altitude < 500) {
        autoMetersPerPixel = minMPP;
    } else {
        const zoomProgress = Math.min(1, Math.log10(altitude / 500) / 6);
        autoMetersPerPixel = minMPP * Math.pow(maxMPP / minMPP, zoomProgress);
    }
    
    const metersPerPixel = (state.cameraMode === 'earth' || !state.autoZoom) 
        ? autoMetersPerPixel / state.manualZoom 
        : autoMetersPerPixel / state.manualZoom;
    
    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;
    
    // Stars
    ctx.fillStyle = '#fff';
    for (let i = 0; i < 200; i++) {
        const sx = (Math.sin(i * 567.89 + 1000) * 0.5 + 0.5) * canvas.width;
        const sy = (Math.cos(i * 123.45 + 500) * 0.5 + 0.5) * canvas.height;
        ctx.fillRect(sx, sy, Math.random() > 0.85 ? 2 : 1, 1);
    }
    
    ctx.save();
    ctx.translate(centerX, centerY);
    ctx.scale(1 / metersPerPixel, -1 / metersPerPixel);
    
    // Camera: either follow rocket or center on Earth
    if (state.cameraMode === 'earth') {
        ctx.translate(0, 0);
    } else {
        ctx.translate(-state.x, -state.y);
    }
    
    // Rotate Earth at actual Earth rotation rate (~465 m/s at surface)
    const EARTH_ROTATION_RATE = 2 * Math.PI / 86400; // rad/s (one rotation per 24 hours)
    const earthRotation = state.time * EARTH_ROTATION_RATE;
    ctx.save();
    ctx.rotate(-earthRotation);
    
    // Earth
    ctx.beginPath();
    ctx.arc(0, 0, EARTH_RADIUS, 0, Math.PI * 2);
    const grad = ctx.createRadialGradient(-EARTH_RADIUS * 0.3, EARTH_RADIUS * 0.3, 0, 0, 0, EARTH_RADIUS);
    grad.addColorStop(0, '#3a7d32');
    grad.addColorStop(0.6, '#1a5a1a');
    grad.addColorStop(1, '#0a3a0a');
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.strokeStyle = '#2a8a2a';
    ctx.lineWidth = metersPerPixel * 2;
    ctx.stroke();
    
    // City visualization - fades as altitude increases
    // City fades from fully visible at ground level to invisible at 100km
    const fadeStartAlt = 0;
    const fadeEndAlt = 100000; // 100km
    const cityOpacity = Math.max(0, 1 - (altitude - fadeStartAlt) / (fadeEndAlt - fadeStartAlt));
    
    if (cityOpacity > 0 && metersPerPixel < 100) {
        // Launch site is at (0, EARTH_RADIUS)
        // Keep rocket area clear (about 800m clear zone)
        const rocketClearZone = 3400; // meters
        const cityStartX = rocketClearZone + 1000; // Start city 1km to the right of clear zone
        const cityEndX = cityStartX + 50000; // 9km of city to the right
        const cityY = EARTH_RADIUS;
        
        ctx.save();
        ctx.globalAlpha = cityOpacity;
        
        // Generate dense cityscape - lots of buildings spanning 9km
        const buildings = [];
        let currentX = cityStartX;
        
        // Generate buildings in rows (multiple rows for density)
        while (currentX < cityEndX) {
            // Determine building size (varied for realism)
            const randSeed = currentX * 0.0001; // Use position as seed for deterministic randomness
            const hash = Math.floor(Math.abs(Math.sin(randSeed)) * 1000000) % 1000;
            
            // Building width: 40-100m (most buildings 50-80m)
            const widthOptions = [45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 95];
            const width = widthOptions[hash % widthOptions.length];
            
            // Building height: varies by area (downtown taller, suburbs shorter)
            const distanceFromStart = currentX - cityStartX;
            const cityProgress = distanceFromStart / 9000; // 0 to 1
            
            let height;
            if (cityProgress < 0.2) {
                // Closer to rocket: shorter buildings (suburbs)
                height = 100 + (hash % 100);
            } else if (cityProgress < 0.6) {
                // Middle: medium buildings (urban)
                height = 150 + (hash % 150);
            } else {
                // Far end: tall buildings (downtown)
                height = 200 + (hash % 200);
            }
            
            buildings.push({
                x: currentX,
                width: width,
                height: height,
                hash: hash
            });
            
            // Spacing: buildings are close together (city density)
            // Some small gaps, but mostly touching
            const spacing = width + (hash % 20); // 0-19m spacing
            currentX += spacing;
        }
        
        // Draw all buildings
        for (let i = 0; i < buildings.length; i++) {
            const b = buildings[i];
            const x = b.x;
            const y = cityY;
            
            // Building base (on Earth surface) - varied colors for depth
            const hue = (b.hash * 17) % 360;
            const brightness = 25 + (b.hash % 4) * 12;
            ctx.fillStyle = `hsl(${hue}, 25%, ${brightness}%)`;
            ctx.fillRect(x - b.width/2, y, b.width, b.height);
            
            // Building outline for definition
            ctx.strokeStyle = '#222';
            ctx.lineWidth = Math.max(metersPerPixel * 0.3, 0.5);
            ctx.strokeRect(x - b.width/2, y, b.width, b.height);
            
            // Building windows (deterministic pattern)
            ctx.fillStyle = '#ffaa00';
            const windowRows = Math.floor(b.height / 30);
            const windowsPerRow = Math.floor(b.width / 20);
            for (let row = 0; row < windowRows; row++) {
                for (let col = 0; col < windowsPerRow; col++) {
                    // Deterministic pattern: light windows based on position hash
                    const windowHash = (b.hash * 31 + row * 17 + col * 13) % 100;
                    if (windowHash > 35) { // ~65% of windows lit
                        ctx.fillRect(
                            x - b.width/2 + 5 + col * 20,
                            y + 5 + row * 30,
                            8, 15
                        );
                    }
                }
            }
        }
        
        ctx.restore();
    }
    
    // Ground detail when close
    if (metersPerPixel < 20) {
        ctx.fillStyle = '#555';
        ctx.fillRect(-30, EARTH_RADIUS - 1, 60, 2);
        ctx.fillStyle = '#777';
        ctx.fillRect(-25, EARTH_RADIUS, 4, 60);
    }
    
    // Atmosphere layers (when zoomed out)
    if (metersPerPixel > 50) {
        for (let i = 0; i < 4; i++) {
            ctx.beginPath();
            ctx.arc(0, 0, EARTH_RADIUS + (i + 1) * 25000, 0, Math.PI * 2);
            ctx.strokeStyle = `rgba(100, 150, 255, ${0.1 - i * 0.02})`;
            ctx.lineWidth = 20000;
            ctx.stroke();
        }
    }
    
    // Karman line
    if (metersPerPixel > 200) {
        ctx.beginPath();
        ctx.arc(0, 0, EARTH_RADIUS + KARMAN_LINE, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(255, 200, 0, 0.5)';
        ctx.lineWidth = 1500;
        ctx.setLineDash([15000, 15000]);
        ctx.stroke();
        ctx.setLineDash([]);
    }
    
    // Trail (transform each point to rotating frame so it follows behind rocket)
    if (state.trail.length > 1) {
        const cosR = Math.cos(earthRotation);
        const sinR = Math.sin(earthRotation);
        
        ctx.beginPath();
        // Transform first point from inertial to rotating frame
        const x0 = state.trail[0].x * cosR - state.trail[0].y * sinR;
        const y0 = state.trail[0].x * sinR + state.trail[0].y * cosR;
        ctx.moveTo(x0, y0);
        
        for (let i = 1; i < state.trail.length; i++) {
            const x = state.trail[i].x * cosR - state.trail[i].y * sinR;
            const y = state.trail[i].x * sinR + state.trail[i].y * cosR;
            ctx.lineTo(x, y);
        }
        ctx.strokeStyle = 'rgba(255, 120, 0, 0.8)';
        ctx.lineWidth = Math.max(metersPerPixel * 2, 2);
        ctx.stroke();
    }
    
    ctx.restore(); // End Earth rotation
    
    // Rocket - ACTUAL SIZE 70m x 3.7m
    const rocketLen = 70;
    const rocketWid = 3.7;
    
    ctx.save();
    const r = Math.sqrt(state.x * state.x + state.y * state.y);
    const localUp = { x: state.x / r, y: state.y / r };
    const localEast = { x: localUp.y, y: -localUp.x };
    ctx.translate(state.x + localUp.x * rocketLen * 0.5, state.y + localUp.y * rocketLen * 0.5);
    
    // Calculate rocket orientation
    // Use state.rocketAngle directly for smooth animation (physics-based)
    // In orbital mode when not burning, point along velocity (prograde)
    // When burning, point along thrust direction
    // Otherwise, use the physics-integrated rocketAngle
    let rocketAngle;
    const currentAltitude = getAltitude();
    const pitchProgramComplete = state.gameMode === 'orbital' || state.time > 600 || (!state.engineOn && currentAltitude > 150000);
    
    if (state.burnMode && pitchProgramComplete && currentAltitude > 150000) {
        // Burning: point along thrust direction (calculate from velocity)
        const velocity = Math.sqrt(state.vx * state.vx + state.vy * state.vy);
        if (velocity > 0) {
            const progradeDir = { x: state.vx / velocity, y: state.vy / velocity };
            // Convert direction to angle relative to local vertical
            // progradeDir = sin(angle) * localEast + cos(angle) * localUp
            // Solve for angle: dot with localEast gives sin(angle), dot with localUp gives cos(angle)
            const sinAngle = progradeDir.x * localEast.x + progradeDir.y * localEast.y;
            const cosAngle = progradeDir.x * localUp.x + progradeDir.y * localUp.y;
            rocketAngle = Math.atan2(sinAngle, cosAngle);
        } else {
            rocketAngle = state.rocketAngle;
        }
    } else if (state.gameMode === 'orbital' && !state.engineOn) {
        // Orbital mode, not burning: point along velocity (prograde)
        const velocity = Math.sqrt(state.vx * state.vx + state.vy * state.vy);
        if (velocity > 0) {
            const progradeDir = { x: state.vx / velocity, y: state.vy / velocity };
            const sinAngle = progradeDir.x * localEast.x + progradeDir.y * localEast.y;
            const cosAngle = progradeDir.x * localUp.x + progradeDir.y * localUp.y;
            rocketAngle = Math.atan2(sinAngle, cosAngle);
        } else {
            rocketAngle = state.rocketAngle;
        }
    } else {
        // Use physics-integrated rocketAngle directly for smooth animation
        // This is continuously integrated and won't have discontinuities
        rocketAngle = state.rocketAngle;
    }
    
    // Convert rocketAngle (relative to local vertical) to canvas rotation
    // rocketAngle: 0 = up, π/2 = east, -π/2 = west
    // Canvas: need to rotate based on world coordinates
    // The rocket is drawn pointing "up" in canvas (negative y in world due to scale flip)
    // We need to find the angle of the rocket direction in world coordinates
    const rocketDirX = Math.sin(rocketAngle) * localEast.x + Math.cos(rocketAngle) * localUp.x;
    const rocketDirY = Math.sin(rocketAngle) * localEast.y + Math.cos(rocketAngle) * localUp.y;
    const rocketDir = { x: rocketDirX, y: rocketDirY }; // Store for use in thrust arrow
    let canvasRotation = Math.atan2(rocketDirY, rocketDirX) - Math.PI / 2;
    
    // Normalize angle to prevent snapping when crossing quadrant boundaries
    // Keep the angle within ±π of the previous angle for smooth animation
    if (previousRocketCanvasAngle !== null) {
        // Normalize to be within ±π of previous angle
        while (canvasRotation - previousRocketCanvasAngle > Math.PI) {
            canvasRotation -= 2 * Math.PI;
        }
        while (canvasRotation - previousRocketCanvasAngle < -Math.PI) {
            canvasRotation += 2 * Math.PI;
        }
    }
    previousRocketCanvasAngle = canvasRotation;
    
    ctx.rotate(canvasRotation);
    
    // Make rocket visible even when zoomed out
    const minPixelSize = 12;
    const scale = Math.max(1, minPixelSize * metersPerPixel / rocketLen);
    const drawLen = rocketLen * scale;
    const drawWid = rocketWid * scale;
    
    // Body
    ctx.fillStyle = '#f0f0f0';
    ctx.fillRect(-drawWid/2, -drawLen * 0.4, drawWid, drawLen * 0.8);
    
    // Nose
    ctx.beginPath();
    ctx.moveTo(-drawWid/2, drawLen * 0.4);
    ctx.lineTo(0, drawLen * 0.55);
    ctx.lineTo(drawWid/2, drawLen * 0.4);
    ctx.fillStyle = '#d33';
    ctx.fill();
    
    // Fins
    ctx.fillStyle = '#888';
    ctx.beginPath();
    ctx.moveTo(-drawWid/2, -drawLen * 0.35);
    ctx.lineTo(-drawWid * 0.9, -drawLen * 0.45);
    ctx.lineTo(-drawWid/2, -drawLen * 0.2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(drawWid/2, -drawLen * 0.35);
    ctx.lineTo(drawWid * 0.9, -drawLen * 0.45);
    ctx.lineTo(drawWid/2, -drawLen * 0.2);
    ctx.fill();
    
    // Flame - only show when actually boosting (engine on, has propellant, valid stage)
    if (state.engineOn && 
        state.currentStage < ROCKET_CONFIG.stages.length && 
        state.propellantRemaining[state.currentStage] > 0) {
        
        // Save context to apply gimbal rotation
        ctx.save();
        
        // Rotate by gimbal angle (gimbal angle is in degrees, positive = deflect right/east)
        // Convert to radians and rotate around the rocket base (where flame starts)
        const gimbalAngleRad = state.gimbalAngle * Math.PI / 180;
        ctx.rotate(gimbalAngleRad);
        
        const flameLen = drawLen * (0.5 + Math.random() * 0.25);
        
        // Outer flame (orange/red)
        ctx.beginPath();
        ctx.moveTo(-drawWid * 0.2, -drawLen * 0.4);
        ctx.quadraticCurveTo(-drawWid * 0.35, -drawLen * 0.4 - flameLen * 0.5, 0, -drawLen * 0.4 - flameLen);
        ctx.quadraticCurveTo(drawWid * 0.35, -drawLen * 0.4 - flameLen * 0.5, drawWid * 0.2, -drawLen * 0.4);
        ctx.fillStyle = `rgb(255, ${80 + Math.random() * 60}, 0)`;
        ctx.fill();
        
        // Inner flame (yellow/white)
        ctx.beginPath();
        ctx.moveTo(-drawWid * 0.1, -drawLen * 0.4);
        ctx.quadraticCurveTo(-drawWid * 0.15, -drawLen * 0.4 - flameLen * 0.35, 0, -drawLen * 0.4 - flameLen * 0.6);
        ctx.quadraticCurveTo(drawWid * 0.15, -drawLen * 0.4 - flameLen * 0.35, drawWid * 0.1, -drawLen * 0.4);
        ctx.fillStyle = `rgb(255, ${200 + Math.random() * 55}, ${100 + Math.random() * 80})`;
        ctx.fill();
        
        // Restore context (undo gimbal rotation)
        ctx.restore();
    }
    
    ctx.restore();
    
    // Draw thrust vector arrow - only show when actually boosting
    if (state.engineOn && 
        state.currentStage < ROCKET_CONFIG.stages.length && 
        state.propellantRemaining[state.currentStage] > 0) {
        const arrowLength = 100;
        const arrowHeadSize = 12;
        
        ctx.save();
        const rArrow = Math.sqrt(state.x * state.x + state.y * state.y);
        const localUpArrow = { x: state.x / rArrow, y: state.y / rArrow };
        const localEastArrow = { x: localUpArrow.y, y: -localUpArrow.x };
        ctx.translate(state.x + localUpArrow.x * rocketLen * 0.5, state.y + localUpArrow.y * rocketLen * 0.5);
        
        // Calculate actual thrust direction (same logic as rocket orientation)
        let thrustDirArrow;
        if (state.burnMode && pitchProgramComplete && currentAltitude > 150000) {
            // Burning: use burn direction
            const velocity = Math.sqrt(state.vx * state.vx + state.vy * state.vy);
            const prograde = velocity > 0 ? { x: state.vx / velocity, y: state.vy / velocity } : { x: localEastArrow.x, y: localEastArrow.y };
            const radial = localUpArrow;
            const h = state.x * state.vy - state.y * state.vx;
            const normal = h > 0 ? { x: -localUpArrow.y, y: localUpArrow.x } : { x: localUpArrow.y, y: -localUpArrow.x };
            
            switch (state.burnMode) {
                case 'prograde':
                    thrustDirArrow = prograde;
                    break;
                case 'retrograde':
                    thrustDirArrow = { x: -prograde.x, y: -prograde.y };
                    break;
                case 'normal':
                    thrustDirArrow = normal;
                    break;
                case 'anti-normal':
                    thrustDirArrow = { x: -normal.x, y: -normal.y };
                    break;
                case 'radial':
                    thrustDirArrow = radial;
                    break;
                case 'anti-radial':
                    thrustDirArrow = { x: -radial.x, y: -radial.y };
                    break;
                default:
                    thrustDirArrow = prograde;
            }
        } else {
            // Use rocket direction (same as rocket orientation)
            thrustDirArrow = rocketDir;
        }
        
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(thrustDirArrow.x * arrowLength, thrustDirArrow.y * arrowLength);
        ctx.strokeStyle = '#0ff';
        ctx.lineWidth = metersPerPixel * 3;
        ctx.stroke();
        
        const arrowX = thrustDirArrow.x * arrowLength;
        const arrowY = thrustDirArrow.y * arrowLength;
        const arrowAngle = Math.atan2(thrustDirArrow.y, thrustDirArrow.x);
        
        const tipX = arrowX;
        const tipY = arrowY;
        const baseOffset = arrowHeadSize * 0.8;
        const baseX = arrowX - baseOffset * Math.cos(arrowAngle);
        const baseY = arrowY - baseOffset * Math.sin(arrowAngle);
        const wingOffset = arrowHeadSize * 0.5;
        
        ctx.beginPath();
        ctx.moveTo(tipX, tipY);
        ctx.lineTo(
            baseX + wingOffset * Math.cos(arrowAngle + Math.PI / 2),
            baseY + wingOffset * Math.sin(arrowAngle + Math.PI / 2)
        );
        ctx.lineTo(
            baseX + wingOffset * Math.cos(arrowAngle - Math.PI / 2),
            baseY + wingOffset * Math.sin(arrowAngle - Math.PI / 2)
        );
        ctx.closePath();
        ctx.fillStyle = '#0ff';
        ctx.fill();
        
        ctx.restore();
    }
    
    // Orbit prediction
    const v = Math.sqrt(state.vx * state.vx + state.vy * state.vy);
    const mu = G * EARTH_MASS;
    const energy = (v * v / 2) - (mu / r);
    if (altitude > 10000 && energy < 0) {
        const a = -mu / (2 * energy);
        const h = state.x * state.vy - state.y * state.vx;
        const e = Math.sqrt(Math.max(0, 1 + (2 * energy * h * h) / (mu * mu)));
        if (e < 1 && a > 0 && a < EARTH_RADIUS * 50 && e >= 0) {
            const v2 = v * v;
            const rVec = { x: state.x, y: state.y };
            const vVec = { x: state.vx, y: state.vy };
            
            const rDotV = rVec.x * vVec.x + rVec.y * vVec.y;
            const eVec = {
                x: ((v2 - mu / r) * rVec.x - rDotV * vVec.x) / mu,
                y: ((v2 - mu / r) * rVec.y - rDotV * vVec.y) / mu
            };
            
            let periapsisAngle;
            if (e < 0.001) {
                periapsisAngle = Math.atan2(rVec.y, rVec.x);
            } else {
                periapsisAngle = Math.atan2(eVec.y, eVec.x);
            }
            
            ctx.beginPath();
            let firstPoint = true;
            let lastValidPoint = null;
            
            if (e < 0.001) {
                const radius = a;
                if (radius > EARTH_RADIUS && radius < EARTH_RADIUS * 50) {
                    ctx.arc(0, 0, radius, 0, Math.PI * 2);
                }
            } else {
                const theta0 = periapsisAngle;
                for (let ang = 0; ang <= Math.PI * 2 + 0.05; ang += 0.01) {
                    const rOrb = a * (1 - e * e) / (1 + e * Math.cos(ang));
                    if (rOrb > EARTH_RADIUS && rOrb < EARTH_RADIUS * 50 && isFinite(rOrb)) {
                        const xO = rOrb * Math.cos(ang + theta0);
                        const yO = rOrb * Math.sin(ang + theta0);
                        if (isFinite(xO) && isFinite(yO)) {
                            if (firstPoint) {
                                ctx.moveTo(xO, yO);
                                firstPoint = false;
                                lastValidPoint = { x: xO, y: yO };
                            } else {
                                if (lastValidPoint) {
                                    const dx = xO - lastValidPoint.x;
                                    const dy = yO - lastValidPoint.y;
                                    const dist = Math.sqrt(dx * dx + dy * dy);
                                    if (dist < EARTH_RADIUS * 10) {
                                        ctx.lineTo(xO, yO);
                                        lastValidPoint = { x: xO, y: yO };
                                    }
                                } else {
                                    ctx.lineTo(xO, yO);
                                    lastValidPoint = { x: xO, y: yO };
                                }
                            }
                        }
                    }
                }
            }
            ctx.strokeStyle = 'rgba(0, 255, 255, 0.7)';
            ctx.lineWidth = Math.max(metersPerPixel * 3, 2);
            ctx.setLineDash([metersPerPixel * 20, metersPerPixel * 10]);
            ctx.stroke();
            ctx.setLineDash([]);
        }
    }
    
    ctx.restore();
    ctx.restore();
    
    // Info
    ctx.fillStyle = '#555';
    ctx.font = '11px Courier New';
    ctx.fillText(`${metersPerPixel < 1000 ? metersPerPixel.toFixed(1) + ' m/px' : (metersPerPixel/1000).toFixed(2) + ' km/px'}`, 10, canvas.height - 10);
    
    // Draw diagrams - show expanded version if expanded, otherwise show normal version
    if (state.expandedDiagram === 'forces') {
        drawForceDiagram(ctx, canvas, true);
    } else {
        drawForceDiagram(ctx, canvas, false);
    }
    
    if (state.expandedDiagram === 'rocket') {
        drawRocketDiagram(ctx, canvas, true);
    } else {
        drawRocketDiagram(ctx, canvas, false);
    }
}

// Draw force diagram in top right, beneath Mission Events (position updates with events panel height)
function drawForceDiagram(ctx, canvas, expanded = false) {
    const diagramSize = expanded ? 300 : 120; // Larger when expanded
    const gap = 10;
    const rightMargin = 20;
    
    const eventsEl = document.getElementById('events');
    const top = eventsEl ? eventsEl.getBoundingClientRect().bottom + gap : 20 + 320 + gap;
    
    // If expanded, center it on screen
    const centerX = expanded ? canvas.width / 2 : canvas.width - rightMargin - diagramSize / 2;
    const centerY = expanded ? canvas.height / 2 : top + diagramSize / 2;
    const radius = expanded ? 100 : 40;
    
    // Background
    ctx.fillStyle = expanded ? 'rgba(0, 0, 0, 0.9)' : 'rgba(0, 0, 0, 0.7)';
    ctx.fillRect(centerX - diagramSize/2, centerY - diagramSize/2, diagramSize, diagramSize);
    ctx.strokeStyle = '#0ff';
    ctx.lineWidth = expanded ? 2 : 1;
    ctx.strokeRect(centerX - diagramSize/2, centerY - diagramSize/2, diagramSize, diagramSize);
    
    // Title
    ctx.fillStyle = '#0ff';
    ctx.font = expanded ? '14px Courier New' : '10px Courier New';
    ctx.textAlign = 'center';
    ctx.fillText('FORCES' + (expanded ? ' (Click to close)' : ' (Click to expand)'), centerX, centerY - diagramSize/2 + (expanded ? 18 : 12));
    
    // Draw reference circle
    ctx.strokeStyle = '#555';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
    ctx.stroke();
    
    // Draw center point (rocket)
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(centerX, centerY, 2, 0, Math.PI * 2);
    ctx.fill();
    
    // Draw force vectors
    const arrowLength = radius * 0.8;
    const arrowHeadSize = expanded ? 10 : 6;
    
    // Gravity (red, pointing down)
    if (state.forceVectors.gravity.x !== 0 || state.forceVectors.gravity.y !== 0) {
        drawForceVector(ctx, centerX, centerY, state.forceVectors.gravity, arrowLength, arrowHeadSize, '#f00', 'G', expanded);
    }
    
    // Thrust (green, pointing along thrust direction)
    if (state.forceVectors.thrust.x !== 0 || state.forceVectors.thrust.y !== 0) {
        drawForceVector(ctx, centerX, centerY, state.forceVectors.thrust, arrowLength, arrowHeadSize, '#0f0', 'T', expanded);
    }
    
    // Drag (yellow, pointing opposite to velocity)
    if (state.forceVectors.drag.x !== 0 || state.forceVectors.drag.y !== 0) {
        drawForceVector(ctx, centerX, centerY, state.forceVectors.drag, arrowLength, arrowHeadSize, '#ff0', 'D', expanded);
    }
    
    // Aerodynamic force (cyan, total normal + axial)
    if (state.forceVectors.aero.x !== 0 || state.forceVectors.aero.y !== 0) {
        drawForceVector(ctx, centerX, centerY, state.forceVectors.aero, arrowLength, arrowHeadSize, '#0ff', 'A', expanded);
    }
    
    ctx.textAlign = 'left'; // Reset text alignment
}

// Draw a single force vector arrow
// Note: direction is in world coordinates (Y up), but canvas has Y down, so flip Y
function drawForceVector(ctx, x, y, direction, length, headSize, color, label, expanded = false) {
    // Flip Y component for screen coordinates (canvas Y increases downward)
    const screenDirX = direction.x;
    const screenDirY = -direction.y;
    const endX = x + screenDirX * length;
    const endY = y + screenDirY * length;
    
    // Draw arrow line
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(endX, endY);
    ctx.stroke();
    
    // Draw arrowhead (use screen direction for angle)
    const angle = Math.atan2(screenDirY, screenDirX);
    ctx.beginPath();
    ctx.moveTo(endX, endY);
    ctx.lineTo(
        endX - headSize * Math.cos(angle - Math.PI / 6),
        endY - headSize * Math.sin(angle - Math.PI / 6)
    );
    ctx.lineTo(
        endX - headSize * Math.cos(angle + Math.PI / 6),
        endY - headSize * Math.sin(angle + Math.PI / 6)
    );
    ctx.closePath();
    ctx.fill();
    
    // Draw label near arrowhead
    ctx.fillStyle = color;
    ctx.font = expanded ? '12px Courier New' : '9px Courier New';
    ctx.textAlign = 'center';
    const labelX = endX + screenDirX * (expanded ? 12 : 8);
    const labelY = endY + screenDirY * (expanded ? 12 : 8);
    ctx.fillText(label, labelX, labelY + (expanded ? 4 : 3));
}

// Draw rocket diagram showing COG, CP, and force vectors at proper locations
function drawRocketDiagram(ctx, canvas, expanded = false) {
    const diagramWidth = expanded ? 300 : 120;
    const diagramHeight = expanded ? 450 : 180; // Taller rectangle
    const gap = 10;
    const rightMargin = 20;
    
    const eventsEl = document.getElementById('events');
    const forceDiagramTop = eventsEl ? eventsEl.getBoundingClientRect().bottom + gap : 20 + 320 + gap;
    const top = expanded ? (canvas.height - diagramHeight) / 2 : forceDiagramTop + 120 + gap;
    
    // If expanded, center it on screen
    const centerX = expanded ? canvas.width / 2 : canvas.width - rightMargin - diagramWidth / 2;
    const centerY = expanded ? canvas.height / 2 : top + diagramHeight / 2;
    
    // Background
    ctx.fillStyle = expanded ? 'rgba(0, 0, 0, 0.9)' : 'rgba(0, 0, 0, 0.7)';
    ctx.fillRect(centerX - diagramWidth/2, centerY - diagramHeight/2, diagramWidth, diagramHeight);
    ctx.strokeStyle = '#0ff';
    ctx.lineWidth = expanded ? 2 : 1;
    ctx.strokeRect(centerX - diagramWidth/2, centerY - diagramHeight/2, diagramWidth, diagramHeight);
    
    // Title
    ctx.fillStyle = '#0ff';
    ctx.font = expanded ? '14px Courier New' : '10px Courier New';
    ctx.textAlign = 'center';
    ctx.fillText('ROCKET' + (expanded ? ' (Click to close)' : ' (Click to expand)'), centerX, centerY - diagramHeight/2 + (expanded ? 18 : 12));
    
    // Get rocket data
    const cogData = calculateRocketCOG();
    let rocketLength = cogData.rocketLength;
    const cogPosition = cogData.cog; // From rocket bottom
    
    if (rocketLength <= 0) return; // No rocket to draw
    
    // Calculate CP position (need Mach number)
    let cpPosition = cogPosition; // Default to COG if we can't calculate
    const altitude = getAltitude();
    if (altitude < 70000) {
        const { airspeed } = getAirspeed();
        if (airspeed > 1e-3) {
            const mach = getMachNumber(airspeed, altitude);
            cpPosition = calculateCenterOfPressure(mach, rocketLength);
        }
    }
    
    // Scale rocket to fit in diagram (leave margins)
    // Use more of the height for a longer, thinner rocket
    const maxRocketHeight = diagramHeight * 0.75; // Use 75% of diagram height
    const scale = maxRocketHeight / rocketLength;
    const rocketDisplayLength = rocketLength * scale;
    // Make rocket thinner - reduced width multiplier
    const rocketDisplayWidth = Math.max(expanded ? 1.5 : 1, ROCKET_CONFIG.stages[0].diameter * scale * (expanded ? 4 : 3)); // Much thinner body
    
    // Calculate positions along rocket (from bottom, in rocket-local coordinates)
    const cogFromBottom = cogPosition / rocketLength; // Fraction from bottom (0-1)
    const cpFromBottom = cpPosition / rocketLength;
    
    // Calculate gimbal point position
    let gimbalFromBottom = 0; // Default to bottom
    if (state.currentStage < ROCKET_CONFIG.stages.length) {
        const stage = ROCKET_CONFIG.stages[state.currentStage];
        const gimbalPosition = stage.gimbalPoint; // From stage bottom
        let gimbalFromRocketBottom = gimbalPosition;
        if (state.currentStage === 1) {
            gimbalFromRocketBottom += ROCKET_CONFIG.stages[0].length;
        }
        gimbalFromBottom = gimbalFromRocketBottom / rocketLength;
    }
    
    // Save context for rotation
    ctx.save();
    
    // Translate to center and rotate by rocket angle
    // Rocket angle: 0 = pointing up, positive = rotated clockwise (east)
    ctx.translate(centerX, centerY);
    ctx.rotate(state.rocketAngle);
    
    // Rocket coordinates: bottom at (0, +length/2), top at (0, -length/2)
    const rocketHalfLength = rocketDisplayLength / 2;
    const rocketHalfWidth = rocketDisplayWidth / 2;
    
    // Draw rocket body - simple light grey tube
    const bodyTop = -rocketHalfLength * 0.8; // Body starts 20% from top
    const bodyBottom = rocketHalfLength * 0.8; // Body ends 20% from bottom
    const bodyHeight = bodyBottom - bodyTop;
    
    // Draw light grey body tube (darker than main simulation)
    ctx.fillStyle = '#b0b0b0'; // Light grey body
    ctx.fillRect(-rocketHalfWidth, bodyTop, rocketDisplayWidth, bodyHeight);
    
    // Add subtle outline
    ctx.strokeStyle = '#999';
    ctx.lineWidth = expanded ? 1.5 : 1;
    ctx.strokeRect(-rocketHalfWidth, bodyTop, rocketDisplayWidth, bodyHeight);
    
    // Draw nose cone (red, matching main simulation)
    if (!state.fairingJettisoned) {
        const noseBaseY = bodyTop;
        const noseTipY = -rocketHalfLength;
        
        ctx.fillStyle = '#d33'; // Red nose
        ctx.beginPath();
        ctx.moveTo(-rocketHalfWidth, noseBaseY);
        ctx.lineTo(0, noseTipY);
        ctx.lineTo(rocketHalfWidth, noseBaseY);
        ctx.closePath();
        ctx.fill();
        
        ctx.strokeStyle = '#a00';
        ctx.lineWidth = expanded ? 1.5 : 1;
        ctx.stroke();
    }
    
    // Calculate marker positions along rocket axis (Y coordinate in rotated frame)
    // Bottom is at +rocketHalfLength, top is at -rocketHalfLength
    const cogY = rocketHalfLength - (cogFromBottom * rocketDisplayLength);
    const cpY = rocketHalfLength - (cpFromBottom * rocketDisplayLength);
    const gimbalY = rocketHalfLength - (gimbalFromBottom * rocketDisplayLength);
    
    // Draw COG marker
    const markerSize = expanded ? 5 : 3;
    ctx.fillStyle = '#0f0'; // Green for COG
    ctx.beginPath();
    ctx.arc(0, cogY, markerSize, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#0f0';
    ctx.lineWidth = expanded ? 2 : 1;
    // Draw line perpendicular to rocket through COG
    const markerLineOffset = expanded ? 12 : 8;
    ctx.beginPath();
    ctx.moveTo(-rocketHalfWidth - markerLineOffset, cogY);
    ctx.lineTo(rocketHalfWidth + markerLineOffset, cogY);
    ctx.stroke();
    
    // Draw CP marker
    ctx.fillStyle = '#0ff'; // Cyan for CP
    ctx.beginPath();
    ctx.arc(0, cpY, markerSize, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#0ff';
    ctx.lineWidth = expanded ? 2 : 1;
    // Draw line perpendicular to rocket through CP
    ctx.beginPath();
    ctx.moveTo(-rocketHalfWidth - markerLineOffset, cpY);
    ctx.lineTo(rocketHalfWidth + markerLineOffset, cpY);
    ctx.stroke();
    
    // Draw moment arm line (dashed) between COG and CP if aerodynamic forces enabled
    const aeroForcesEnabled = state.settings.enableAerodynamicForces && 
                               state.settings.controlMode === 'gimbal';
    if (aeroForcesEnabled && Math.abs(cpY - cogY) > 2) {
        ctx.strokeStyle = '#888';
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 2]);
        ctx.beginPath();
        ctx.moveTo(0, cogY);
        ctx.lineTo(0, cpY);
        ctx.stroke();
        ctx.setLineDash([]);
    }
    
    // Calculate screen coordinates BEFORE restoring context
    // We need to transform points from rotated coordinate system to screen coordinates
    // Points are at (0, y) in rotated frame (rocket-local coordinates)
    const cosAngle = Math.cos(state.rocketAngle);
    const sinAngle = Math.sin(state.rocketAngle);
    
    // Transform from rotated coords (0, cogY) to screen coords
    // After translate(centerX, centerY) and rotate(angle), a point at (x_rot, y_rot)
    // appears at: (centerX + x_rot*cos - y_rot*sin, centerY + x_rot*sin + y_rot*cos)
    // For our case, x_rot = 0, so:
    const cogScreenX = centerX - cogY * sinAngle;
    const cogScreenY = centerY + cogY * cosAngle;
    
    const cpScreenX = centerX - cpY * sinAngle;
    const cpScreenY = centerY + cpY * cosAngle;
    
    const gimbalScreenX = centerX - gimbalY * sinAngle;
    const gimbalScreenY = centerY + gimbalY * cosAngle;
    
    // Restore context before drawing force vectors (they need to be in screen coordinates)
    ctx.restore();
    
    // Draw labels (in screen coordinates, positioned perpendicular to rocket)
    ctx.fillStyle = '#0f0';
    ctx.font = expanded ? '11px Courier New' : '8px Courier New';
    ctx.textAlign = 'right';
    // Position labels perpendicular to rocket (to the left side)
    // Perpendicular vector: rotate rocket direction 90 degrees counterclockwise
    const perpX = -sinAngle; // Perpendicular X component
    const perpY = -cosAngle; // Perpendicular Y component
    const labelOffset = expanded ? 18 : 12; // Distance from rocket
    ctx.fillText('COG', cogScreenX + perpX * labelOffset, cogScreenY - perpY * labelOffset + (expanded ? 4 : 3));
    
    ctx.fillStyle = '#0ff';
    ctx.fillText('CP', cpScreenX + perpX * labelOffset, cpScreenY - perpY * labelOffset + (expanded ? 4 : 3));
    
    // Draw force vectors at their proper locations (in screen coordinates)
    const arrowLength = expanded ? 40 : 25;
    const arrowHeadSize = expanded ? 6 : 4;
    
    // Gravity at COG (red, pointing down)
    if (state.forceVectors.gravity.x !== 0 || state.forceVectors.gravity.y !== 0) {
        drawForceVector(ctx, cogScreenX, cogScreenY, state.forceVectors.gravity, arrowLength, arrowHeadSize, '#f00', 'G', expanded);
    }
    
    // Thrust at gimbal point (green)
    if (state.forceVectors.thrust.x !== 0 || state.forceVectors.thrust.y !== 0) {
        drawForceVector(ctx, gimbalScreenX, gimbalScreenY, state.forceVectors.thrust, arrowLength, arrowHeadSize, '#0f0', 'T', expanded);
    }
    
    // Drag at COG (yellow)
    if (state.forceVectors.drag.x !== 0 || state.forceVectors.drag.y !== 0) {
        drawForceVector(ctx, cogScreenX, cogScreenY, state.forceVectors.drag, arrowLength, arrowHeadSize, '#ff0', 'D', expanded);
    }
    
    // Aerodynamic force at CP (cyan) - only if enabled
    if (aeroForcesEnabled && (state.forceVectors.aero.x !== 0 || state.forceVectors.aero.y !== 0)) {
        drawForceVector(ctx, cpScreenX, cpScreenY, state.forceVectors.aero, arrowLength, arrowHeadSize, '#0ff', 'A', expanded);
    }
    
    ctx.textAlign = 'left'; // Reset text alignment
}

