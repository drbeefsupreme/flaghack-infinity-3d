"""Approximate mono graph renderer. Requires existing numpy/scipy; no packages installed.
Not WebAudio: naive oscillators, 64-sample filter control blocks, no spatial/master
compressor/limiter. Metrics are dry recipe comparisons, not loudness/LUFS. The preview
adds the captured production shared stereo impulse, wet routing, and W3C normalization.
"""
import json, sys
import numpy as np
from scipy.signal import lfilter
RATE = 44100
rng = np.random.default_rng(7711)
white = rng.uniform(-1, 1, RATE * 2)
w = rng.uniform(-1, 1, RATE * 4)
pink = (lfilter([.099046], [1, -.99765], w) + lfilter([.2965164], [1, -.963], w) + lfilter([1.0526913], [1, -.57], w) + .1848 * w) * .2

def render(nodes, duration):
    size = int((duration + .12) * RATE)
    times = np.arange(size) / RATE
    cache = {}
    def param(p):
        out = np.full(size, float(p['value']))
        previous_t, previous_v = 0., p['value']
        for event in p['events']:
            mode, value, t = event[:3]
            mask = times >= t
            if mode in ('linear', 'exp'):
                active = (times >= previous_t) & (times < t)
                x = (times[active] - previous_t) / max(1e-12, t - previous_t)
                out[active] = previous_v + (value - previous_v) * x if mode == 'linear' else previous_v * (value / max(1e-12, previous_v)) ** x
            if mode == 'target':
                ix = min(size-1, int(t * RATE)); start = out[ix]
                out[mask] = value + (start-value) * np.exp(-(times[mask]-t)/event[3])
            else:
                out[mask] = value
            previous_t, previous_v = t, value
        for source in p['inputs']: out += node(source)
        return out
    def node(i):
        if i in cache: return cache[i]
        n = nodes[i]; kind = n['kind']
        if kind == 'osc':
            freq = param(n['frequency']) * 2 ** (param(n['detune']) / 1200)
            start = n['startTime']; freq[times < start] = 0
            phase = (np.cumsum(freq) - freq) / RATE
            if n['type'] == 'sine': result = np.sin(phase * 2 * np.pi)
            elif n['type'] == 'triangle': result = 2 / np.pi * np.arcsin(np.sin(phase * 2 * np.pi))
            elif n['type'] == 'sawtooth': result = 2 * (phase % 1) - 1
            else: raise ValueError('Unsupported oscillator ' + n['type'])
        elif kind == 'noise':
            data = pink if n['buffer'] == 'pink' else white
            index = ((times - n['startTime']) * param(n['playbackRate']) + n['offset']) * RATE
            result = data[np.floor(index).astype(int) % len(data)].copy()
        else:
            result = np.zeros(size)
            for source in n['inputs']: result += node(source)
            if kind == 'gain': result *= param(n['gain'])
            elif kind == 'filter':
                freq, q = param(n['frequency']), param(n['Q']); zi = np.zeros(2); filtered = np.empty(size)
                for start in range(0, size, 64):
                    end = min(start + 64, size); omega = 2 * np.pi * np.clip(freq[start], 1, RATE * .49) / RATE
                    c, s = np.cos(omega), np.sin(omega)
                    # WebAudio lowpass Q is dB; bandpass Q is dimensionless.
                    alpha = s / (2 * (10 ** (q[start] / 20) if n['type'] == 'lowpass' else max(.001, q[start])))
                    a = np.array([1 + alpha, -2*c, 1-alpha])
                    if n['type'] == 'lowpass': b = np.array([(1-c)/2, 1-c, (1-c)/2])
                    elif n['type'] == 'bandpass': b = np.array([alpha, 0, -alpha])
                    else: raise ValueError('Unsupported filter ' + n['type'])
                    filtered[start:end], zi = lfilter(b/a[0], a/a[0], result[start:end], zi=zi)
                result = filtered
        if kind in ('osc', 'noise'): result[(times < n['startTime']) | (times >= n['stopTime'])] = 0
        cache[i] = result
        return result
    return node(0)

source = json.load(open(sys.argv[1])); output = []; waves = {}
for entry in source['reports']:
    wave = render(entry.pop('graph'), entry['duration'])
    waves[entry['cue']] = wave
    power = abs(np.fft.rfft(wave)) ** 2
    hz = np.fft.rfftfreq(len(wave), 1/RATE)
    total = np.sum(power)
    rms = float(np.sqrt(np.mean(wave**2)))
    entry.update(bass60to180Rms=float(rms*np.sqrt(np.sum(power[(hz>=60)&(hz<=180)])/total)),
                 subBelow50Rms=float(rms*np.sqrt(np.sum(power[hz<50])/total)),
                 nominalMasterSfxOnlyPeak=float(np.max(abs(wave))*.8*.9),
                 nominalMasterSfxOnlyRms=rms*.8*.9, peak=float(np.max(abs(wave))), rms=float(np.sqrt(np.mean(wave**2))),
                 bass60to180EnergyPct=float(100*np.sum(power[(hz>=60)&(hz<=180)])/total),
                 subBelow50EnergyPct=float(100*np.sum(power[hz<50])/total), finite=bool(np.isfinite(wave).all()))
    output.append(entry)
report = dict(revision=source['revision'], sourceHash=source['sourceHash'], nominalGainAssumption='master .8 times SFX .9 only; excludes cue voice gain and old token attenuation', approximation='Per-cue metrics are dry mono recipes: naive oscillators, block-updated RBJ filters, seeded engine-formula noise. Preview separately adds production shared stereo reverb and gain routing. Both exclude browser DSP, spatialization, compressor and limiter. Scheduling uses a JS graph stub, not browser DSP or audible latency.', reports=output)
def overlap(cues):
    n = max(len(waves[c]) for c in cues)
    combined = sum(np.pad(waves[c], (0, n-len(waves[c]))) for c in cues)
    return dict(cues=cues, dryPeak=float(np.max(abs(combined))), nominalMasterSfxPeak=float(np.max(abs(combined))*.72))
def offset_scan(first, second):
    best = (0., 0.)
    for offset in np.arange(-.6, .6001, .005):
        shift = int(round(abs(offset)*RATE)); a, b = waves[first], waves[second]
        if offset < 0: a, b = b, a
        n = max(len(a), len(b)+shift)
        combined = np.pad(a, (0,n-len(a))) + np.pad(b,(shift,n-len(b)-shift))
        peak = float(np.max(abs(combined)))
        if peak > best[0]: best = peak, float(offset)
    return dict(cues=[first,second], offsetSeconds=best[1], dryPeak=best[0], nominalMasterSfxPeak=best[0]*.72,
                assumption='Largest of sampled relative offsets -0.6..0.6 seconds in 5ms steps, same seeded waveforms; not a universal worst case')
report['sampledOffsetOverlaps'] = [offset_scan('step','crush'), offset_scan('stomp','crush')]
report['simultaneousOnsetOverlaps'] = [overlap(['beam','impact']), overlap(['step','crush']), overlap(['stomp','crush'])]
if len(sys.argv) > 3:
    from scipy.io import wavfile
    cues = [('emerge', .2), ('step', 5), ('step', 6.3), ('stomp', 7.7), ('crush', 9.8), ('charge', 11.4), ('beam', 14.4), ('impact', 14.4), ('death', 16.6)]
    from scipy.signal import fftconvolve
    reverb = source['reverb']
    ir = np.fromfile(reverb['impulsePath'], dtype=np.float32).astype(float).reshape(2,-1)
    # W3C ConvolverNode normalized RMS algorithm, including calibration rate.
    normalization = .00125 * 44100/RATE / max(.000125, float(np.sqrt(np.mean(ir**2))))
    ir *= normalization
    size = int(26*RATE)
    dry, wet_send = np.zeros(size), np.zeros(size)
    for cue,t in cues:
        start = int(round(t*RATE)); mix = reverb['voiceMix'][cue]
        data = waves[cue] * .72 * mix['gain']
        dry[start:start+len(data)] += data
        wet_send[start:start+len(data)] += data * mix['wet']
    # Centered mono dry, stereo shared IR; no invented reflections or per-cue IRs.
    wet = np.column_stack([fftconvolve(wet_send, channel)[:size] for channel in ir]) * reverb['returnGain']
    combined = dry[:,None] + wet
    peak = float(np.max(abs(combined)))
    if peak >= 1: raise RuntimeError('Preview requires explicit shared limiter approximation; do not normalize silently')
    wavfile.write(sys.argv[3], RATE, np.round(combined*32767).astype(np.int16))
    report['preview'] = dict(path=sys.argv[3], cues=cues, peak=peak, rms=float(np.sqrt(np.mean(combined**2))), peakNormalized=False,
        label='Approximate offline diagnostic preview with production bass and shared stereo reverb, not browser audio or gameplay capture',
        gain='master .8 * SFX .9 * production BOSS_VOICE_MIX gain/wet; shared production 2.8s impulse and .55 return; centered mono dry; no compressor/limiter/spatial',
        reverbNormalization=normalization, dryPeak=float(np.max(abs(dry))), wetPeak=float(np.max(abs(wet))),
        reverbSource=reverb, durationSeconds=size/RATE)
json.dump(report, open(sys.argv[2], 'w'), indent=2)
print(json.dumps(report, indent=2))
