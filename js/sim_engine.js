/**
 * THE ISLAND ENGINE
 * Core Logic for McKean-Vlasov Dynamics, Terrain, and Deterministic Randomness.
 */

'use strict';

// ------------------------------------------------------------------
// 1. DETERMINISTIC RANDOMNESS (The "Gaussian Tape")
// ------------------------------------------------------------------

class PRNG {
    constructor(seed) {
        this.seed = seed >>> 0;
    }
    
    // Mulberry32
    next() {
        var t = this.seed += 0x6D2B79F5;
        t = Math.imul(t ^ t >>> 15, t | 1);
        t ^= t + Math.imul(t ^ t >>> 7, t | 61);
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    }

    // Box-Muller Standard Normal
    nextGaussian() {
        let u = 0, v = 0;
        while(u === 0) u = this.next();
        while(v === 0) v = this.next();
        return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
    }
}

// ------------------------------------------------------------------
// 2. MATH & PHYSICS CONSTANTS
// ------------------------------------------------------------------

const WORLD_BOUNDS = { xmin: -1.75, xmax: 1.75, ymin: -1.75, ymax: 1.75 };
const TYPE_CENTERS = {
    'R': { x: 1.00, y: 0.00 },
    'G': { x: -0.50, y: Math.sqrt(3)/2 },
    'B': { x: -0.50, y: -Math.sqrt(3)/2 }
};

// ------------------------------------------------------------------
// 3. TERRAIN & ECOLOGY (The "Pope's" Algorithms)
// ------------------------------------------------------------------

// Noise functions
function smoothstep(t) { return t * t * (3 - 2 * t); }
function smoothstepAB(a, b, x) {
    if (a === b) return x >= b ? 1 : 0;
    const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
    return smoothstep(t);
}
function lerp(a, b, t) { return a + (b - a) * t; }
function hash2i(ix, iy, seed) {
    let h = ix * 374761393 + iy * 668265263 + seed * 1442695041;
    h = (h ^ (h >>> 13)) * 1274126177;
    h = h ^ (h >>> 16);
    return (h >>> 0) / 4294967296;
}
function valueNoise(x, y, freq, seed) {
    const xf = x * freq, yf = y * freq;
    const x0 = Math.floor(xf), y0 = Math.floor(yf);
    const tx = smoothstep(xf - x0), ty = smoothstep(yf - y0);
    const v00 = hash2i(x0, y0, seed), v10 = hash2i(x0 + 1, y0, seed);
    const v01 = hash2i(x0, y0 + 1, seed), v11 = hash2i(x0 + 1, y0 + 1, seed);
    return lerp(lerp(v00, v10, tx), lerp(v01, v11, tx), ty);
}
function fbm(x, y, seed) {
    let amp = 0.55, freq = 1.0, sum = 0.0, norm = 0.0;
    for (let o = 0; o < 4; o++) {
        sum += amp * valueNoise(x, y, 1.8 * freq, seed + 101 * o);
        norm += amp;
        amp *= 0.55;
        freq *= 2.0;
    }
    return sum / norm;
}

// Island Mask (0=Ocean, 1=Land)
function islandMask(x, y, seed) {
    const r = Math.sqrt(x * x + y * y) / 1.75;
    const base = Math.exp(-2.7 * r * r);
    const n = fbm(x * 0.85 + 1.7, y * 0.85 - 0.9, seed);
    const ridge = fbm(x * 1.6 - 0.3, y * 1.6 + 0.4, seed + 777);
    let m = 0.72 * base + 0.20 * (n - 0.5) + 0.10 * (ridge - 0.5);
    m = 1 / (1 + Math.exp(-7.0 * (m - 0.38))); // Sigmoid sharpness
    return Math.max(0, Math.min(1, m));
}

function getTerrainColor(m, x, y, seed) {
    const moist = fbm(x * 1.2 + 3.1, y * 1.2 - 2.7, seed + 2024);
    // Simplified biome logic
    if (m < 0.42) return [10, 70, 110]; // Ocean
    if (m < 0.48) return [224, 206, 140]; // Beach
    if (m < 0.62) return [74, 168, 86]; // Grass
    if (m < 0.80) return [48, 112, 60]; // Forest
    return [216, 220, 230]; // Mountain
}

// ------------------------------------------------------------------
// 4. SIMULATION ENGINE
// ------------------------------------------------------------------

class Engine {
    constructor(worldData) {
        this.data = worldData;
        this.seed = worldData.meta.seed || 1337;
        this.rng = new PRNG(this.seed);
        this.islandSeed = 1337; // Fixed terrain seed for consistency
        
        // Physics Params (Underdamped)
        this.params = {
            dt: 0.05,        // Time step
            sigma: 0.8,      // Noise strength (Diffusion)
            friction: 2.5,   // Damping (Gamma)
            mass: 1.0,       // Mass
            k: 0.5,          // Attraction to type center
            alpha: 0.6,      // Mean contraction
            beta: 2.2,       // Rotation
            rps: 1.2,        // RPS strength
            eco: 1.5,        // Ecology strength
            shore: 20.0      // Strong Shoreline repulsion
        };
        
        // Override with saved params
        if(worldData.config) Object.assign(this.params, worldData.config);

        // Initialize Velocity if missing
        this.data.agents.forEach(a => {
            if (typeof a.vx === 'undefined') a.vx = 0;
            if (typeof a.vy === 'undefined') a.vy = 0;
        });
    }

    // Gradient of preferred terrain
    gradEco(type, x, y) {
        const eps = 0.05;
        const p = (tx, ty) => this.ecoPhi(type, tx, ty);
        const gx = (p(x + eps, y) - p(x - eps, y)) / (2 * eps);
        const gy = (p(x, y + eps) - p(x, y - eps)) / (2 * eps);
        return { x: gx, y: gy };
    }

    ecoPhi(type, x, y) {
        const m = islandMask(x, y, this.islandSeed);
        // R: Beach, G: Forest, B: Water (but Inland)
        if (type === 'R') return smoothstepAB(0.42, 0.48, m) * (1 - smoothstepAB(0.48, 0.62, m));
        if (type === 'G') return smoothstepAB(0.62, 0.80, m);
        if (type === 'B') return (m > 0.42 && m < 0.55) ? 1.0 : 0.0; // Puddles/Lowlands
        return 0;
    }

    rpsDrift(type, means) {
        const r = means.R || {x:0, y:0}, g = means.G || {x:0, y:0}, b = means.B || {x:0, y:0};
        const gamma = this.params.rps;
        if (type === 'R') return { x: gamma * (b.x - g.x), y: gamma * (b.y - g.y) };
        if (type === 'G') return { x: gamma * (r.x - b.x), y: gamma * (r.y - b.y) };
        if (type === 'B') return { x: gamma * (g.x - r.x), y: gamma * (g.y - r.y) };
        return { x: 0, y: 0 };
    }

    computeMeans() {
        const sums = { R: {x:0,y:0,c:0}, G: {x:0,y:0,c:0}, B: {x:0,y:0,c:0}, ALL: {x:0,y:0,c:0} };
        this.data.agents.forEach(a => {
            if(a.status === 'dead') return;
            sums[a.type].x += a.pos[0]; sums[a.type].y += a.pos[1]; sums[a.type].c++;
            sums.ALL.x += a.pos[0]; sums.ALL.y += a.pos[1]; sums.ALL.c++;
        });
        const means = {};
        ['R','G','B'].forEach(k => means[k] = sums[k].c ? {x: sums[k].x/sums[k].c, y: sums[k].y/sums[k].c} : {x:0,y:0});
        means.ALL = sums.ALL.c ? {x: sums.ALL.x/sums.ALL.c, y: sums.ALL.y/sums.ALL.c} : {x:0,y:0};
        return means;
    }

    step() {
        const means = this.computeMeans();
        const p = this.params;
        const dt = p.dt;
        const sqDt = Math.sqrt(dt);

        this.data.agents.forEach(agent => {
            if(agent.status === 'dead') return;

            const x = agent.pos[0];
            const y = agent.pos[1];
            const vx = agent.vx;
            const vy = agent.vy;
            const center = TYPE_CENTERS[agent.type];

            // --- FORCE CALCULATION ---
            let fx = 0, fy = 0;

            // 1. Drift to Center
            fx += -p.k * (x - center.x);
            fy += -p.k * (y - center.y);

            // 2. Mean Contraction
            const dx = x - means.ALL.x;
            const dy = y - means.ALL.y;
            fx += -p.alpha * dx + p.beta * dy;
            fy += -p.alpha * dy - p.beta * dx;

            // 3. RPS
            const rps = this.rpsDrift(agent.type, means);
            fx += rps.x;
            fy += rps.y;

            // 4. Ecology (Gradient Climb)
            const eco = this.gradEco(agent.type, x, y);
            fx += p.eco * eco.x;
            fy += p.eco * eco.y;

            // 5. Shoreline Containment (Hard Soft-Wall)
            // Calculate mask gradient to know which way is "Inland"
            const eps = 0.05;
            const m = islandMask(x, y, this.islandSeed);
            if (m < 0.45) { // Warning Zone
                const mX = islandMask(x + eps, y, this.islandSeed);
                const mY = islandMask(x, y + eps, this.islandSeed);
                const gX = (mX - m) / eps;
                const gY = (mY - m) / eps;
                
                // Force = Steep push towards higher ground
                const pen = (0.45 - m) * p.shore; 
                fx += gX * pen * 50; 
                fy += gY * pen * 50;
                
                // Damping increase in water (muddy)
                agent.vx *= 0.9;
                agent.vy *= 0.9;
            }

            // --- INTEGRATION (Underdamped Langevin) ---
            // dV = (-gamma*V + F/m)dt + (sigma/m)*dW
            // dX = V*dt
            
            const noiseX = this.rng.nextGaussian();
            const noiseY = this.rng.nextGaussian();

            // Update Velocity
            const dvx = (-p.friction * vx + fx / p.mass) * dt + (p.sigma / p.mass) * sqDt * noiseX;
            const dvy = (-p.friction * vy + fy / p.mass) * dt + (p.sigma / p.mass) * sqDt * noiseY;
            
            agent.vx += dvx;
            agent.vy += dvy;

            // Update Position
            agent.pos[0] += agent.vx * dt;
            agent.pos[1] += agent.vy * dt;
        });
    }
}

// Export for module use if needed, but primarily designed for browser global script inclusion
if (typeof module !== 'undefined') module.exports = { Engine, PRNG, islandMask, getTerrainColor };
