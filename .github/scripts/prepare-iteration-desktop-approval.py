"""Create a local approval record from an already verified Windows build and ZIP.

No network, credentials, GitHub changes, rebuild, or publication. This records
reviewed inputs; it does not itself grant authority to publish them.
"""
import argparse
import importlib.util
import json
from pathlib import Path
import tempfile
import zipfile

SPEC = importlib.util.spec_from_file_location('publisher', Path(__file__).with_name('publish-iteration-desktop.py'))
publisher = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(publisher)


def prepare(run, artifact, archive, launcher_tests, game_tests):
    approval = {
        'schema': 1, 'repository': publisher.REPOSITORY, 'version': publisher.VERSION,
        'source': run['head_sha'], 'run_id': run['id'], 'run_attempt': run['run_attempt'],
        'workflow_id': run['workflow_id'], 'artifact_id': artifact['id'],
        'artifact_name': artifact['name'], 'zip': publisher.file_spec(archive),
        'assets': {}, 'launcher_tests': launcher_tests, 'game_tests': game_tests,
    }
    with tempfile.TemporaryDirectory(prefix='flaghack-local-approval-') as temporary:
        directory = Path(temporary)
        with zipfile.ZipFile(archive) as bundle:
            publisher.require(len(bundle.infolist()) == len(publisher.NAMES) and
                              set(bundle.namelist()) == set(publisher.NAMES), 'Unexpected ZIP entries')
            for name in publisher.NAMES:
                info = bundle.getinfo(name)
                publisher.require(0 < info.file_size <= 1024 ** 3, f'Invalid artifact member size: {name}')
                destination = directory / name
                with bundle.open(info) as source, destination.open('wb') as output:
                    count = 0
                    while chunk := source.read(1024 * 1024):
                        count += len(chunk)
                        publisher.require(count <= info.file_size, 'ZIP expanded beyond declared size')
                        output.write(chunk)
                approval['assets'][name] = publisher.file_spec(destination)
        local_record = directory / 'approval.json'
        local_record.write_text(json.dumps(approval), encoding='utf-8')
        publisher.load_approval(local_record)
        publisher.validate_provenance_metadata(approval, run, artifact)
        publisher.verify_bundle(archive, directory, approval)
    return approval


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--run-json', type=Path, required=True, help='Raw successful GitHub run API JSON')
    parser.add_argument('--artifact-json', type=Path, required=True, help='Raw immutable artifact API JSON')
    parser.add_argument('--archive', type=Path, required=True)
    parser.add_argument('--launcher-tests', type=int, required=True, help='Verified passed count from that Windows build log')
    parser.add_argument('--game-tests', type=int, required=True, help='Verified passed count from that Windows build log')
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    approved = prepare(json.loads(args.run_json.read_text(encoding='utf-8')),
                       json.loads(args.artifact_json.read_text(encoding='utf-8')),
                       args.archive, args.launcher_tests, args.game_tests)
    # Do not silently replace an existing approval record with different inputs.
    serialized = json.dumps(approved, indent=2) + '\n'
    if args.output.exists():
        publisher.require(json.loads(args.output.read_text(encoding='utf-8')) == approved,
                          'Existing approval differs; review before replacing it')
    else:
        args.output.write_text(serialized, encoding='utf-8')
    print(f'Local approval record verified: {args.output}. No remote changes.')
