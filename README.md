# The Island: Project Infrastructure

This project implements a persistent, rigorous stochastic simulation of an ecosystem using a "Git-as-Backend" architecture.

## Overview

The simulation models $N$ agents (Pokemon) evolving according to **McKean-Vlasov Stochastic Differential Equations (SDEs)**. The state of the world is persistent, meaning the "Week 1" state is saved, then "Week 2" is computed from it, and so on.

## File Structure

*   `island.html`: **The Viewer**. This is the public-facing page for students. It loads the world state and renders a "live" visualization (local micro-simulation) of the current week.
*   `admin.html`: **The Simulator**. This is for the Instructor. It loads the world state, computes the heavy mathematical evolution for the next week, and exports the new JSON.
*   `data/world.json`: **The Database**. Contains the canonical state of every agent (position, stats, type) and the environment.
*   `js/sim_engine.js`: **The Core**. Contains the shared physics logic, the `PRNG` (deterministic random number generator), and terrain algorithms.

## Workflow (The 14-Week Semester)

1.  **Start of Week**:
    *   Instructor opens `admin.html`.
    *   Click **Load from Server**.
    *   Click **SIMULATE WEEK**. (This runs the SDE for $T$ steps).
    *   Click **Download File** to get the new `world.json`.
2.  **Publish**:
    *   Instructor overwrites `data/world.json` with the new file.
    *   Instructor commits and pushes to GitHub (`git add . && git commit -m "Week X" && git push`).
3.  **Student View**:
    *   Students visit `island.html`.
    *   They see the new positions and stats.
    *   The browser runs a local, visually pleasing simulation starting from that canonical state.

## Technical Details

*   **Synchronization**: We use a `PRNG` (Mulberry32) seeded by the `world.json` meta-data. This ensures that even though the simulation runs client-side for visualization, every student sees the same stochastic noise patterns.
*   **Physics**: The SDE includes:
    *   **Ornstein-Uhlenbeck** drift toward type centers.
    *   **Mean-Field** attraction/repulsion.
    *   **Rock-Paper-Scissors** cyclic drift.
    *   **Ecology Potentials** (agents climb gradients of their preferred terrain).
    *   **Langevin Diffusion** (Gaussian noise).