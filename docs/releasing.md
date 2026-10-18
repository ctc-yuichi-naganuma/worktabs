# Releasing

**English** | [日本語](ja/releasing.md)

When you bump the version and tag it with `npm version` and push, GitHub Actions (`.github/workflows/release.yml`) builds the Windows installer and zip and the macOS zip from that commit and publishes them to GitHub Releases. Release files are not built locally, so that it is clear who built them and from which code.

For now, though, the Actions budget is used up, so tags are not pushed and the release files are built locally (see "[Build locally and hand out for now](#build-locally-and-hand-out-for-now)" below).

The rules for commit prefixes are in [CONTRIBUTING.md](../.github/CONTRIBUTING.md). Release notes are made from those prefixes.

## Versioning

- Versions follow [SemVer](https://semver.org/). While at `0.x`, there is no compatibility guarantee (the contents of the settings file and the data folder may change).
- Which part to bump depends on the prefixes of the commits in the release ("1. Prefixes" in [CONTRIBUTING.md](../.github/CONTRIBUTING.md)). If there is a `feat:`, bump minor. If there are only `fix:` and the like, bump patch.
- The version is written only in `version` in `package.json`. The version the app reports, the names of the installer and zips (Windows and macOS), and the tag all follow from it.
- The helper extension's version (`helper-extension/package.json`) is separate. Bump it when you change the helper extension's contents. The app uses the helper extension's version to decide whether to reinstall it into each tab's VS Code.

## Releasing

1. Update main.
   ```sh
   git switch main
   git pull
   npm ci
   npm run changelog   # (optional) see what has not been released yet
   npm run pack        # (optional) check the main build with npm run try ("Updating your own build of Worktabs" in install.md)
   ```
2. Bump the version.
   ```sh
   npm version minor   # 0.1.0 → 0.2.0. Use patch for fixes only
   ```
   `npm version` does the following in sequence. It stops if the working tree has uncommitted changes.
   - Bumps `version` in `package.json` and `package-lock.json`
   - Regenerates `CHANGELOG.md` with git-cliff (`scripts/changelog.js`, configured in `cliff.toml`)
   - Commits as `chore(release): v0.2.0` (the message is set in `.npmrc`) and tags `v0.2.0`
3. Push. This is the only time you push directly to main.
   ```sh
   git push --follow-tags
   ```
4. When the "Release" workflow in Actions finishes, the release appears in Releases. It goes out as soon as the tag is pushed, so do your checks in step 1.

- The repository started over with a single commit when it was made public, so the CHANGELOG and the tags begin there. The versions up to 0.3.1 were not public.
- `CHANGELOG.md` is regenerated from the full history on every release, so hand edits are lost at the next release. Fix the commit messages instead (with squash merge, the PR titles).

## Build locally and hand out for now

The Actions budget ran out in October 2026, so from 0.3.0 on, tags are not pushed, and the Windows zip and installer are built locally and handed out. When the budget comes back, go back to "Releasing" above.

1. Update main (step 1 of "Releasing") and pass `npm run check` and `npm test`. The Windows CI is stopped, so check locally before building.
2. Bump the version with `npm version minor` (`patch` for fixes only). The release commit and tag are created as usual.
3. Push only main, so that other machines can see the current version. Do not push the tag, because pushing it runs the Release workflow.
   ```sh
   git push origin main
   ```
   - `package.json` changes, so the push to main runs the Ubuntu CI once.
4. Build.
   ```sh
   npm run pack          # dist/win-unpacked
   npm run dist:packed   # dist/Worktabs-<version>-win.zip and dist/Worktabs-<version>-setup.exe
   ```
   - Update your own Worktabs from `dist\win-unpacked` with `update-worktabs.cmd` ([install.md](install.md#updating-your-own-build-of-worktabs)). It has the same contents as the files you hand out.
5. When handing them out, include the SHA-256 and the release notes.
   ```powershell
   Get-FileHash dist\Worktabs-0.3.0-win.zip
   node scripts/release-notes.js v0.3.0
   ```

- The tag exists only on the machine that bumped the version. Bump the next version on the same machine. git-cliff splits CHANGELOG versions by tag, so if you run `npm version` on a machine without the tag, the commits of the previous version also go into the new version.
- The macOS zip is not built. When you need it, run `npm run dist:mac` on a real Mac.
- The Windows files are not signed, so recipients see a SmartScreen warning on first launch (see "Signing" below).
- When the budget comes back, push the local tag and the Release workflow publishes that version to Releases. It rebuilds from the same commit as the files handed out locally, so the contents are the same, but the SHA-256 differs. Release runs for each tag, so publishing only the latest version is fine.

## What the Release workflow does

It runs on a push of a tag that starts with `v`.

- If the tag and the version in `package.json` differ, it fails without building, because the app reports the version in `package.json`.
- The release notes are the section for that version taken from `CHANGELOG.md` at the tag's commit (`scripts/release-notes.js`). The workflow does not run git-cliff, so the CHANGELOG and the release notes never disagree. If the section is missing, it fails before building. A table of which file to download is added at the end.
- The build runs as two parallel jobs, Windows (`npm run dist`) and macOS (`npm run dist:mac`). Both run `npm run check` and `npm test` before building. If one fails, the other is stopped too and no release is created.
- The last job gathers the built files and publishes them in one release.
- `SHA256SUMS.txt` (the SHA-256 of the installer and the two zips) is published with them. If the repository is public, an Artifact attestation (proof of which commit the files were built from) is attached too. It is not available for private repositories, so it is skipped there.
- Versions containing `-` (such as `0.2.0-rc.1`) are published as prereleases.

You can see the same release notes locally.

```sh
node scripts/release-notes.js v0.2.0
```

The workflow runs only on tags. `scripts/release-notes.js` and `cliff.toml` are checked by `npm test` (`test/release-notes.test.js`).

## When it fails

- If the workflow fails partway, remove the cause and Re-run it in Actions. gh publishes the release only after uploading all files, and deletes the partial release if an upload fails, so you can simply build it again.
- If the build or tests fail and the code needs a fix, delete the tag and tag the same version again on the fixed main.
  ```sh
  git push origin :refs/tags/v0.2.0
  git tag -d v0.2.0
  # after merging the fix PR into main
  git switch main && git pull
  npm version 0.2.0 --allow-same-version
  git push --follow-tags
  ```
- If you find a problem after the release is out, fix it and release the next patch. Do not re-tag a released version, because the files handed out and the code at the tag would disagree.

## Signing

Before describing Codex support as complete in release notes, update the [verification matrix](codex-verification.md) with the shipped app and extension versions. State the checked environments and outstanding limits. Use its release-note scope while signed-in platform checks remain pending.

The installer and `Worktabs.exe` are not signed, so a downloaded copy shows a SmartScreen warning on first launch. The macOS `Worktabs.app` has an ad-hoc signature so Electron can deliver notifications. It has no Developer ID signature and is not notarized, so Gatekeeper still blocks a downloaded copy. Before launching it, remove the download mark with `xattr` ([install.md](install.md#macos-zip)).
