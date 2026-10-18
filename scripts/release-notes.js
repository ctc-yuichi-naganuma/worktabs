// Prints the section of CHANGELOG.md for one version: the body of its GitHub release. The
// release workflow runs it on the tagged commit, so the notes are what `npm version` wrote there,
// whatever git-cliff would say now.
//
// usage: node scripts/release-notes.js <tag or version> [<CHANGELOG.md>]
const fs = require('fs');
const path = require('path');

// The "## [x.y.z] - <date>" section for the version, up to the next "## [" heading. Throws when
// there is none, more than one, or only the heading: a release without notes is a mistake.
function releaseNotes(changelog, tag) {
  const version = tag.replace(/^v/i, '');
  if (!version) throw new Error(`no version in the tag "${tag}"`);
  const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const headings = [...changelog.matchAll(new RegExp(`^## \\[${escaped}\\].*$`, 'gm'))];
  if (headings.length === 0) throw new Error(`CHANGELOG.md has no section for ${version}`);
  if (headings.length > 1) throw new Error(`CHANGELOG.md has ${headings.length} sections for ${version}`);
  const bodyStart = headings[0].index + headings[0][0].length;
  const next = changelog.slice(bodyStart).search(/^## \[/m);
  const body = changelog.slice(bodyStart, next === -1 ? changelog.length : bodyStart + next);
  if (!body.trim()) throw new Error(`the section for ${version} in CHANGELOG.md is empty`);
  return `${headings[0][0]}${body}`.trimEnd() + '\n';
}

if (require.main === module) {
  const [tag, file = path.join(__dirname, '..', 'CHANGELOG.md')] = process.argv.slice(2);
  if (!tag) {
    console.error('usage: node scripts/release-notes.js <tag or version> [<CHANGELOG.md>]');
    process.exit(1);
  }
  try {
    process.stdout.write(releaseNotes(fs.readFileSync(file, 'utf8'), tag));
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

module.exports = { releaseNotes };
