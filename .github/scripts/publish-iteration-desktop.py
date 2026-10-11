"""Publish one explicitly approved, immutable Windows artifact. No rebuilds or clobbers."""
import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile
import time
import urllib.error
import urllib.request
import zipfile

REPOSITORY = 'elmorei/flaghack-infinity-3d'
SOURCE = '8909d36160d1c381a669b5761c70fc7a03dbbce3'
RUN_ID = 38165458912
ARTIFACT_ID = 11712241056
VERSION = '0.1.1-iteration.1'
TAG = 'desktop-iteration'
TITLE = 'Iteration desktop 0.1.1-iteration.1'
ARTIFACT_NAME = 'flaghack-windows-iteration-0.1.1-iteration.1'
ZIP_SHA256 = '5d05fa9eb28545de3bb6bbdabfad08fe967e5cb67701e85a0fd92fc6198e68a5'
INSTALLER = 'Flaghack-Setup-0.1.1-iteration.1-x64.exe'
INSTALLER_SHA512 = 'rWDD5qDlZZnw8TrxHu8u4qjwFnaXkIuiK1GwUdVYascnmGPhA0n8g1m1DVlQbLdDQBsEiOvr1YU2SFpMTJHrsg=='
ASSETS = {
    INSTALLER: (122597416, '63954a101b2528220742850e53ab09246eb1ed8472dcf97645d192918d9cd22d'),
    INSTALLER + '.blockmap': (129542, '000231aef959aa4de4d4f72503b447a84b0ff574bf0f9dc4146e2194fe1fc466'),
    'iteration.yml': (389, '08d9b071957ba6b2cc29175abb2398a3c7c83effb222ee91c637c00195890b76'),
}
BODY = f'''Windows x64 iteration build {VERSION}.

Source commit: {SOURCE}
Verified build: https://github.com/{REPOSITORY}/actions/runs/{RUN_ID}

The Windows build passed 31 launcher tests and 1,111 game tests. The installer,
blockmap, and iteration update manifest are the original verified build outputs.

This installer is unsigned. Actual Windows installation and gameplay have not
been manually verified. The launcher checks, downloads, and installs updates only
on explicit player actions. This release activates the iteration feed only.

Installer SHA-256: {ASSETS[INSTALLER][1]}
'''


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def gh(*args):
    return subprocess.run(['gh', *args], check=True, capture_output=True, text=True).stdout


def api(path, optional=False):
    result = subprocess.run(['gh', 'api', f'repos/{REPOSITORY}/{path}'], capture_output=True, text=True)
    if optional and result.returncode and '(HTTP 404)' in result.stderr:
        return None
    result.check_returncode()
    return json.loads(result.stdout)


def download_api(path, destination):
    with destination.open('wb') as output:
        subprocess.run(['gh', 'api', '-H', 'Accept: application/octet-stream',
                        f'repos/{REPOSITORY}/{path}'], stdout=output, check=True)


def check_file(path, expected):
    size, digest = expected
    require(path.stat().st_size == size, f'Wrong size: {path.name}')
    with path.open('rb') as file:
        require(hashlib.file_digest(file, 'sha256').hexdigest() == digest, f'Wrong SHA-256: {path.name}')


def verify_bundle(archive, directory):
    with archive.open('rb') as file:
        require(hashlib.file_digest(file, 'sha256').hexdigest() == ZIP_SHA256, 'Wrong build artifact ZIP')
    with zipfile.ZipFile(archive) as bundle:
        require(len(bundle.infolist()) == len(ASSETS) and set(bundle.namelist()) == set(ASSETS), 'Unexpected ZIP files')
        for name, expected in ASSETS.items():
            require(bundle.getinfo(name).file_size == expected[0], f'Wrong ZIP entry size: {name}')
            with bundle.open(name) as source, (directory / name).open('wb') as output:
                while chunk := source.read(1024 * 1024):
                    output.write(chunk)
            check_file(directory / name, expected)
    with (directory / INSTALLER).open('rb') as file:
        digest = base64.b64encode(hashlib.file_digest(file, 'sha512').digest()).decode()
    require(digest == INSTALLER_SHA512, 'Wrong installer SHA-512')


def validate_release(release):
    require(release['tag_name'] == TAG and release['name'] == TITLE, 'Unexpected existing release identity')
    require(release['target_commitish'] == SOURCE and release['prerelease'], 'Unexpected existing release target/type')
    require(release['body'].replace('\r\n', '\n') == BODY, 'Unexpected existing release notes')
    names = [asset['name'] for asset in release['assets']]
    require(len(names) == len(set(names)) and set(names).issubset(ASSETS), 'Unexpected existing release assets')


def find_release():
    # The tag endpoint omits drafts. Authenticated lists include them.
    matches = []
    page = 1
    while True:
        releases = api(f'releases?per_page=100&page={page}')
        matches.extend(release for release in releases if release['tag_name'] == TAG)
        require(len(matches) <= 1, 'Multiple releases use the approved tag')
        if len(releases) < 100:
            break
        page += 1
    return api(f'releases/{matches[0]["id"]}') if matches else None


def validate_tag(required=False):
    tag = api(f'git/ref/tags/{TAG}', optional=True)
    require(not required or tag is not None, 'Published release tag is missing')
    if tag:
        require(tag['object']['type'] == 'commit' and tag['object']['sha'] == SOURCE, 'Existing tag points elsewhere')


def verify_remote_assets(release, directory):
    for asset in release['assets']:
        name = asset['name']
        require(asset['state'] == 'uploaded' and asset['size'] == ASSETS[name][0], f'Incomplete asset: {name}')
        if asset.get('digest'):
            require(asset['digest'] == f'sha256:{ASSETS[name][1]}', f'Wrong remote digest: {name}')
        destination = directory / ('remote-' + name)
        download_api(f'releases/assets/{asset["id"]}', destination)
        check_file(destination, ASSETS[name])


def verify_public_assets(directory):
    for name, expected in ASSETS.items():
        url = f'https://github.com/{REPOSITORY}/releases/download/{TAG}/{name}'
        for attempt in range(4):
            try:
                with urllib.request.urlopen(url, timeout=120) as response, (directory / ('public-' + name)).open('wb') as output:
                    require(response.status == 200 and response.url.startswith('https://'), 'Non-HTTPS or unsuccessful asset response')
                    while chunk := response.read(1024 * 1024):
                        output.write(chunk)
                break
            except urllib.error.HTTPError as error:
                if error.code not in (404, 429, 502, 503) or attempt == 3:
                    raise
                time.sleep((3, 10, 20)[attempt])
        check_file(directory / ('public-' + name), expected)


def publish():
    require(bool(os.environ.get('GH_TOKEN')), 'Use the job-scoped GitHub token')
    run = api(f'actions/runs/{RUN_ID}')
    require(run['head_sha'] == SOURCE and run['status'] == 'completed' and run['conclusion'] == 'success', 'Build was not successful at the approved commit')
    artifact = api(f'actions/artifacts/{ARTIFACT_ID}')
    require(artifact['id'] == ARTIFACT_ID and artifact['name'] == ARTIFACT_NAME and not artifact['expired'], 'Wrong or expired artifact')
    require(artifact['workflow_run']['id'] == RUN_ID and artifact['workflow_run']['head_sha'] == SOURCE, 'Artifact source mismatch')
    require(artifact.get('digest') == f'sha256:{ZIP_SHA256}', 'Artifact digest mismatch')
    validate_tag()
    with tempfile.TemporaryDirectory(prefix='flaghack-approved-release-') as temporary:
        directory = Path(temporary)
        archive = directory / 'artifact.zip'
        download_api(f'actions/artifacts/{ARTIFACT_ID}/zip', archive)
        verify_bundle(archive, directory)
        release = find_release()
        if release is None:
            notes = directory / 'release-notes.txt'
            notes.write_text(BODY)
            gh('release', 'create', TAG, '--repo', REPOSITORY, '--target', SOURCE,
               '--title', TITLE, '--notes-file', str(notes), '--draft', '--prerelease', '--latest=false')
            release = find_release()
            require(release is not None, 'Created draft could not be resolved')
        validate_release(release)
        verify_remote_assets(release, directory)
        if release['draft']:
            # ASSETS preserves installer -> blockmap -> manifest publication order.
            for name in ASSETS:
                if not any(asset['name'] == name for asset in release['assets']):
                    gh('release', 'upload', TAG, str(directory / name), '--repo', REPOSITORY)
                    release = api(f'releases/{release["id"]}')
                    validate_release(release)
            require(set(asset['name'] for asset in release['assets']) == set(ASSETS), 'Missing release assets')
            verify_remote_assets(release, directory)
            validate_tag()
            identity = lambda asset: (asset['name'], asset['id'], asset['size'], asset['state'], asset.get('digest'))
            verified_assets = {identity(asset) for asset in release['assets']}
            release = api(f'releases/{release["id"]}')
            validate_release(release)
            require(release['draft'] and {identity(asset) for asset in release['assets']} == verified_assets,
                    'Release changed while verifying its assets')
            gh('release', 'edit', TAG, '--repo', REPOSITORY, '--draft=false', '--prerelease', '--latest=false')
            release = api(f'releases/{release["id"]}')
        validate_release(release)
        require(not release['draft'] and set(asset['name'] for asset in release['assets']) == set(ASSETS), 'Release is not complete and public')
        validate_tag(required=True)
        verify_public_assets(directory)
        print(json.dumps({'release': release['html_url'], 'installer': f'https://github.com/{REPOSITORY}/releases/download/{TAG}/{INSTALLER}',
                          'source': SOURCE, 'version': VERSION, 'checksums_verified': True}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument('--publish', action='store_true')
    mode.add_argument('--verify-only', type=Path)
    args = parser.parse_args()
    if args.verify_only:
        with tempfile.TemporaryDirectory(prefix='flaghack-verify-') as directory:
            verify_bundle(args.verify_only, Path(directory))
        print('Approved artifact verified; no remote changes.')
    else:
        publish()
