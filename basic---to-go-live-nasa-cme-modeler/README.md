# CME Modeler

A fresh, minimal coronal mass ejection modeling workspace built with Vite + React. Adjust launch parameters, visualize a
simple propagation profile, and review example events.

## Getting started

```bash
npm install
npm run dev
```

Then open the printed localhost URL.

## Development notes
- The propagation model is intentionally lightweight: a linear acceleration curve between launch and 1 AU.
- Adjust acceleration to negative values to simulate aerodynamic drag.
- Chart.js renders the distance and speed timeline on the same plot for quick comparisons.
