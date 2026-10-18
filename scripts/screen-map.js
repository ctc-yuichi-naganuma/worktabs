// Draws the map of the window at the top of docs/features.md: numbered boxes over the README
// screenshot, one for each region the page explains. Run it again when the screenshot is taken
// anew, and move REGIONS if the layout moved. It draws with the canvas of an Electron page, so that
// it needs nothing besides Electron.
// usage: npx electron scripts/screen-map.js [<screenshot> <output>]
//   (default: docs/images/worktabs.png -> docs/images/features/screen-map.png)
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const [input = path.join(root, 'docs', 'images', 'worktabs.png'), output = path.join(root, 'docs', 'images', 'features', 'screen-map.png')] =
  process.argv.slice(2);

// In the 1600 x 946 screenshot: each box (left, top, right, bottom), and where its number goes, on
// an empty part of the screenshot so that it hides nothing. The chat panel (5) is part of the VS
// Code (4), so its box is inside the other.
const REGIONS = [
  { number: 1, box: [3, 3, 357, 74], label: [334, 56] }, // top of the sidebar
  { number: 2, box: [3, 80, 357, 642], label: [334, 94] }, // repository tree
  { number: 3, box: [3, 814, 357, 943], label: [334, 790] }, // subscription usage
  { number: 4, box: [362, 3, 1597, 943], label: [580, 20] }, // VS Code of the selected worktree
  { number: 5, box: [1263, 44, 1591, 890], label: [1478, 60] }, // agent chat panel
];
// Pink: no state of the UI uses it, so a box is not taken for part of the UI.
const COLOR = '#ec407a';

// Runs in the page: draws the boxes over the screenshot and gives the result as a data URL.
async function draw(source, regions, color) {
  /* global Image, document */
  const image = new Image();
  image.src = source;
  await image.decode();
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(image, 0, 0);
  ctx.strokeStyle = color;
  ctx.lineWidth = 4;
  for (const { box: [left, top, right, bottom] } of regions) {
    ctx.beginPath();
    ctx.roundRect(left, top, right - left, bottom - top, 6);
    ctx.stroke();
  }
  ctx.font = 'bold 22px "Segoe UI", system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const { number, label: [x, y] } of regions) {
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(x, y, 19, 0, 2 * Math.PI);
    ctx.fill();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, 17, 0, 2 * Math.PI);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.fillText(String(number), x, y + 1);
  }
  return canvas.toDataURL('image/png');
}

app.whenReady().then(async () => {
  try {
    const win = new BrowserWindow({ show: false });
    await win.loadURL('about:blank');
    const source = `data:image/png;base64,${fs.readFileSync(input).toString('base64')}`;
    const args = [source, REGIONS, COLOR].map((value) => JSON.stringify(value)).join(', ');
    const result = await win.webContents.executeJavaScript(`(${draw})(${args})`);
    fs.writeFileSync(output, Buffer.from(result.replace(/^data:image\/png;base64,/, ''), 'base64'));
    console.log(`${path.relative(root, output)}: ${fs.statSync(output).size} bytes`);
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
  app.quit();
});
