'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { spawnSync } = require('node:child_process');
const { runInNewContext } = require('node:vm');
const yaml = require('js-yaml');

const root = join(__dirname, '../..');
const helper = join(root, '.github/scripts/publish-iteration-desktop.py');
const workflow = yaml.load(readFileSync(join(root, '.github/workflows/desktop-publish.yml'), 'utf8'));
const marker = 'Publish verified iteration desktop [release:20261011-retry1]';
const python = process.platform === 'win32' ? 'python' : 'python3';

test('publisher trigger is limited to the approved repository, iteration, and exact marker', () => {
  assert.deepEqual(workflow.on.push.branches, ['iteration']);
  assert.deepEqual(Object.keys(workflow.on).sort(), ['push', 'workflow_dispatch']);
  assert.ok(!workflow.on.workflow_dispatch?.inputs);
  const enabled = (name, ref, message, repository = 'elmorei/flaghack-infinity-3d') =>
    runInNewContext(workflow.jobs.publish.if, { github: { repository, event_name: name, ref, event: { head_commit: { message } } } });
  assert.equal(enabled('push', 'refs/heads/iteration', marker), true);
  assert.equal(enabled('workflow_dispatch', 'refs/heads/iteration', ''), true);
  assert.equal(enabled('push', 'refs/heads/iteration', 'Ordinary later commit'), false);
  assert.equal(enabled('push', 'refs/heads/iteration', marker + '\n'), false);
  assert.equal(enabled('push', 'refs/heads/main', marker), false);
  assert.equal(enabled('workflow_dispatch', 'refs/heads/main', ''), false);
  assert.equal(enabled('pull_request', 'refs/heads/iteration', marker), false);
  assert.equal(enabled('push', 'refs/heads/iteration', marker, 'someone/fork'), false);
});

test('publisher grants only job-scoped permissions and never persists or interpolates credentials', () => {
  const job = workflow.jobs.publish;
  assert.deepEqual(workflow.permissions, {});
  assert.deepEqual(job.permissions, { actions: 'read', contents: 'write' });
  assert.equal(job['runs-on'], 'ubuntu-latest');
  assert.ok(job['timeout-minutes'] > 0 && job['timeout-minutes'] <= 15);
  const checkout = job.steps.find(step => step.uses?.startsWith('actions/checkout@'));
  assert.match(checkout.uses, /@[0-9a-f]{40}$/);
  assert.equal(checkout.with.ref, '${{ github.sha }}');
  assert.equal(checkout.with['persist-credentials'], false);
  const publish = job.steps.find(step => step.run);
  assert.deepEqual(publish.env, { GH_TOKEN: '${{ github.token }}', GH_REPO: 'elmorei/flaghack-infinity-3d' });
  assert.equal(publish.run.trim(), 'python3 .github/scripts/publish-iteration-desktop.py --publish');
  assert.ok(!job.env?.GH_TOKEN && !workflow.env?.GH_TOKEN);
  const concurrency = job.concurrency || workflow.concurrency;
  assert.equal(typeof concurrency?.group, 'string');
  assert.match(concurrency.group, /iteration/);
  assert.equal(concurrency['cancel-in-progress'], false);
});

const preamble = String.raw`
import base64, copy, hashlib, importlib.util, io, json, os, sys, tempfile, unittest, warnings, zipfile
from pathlib import Path
from urllib.parse import parse_qs, urlsplit
spec = importlib.util.spec_from_file_location('publisher', sys.argv[1])
p = importlib.util.module_from_spec(spec)
spec.loader.exec_module(p)
t = unittest.TestCase()

def release(draft=True, names=()):
    return {'id': 61, 'tag_name': p.TAG, 'name': p.TITLE, 'target_commitish': p.SOURCE,
            'prerelease': True, 'draft': draft, 'body': p.BODY,
            'html_url': 'https://github.com/' + p.REPOSITORY + '/releases/tag/' + p.TAG,
            'assets': [asset(name) for name in names]}

def asset(name):
    return {'id': 100 + list(p.ASSETS).index(name), 'name': name, 'size': p.ASSETS[name][0],
            'state': 'uploaded', 'digest': 'sha256:' + p.ASSETS[name][1]}

class FakeGitHub:
    def __init__(self, existing=None):
        self.releases = [] if existing is None else [existing]
        self.calls = []
        self.tag = None if existing is None or existing['draft'] else {'object': {'type': 'commit', 'sha': p.SOURCE}}
        self.run = {'head_sha': p.SOURCE, 'status': 'completed', 'conclusion': 'success'}
        self.artifact = {'id': p.ARTIFACT_ID, 'name': p.ARTIFACT_NAME, 'expired': False,
                         'workflow_run': {'id': p.RUN_ID, 'head_sha': p.SOURCE}, 'digest': 'sha256:' + p.ZIP_SHA256}
        self.corrupt_bundle = False
        self.corrupt_remote = False
        self.read_paths = []

    def install(self):
        os.environ['GH_TOKEN'] = 'unit-test-value-never-transmitted'
        p.api = self.api
        p.gh = self.gh
        p.download_api = self.download
        p.verify_bundle = self.bundle
        p.check_file = self.check_file
        p.verify_public_assets = lambda directory: self.calls.append(('public',))

    def api(self, path, optional=False):
        self.read_paths.append(path)
        if path == 'actions/runs/' + str(p.RUN_ID): return copy.deepcopy(self.run)
        if path == 'actions/artifacts/' + str(p.ARTIFACT_ID): return copy.deepcopy(self.artifact)
        if path == 'git/ref/tags/' + p.TAG: return copy.deepcopy(self.tag)
        if path.startswith('releases?') or path == 'releases':
            query = parse_qs(urlsplit(path).query)
            page = int(query.get('page', ['1'])[0])
            size = int(query.get('per_page', ['30'])[0])
            return copy.deepcopy(self.releases[(page - 1) * size:page * size])
        if path == 'releases/tags/' + p.TAG:
            matches = [item for item in self.releases if item['tag_name'] == p.TAG and not item['draft']]
            if matches: return copy.deepcopy(matches[0])
            if optional: return None
            raise RuntimeError('Tag lookup excludes draft releases')
        if path.startswith('releases/') and path.split('/')[1].isdigit():
            return copy.deepcopy(next(item for item in self.releases if item['id'] == int(path.split('/')[1])))
        raise AssertionError('Unexpected API read: ' + path)

    def gh(self, *args):
        self.calls.append(args)
        if args[:2] == ('release', 'create'):
            t.assertEqual(args[2], p.TAG)
            t.assertEqual(args[args.index('--target') + 1], p.SOURCE)
            t.assertIn('--draft', args)
            t.assertIn('--prerelease', args)
            t.assertIn('--latest=false', args)
            t.assertEqual(Path(args[args.index('--notes-file') + 1]).read_text(), p.BODY)
            t.assertFalse(any(item['tag_name'] == p.TAG for item in self.releases), 'must reuse existing draft')
            self.releases.append(release())
            return self.releases[-1]['html_url']
        if args[:2] == ('release', 'upload'):
            t.assertNotIn('--clobber', args)
            name = Path(args[3]).name
            target = next(item for item in self.releases if item['tag_name'] == p.TAG)
            t.assertTrue(target['draft'])
            t.assertNotIn(name, [item['name'] for item in target['assets']])
            target['assets'].append(asset(name))
            return ''
        if args[:2] == ('release', 'edit'):
            t.assertIn('--draft=false', args)
            t.assertIn('--prerelease', args)
            t.assertIn('--latest=false', args)
            target = next(item for item in self.releases if item['tag_name'] == p.TAG)
            t.assertEqual(set(item['name'] for item in target['assets']), set(p.ASSETS))
            target['draft'] = False
            self.tag = {'object': {'type': 'commit', 'sha': p.SOURCE}}
            return ''
        raise AssertionError('Unexpected gh mutation: ' + repr(args))

    def download(self, path, destination):
        self.calls.append(('download', path))
        destination.write_bytes(b'fixture')

    def bundle(self, archive, directory):
        self.calls.append(('verify-bundle',))
        if self.corrupt_bundle: raise RuntimeError('Wrong build artifact ZIP')
        for name in p.ASSETS: (directory / name).write_bytes(b'fixture')

    def check_file(self, path, expected):
        self.calls.append(('verify-remote', path.name))
        if self.corrupt_remote: raise RuntimeError('Wrong remote bytes')

    def mutations(self):
        return [call for call in self.calls if call[0] == 'release']
`;

function runPython(source) {
  const result = spawnSync(python, ['-c', preamble + '\n' + source, helper], {
    encoding: 'utf8', timeout: 20000, windowsHide: true,
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr || result.stdout);
}

test('artifact ZIP downloads negotiate JSON while release asset downloads request binary content', () => runPython(String.raw`
calls = []
def run(arguments, **kwargs):
    calls.append((arguments, kwargs))
    t.assertTrue(kwargs['check'])
    t.assertNotIn('shell', kwargs)
    t.assertNotIn('text', kwargs)
    kwargs['stdout'].write(b'\x00downloaded\xff')
p.subprocess.run = run
with tempfile.TemporaryDirectory() as temporary:
    directory = Path(temporary)
    cases = [('actions/artifacts/' + str(p.ARTIFACT_ID) + '/zip', 'application/vnd.github+json'),
             ('releases/assets/123', 'application/octet-stream')]
    for index, (path, media_type) in enumerate(cases):
        destination = directory / str(index)
        p.download_api(path, destination)
        t.assertEqual(calls[-1][0], ['gh', 'api', '-H', 'Accept: ' + media_type, 'repos/' + p.REPOSITORY + '/' + path])
        t.assertEqual(destination.read_bytes(), b'\x00downloaded\xff')
    t.assertEqual(len(calls), 2)
`));

test('publisher pins the authorized artifact and every distributed file', () => runPython(String.raw`
t.assertEqual(p.REPOSITORY, 'elmorei/flaghack-infinity-3d')
t.assertEqual(p.SOURCE, '8909d36160d1c381a669b5761c70fc7a03dbbce3')
t.assertEqual(p.RUN_ID, 38165458912)
t.assertEqual(p.ARTIFACT_ID, 11712241056)
t.assertEqual(p.VERSION, '0.1.1-iteration.1')
t.assertEqual(p.TAG, 'desktop-iteration')
t.assertEqual(p.ZIP_SHA256, '5d05fa9eb28545de3bb6bbdabfad08fe967e5cb67701e85a0fd92fc6198e68a5')
t.assertEqual(list(p.ASSETS), ['Flaghack-Setup-0.1.1-iteration.1-x64.exe', 'Flaghack-Setup-0.1.1-iteration.1-x64.exe.blockmap', 'iteration.yml'])
t.assertEqual(p.ASSETS[p.INSTALLER], (122597416, '63954a101b2528220742850e53ab09246eb1ed8472dcf97645d192918d9cd22d'))
t.assertEqual(p.ASSETS[p.INSTALLER + '.blockmap'], (129542, '000231aef959aa4de4d4f72503b447a84b0ff574bf0f9dc4146e2194fe1fc466'))
t.assertEqual(p.ASSETS['iteration.yml'], (389, '08d9b071957ba6b2cc29175abb2398a3c7c83effb222ee91c637c00195890b76'))
t.assertEqual(p.INSTALLER_SHA512, 'rWDD5qDlZZnw8TrxHu8u4qjwFnaXkIuiK1GwUdVYascnmGPhA0n8g1m1DVlQbLdDQBsEiOvr1YU2SFpMTJHrsg==')
`));

test('publisher can create a draft when tag lookup excludes drafts, then verifies before publishing', () => runPython(String.raw`
fake = FakeGitHub()
fake.install()
p.publish()
mutations = fake.mutations()
t.assertEqual([call[1] for call in mutations], ['create', 'upload', 'upload', 'upload', 'edit'])
t.assertEqual([Path(call[3]).name for call in mutations if call[1] == 'upload'], list(p.ASSETS))
first_mutation = next(i for i, call in enumerate(fake.calls) if call[0] == 'release')
t.assertLess(fake.calls.index(('verify-bundle',)), first_mutation)
edit_index = next(i for i, call in enumerate(fake.calls) if call[:2] == ('release', 'edit'))
for name in p.ASSETS:
    t.assertLess(fake.calls.index(('verify-remote', 'remote-' + name)), edit_index)
t.assertEqual(fake.calls[-1], ('public',))
`));

test('publisher resumes a matching draft without replacing verified assets', () => runPython(String.raw`
fake = FakeGitHub(release(names=[p.INSTALLER]))
fake.install()
p.publish()
t.assertEqual([call[1] for call in fake.mutations()], ['upload', 'upload', 'edit'])
t.assertEqual([Path(call[3]).name for call in fake.mutations() if call[1] == 'upload'], list(p.ASSETS)[1:])
`));

test('publisher treats an already published matching release as a read-only verification', () => runPython(String.raw`
fake = FakeGitHub(release(draft=False, names=p.ASSETS))
fake.install()
p.publish()
t.assertEqual(fake.mutations(), [])
t.assertEqual(fake.calls[-1], ('public',))
`));

test('publisher refuses unsuccessful source runs, wrong artifacts, tags, and bundle bytes before mutations', () => runPython(String.raw`
changes = [lambda f: f.run.update(head_sha='bad'), lambda f: f.run.update(status='in_progress'),
           lambda f: f.run.update(conclusion='failure'), lambda f: f.artifact.update(id=0),
           lambda f: f.artifact.update(name='other'), lambda f: f.artifact.update(expired=True),
           lambda f: f.artifact['workflow_run'].update(id=0),
           lambda f: f.artifact['workflow_run'].update(head_sha='bad'),
           lambda f: f.artifact.update(digest='sha256:wrong'),
           lambda f: setattr(f, 'tag', {'object': {'type': 'commit', 'sha': 'bad'}}),
           lambda f: setattr(f, 'tag', {'object': {'type': 'tag', 'sha': p.SOURCE}}),
           lambda f: setattr(f, 'corrupt_bundle', True)]
for change in changes:
    fake = FakeGitHub()
    change(fake)
    fake.install()
    with t.assertRaises(RuntimeError): p.publish()
    t.assertEqual(fake.mutations(), [])
`));

test('publisher fails closed for unexpected existing release identity, duplicate assets, or corrupt remote bytes', () => runPython(String.raw`
changes = [lambda r: r.update(name='other'), lambda r: r.update(target_commitish='main'),
           lambda r: r.update(prerelease=False), lambda r: r.update(body='other'),
           lambda r: r['assets'].append({'name': 'latest.yml'}),
           lambda r: r['assets'].append(copy.deepcopy(r['assets'][0])),
           lambda r: r['assets'][0].update(state='starter'),
           lambda r: r['assets'][0].update(size=1),
           lambda r: r['assets'][0].update(digest='sha256:wrong')]
for change in changes:
    existing = release(names=[p.INSTALLER])
    change(existing)
    fake = FakeGitHub(existing)
    fake.install()
    with t.assertRaises(RuntimeError): p.publish()
    t.assertEqual(fake.mutations(), [])
fake = FakeGitHub(release(names=[p.INSTALLER]))
fake.corrupt_remote = True
fake.install()
with t.assertRaises(RuntimeError): p.publish()
t.assertEqual(fake.mutations(), [])
`));

test('publisher rejects ambiguous duplicate drafts instead of choosing a mutation target', () => runPython(String.raw`
fake = FakeGitHub(release())
duplicate = release()
duplicate['id'] = 62
fake.releases.append(duplicate)
fake.install()
with t.assertRaises(RuntimeError): p.publish()
t.assertEqual(fake.mutations(), [])
`));

test('publisher finds an existing draft beyond the first release page', () => runPython(String.raw`
fake = FakeGitHub()
for index in range(100):
    other = release()
    other.update(id=1000 + index, tag_name='unrelated-' + str(index))
    fake.releases.append(other)
fake.releases.append(release(names=[p.INSTALLER]))
fake.install()
p.publish()
t.assertNotIn('create', [call[1] for call in fake.mutations()])
`));

test('publisher never repairs or adds assets to an incomplete published release', () => runPython(String.raw`
fake = FakeGitHub(release(draft=False, names=[p.INSTALLER]))
fake.install()
with t.assertRaises(RuntimeError): p.publish()
t.assertEqual(fake.mutations(), [])
`));

test('publisher rechecks draft status and asset identity before the final publication', () => runPython(String.raw`
def rename_assets(target):
    assets = target['assets']
    assets[0]['name'], assets[1]['name'] = assets[1]['name'], assets[0]['name']

changes = [lambda target: target.update(draft=False),
           lambda target: target['assets'][0].update(id=999), rename_assets,
           lambda target: target['assets'][0].update(size=1),
           lambda target: target['assets'][0].update(state='starter'),
           lambda target: target['assets'][0].update(digest='sha256:wrong')]
for change in changes:
    fake = FakeGitHub(release(names=p.ASSETS))
    original_api = fake.api
    def api(path, optional=False):
        verified = len([call for call in fake.calls if call[0] == 'verify-remote'])
        if path == 'releases/61' and verified >= 2 * len(p.ASSETS):
            change(fake.releases[0])
        return original_api(path, optional)
    fake.install()
    p.api = api
    with t.assertRaises(RuntimeError): p.publish()
    t.assertEqual(fake.mutations(), [])
`));

test('public verification downloads only the iteration assets without authentication and checks their bytes', () => runPython(String.raw`
payloads = {name: ('public ' + name).encode() for name in p.ASSETS}
p.ASSETS = {name: (len(data), hashlib.sha256(data).hexdigest()) for name, data in payloads.items()}
calls = []
class Response(io.BytesIO):
    status = 200
    url = 'https://release-assets.githubusercontent.com/verified'
def urlopen(url, timeout):
    t.assertIsInstance(url, str)
    calls.append(url)
    name = url.rsplit('/', 1)[1]
    return Response(payloads[name])
p.urllib.request.urlopen = urlopen
with tempfile.TemporaryDirectory() as temporary:
    p.verify_public_assets(Path(temporary))
t.assertEqual(calls, ['https://github.com/' + p.REPOSITORY + '/releases/download/desktop-iteration/' + name for name in p.ASSETS])
original = p.ASSETS[p.INSTALLER]
p.ASSETS[p.INSTALLER] = (original[0], '0' * 64)
with tempfile.TemporaryDirectory() as temporary:
    with t.assertRaisesRegex(RuntimeError, 'SHA-256'): p.verify_public_assets(Path(temporary))
`));

test('bundle verifier checks ZIP identity, member names, size, SHA-256, and installer SHA-512', () => runPython(String.raw`
payloads = {p.INSTALLER: b'approved installer', p.INSTALLER + '.blockmap': b'approved blockmap', 'iteration.yml': b'approved manifest'}
p.ASSETS = {name: (len(data), hashlib.sha256(data).hexdigest()) for name, data in payloads.items()}
p.INSTALLER_SHA512 = base64.b64encode(hashlib.sha512(payloads[p.INSTALLER]).digest()).decode()
with tempfile.TemporaryDirectory() as temporary:
    directory = Path(temporary)
    archive = directory / 'fixture.zip'
    output = directory / 'out'
    output.mkdir()
    def write_zip(entries, pin=True):
        with warnings.catch_warnings():
            warnings.simplefilter('ignore', UserWarning)
            with zipfile.ZipFile(archive, 'w') as bundle:
                for name, data in entries: bundle.writestr(name, data)
        if pin: p.ZIP_SHA256 = hashlib.sha256(archive.read_bytes()).hexdigest()
    write_zip(payloads.items())
    p.verify_bundle(archive, output)
    for name, data in payloads.items(): t.assertEqual((output / name).read_bytes(), data)
    write_zip([(name, b'corrupted bytes') for name in payloads], pin=False)
    with t.assertRaisesRegex(RuntimeError, 'ZIP'): p.verify_bundle(archive, output)
    write_zip(list(payloads.items()) + [('../outside', b'x')])
    with t.assertRaisesRegex(RuntimeError, 'Unexpected ZIP files'): p.verify_bundle(archive, output)
    t.assertFalse((directory / 'outside').exists())
    write_zip(list(payloads.items()) + [(p.INSTALLER, payloads[p.INSTALLER])])
    with t.assertRaisesRegex(RuntimeError, 'Unexpected ZIP files'): p.verify_bundle(archive, output)
    wrong_size = dict(payloads)
    wrong_size[p.INSTALLER] += b'x'
    write_zip(wrong_size.items())
    with t.assertRaisesRegex(RuntimeError, 'size'): p.verify_bundle(archive, output)
    wrong_digest = dict(payloads)
    wrong_digest[p.INSTALLER] = b'x' * len(payloads[p.INSTALLER])
    write_zip(wrong_digest.items())
    with t.assertRaisesRegex(RuntimeError, 'SHA-256'): p.verify_bundle(archive, output)
    write_zip(payloads.items())
    p.INSTALLER_SHA512 = 'wrong'
    with t.assertRaisesRegex(RuntimeError, 'SHA-512'): p.verify_bundle(archive, output)
`));
