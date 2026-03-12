const canvas = document.getElementById("landscape");
const context = canvas.getContext("2d");
const replayButton = document.getElementById("replay");
const randomizeSpaceButton = document.getElementById("randomize-space");
const algorithmButtons = document.getElementById("algorithm-buttons");
const terrainButtons = document.getElementById("terrain-buttons");
const algorithmName = document.getElementById("algorithm-name");
const algorithmSummary = document.getElementById("algorithm-summary");
const activeTitle = document.getElementById("active-title");
const spaceStatus = document.getElementById("space-status");
const legend = document.getElementById("legend");

const algorithms = [
  {
    id: "all",
    name: "All algorithms",
    color: "#2d241f",
    summary:
      "Compare the motion patterns: restarts, perturbation jumps, population mixing, and model-guided sampling.",
  },
  {
    id: "msls",
    name: "Multi-start local search",
    color: "#d1495b",
    summary:
      "Independent random starts each climb to a nearby local optimum. Exploration comes from restarting, not from memory or structure across runs.",
  },
  {
    id: "ils",
    name: "Iterated Local Search",
    color: "#2f7fc1",
    summary:
      "A local optimum is perturbed, then refined again. The trajectory alternates between local improvement and targeted jumps into new basins.",
  },
  {
    id: "gls",
    name: "Genetic Local Search",
    color: "#1f9d7a",
    summary:
      "A population explores several basins, recombines information from different parents, and locally improves offspring toward strong optima.",
  },
  {
    id: "pmb",
    name: "Probabilistic Model Building Local Search",
    color: "#8b5cf6",
    summary:
      "Promising samples define a probabilistic model, which is then resampled and locally improved. The model contracts around successful basins over time.",
  },
];

const palette = {
  msls: "#d1495b",
  ils: "#2f7fc1",
  gls: "#1f9d7a",
  pmb: "#8b5cf6",
};

const terrainModes = [
  { id: "smooth", name: "Smooth" },
  { id: "rugged", name: "Rugged" },
];

let activeAlgorithm = "all";
let activeTerrain = "smooth";
let animationStart = 0;
let animationFrame = 0;
let backgroundImage = null;
let terrainModel = null;
let searchModel = null;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function clampPoint([x, y], padding = 0.04) {
  return [clamp(x, padding, 1 - padding), clamp(y, padding, 1 - padding)];
}

function lerp(start, end, t) {
  return start + (end - start) * t;
}

function interpolatePoint(start, end, t) {
  return [
    lerp(start[0], end[0], t),
    lerp(start[1], end[1], t),
  ];
}

function mapPoint([x, y]) {
  return [x * canvas.width, y * canvas.height];
}

function distance(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

function normalize([x, y]) {
  const length = Math.hypot(x, y) || 1;
  return [x / length, y / length];
}

function createRng(seed) {
  let value = seed >>> 0;

  return function nextRandom() {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

function randomBetween(rng, min, max) {
  return min + (max - min) * rng();
}

function jitterPoint(point, rng, amount) {
  return clampPoint([
    point[0] + randomBetween(rng, -amount, amount),
    point[1] + randomBetween(rng, -amount, amount),
  ]);
}

function selectDistinctOptima(peaks, count) {
  const optima = [];
  const sorted = [...peaks].sort((left, right) => right.amp - left.amp);

  for (const peak of sorted) {
    const point = [peak.x, peak.y];

    if (optima.every((optimum) => distance(point, optimum.point) > 0.14)) {
      optima.push({ point, amp: peak.amp, spread: peak.spread });
    }

    if (optima.length === count) {
      break;
    }
  }

  return optima;
}

function buildTerrain(mode) {
  const seed = (Date.now() ^ Math.floor(Math.random() * 1e9)) >>> 0;
  const rng = createRng(seed);
  const config =
    mode === "rugged"
      ? {
          baseAmp: 0.055,
          waveAmp: 0.09,
          waveFreqX: randomBetween(rng, 10, 16),
          waveFreqY: randomBetween(rng, 11, 18),
          ridgeAmp: 0.035,
          ridgeFreq: randomBetween(rng, 24, 36),
          peakCount: 9,
          dominantPeaks: 4,
          spreadMin: 0.008,
          spreadMax: 0.02,
          ampMin: 0.22,
          ampMax: 0.82,
          strongAmpMin: 0.9,
          strongAmpMax: 1.3,
          scale: 1.7,
          minPeakDistance: 0.11,
        }
      : {
          baseAmp: 0.04,
          waveAmp: 0.03,
          waveFreqX: randomBetween(rng, 4, 7),
          waveFreqY: randomBetween(rng, 4, 7),
          ridgeAmp: 0.012,
          ridgeFreq: randomBetween(rng, 12, 18),
          peakCount: 6,
          dominantPeaks: 3,
          spreadMin: 0.02,
          spreadMax: 0.045,
          ampMin: 0.28,
          ampMax: 0.75,
          strongAmpMin: 1.0,
          strongAmpMax: 1.5,
          scale: 1.6,
          minPeakDistance: 0.16,
        };

  const peaks = [];
  let attempts = 0;

  while (peaks.length < config.peakCount && attempts < 800) {
    attempts += 1;
    const index = peaks.length;
    const candidate = {
      x: randomBetween(rng, 0.12, 0.86),
      y: randomBetween(rng, 0.12, 0.86),
      amp:
        index < config.dominantPeaks
          ? randomBetween(rng, config.strongAmpMin, config.strongAmpMax)
          : randomBetween(rng, config.ampMin, config.ampMax),
      spread: randomBetween(rng, config.spreadMin, config.spreadMax),
    };

    const isFarEnough = peaks.every(
      (peak) => distance([candidate.x, candidate.y], [peak.x, peak.y]) > config.minPeakDistance
    );

    if (isFarEnough) {
      peaks.push(candidate);
    }
  }

  peaks.sort((left, right) => right.amp - left.amp);

  return {
    mode,
    seed,
    peaks,
    optima: selectDistinctOptima(peaks, Math.min(4, peaks.length)),
    config,
  };
}

function landscapeValue(x, y) {
  const { peaks, config } = terrainModel;
  let value =
    config.baseAmp +
    config.waveAmp * Math.sin(config.waveFreqX * x) * Math.cos(config.waveFreqY * y);

  for (const peak of peaks) {
    const dx = x - peak.x;
    const dy = y - peak.y;
    value += peak.amp * Math.exp(-(dx * dx + dy * dy) / peak.spread);
  }

  return value;
}

function createLandscape() {
  const offscreen = document.createElement("canvas");
  offscreen.width = canvas.width;
  offscreen.height = canvas.height;
  const offscreenContext = offscreen.getContext("2d");
  const imageData = offscreenContext.createImageData(offscreen.width, offscreen.height);
  const data = imageData.data;

  for (let y = 0; y < offscreen.height; y += 1) {
    for (let x = 0; x < offscreen.width; x += 1) {
      const nx = x / offscreen.width;
      const ny = y / offscreen.height;
      const value = Math.min(1, landscapeValue(nx, ny) / terrainModel.config.scale);
      const ridge =
        Math.sin((nx + ny) * terrainModel.config.ridgeFreq) *
        terrainModel.config.ridgeAmp;
      const intensity = clamp(value + ridge, 0, 1);
      const index = (y * offscreen.width + x) * 4;

      data[index] = Math.round(lerp(93, 255, intensity));
      data[index + 1] = Math.round(lerp(69, 241, intensity));
      data[index + 2] = Math.round(lerp(43, 208, intensity));
      data[index + 3] = 255;
    }
  }

  offscreenContext.putImageData(imageData, 0, 0);
  offscreenContext.strokeStyle = "rgba(81, 57, 30, 0.12)";
  offscreenContext.lineWidth = 1;

  for (let contour = 0.18; contour < 1; contour += 0.14) {
    offscreenContext.beginPath();

    for (let x = 0; x <= offscreen.width; x += 6) {
      for (let y = 0; y <= offscreen.height; y += 6) {
        const nx = x / offscreen.width;
        const ny = y / offscreen.height;
        const value = Math.min(1, landscapeValue(nx, ny) / terrainModel.config.scale);

        if (Math.abs(value - contour) < 0.01) {
          offscreenContext.rect(x, y, 1, 1);
        }
      }
    }

    offscreenContext.stroke();
  }

  backgroundImage = offscreen;
}

function buildClimbPath(start, target, steps, rng, curvature = 0.08) {
  const points = [start];
  const direction = [target[0] - start[0], target[1] - start[1]];
  const perpendicular = normalize([-direction[1], direction[0]]);

  for (let index = 1; index < steps; index += 1) {
    const t = index / steps;
    const eased = 1 - (1 - t) ** 1.6;
    const offset = (0.5 - Math.abs(t - 0.5)) * 2;
    const bend = randomBetween(rng, -curvature, curvature) * offset;
    const base = interpolatePoint(start, target, eased * 0.92);
    points.push(
      clampPoint([
        base[0] + perpendicular[0] * bend,
        base[1] + perpendicular[1] * bend,
      ])
    );
  }

  points.push(target);
  return points;
}

function chooseStartForOptimum(optimum, angle, radius) {
  return clampPoint([
    optimum[0] + Math.cos(angle) * radius,
    optimum[1] + Math.sin(angle) * radius,
  ]);
}

function buildSearchModel(model) {
  const rng = createRng((model.seed ^ 0x9e3779b9) >>> 0);
  const optima = model.optima.map((optimum) => optimum.point);
  const fallback = optima[0] || [0.5, 0.5];
  const first = optima[0] || fallback;
  const second = optima[1] || first;
  const third = optima[2] || second;
  const fourth = optima[3] || third;

  const mslsTargets = [first, second, third];
  const msls = mslsTargets.map((target, index) => {
    const angle = -2.2 + index * 1.35;
    const radius = model.mode === "rugged" ? 0.32 : 0.28;
    const start = jitterPoint(chooseStartForOptimum(target, angle, radius), rng, 0.035);
    return {
      kind: "restart",
      points: buildClimbPath(start, target, 4, rng, 0.08),
    };
  });

  const ilsStart = jitterPoint(chooseStartForOptimum(second, -2.5, 0.27), rng, 0.025);
  const ilsJumpOne = jitterPoint(chooseStartForOptimum(first, 1.9, 0.19), rng, 0.02);
  const ilsJumpTwo = jitterPoint(chooseStartForOptimum(third, -0.7, 0.17), rng, 0.02);
  const ilsSegmentOne = buildClimbPath(ilsStart, second, 4, rng, 0.06);
  const ilsSegmentTwo = buildClimbPath(ilsJumpOne, first, 4, rng, 0.05);
  const ilsSegmentThree = buildClimbPath(ilsJumpTwo, third, 3, rng, 0.04);
  const ilsPoints = [
    ...ilsSegmentOne,
    ilsJumpOne,
    ...ilsSegmentTwo.slice(1),
    ilsJumpTwo,
    ...ilsSegmentThree.slice(1),
  ];
  const ilsJumps = [
    ilsSegmentOne.length - 1,
    ilsSegmentOne.length + ilsSegmentTwo.length - 1,
  ];

  const population0 = [
    jitterPoint(chooseStartForOptimum(first, -2.6, 0.22), rng, 0.03),
    jitterPoint(chooseStartForOptimum(second, 2.5, 0.2), rng, 0.03),
    jitterPoint(chooseStartForOptimum(third, -0.25, 0.22), rng, 0.03),
    jitterPoint(chooseStartForOptimum(fourth, 2.95, 0.18), rng, 0.025),
    jitterPoint(interpolatePoint(second, first, 0.45), rng, 0.035),
  ];
  const population1 = [
    interpolatePoint(population0[0], first, 0.5),
    interpolatePoint(population0[1], second, 0.58),
    interpolatePoint(population0[2], third, 0.55),
    interpolatePoint(population0[3], fourth, 0.52),
    interpolatePoint(population0[4], first, 0.42),
  ].map((point) => jitterPoint(point, rng, 0.015));
  const population2 = [
    interpolatePoint(population1[0], first, 0.75),
    interpolatePoint(population1[1], second, 0.72),
    interpolatePoint(population1[2], third, 0.75),
    interpolatePoint(population1[3], first, 0.7),
    interpolatePoint(population1[4], first, 0.82),
  ].map((point) => jitterPoint(point, rng, 0.01));
  const familyChild = jitterPoint(interpolatePoint(population1[1], population1[3], 0.5), rng, 0.012);
  const familyRefined = jitterPoint(
    terrainModel.mode === "rugged" ? second : first,
    rng,
    0.008
  );

  const modelStepOneCenter = clampPoint([
    (first[0] + second[0] + third[0]) / 3,
    (first[1] + second[1] + third[1]) / 3,
  ]);
  const modelStepTwoCenter = jitterPoint(first, rng, 0.01);
  const modelSamplesOne = [
    jitterPoint(modelStepOneCenter, rng, 0.14),
    jitterPoint(modelStepOneCenter, rng, 0.12),
    jitterPoint(modelStepOneCenter, rng, 0.1),
    jitterPoint(interpolatePoint(modelStepOneCenter, second, 0.5), rng, 0.08),
    jitterPoint(interpolatePoint(modelStepOneCenter, third, 0.55), rng, 0.08),
  ];
  const modelRefinedOne = [first, second, third, second, first].map((target) =>
    jitterPoint(target, rng, 0.012)
  );
  const modelSamplesTwo = [
    jitterPoint(modelStepTwoCenter, rng, 0.07),
    jitterPoint(modelStepTwoCenter, rng, 0.06),
    jitterPoint(interpolatePoint(modelStepTwoCenter, second, 0.35), rng, 0.05),
    jitterPoint(interpolatePoint(modelStepTwoCenter, first, 0.2), rng, 0.05),
  ];
  const modelRefinedTwo = [first, first, second, first].map((target) =>
    jitterPoint(target, rng, 0.009)
  );

  return {
    msls,
    ils: [
      {
        kind: "ils",
        points: ilsPoints,
        jumps: ilsJumps,
      },
    ],
    gls: [
      { kind: "population", generation: 0, points: population0 },
      { kind: "population", generation: 1, points: population1 },
      { kind: "population", generation: 2, points: population2 },
      {
        kind: "family",
        parentA: population1[1],
        parentB: population1[3],
        child: familyChild,
        refined: familyRefined,
      },
    ],
    pmb: [
      {
        kind: "model",
        center: modelStepOneCenter,
        radiusX: model.mode === "rugged" ? 0.16 : 0.19,
        radiusY: model.mode === "rugged" ? 0.11 : 0.13,
        samples: modelSamplesOne,
        refined: modelRefinedOne,
      },
      {
        kind: "model",
        center: modelStepTwoCenter,
        radiusX: model.mode === "rugged" ? 0.09 : 0.11,
        radiusY: model.mode === "rugged" ? 0.07 : 0.08,
        samples: modelSamplesTwo,
        refined: modelRefinedTwo,
      },
    ],
  };
}

function setTerrainLabel() {
  const label = activeTerrain === "rugged" ? "Rugged" : "Smooth";
  spaceStatus.textContent = `${label} landscape • ${terrainModel.optima.length} visible local optima`;
}

function setPanelContent(id) {
  const selected = algorithms.find((algorithm) => algorithm.id === id) || algorithms[0];
  activeTitle.textContent = selected.name;
  algorithmName.textContent = selected.name;
  algorithmSummary.textContent = selected.summary;
}

function buildLegend() {
  legend.innerHTML = "";

  for (const algorithm of algorithms.slice(1)) {
    const item = document.createElement("div");
    item.className = "legend-item";
    item.innerHTML = `<span class="swatch" style="background:${algorithm.color}"></span>${algorithm.name}`;
    legend.appendChild(item);
  }
}

function buildButtons() {
  for (const algorithm of algorithms) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "filter-button";
    button.textContent = algorithm.name;
    button.dataset.algorithm = algorithm.id;

    button.addEventListener("click", () => {
      activeAlgorithm = algorithm.id;
      animationStart = performance.now();
      syncButtons();
      setPanelContent(activeAlgorithm);
    });

    algorithmButtons.appendChild(button);
  }
}

function buildTerrainButtons() {
  for (const terrain of terrainModes) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "filter-button";
    button.textContent = terrain.name;
    button.dataset.terrain = terrain.id;

    button.addEventListener("click", () => {
      rebuildTerrain(terrain.id);
      syncTerrainButtons();
    });

    terrainButtons.appendChild(button);
  }
}

function syncButtons() {
  const buttons = algorithmButtons.querySelectorAll("button");

  for (const button of buttons) {
    const isActive = button.dataset.algorithm === activeAlgorithm;
    const key = button.dataset.algorithm;
    const color = key === "all" ? "#2d241f" : palette[key];

    button.classList.toggle("active", isActive);
    button.style.background = isActive
      ? `linear-gradient(135deg, ${color}, #2d241f)`
      : "rgba(255, 248, 236, 0.96)";
    button.style.color = isActive ? "#fffdf7" : "#1f1a16";
  }
}

function syncTerrainButtons() {
  const buttons = terrainButtons.querySelectorAll("button");

  for (const button of buttons) {
    const isActive = button.dataset.terrain === activeTerrain;
    button.classList.toggle("active", isActive);
    button.style.background = isActive
      ? "linear-gradient(135deg, #6b523b, #2d241f)"
      : "rgba(255, 248, 236, 0.96)";
    button.style.color = isActive ? "#fffdf7" : "#1f1a16";
  }
}

function rebuildTerrain(mode = activeTerrain) {
  activeTerrain = mode;
  terrainModel = buildTerrain(activeTerrain);
  searchModel = buildSearchModel(terrainModel);
  createLandscape();
  setTerrainLabel();
  animationStart = performance.now();
}

function progressAt(timestamp, speed = 0.00022) {
  return Math.min(1, (timestamp - animationStart) * speed);
}

function drawBase() {
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.drawImage(backgroundImage, 0, 0);
  context.strokeStyle = "rgba(76, 56, 36, 0.12)";
  context.lineWidth = 1;

  for (let index = 1; index < 10; index += 1) {
    const x = (canvas.width / 10) * index;
    const y = (canvas.height / 10) * index;

    context.beginPath();
    context.moveTo(x, 0);
    context.lineTo(x, canvas.height);
    context.stroke();

    context.beginPath();
    context.moveTo(0, y);
    context.lineTo(canvas.width, y);
    context.stroke();
  }

  drawOptima();
}

function drawOptima() {
  context.save();

  for (const optimum of terrainModel.optima) {
    const [x, y] = mapPoint(optimum.point);

    context.strokeStyle = "rgba(255, 250, 220, 0.75)";
    context.lineWidth = 1.4;
    context.beginPath();
    context.arc(x, y, 10, 0, Math.PI * 2);
    context.stroke();

    context.fillStyle = "rgba(255, 250, 220, 0.95)";
    context.beginPath();
    context.arc(x, y, 2.6, 0, Math.PI * 2);
    context.fill();
  }

  context.restore();
}

function drawPoint(point, color, radius = 7, alpha = 1) {
  const [x, y] = mapPoint(point);
  context.save();
  context.globalAlpha = alpha;
  context.fillStyle = color;
  context.beginPath();
  context.arc(x, y, radius, 0, Math.PI * 2);
  context.fill();
  context.restore();
}

function drawPolyline(points, color, shownSegments, alpha = 1, dashed = false) {
  if (shownSegments <= 0) {
    return;
  }

  context.save();
  context.globalAlpha = alpha;
  context.strokeStyle = color;
  context.lineWidth = 3;
  context.lineCap = "round";
  context.lineJoin = "round";
  context.setLineDash(dashed ? [10, 8] : []);
  context.beginPath();

  const [startX, startY] = mapPoint(points[0]);
  context.moveTo(startX, startY);

  for (let index = 1; index < points.length && index <= shownSegments; index += 1) {
    const [x, y] = mapPoint(points[index]);
    context.lineTo(x, y);
  }

  context.stroke();
  context.restore();
}

function drawMSLS(timestamp) {
  const progress = progressAt(timestamp, 0.00018);
  const tracks = searchModel.msls;

  for (let index = 0; index < tracks.length; index += 1) {
    const local = clamp(progress * tracks.length - index, 0, 1);
    const visibleSegments = Math.floor(local * (tracks[index].points.length - 1));
    drawPolyline(tracks[index].points, palette.msls, visibleSegments, 0.95);

    for (let pointIndex = 0; pointIndex < tracks[index].points.length; pointIndex += 1) {
      if (pointIndex <= visibleSegments) {
        const radius = pointIndex === tracks[index].points.length - 1 ? 8 : 5;
        drawPoint(tracks[index].points[pointIndex], palette.msls, radius, 0.92);
      }
    }
  }
}

function drawILS(timestamp) {
  const path = searchModel.ils[0];
  const progress = progressAt(timestamp, 0.00013);
  const totalSegments = path.points.length - 1;
  const visibleSegments = Math.floor(progress * totalSegments);

  for (let index = 1; index <= visibleSegments; index += 1) {
    const isJump = path.jumps.includes(index - 1);
    drawPolyline([path.points[index - 1], path.points[index]], palette.ils, 1, 0.98, isJump);
  }

  for (let index = 0; index <= visibleSegments; index += 1) {
    drawPoint(path.points[index], palette.ils, path.jumps.includes(index) ? 8 : 6, 0.94);
  }
}

function drawPopulationRing(points, color, alpha) {
  context.save();
  context.strokeStyle = color;
  context.globalAlpha = alpha;
  context.lineWidth = 1.5;
  context.setLineDash([8, 6]);
  context.beginPath();

  const sorted = [...points].sort((left, right) => left[0] - right[0]);
  sorted.forEach((point, index) => {
    const [x, y] = mapPoint(point);
    if (index === 0) {
      context.moveTo(x, y);
    } else {
      context.lineTo(x, y);
    }
  });

  context.closePath();
  context.stroke();
  context.restore();
}

function drawGLS(timestamp) {
  const progress = progressAt(timestamp, 0.00019);
  const generations = searchModel.gls.filter((step) => step.kind === "population");
  const family = searchModel.gls.find((step) => step.kind === "family");

  for (let generation = 0; generation < generations.length; generation += 1) {
    const local = clamp(progress * generations.length - generation, 0, 1);

    if (local <= 0) {
      continue;
    }

    const points = generations[generation].points;
    drawPopulationRing(points, palette.gls, 0.24 + generation * 0.15);

    for (const point of points) {
      drawPoint(point, palette.gls, 6, 0.72 + generation * 0.08);
    }
  }

  if (progress > 0.62) {
    drawPolyline([family.parentA, family.child], palette.gls, 1, 0.9, true);
    drawPolyline([family.parentB, family.child], palette.gls, 1, 0.9, true);
    drawPolyline([family.child, family.refined], palette.gls, 1, 0.95);
    drawPoint(family.child, palette.gls, 7, 0.92);
    drawPoint(family.refined, palette.gls, 9, 1);
  }
}

function drawModelEllipse(step, color, alpha) {
  const [x, y] = mapPoint(step.center);
  context.save();
  context.strokeStyle = color;
  context.lineWidth = 2;
  context.globalAlpha = alpha;
  context.setLineDash([12, 10]);
  context.beginPath();
  context.ellipse(
    x,
    y,
    step.radiusX * canvas.width,
    step.radiusY * canvas.height,
    -0.5,
    0,
    Math.PI * 2
  );
  context.stroke();
  context.restore();
}

function drawPMB(timestamp) {
  const steps = searchModel.pmb;
  const progress = progressAt(timestamp, 0.00016);

  for (let stepIndex = 0; stepIndex < steps.length; stepIndex += 1) {
    const local = clamp(progress * steps.length - stepIndex, 0, 1);

    if (local <= 0) {
      continue;
    }

    const step = steps[stepIndex];
    drawModelEllipse(step, palette.pmb, 0.25 + stepIndex * 0.24);

    for (const sample of step.samples) {
      drawPoint(sample, palette.pmb, 5, 0.45);
    }

    const refinedCount = Math.floor(local * step.refined.length);

    for (let index = 0; index < refinedCount; index += 1) {
      drawPolyline([step.samples[index], step.refined[index]], palette.pmb, 1, 0.8);
      drawPoint(step.refined[index], palette.pmb, 7, 0.95);
    }
  }
}

function render(timestamp) {
  drawBase();

  if (activeAlgorithm === "all" || activeAlgorithm === "msls") {
    drawMSLS(timestamp);
  }

  if (activeAlgorithm === "all" || activeAlgorithm === "ils") {
    drawILS(timestamp);
  }

  if (activeAlgorithm === "all" || activeAlgorithm === "gls") {
    drawGLS(timestamp);
  }

  if (activeAlgorithm === "all" || activeAlgorithm === "pmb") {
    drawPMB(timestamp);
  }

  animationFrame = window.requestAnimationFrame(render);
}

replayButton.addEventListener("click", () => {
  animationStart = performance.now();
});

randomizeSpaceButton.addEventListener("click", () => {
  rebuildTerrain(activeTerrain);
  syncTerrainButtons();
});

buildLegend();
buildButtons();
buildTerrainButtons();
syncButtons();
rebuildTerrain(activeTerrain);
syncTerrainButtons();
setPanelContent(activeAlgorithm);
animationStart = performance.now();
animationFrame = window.requestAnimationFrame(render);

window.addEventListener("beforeunload", () => {
  window.cancelAnimationFrame(animationFrame);
});
