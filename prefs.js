// SPDX-FileCopyrightText: 2026 Chester Danao <chester@steerch.com>
// SPDX-License-Identifier: GPL-2.0-or-later

import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

function spinRow(settings, key, title, lower, upper, step = 1, digits = 0) {
    const row = new Adw.SpinRow({
        title,
        digits,
        adjustment: new Gtk.Adjustment({lower, upper, step_increment: step}),
    });
    settings.bind(key, row, 'value', Gio.SettingsBindFlags.DEFAULT);
    return row;
}

function colorRow(settings, key, title) {
    const row = new Adw.ActionRow({title});
    const button = new Gtk.ColorDialogButton({
        dialog: new Gtk.ColorDialog({with_alpha: false}),
        valign: Gtk.Align.CENTER,
    });
    const rgba = new Gdk.RGBA();
    rgba.parse(settings.get_string(key));
    button.set_rgba(rgba);
    button.connect('notify::rgba', () => {
        const c = button.get_rgba();
        const hex = [c.red, c.green, c.blue]
            .map(v => Math.round(v * 255).toString(16).padStart(2, '0')).join('');
        settings.set_string(key, `#${hex}`);
    });
    row.add_suffix(button);
    return row;
}

export default class TopBarVisualizerPrefs extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        const page = new Adw.PreferencesPage();

        const look = new Adw.PreferencesGroup({title: 'Appearance'});
        look.add(spinRow(settings, 'bar-count', 'Number of bars', 4, 64));
        look.add(spinRow(settings, 'bar-width', 'Bar width (px)', 1, 12));
        look.add(spinRow(settings, 'bar-gap', 'Gap between bars (px)', 0, 8));
        look.add(colorRow(settings, 'color', 'Peak color'));
        look.add(colorRow(settings, 'color-bottom', 'Base color'));

        const mirror = new Adw.SwitchRow({title: 'Mirrored bars', subtitle: 'Grow from the center'});
        settings.bind('mirror', mirror, 'active', Gio.SettingsBindFlags.DEFAULT);
        look.add(mirror);

        const positions = ['left', 'center', 'right'];
        const pos = new Adw.ComboRow({
            title: 'Top bar position',
            model: Gtk.StringList.new(['Left', 'Center', 'Right']),
            selected: Math.max(0, positions.indexOf(settings.get_string('position'))),
        });
        pos.connect('notify::selected', () => settings.set_string('position', positions[pos.selected]));
        look.add(pos);

        const behavior = new Adw.PreferencesGroup({title: 'Behavior'});
        behavior.add(spinRow(settings, 'sensitivity', 'Sensitivity', 0.2, 5.0, 0.1, 1));
        behavior.add(spinRow(settings, 'fps', 'Frames per second', 10, 60));

        page.add(look);
        page.add(behavior);
        window.add(page);
    }
}
