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
        this.islandSeed = 1337;
        this.time = 0; // Simulation time for wind/waves
        
        // Physics Params (Underdamped)
        this.params = {
            dt: 0.05,
            sigma: 0.8,
            friction: 2.5,
            mass: 1.0,
            k: 0.5,
            alpha: 0.6,
            beta: 2.2,
            rps: 1.2,
            eco: 1.5,
            shore: 20.0
        };
        if(worldData.config) Object.assign(this.params, worldData.config);

        // Initialize Velocity
        this.data.agents.forEach(a => {
            if (typeof a.vx === 'undefined') a.vx = 0;
            if (typeof a.vy === 'undefined') a.vy = 0;
        });
    }

    // ------------------------------------------------------------------
    // BIOME LOGIC (Tri-Sector Island)
    // ------------------------------------------------------------------
    
    getBiome(x, y) {
        // 3 Sectors: Red (Volcano), Green (Forest), Blue (Swamp)
        // Angle determines sector, Noise determines boundary wobble
        const angle = Math.atan2(y, x); // -PI to PI
        const r = Math.sqrt(x*x + y*y);
        
        // Wobble the boundaries
        const wobble = fbm(x * 2, y * 2, this.islandSeed + 99) * 0.5;
        const a = angle + wobble;

        // Normalizing angle to [0, 2PI) for easier logic
        let na = a;
        if (na < 0) na += Math.PI * 2;

        // Sectors (120 degrees each)
        // 0 to 2.09 (0 to 120): Red/Volcano
        // 2.09 to 4.18 (120 to 240): Green/Forest
        // 4.18 to 6.28 (240 to 360): Blue/Swamp
        
        if (na < 2.094) return 'R'; // Volcano
        if (na < 4.188) return 'G'; // Forest
        return 'B';                 // Swamp
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
        const biome = this.getBiome(x, y);
        
        // Base preference: Stay on land
        if (m < 0.45) return -10.0; // Hate water/void

        // Strong preference for own biome
        if (biome === type) {
            // Within own biome, prefer certain features
            if (type === 'R') return m; // Fire likes high peaks (Volcano)
            if (type === 'G') return 1.0 - Math.abs(m - 0.6); // Green likes mid-elevation
            if (type === 'B') return (1.0 - m); // Blue likes low-elevation (Swamp)
        }
        
        return 0.0; // Neutral to other land
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

    // Dynamic Wind Field (Curl Noise)
    getWind(x, y, t) {
        const scale = 1.5;
        const speed = 0.5;
        // Curl of noise potential = (dPsi/dy, -dPsi/dx) -> divergence free
        const eps = 0.01;
        const psi = (tx, ty) => fbm(tx * scale + t*speed, ty * scale, this.islandSeed + 123);
        const wy = (psi(x + eps, y) - psi(x - eps, y)) / (2 * eps);
        const wx = -(psi(x, y + eps) - psi(x, y - eps)) / (2 * eps);
        return { x: wx, y: wy };
    }

    step() {
        const means = this.computeMeans();
        const p = this.params;
        const dt = p.dt;
        const sqDt = Math.sqrt(dt);
        this.time += dt;

        // 1. STOCHASTIC FOOD GROWTH
        if (this.rng.next() < 0.03) { 
            const x = (this.rng.next() - 0.5) * 3.2;
            const y = (this.rng.next() - 0.5) * 3.2;
            if (islandMask(x, y, this.islandSeed) > 0.5) {
                if (!this.data.food) this.data.food = [];
                this.data.food.push({ 
                    x, y, 
                    val: 15, 
                    type: this.getBiome(x, y),
                    id: "food_" + Math.floor(this.rng.next() * 100000)
                });
            }
        }

        // 2. AGENT BIOLOGY & COMBAT
        this.data.agents.forEach(agent => {
            if (agent.status === 'fainted') {
                // Revival Logic: Slowly heal at home center
                const center = TYPE_CENTERS[agent.type];
                const dToCenter = Math.hypot(agent.pos[0] - center.x, agent.pos[1] - center.y);
                if (dToCenter > 0.2) {
                    // Warp to center
                    agent.pos[0] = center.x;
                    agent.pos[1] = center.y;
                    agent.vx = 0; agent.vy = 0;
                }
                agent.stats.hp += 0.1; // Slow heal
                if (agent.stats.hp >= 50) agent.status = 'alive';
                return;
            }

            const x = agent.pos[0];
            const y = agent.pos[1];
            const vx = agent.vx;
            const vy = agent.vy;
            const center = TYPE_CENTERS[agent.type];

            // 2a. EATING
            if (this.data.food) {
                for (let i = this.data.food.length - 1; i >= 0; i--) {
                    const f = this.data.food[i];
                    const dist = Math.hypot(x - f.x, y - f.y);
                    if (dist < 0.15) { 
                        agent.stats.hp = Math.min(100, agent.stats.hp + f.val);
                        agent.stats.xp += 5;
                        this.data.food.splice(i, 1);
                        break; 
                    }
                }
            }

            // 2b. COMBAT (Proximity detection)
            this.data.agents.forEach(other => {
                if (agent === other || other.status !== 'alive') return;
                const dist = Math.hypot(x - other.pos[0], y - other.pos[1]);
                if (dist < 0.12) {
                    // Resolve RPS Advantage
                    // R > G, G > B, B > R
                    let advantage = false;
                    if (agent.type === 'R' && other.type === 'G') advantage = true;
                    if (agent.type === 'G' && other.type === 'B') advantage = true;
                    if (agent.type === 'B' && other.type === 'R') advantage = true;

                    if (advantage) {
                        const dmg = 1.0 + (agent.stats.xp / 100);
                        other.stats.hp -= dmg;
                        agent.stats.xp += 0.2;
                        if (other.stats.hp <= 0) {
                            other.stats.hp = 0;
                            other.status = 'fainted';
                            agent.stats.xp += 50; // Big reward for "Knockout"
                        }
                    }
                }
            });

            // --- FORCE CALCULATION ---
            let fx = 0, fy = 0;

            // 3. Drift to Center (Reduced)
            fx += -p.k * 0.3 * (x - center.x);
            fy += -p.k * 0.3 * (y - center.y);

            // 4. Mean Contraction
            const dx = x - means.ALL.x;
            const dy = y - means.ALL.y;
            fx += -p.alpha * dx + p.beta * dy;
            fy += -p.alpha * dy - p.beta * dx;

            // 5. RPS (Biological Social Drift)
            const rps = this.rpsDrift(agent.type, means);
            fx += rps.x;
            fy += rps.y;

            // 6. Ecology
            const eco = this.gradEco(agent.type, x, y);
            fx += p.eco * 4.0 * eco.x;
            fy += p.eco * 4.0 * eco.y;

            // 7. Wind
            const wind = this.getWind(x, y, this.time);
            fx += wind.x * 0.4;
            fy += wind.y * 0.4;

            // 8. Shoreline
            const m = islandMask(x, y, this.islandSeed);
            if (m < 0.45) {
                const eps = 0.05;
                const mX = islandMask(x + eps, y, this.islandSeed);
                const mY = islandMask(x, y + eps, this.islandSeed);
                const gX = (mX - m) / eps;
                const gY = (mY - m) / eps;
                const pen = (0.45 - m) * p.shore; 
                fx += gX * pen * 100; 
                fy += gY * pen * 100;
                agent.vx *= 0.7;
                agent.vy *= 0.7;
            }

            // --- INTEGRATION ---
            const noiseX = this.rng.nextGaussian();
            const noiseY = this.rng.nextGaussian();

            const dvx = (-p.friction * vx + fx / p.mass) * dt + (p.sigma / p.mass) * sqDt * noiseX;
            const dvy = (-p.friction * vy + fy / p.mass) * dt + (p.sigma / p.mass) * sqDt * noiseY;
            
            agent.vx += dvx;
            agent.vy += dvy;

            agent.pos[0] += agent.vx * dt;
            agent.pos[1] += agent.vy * dt;
        });
    }
}

// Helper to determine pixel color for rendering based on Tri-Biome
function getTerrainColor(m, x, y, seed) {
    if (m < 0.42) return [10, 70, 110]; // Ocean
    if (m < 0.48) return [224, 206, 140]; // Beach

    const eng = new Engine({meta:{}, agents:[]}); // Temp engine for static lookup
    const biome = eng.getBiome(x, y);
    const noise = fbm(x*3, y*3, seed + 555); // Texture detail

    if (biome === 'R') {
        // VOLCANO SECTOR
        if (m > 0.85) return [50, 20, 20]; // Crater
        if (m > 0.7) return [100 + noise*40, 50, 40]; // Rock
        return [80, 40, 30]; // Ash soil
    }
    if (biome === 'G') {
        // FOREST SECTOR
        if (m > 0.7) return [20, 80 + noise*40, 30]; // Deep forest
        return [50, 120 + noise*30, 60]; // Grassland
    }
    if (biome === 'B') {
        // SWAMP SECTOR
        if (m > 0.5 && m < 0.6) return [40, 60, 100 + noise*50]; // Pools
        return [40, 50, 60]; // Mud
    }
    return [200, 200, 200];
}
