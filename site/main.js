/* global document, window, requestAnimationFrame, cancelAnimationFrame, devicePixelRatio */

const canvas = document.querySelector("#contract-scene");
const context = canvas.getContext("2d");

const nodes = [
  { label: "contract", color: "#207a74", x: 0.18, y: 0.36, vx: 0.18, vy: 0.1 },
  { label: "zod", color: "#6c3d7c", x: 0.34, y: 0.24, vx: -0.12, vy: 0.16 },
  { label: "normalize", color: "#b46625", x: 0.56, y: 0.34, vx: 0.16, vy: -0.12 },
  { label: "schemas", color: "#b84f61", x: 0.72, y: 0.5, vx: -0.16, vy: 0.12 },
  { label: "redact", color: "#207a74", x: 0.44, y: 0.64, vx: 0.12, vy: -0.14 },
  { label: "validate", color: "#6c3d7c", x: 0.82, y: 0.22, vx: -0.1, vy: -0.16 },
  { label: "tests", color: "#b46625", x: 0.66, y: 0.72, vx: -0.12, vy: 0.1 },
].map((node) => ({ ...node }));

let width = 0;
let height = 0;
let animationFrame = 0;
let lastTime = 0;

function resize() {
  const ratio = Math.min(devicePixelRatio || 1, 2);
  const rect = canvas.getBoundingClientRect();
  width = Math.max(1, rect.width);
  height = Math.max(1, rect.height);
  canvas.width = Math.floor(width * ratio);
  canvas.height = Math.floor(height * ratio);
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
}

function draw(time) {
  const elapsed = Math.min(32, time - lastTime || 16) / 1000;
  lastTime = time;

  context.clearRect(0, 0, width, height);
  drawGrid();
  updateNodes(elapsed);
  drawConnections();
  drawNodes();

  animationFrame = requestAnimationFrame(draw);
}

function drawGrid() {
  context.save();
  context.strokeStyle = "rgb(32 33 31 / 0.055)";
  context.lineWidth = 1;

  for (let x = 0; x < width; x += 42) {
    context.beginPath();
    context.moveTo(x, 0);
    context.lineTo(x, height);
    context.stroke();
  }

  for (let y = 0; y < height; y += 42) {
    context.beginPath();
    context.moveTo(0, y);
    context.lineTo(width, y);
    context.stroke();
  }

  context.restore();
}

function updateNodes(elapsed) {
  for (const node of nodes) {
    node.x += node.vx * elapsed * 0.03;
    node.y += node.vy * elapsed * 0.03;

    if (node.x < 0.1 || node.x > 0.9) {
      node.vx *= -1;
    }

    if (node.y < 0.12 || node.y > 0.78) {
      node.vy *= -1;
    }
  }
}

function drawConnections() {
  context.save();
  context.lineWidth = 1.5;

  for (let index = 0; index < nodes.length; index += 1) {
    const current = nodes[index];
    const next = nodes[(index + 1) % nodes.length];
    context.strokeStyle = "rgb(32 33 31 / 0.18)";
    context.beginPath();
    context.moveTo(current.x * width, current.y * height);
    context.lineTo(next.x * width, next.y * height);
    context.stroke();
  }

  context.restore();
}

function drawNodes() {
  context.save();
  context.textBaseline = "middle";
  context.font = "700 13px Inter, system-ui, sans-serif";

  for (const node of nodes) {
    const x = node.x * width;
    const y = node.y * height;
    const textWidth = context.measureText(node.label).width;
    const boxWidth = Math.max(92, textWidth + 34);
    const boxHeight = 36;

    context.fillStyle = "rgb(255 253 248 / 0.88)";
    context.strokeStyle = "rgb(32 33 31 / 0.2)";
    roundRect(x - boxWidth / 2, y - boxHeight / 2, boxWidth, boxHeight, 8);
    context.fill();
    context.stroke();

    context.fillStyle = node.color;
    context.beginPath();
    context.arc(x - boxWidth / 2 + 16, y, 4, 0, Math.PI * 2);
    context.fill();

    context.fillStyle = "#20211f";
    context.fillText(node.label, x - boxWidth / 2 + 28, y);
  }

  context.restore();
}

function roundRect(x, y, boxWidth, boxHeight, radius) {
  context.beginPath();
  context.moveTo(x + radius, y);
  context.arcTo(x + boxWidth, y, x + boxWidth, y + boxHeight, radius);
  context.arcTo(x + boxWidth, y + boxHeight, x, y + boxHeight, radius);
  context.arcTo(x, y + boxHeight, x, y, radius);
  context.arcTo(x, y, x + boxWidth, y, radius);
  context.closePath();
}

resize();
animationFrame = requestAnimationFrame(draw);
window.addEventListener("resize", resize);
window.addEventListener("beforeunload", () => cancelAnimationFrame(animationFrame));
