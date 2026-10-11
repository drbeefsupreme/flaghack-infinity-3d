# Windows desktop launcher

This is a new Electron launcher for the existing `web/` game. It bundles the game,
its local Node host, and Electron into a Windows x64 NSIS installer. It does not
reuse an earlier discarded launcher. Players do not need a separate Node install.

## Current scope and release status

The source implements offline Play, a stable/iteration channel selector, and
explicit Check → Download → Install and restart controls. The updater replaces
the **whole installed application**, including the launcher, host, and game.
It does not fetch source branches, patch loose game files, or run a build on the
player's computer.

The package scripts and build-only GitHub Actions workflow produce artifacts
without activating an update feed. The separate `desktop-publish.yml` workflow
is restricted to the approved initial iteration artifact described below.
Later versions require another authorized publication; pushing game changes does
not automatically update installed clients. No signing credentials are configured.
If the selected feed is unavailable, Check can fail while the installed game
remains available through Play.

A successful cross-build or automated test is not proof of Windows installation,
real gameplay, or end-to-end updating. Those require the Windows checklist below.

## Player behavior

- Play launches the bundled game through a loopback-only host on `127.0.0.1` using
  an available port. An internet connection and update check are not prerequisites.
- Check for updates performs the network check only when requested. A newer
  version is downloaded only after Download is clicked.
- Install and restart requires a completed download and a separate native
  confirmation. Close the game first. Cancel leaves the installed version in place.
- Closing the launcher does not silently install a downloaded update.
- Failed checks and downloads report a recoverable error and leave the installed
  game intact. This is not a guarantee of rollback after a Windows installer has
  started or been interrupted.
- The launcher and game use sandboxed renderers without Node integration. The
  launcher accepts only its built-in update channels; it does not accept an
  arbitrary feed URL from the renderer. The bundled host does not expose a LAN
  hosting interface through this launcher.
- Launcher channel choice and supported game preferences are stored under the
  app's user-data directory, independently of the replaceable application files.

## Stable and iteration channels

| Channel | Source branch | Build version convention | Update release tag | Manifest |
| --- | --- | --- | --- | --- |
| Stable | `main` | `X.Y.Z` | `desktop-stable` | `latest.yml` |
| Iteration | `iteration` | `X.Y.Z-iteration.N` | `desktop-iteration` | `iteration.yml` |

The first-run channel comes from build metadata. A previously saved selection
wins on later launches. Selecting another channel changes which feed is checked;
it does not immediately replace the game or install an older version.

Versions must increase according to SemVer across any channel transition.
For example, `0.2.0-iteration.1` can move to `0.2.0` stable, and `0.2.0` stable can
move to `0.2.1-iteration.1`. A stable `0.2.0` cannot update to
`0.2.0-iteration.2`, because that prerelease sorts below `0.2.0`.
Switching from `0.3.0-iteration.1` to a stable feed containing `0.2.0` does not
roll back. Wait for a higher stable version, or deliberately reinstall the chosen
version manually after considering saved-data compatibility. Automatic downgrades
are disabled, including after changing channels.

The fixed public generic-feed roots are:

- Stable: `https://github.com/elmorei/flaghack-infinity-3d/releases/download/desktop-stable/`
- Iteration: `https://github.com/elmorei/flaghack-infinity-3d/releases/download/desktop-iteration/`

Both channels use the same application identity. They are alternative versions of
one installed app, not separate side-by-side installs. A feed selection never
turns a build from `iteration` into a build of `main`; the published artifact must
actually have been built from the matching branch.

## Local development and packaging

Use Node 24 and run commands from `web/`. The npm lockfile pins the dependency
graph; direct launcher dependencies are Electron `44.7.0`, electron-builder
`26.15.3`, and electron-updater `6.8.9`.

```powershell
cd web
npm ci
npm run desktop:test
npm test
npm run desktop:dev
```

`desktop:dev` builds the game and host, then opens Electron. Updates are disabled
in this unpackaged development mode. It is for launcher/game checks, not a real
installed-update test. Building needs network access for uncached dependencies;
playing an installed build does not.

To package an iteration build on Windows:

```powershell
$env:FLAGHACK_CHANNEL = 'iteration'
npm version 0.2.1-iteration.1 --no-git-tag-version --allow-same-version
npm run desktop:package
```

For stable, check out the approved `main` source, use `FLAGHACK_CHANNEL=stable`
and a version such as `0.2.1`. `npm version` changes local package metadata and
the lockfile; it does not commit or tag with these flags. Do not package stable
from iteration code merely by changing the environment variable.

`desktop:package` runs the typechecked Vite production build, bundles
`server/host.ts` into `dist-desktop/`, then runs electron-builder with
`electron-builder.cjs`, Windows x64, and `--publish never`. The expected outputs
are in `web/desktop-release/`:

- `Flaghack-Setup-<version>-x64.exe`
- The installer's `.exe.blockmap`
- `latest.yml` for stable or `iteration.yml` for iteration

Use the NSIS installer for the supported installed/update path. A loose unpacked
app or diagnostic archive is not a substitute for testing an installed update.

## Manual Windows CI, once authorized

`.github/workflows/desktop-build.yml` supports manual builds plus the narrowly
gated initial iteration build described below. Manual builds check out `main` for
stable or `iteration` for iteration, sets up Node 24, validates the channel/version
pair, runs `npm ci`, updates the build's version without a commit or tag, runs
launcher and game tests, packages the app, verifies expected output files, and
uploads a 14-day Actions artifact for review. Actions are pinned to commit SHAs.
The job has only `contents: read`; checkout does not persist credentials. There
is no release step, publishing token, or repository-write permission.

The workflow must first be placed on the repository's default branch through an
authorized change before GitHub exposes manual dispatch. The selected source
branch also needs the launcher scripts/config/lockfile. In Actions, choose the
workflow, select stable or iteration, and enter a matching version without `v`,
leading zeroes, or build metadata. The channel input determines the checked-out
source branch regardless of the dispatch branch selector. Download the resulting
Actions artifact to inspect/test it; an Actions artifact is not a live update feed.

### Approved initial iteration build

To create the first installer without changing the default branch, the workflow
also listens for pushes to `iteration`. Its Windows job runs on a push only when
the head commit message equals this exact approved marker:

`Preserve Windows source hashes [desktop-build:0.1.1-iteration.1:20261011-retry1]`

That route checks out the event's immutable commit SHA and fixes the channel to
`iteration` and version to `0.1.1-iteration.1`. It does not consume manual inputs,
change `main`, publish a release, or receive repository-write permissions.
Ordinary later pushes skip the job. Do not reuse the marker for another build;
remove this bootstrap trigger after the initial build in an authorized follow-up.
Manual dispatch still requires default-branch registration as described above.

### Approved initial iteration publication

`desktop-publish.yml` publishes only the original Windows artifact from successful
run `38165458912`, source commit `8909d36160d1c381a669b5761c70fc7a03dbbce3`.
Its iteration push route requires the exact marker
`Publish iteration desktop 0.1.1-iteration.1 [release:20261011]`; ordinary pushes
skip it. Manual retries are also restricted to iteration and that same artifact.
The job uses a temporary job token with release-write and artifact-read access,
without storing credentials. It checks the ZIP and all asset hashes, uses a draft
prerelease, uploads the installer and blockmap before `iteration.yml`, and verifies
the public downloads after publication. It never marks the release as latest,
changes the stable feed, or overwrites unexpected tags, releases, or assets.

## Activating updates later

This is a separate publication step requiring authorization. Do not add release
credentials or broaden CI permissions merely to test packaging.

1. Obtain approved matching-branch builds with increasing versions and complete
   the Windows checks below. Record the source commit and artifact hashes.
2. Confirm public distribution and publish the approved installer and its
   blockmap under the corresponding release tag above, preserving filenames.
   The generic provider assumes unauthenticated public access; a private release
   cannot be made usable by embedding a repository token in the launcher.
3. Publish the matching generated YAML manifest only after all files it references
   are available. Keep the generated filenames, sizes, and SHA-512 values intact.
   An interrupted replacement can temporarily make checks fail; do not describe
   this manual release-asset process as atomic.
4. Retain older versioned installers/blockmaps while clients could still download
   them, then test the actual public manifest and installer download from a clean
   Windows installation. Publishing these assets makes executable updates
   available to installed clients and must be an intentional release decision.

No signing is configured. Unsigned Windows executables may trigger SmartScreen
or antivirus warnings; packaging or code signing cannot promise that no warning
will appear. Do not disable antivirus or OS protections as part of testing.
Production signing and its credentials need separate setup and authorization.

## Windows acceptance checklist (not yet certified)

- Install the NSIS artifact on a clean Windows x64 machine using the intended
  per-user path. Launch from the installed shortcut and verify version/channel.
- Disconnect internet, click Play, start a local game, check graphics/audio/input
  including pointer lock/fullscreen, close the game, and reopen it.
- Restart the launcher and verify supported preferences persist. Confirm it
  binds only to loopback and another launcher launch focuses the existing app.
- With an approved feed, check a newer version, download it, cancel install once,
  then close the game and explicitly confirm install/restart. Verify the new
  installed version, game behavior, and preferences after relaunch.
- Check while offline or with an unavailable manifest, and interrupt a download.
  Confirm an understandable error, repeatable check, and working installed Play.
- Try repeated check/download clicks, change channels when idle, and verify
  switching is blocked during download or while an update awaits installation.
- Verify a lower/equal feed version is not installed; test stable-to-iteration
  and iteration-to-stable with the version ordering described above.
- Close the app with a downloaded update pending and verify it does not install
  automatically. Test installer cancellation and uninstall without assuming
  failure rollback. Record SmartScreen/antivirus behavior without bypassing it.

## Upstream references

- [electron-builder v26 auto-update documentation](https://www.electron.build/v26/docs/features/auto-update/)
- [GitHub manual workflow dispatch requirements](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow)
- [GitHub workflow permissions and syntax](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax)
