# Top Bar Audio Visualizer

A GNOME Shell extension that shows a real-time spectrum visualizer of your system audio output in the top bar.

## Features

- Log-spaced frequency bars from 40 Hz to 16 kHz
- Color gradient from a base color to a peak color, driven by each bar's level
- Optional mirrored mode where bars grow from the center
- Placement on the left, center or right of the top bar
- Pause and resume from the indicator's menu

## Requirements

- GNOME Shell 45–50
- `parec`, from your distro's PulseAudio utilities package. It works on both PulseAudio and PipeWire (through `pipewire-pulse`).

  | Distro | Package |
  | --- | --- |
  | Fedora | `pulseaudio-utils` |
  | Debian / Ubuntu | `pulseaudio-utils` |
  | Arch | `libpulse` |

## Privacy

The extension reads the monitor of your default audio output with `parec` and analyzes it in memory to draw the bars. Audio is never recorded, saved or sent anywhere. Capture stops when you pause the visualizer or turn off the extension.

## Installation

### From extensions.gnome.org

Search for **Top Bar Audio Visualizer** on [extensions.gnome.org](https://extensions.gnome.org) or in the Extension Manager app.

### From source

```bash
zip -r topbar-visualizer@steerch.com.shell-extension.zip \
  metadata.json extension.js prefs.js schemas/*.gschema.xml LICENSE
gnome-extensions install --force topbar-visualizer@steerch.com.shell-extension.zip
```

Log out and back in (on Wayland), then enable it:

```bash
gnome-extensions enable topbar-visualizer@steerch.com
```

## Settings

Open them from the indicator menu (**Settings**) or with `gnome-extensions prefs topbar-visualizer@steerch.com`.

| Setting | Default | Range |
| --- | --- | --- |
| Number of bars | 16 | 4–64 |
| Bar width (px) | 3 | 1–12 |
| Gap between bars (px) | 1 | 0–8 |
| Peak color | `#62a0ea` | |
| Base color | `#c061cb` | |
| Mirrored bars | Off | |
| Top bar position | Right | Left, Center, Right |
| Sensitivity | 1.0 | 0.2–5.0 |
| Frames per second | 30 | 10–60 |

## Troubleshooting

**The bars don't move.** Check that `parec` is installed (`which parec`) and that audio is actually playing. The bars stay flat while nothing is playing.

**The bars are too small or always maxed out.** Adjust **Sensitivity**.

**Checking for errors:**

```bash
journalctl -f -o cat /usr/bin/gnome-shell | grep topbar-visualizer
```

## License

Licensed under the GNU General Public License v2.0 or later. See [LICENSE](LICENSE).
