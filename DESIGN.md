# Project: The Island (CPSC 4860)

## Overview
A persistent, stochastic ecosystem simulation running over a 14-week academic semester. The world consists of autonomous agents ("Pokemon") governed by McKean-Vlasov SDEs, interacting within a finite island domain.

## Infrastructure: "Git-as-Backend"

Since the hosting platform (GitHub Pages) is static, state persistence is managed via version control.

### The Loop
1.  **State File (`world.json`)**: The JSON file in the repo acting as the database.
2.  **Simulation Step (Admin)**: The instructor runs the physics engine locally to advance time (e.g., `t` to `t + 1 week`).
3.  **Synchronization**: The instructor commits and pushes the updated JSON.
4.  **Visualization (Client)**: Students' browsers fetch the JSON to render the current "frozen" state of the world.

## Data Schema (`world.json`)

```json
{
  "meta": {
    "week": 1,
    "last_updated": "2026-01-18",
    "global_temperature": 0.5
  },
  "agents": [
    {
      "id": "pkm_001",
      "name": "Bulb",
      "type": "G", // Red, Green, Blue
      "pos": [10.5, -5.2],
      "stats": {
        "hp": 100,
        "mp": 50,
        "attack": 10,
        "defense": 5
      },
      "personality": {
        "bravery": 0.8,
        "affinity_center": -0.5
      },
      "status": "alive" // alive, dead, egg
    }
  ],
  "environment": {
    "food_sources": [ { "x": 0, "y": 0, "value": 50 } ],
    "hazards": []
  },
  "history": [] // Optional: Log of major events (deaths, level ups)
}
```

## Game Engine Implementation Details

### 1. Dynamics (SDE)
Agents move according to:
$$ dX_t = \underbrace{F_{env}(X_t)dt}_{\text{Drift}} + \underbrace{\frac{1}{N} \sum F_{int}(X_t - X_j)dt}_{\text{Social}} + \underbrace{\sqrt{2\sigma} dB_t}_{\text{Noise}} $$

*   **Drift**: Determined by `personality.affinity_center`.
*   **Interaction**:
    *   **Same Type (R-R)**: Attraction (Swarming).
    *   **Weak Type (R-G)**: Pursuit (Predator-Prey).
    *   **Strong Type (R-B)**: Repulsion (Fear).

### 2. State Machine
*   **Eating**: If `dist(agent, food) < threshold`, `hp += food_value`.
*   **Combat**: If `dist(agent_A, agent_B) < threshold` AND types are hostile:
    *   Calculate damage based on `attack` vs `defense`.
    *   If `hp <= 0`, set `status = "dead"`.

### 3. File Structure
*   `island.html`: The student-facing visualization. Reads `world.json`.
*   `admin.html` (Protected): The simulation runner. Writes/Exports `world.json`.
*   `js/engine.js`: Shared physics logic.
*   `data/world.json`: The database.

## Extension Guide
*   **To add new stats**: Update the `agents` objects in `world.json`. The engine handles generic properties gracefully.
*   **To run weekly**: Open `admin.html`, load current file, click "Simulate Week", save result, commit to Git.
