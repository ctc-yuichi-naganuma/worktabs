// Keep the shipped artwork and every platform size derived from the approved SVG.
const fs = require('node:fs');
const path = require('node:path');
const { Resvg } = require('@resvg/resvg-js');

const root = path.join(__dirname, '..');
const build = path.join(root, 'build');
const assets = path.join(root, 'src', 'assets');
const images = path.join(root, 'docs', 'images');
const dark = fs.readFileSync(path.join(build, 'icon.svg'), 'utf8');
const light = dark.replaceAll('#1a1b26', '#e6e7ed').replaceAll('#bb9af7', '#5a3e8e').replaceAll('#7aa2f7', '#2959aa')
  .replace('on a night-indigo tile', 'on a pale lavender tile');

function png(svg, size) {
  return new Resvg(svg, { fitTo: { mode: 'width', value: size }, font: { loadSystemFonts: false } }).render().asPng();
}

function ico(sizes) {
  const header = Buffer.alloc(6 + 16 * sizes.length);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(sizes.length, 4);
  const frames = [];
  let offset = header.length;
  for (const [index, size] of sizes.entries()) {
    const frame = png(dark, size);
    const entry = 6 + 16 * index;
    header[entry] = size === 256 ? 0 : size;
    header[entry + 1] = size === 256 ? 0 : size;
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(frame.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    frames.push(frame);
    offset += frame.length;
  }
  return Buffer.concat([header, ...frames]);
}

function icns() {
  const frames = [['icp4', 16], ['icp5', 32], ['icp6', 64], ['ic07', 128], ['ic08', 256], ['ic09', 512], ['ic10', 1024]]
    .map(([type, size]) => {
      const image = png(dark, size);
      const header = Buffer.alloc(8);
      header.write(type);
      header.writeUInt32BE(image.length + 8, 4);
      return Buffer.concat([header, image]);
    });
  const header = Buffer.alloc(8);
  header.write('icns');
  header.writeUInt32BE(8 + frames.reduce((total, frame) => total + frame.length, 0), 4);
  return Buffer.concat([header, ...frames]);
}

fs.mkdirSync(assets, { recursive: true });
fs.writeFileSync(path.join(build, 'icon-light.svg'), light);
fs.writeFileSync(path.join(build, 'icon.png'), png(dark, 1024));
fs.writeFileSync(path.join(build, 'icon.ico'), ico([16, 24, 32, 48, 64, 128, 256]));
fs.writeFileSync(path.join(build, 'icon.icns'), icns());
fs.writeFileSync(path.join(assets, 'icon.png'), png(dark, 256));
fs.writeFileSync(path.join(assets, 'icon-light.png'), png(light, 256));

// A text-free preview keeps regeneration independent of installed fonts.
const mark = dark.replace(/<\/?svg[^>]*>/g, '');
const preview = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="640" viewBox="0 0 1280 640">
  <rect width="1280" height="640" fill="#24283b"/>
  <g transform="translate(384 64) scale(.5)">${mark}</g>
</svg>`;
fs.writeFileSync(path.join(images, 'social-preview.png'), png(preview, 1280));
console.log('Built Worktabs icons and social preview from build/icon.svg');
