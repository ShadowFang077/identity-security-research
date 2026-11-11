# Slither Static Analysis

## Reproduction

This workspace run used Python 3.13.5, Slither 0.11.6, and native solc 0.8.24. From the repository root in PowerShell:

```powershell
python -m venv security\.venv
.\security\.venv\Scripts\python.exe -m pip install -r security\slither\requirements.txt
.\security\.venv\Scripts\solc-select.exe install 0.8.24
.\security\.venv\Scripts\solc-select.exe use 0.8.24
.\security\.venv\Scripts\python.exe security\slither\run_analysis.py
```

The wrapper saves raw Slither JSON and text output per contract and a machine-readable `summary.json`. Analysis is source-file scoped and runs locally; it does not contact a blockchain.

## Observed Findings

The recorded run analyzed all four contracts using 102 Slither detectors:

| Contract | Findings | Interpretation |
| --- | ---: | --- |
| `IdentityVulnerable` | 0 | Slither did not identify the missing subject authorization. The manually executed tests confirm that this is a real flaw; zero static findings is not evidence of safety. |
| `IdentitySecure` | 0 | No Slither findings in this run. This is not a proof of correctness. |
| `CredentialRegistryVulnerable` | 1 | Low impact, medium confidence `timestamp` finding on expiry verification. Expiration intentionally depends on chain time; this is a design caveat, not evidence of an access-control exploit. |
| `CredentialRegistrySecure` | 2 | Low impact, medium confidence `timestamp` findings on expiry validation and verification. Both checks implement the documented expiration behavior. |

The timestamp findings are retained rather than suppressed. In consensus systems, block timestamps have bounded proposer influence; applications should avoid using them for exact, high-value timing boundaries. The local tests establish expiry behavior at the configured timestamp but do not model proposer manipulation. No false positive has been asserted: the detector reports real timestamp comparisons, whose security significance depends on the application’s timing assumptions.

Manual tests, not Slither, are the evidence for the access-control flaw: unauthorized identity modification/deletion and credential issuance/revocation succeed against the vulnerable contracts and are rejected by the secure contracts. Slither’s lack of an access-control finding here is a detector limitation/false negative relative to this project’s test-grounded labels.

On this Windows run, Slither produced valid JSON with `success: true` for all contracts, while the process return code for contracts with findings appeared as `4294967295` (`-1` in PowerShell). The wrapper preserves both facts and treats the parsed analyzer success field as authoritative; inspect the raw `.txt` output and JSON if this behavior differs with another Slither/Python release.