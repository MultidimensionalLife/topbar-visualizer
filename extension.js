// SPDX-FileCopyrightText: 2026 Chester Danao <chester@steerch.com>
// SPDX-License-Identifier: GPL-2.0-or-later

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';
import Clutter from 'gi://Clutter';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

const SAMPLE_RATE = 44100;
const FFT_SIZE = 2048;
const CHUNK_BYTES = 1024 * 2; // 1024 mono s16 samples
const MIN_FREQ = 40;
const MAX_FREQ = 16000;
const DB_FLOOR = -75;
const DB_CEIL = -15;

/* ---------- audio capture (parec on the default sink's monitor) ---------- */

class AudioCapture {
    constructor(onSamples) {
        this._onSamples = onSamples;
        this._proc = null;
        this._cancellable = null;
        this._leftover = null;
        this._restartId = 0;
        this._running = false;
    }

    start() {
        if (this._running)
            return;
        this._running = true;
        this._spawn();
    }

    stop() {
        this._running = false;
        if (this._restartId) {
            GLib.source_remove(this._restartId);
            this._restartId = 0;
        }
        this._cancellable?.cancel();
        this._cancellable = null;
        this._proc?.force_exit();
        this._proc = null;
        this._leftover = null;
    }

    _spawn() {
        try {
            this._cancellable = new Gio.Cancellable();
            this._proc = Gio.Subprocess.new([
                'parec',
                '--device=@DEFAULT_MONITOR@',
                '--format=s16le',
                `--rate=${SAMPLE_RATE}`,
                '--channels=1',
                '--latency-msec=15',
                '--client-name=Top Bar Visualizer',
                '--stream-name=visualizer',
            ], Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE);
        } catch (e) {
            console.error(`[topbar-visualizer] failed to start parec: ${e.message}`);
            this._scheduleRestart();
            return;
        }

        const proc = this._proc;
        proc.wait_async(null, () => {
            if (this._proc === proc) {
                this._proc = null;
                this._scheduleRestart();
            }
        });
        this._read(proc.get_stdout_pipe(), this._cancellable);
    }

    _scheduleRestart() {
        if (!this._running || this._restartId)
            return;
        this._restartId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 2, () => {
            this._restartId = 0;
            if (this._running)
                this._spawn();
            return GLib.SOURCE_REMOVE;
        });
    }

    _read(stream, cancellable) {
        stream.read_bytes_async(CHUNK_BYTES, GLib.PRIORITY_DEFAULT, cancellable, (s, res) => {
            let bytes;
            try {
                bytes = s.read_bytes_finish(res);
            } catch (e) {
                return; // cancelled or pipe closed; wait_async handles restart
            }
            if (!bytes || bytes.get_size() === 0)
                return;

            let data = bytes.toArray();
            if (this._leftover) {
                const merged = new Uint8Array(this._leftover.length + data.length);
                merged.set(this._leftover);
                merged.set(data, this._leftover.length);
                data = merged;
                this._leftover = null;
            }
            const even = data.length & ~1;
            if (even < data.length)
                this._leftover = data.slice(even);

            const samples = new Int16Array(data.slice(0, even).buffer);
            this._onSamples(samples);
            this._read(stream, cancellable);
        });
    }
}

/* ---------- spectrum analysis ---------- */

class Spectrum {
    constructor() {
        this._ring = new Float32Array(FFT_SIZE);
        this._pos = 0;
        this._re = new Float64Array(FFT_SIZE);
        this._im = new Float64Array(FFT_SIZE);
        this._window = new Float64Array(FFT_SIZE);
        for (let i = 0; i < FFT_SIZE; i++)
            this._window[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (FFT_SIZE - 1)));

        this._rev = new Uint32Array(FFT_SIZE);
        const bits = Math.log2(FFT_SIZE);
        for (let i = 0; i < FFT_SIZE; i++) {
            let r = 0;
            for (let b = 0; b < bits; b++)
                r |= ((i >> b) & 1) << (bits - 1 - b);
            this._rev[i] = r;
        }
        this._bands = [];
    }

    push(samples) {
        for (let i = 0; i < samples.length; i++) {
            this._ring[this._pos] = samples[i] / 32768;
            this._pos = (this._pos + 1) % FFT_SIZE;
        }
    }

    setBarCount(n) {
        // Log-spaced band edges mapped to FFT bins
        const binHz = SAMPLE_RATE / FFT_SIZE;
        const edges = [];
        for (let i = 0; i <= n; i++)
            edges.push(MIN_FREQ * Math.pow(MAX_FREQ / MIN_FREQ, i / n));
        this._bands = [];
        for (let i = 0; i < n; i++) {
            let lo = Math.floor(edges[i] / binHz);
            let hi = Math.floor(edges[i + 1] / binHz);
            if (hi <= lo)
                hi = lo + 1;
            this._bands.push([lo, Math.min(hi, FFT_SIZE / 2)]);
        }
    }

    compute(out, gain) {
        const re = this._re, im = this._im, N = FFT_SIZE;
        for (let i = 0; i < N; i++) {
            const j = this._rev[i];
            re[j] = this._ring[(this._pos + i) % N] * this._window[i];
            im[j] = 0;
        }
        for (let size = 2; size <= N; size <<= 1) {
            const half = size >> 1;
            const step = (-2 * Math.PI) / size;
            for (let start = 0; start < N; start += size) {
                for (let k = 0; k < half; k++) {
                    const c = Math.cos(step * k), s = Math.sin(step * k);
                    const a = start + k, b = a + half;
                    const tr = re[b] * c - im[b] * s;
                    const ti = re[b] * s + im[b] * c;
                    re[b] = re[a] - tr;
                    im[b] = im[a] - ti;
                    re[a] += tr;
                    im[a] += ti;
                }
            }
        }

        const norm = 2 / (N * 0.5); // Hann window coherent gain
        for (let i = 0; i < this._bands.length; i++) {
            const [lo, hi] = this._bands[i];
            let peak = 0;
            for (let k = lo; k < hi; k++) {
                const m = Math.hypot(re[k], im[k]) * norm;
                if (m > peak)
                    peak = m;
            }
            // Tilt so highs aren't dwarfed by bass (~3 dB/octave)
            const tilt = 1 + i / this._bands.length * 3;
            const db = 20 * Math.log10(peak * gain * tilt + 1e-9);
            out[i] = Math.min(1, Math.max(0, (db - DB_FLOOR) / (DB_CEIL - DB_FLOOR)));
        }
    }
}

/* ---------- panel indicator ---------- */

function parseColor(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex ?? '');
    const v = m ? parseInt(m[1], 16) : 0x62a0ea;
    return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
}

const VisualizerIndicator = GObject.registerClass(
class VisualizerIndicator extends PanelMenu.Button {
    _init(ext) {
        super._init(0.5, 'Top Bar Audio Visualizer');
        this._ext = ext;
        this._settings = ext.getSettings();
        this._spectrum = new Spectrum();
        this._paused = false;
        this._timerId = 0;
        this._gotAudio = false;

        this._area = new St.DrawingArea({
            style_class: 'topbar-visualizer',
            y_expand: true,
            y_align: Clutter.ActorAlign.FILL,
        });
        this._area.connect('repaint', a => this._draw(a));
        this.add_child(this._area);

        this._capture = new AudioCapture(samples => {
            this._spectrum.push(samples);
            this._gotAudio = true;
        });

        const pauseItem = new PopupMenu.PopupSwitchMenuItem('Visualizer active', true);
        pauseItem.connect('toggled', (_i, state) => this._setPaused(!state));
        this.menu.addMenuItem(pauseItem);
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this.menu.addAction('Settings', () => ext.openPreferences());

        this._settingsIds = [
            'bar-count', 'bar-width', 'bar-gap', 'fps',
        ].map(k => this._settings.connect(`changed::${k}`, () => this._reconfigure()));
        this._settingsIds.push(
            ...['color', 'color-bottom', 'mirror'].map(k =>
                this._settings.connect(`changed::${k}`, () => this._readColors())));

        this._readColors();
        this._reconfigure();
        this._capture.start();
    }

    _readColors() {
        this._top = parseColor(this._settings.get_string('color'));
        this._bottom = parseColor(this._settings.get_string('color-bottom'));
        this._mirror = this._settings.get_boolean('mirror');
        this._area.queue_repaint();
    }

    _reconfigure() {
        this._n = this._settings.get_int('bar-count');
        this._barW = this._settings.get_int('bar-width');
        this._gap = this._settings.get_int('bar-gap');
        this._target = new Float32Array(this._n);
        this._levels = new Float32Array(this._n);
        this._spectrum.setBarCount(this._n);
        this._area.set_width(this._n * this._barW + (this._n - 1) * this._gap);

        if (this._timerId)
            GLib.source_remove(this._timerId);
        this._timerId = 0;
        if (!this._paused) {
            const interval = Math.round(1000 / this._settings.get_int('fps'));
            this._timerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, interval, () => {
                this._tick();
                return GLib.SOURCE_CONTINUE;
            });
        }
    }

    _setPaused(paused) {
        this._paused = paused;
        if (paused) {
            this._capture.stop();
            this._levels.fill(0);
            this._area.queue_repaint();
        } else {
            this._capture.start();
        }
        this._reconfigure();
    }

    _tick() {
        if (this._gotAudio) {
            this._spectrum.compute(this._target, this._settings.get_double('sensitivity'));
            this._gotAudio = false;
        } else {
            this._target.fill(0); // no data arriving (parec only sends while sink is running)
        }

        let changed = false;
        for (let i = 0; i < this._n; i++) {
            const t = this._target[i], l = this._levels[i];
            const next = t > l ? l + (t - l) * 0.7 : l + (t - l) * 0.18;
            if (Math.abs(next - l) > 0.001)
                changed = true;
            this._levels[i] = next;
        }
        if (changed)
            this._area.queue_repaint();
    }

    _draw(area) {
        const cr = area.get_context();
        const [w, h] = area.get_surface_size();
        const pad = Math.round(h * 0.22);
        const maxH = h - pad * 2;
        const minH = Math.max(1, this._barW > 2 ? 2 : 1);

        const [tr, tg, tb] = this._top;
        const [br, bg, bb] = this._bottom;

        for (let i = 0; i < this._n; i++) {
            const bh = Math.max(minH, this._levels[i] * maxH);
            const x = i * (this._barW + this._gap);
            const y = this._mirror ? (h - bh) / 2 : h - pad - bh;
            const k = this._levels[i];
            cr.setSourceRGBA(br + (tr - br) * k, bg + (tg - bg) * k, bb + (tb - bb) * k, 0.55 + 0.45 * k);
            const r = Math.min(this._barW / 2, bh / 2, 1.5);
            cr.newSubPath();
            cr.arc(x + this._barW - r, y + r, r, -Math.PI / 2, 0);
            cr.arc(x + this._barW - r, y + bh - r, r, 0, Math.PI / 2);
            cr.arc(x + r, y + bh - r, r, Math.PI / 2, Math.PI);
            cr.arc(x + r, y + r, r, Math.PI, 1.5 * Math.PI);
            cr.closePath();
            cr.fill();
        }
        cr.$dispose();
    }

    destroy() {
        if (this._timerId)
            GLib.source_remove(this._timerId);
        this._timerId = 0;
        this._capture.stop();
        this._settingsIds.forEach(id => this._settings.disconnect(id));
        this._settingsIds = [];
        super.destroy();
    }
});

export default class TopBarVisualizerExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._addIndicator();
        this._posId = this._settings.connect('changed::position', () => {
            this._indicator?.destroy();
            this._addIndicator();
        });
    }

    _addIndicator() {
        this._indicator = new VisualizerIndicator(this);
        const box = this._settings.get_string('position');
        Main.panel.addToStatusArea(this.uuid, this._indicator, box === 'right' ? 0 : -1, box);
    }

    disable() {
        if (this._posId)
            this._settings.disconnect(this._posId);
        this._posId = 0;
        this._indicator?.destroy();
        this._indicator = null;
        this._settings = null;
    }
}
