# Release security

Local API keys, settings, queues, logs, diagnostics and private fonts are excluded from public source and installers. Report suspected vulnerabilities privately to the repository owner.

Windows release workflow: .github/workflows/release-windows.yml. Releases include SHA256 checksums and GitHub build provenance attestations. Verify with gh attestation verify <file> -R golsaysea/videokit-Y.

Automatic updates use only golsaysea/videokit-Y. Source development launches do not install packaged updates.
