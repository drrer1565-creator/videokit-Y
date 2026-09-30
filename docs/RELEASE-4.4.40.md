# VideoKit 4.4.40

- Fix new batch tabs omitted after applying changes; refresh preview media.
- Fix media following scrolling subtitles and competing position animation.
- Auto-stop scroll presets now use the receiving task duration.
- Point updater and release history at golsaysea/videokit-Y.
- Include Windows Edge TTS interpreter dependencies and unpacked bridge.
- Apply compatible dependency security updates and reject ZIP symlink entries.

Known audit limitation: extract-zip 2.0.1 has no patched release; all application extraction entrypoints now reject symbolic links and destinations traversing existing symlinks. npm audit still flags the underlying package. This is not a claim of zero vulnerabilities. Windows installer is not Authenticode signed unless signing credentials are configured.
