import numpy as np
import matplotlib.pyplot as plt

# Configuration
N = 50  # Players
T = 100 # Time steps
dt = 0.1
sigma = 0.5 # Noise level

# Initialize Positions (Random in 2D space)
X = np.random.randn(N, 2) * 5

# Classes (0: Guard, 1: Mage, 2: Ninja)
classes = np.random.randint(0, 3, N)

def interaction_kernel(xi, xj, c_type):
    r = xi - xj
    dist = np.linalg.norm(r)
    if dist < 1e-3: return np.zeros(2)
    
    # Gradient Guard (Repulsion)
    if c_type == 0:
        return 2.0 * r / (dist**3) if dist < 2 else np.zeros(2)
    # Tensor Caster (Long range attraction)
    elif c_type == 1:
        return -0.5 * r / dist 
    # Ninja (No interaction)
    else:
        return np.zeros(2)

def potential_gradient(x):
    # Double-well potential (Food sources at -3 and +3)
    return 0.1 * (x**3 - 9*x)

# Simulation Loop
history = []
for t in range(T):
    X_new = np.zeros_like(X)
    for i in range(N):
        drift = -potential_gradient(X[i])
        
        interaction = np.zeros(2)
        for j in range(N):
            if i == j: continue
            interaction += interaction_kernel(X[i], X[j], classes[i])
        interaction /= N
        
        noise = np.random.randn(2) * np.sqrt(dt) * sigma
        
        # McKean-Vlasov Update
        X_new[i] = X[i] + (drift + interaction) * dt + noise
        
    X = X_new
    history.append(X.copy())

print("Simulation complete. Data generated for N=50 agents.")
# You would visualize 'history' to see the swarm dynamics.
