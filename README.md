# Security Vulnerabilities in Smart Contracts for Identity Management

This research project compares deliberately vulnerable identity and credential contracts with access-controlled implementations. Experiments use synthetic data and the local Hardhat network only. Vulnerable contracts are teaching artifacts and must not be deployed to a public network.

## Research Problem and Objectives

Identity records controlled by smart contracts can be modified or deleted if transaction authorization is not enforced. This project tests whether subject-level authorization and input validation prevent those failures. It measures observed attack outcomes, resulting contract state, test results, and gas for comparable owner operations.

The contracts store a synthetic display label and a `bytes32` commitment. They are not suitable for storing personal data, secrets, or production credentials.

## Architecture

The `blockchain/` directory contains four Solidity contracts, Hardhat configuration, tests, deployment script, and local experiment runner. The `frontend/` directory contains a Vite and ethers.js UI that is restricted to chain ID 31337 and uses generated local contract addresses. The `security/slither/` directory contains isolated analyzer setup and reproducible runs. The experiment runner deploys fresh instances to an ephemeral Hardhat chain and writes JSON and CSV results under `reports/`.

## Contract Designs

`IdentityVulnerable.sol` deliberately omits caller authorization from identity updates and deletion. Registration also accepts empty labels and zero commitments and permits duplicate registration. Its update and deletion methods only check that a record exists; any account can act on another subject's record.

`IdentitySecure.sol` scopes modification and deletion to the identity subject by requiring `msg.sender == subject`. It rejects duplicate registration, empty or overlong display labels, and zero commitments. Identity lifecycle events are emitted for registration, update, and deletion.

`CredentialRegistryVulnerable.sol` intentionally allows any account to issue or revoke synthetic credential commitments. `CredentialRegistrySecure.sol` allows issuance only by administrator-authorized issuers, binds each credential to a subject and issuer, checks nonzero identifiers/subjects and future expiry, prevents duplicate IDs, and limits revocation to the issuer or administrator. Verification rejects revoked and expired credentials.

Credentials store only a commitment, subject address, issuer address, and expiry. They do not store credential documents or personal attributes. Identity transfer and identity recovery are outside this study. The identity authorization-bypass experiment is the same operation as unauthorized update and is counted once.

## Threat Model

The adversary is an arbitrary account with access to the local development chain, but without the identity subject's signing key or the secure registry administrator's issuer-management authority. The study tests direct calls to exposed contract methods, not compromised wallets, consensus attacks, phishing, private-key theft, or external-chain behavior. Hardhat test keys and funds are public deterministic fixtures and must never be used on a live network.

## Vulnerabilities Investigated

- Broken access control: unauthorized changes to another subject's identity.
- Unauthorized deletion: a caller removes another subject's identity.
- Improper input validation: empty names and zero commitments are accepted by the vulnerable version.
- Duplicate registration: the vulnerable version silently overwrites an existing record.
- Credential forgery: any account can issue a credential in the vulnerable registry.
- Unauthorized revocation: any account can revoke credentials in the vulnerable registry.
- Credential input validation: the vulnerable registry accepts zero IDs, zero subjects, and expired credentials.
- Expiry enforcement: both registries reject credentials at or after their expiry timestamp.

## Methodology

Tests create fresh contract instances and use Hardhat's deterministic accounts. Attack transactions are submitted to the local chain. Each experiment records contract names, expected and actual outcomes, test status, transaction hash, gas used from receipts, and before/after state. The local Hardhat network is configured to mine reverted experiment transactions so blocked-operation receipts can be measured. Tests establish local expiry behavior at the boundary but do not simulate proposer timestamp manipulation.

The comparative JSON includes the observed test pass/fail counts, attack counts, rates, and gas. CSV contains one row per experiment. Gas results describe only the recorded local execution and are not generalized performance benchmarks. No precision, recall, or F1 score is calculated because this project has not established a labeled security-tool ground truth.

## Requirements

- Node.js 20.19 or newer (tested in this workspace with Node.js 22.14.0)
- npm
- Python 3.13.5 for the optional Slither analysis

Dependencies are pinned: Hardhat 2.26.3, Solidity compiler 0.8.24, ethers 6.13.4, and `@nomicfoundation/hardhat-ethers` 3.0.8 in `blockchain/package.json`; Vite 8.3.5 and ethers 6.13.4 in `frontend/package.json`.

## Install and Run

From the project root in PowerShell:

```powershell
Set-Location blockchain
npm install
npm run compile
npm test
npm run research
```

From a separate terminal, install and build the frontend:

```powershell
Set-Location frontend
npm install
npm run build
```

`npm run research` runs the test suite, records its observed counts, then launches the local experiments and writes:

- `reports/test-results.json`
- `reports/identity-comparison.json`
- `reports/identity-comparison.csv`

To run an interactive local node in one terminal and deploy both contracts from another:

```powershell
# Terminal 1
Set-Location blockchain
npm run node

# Terminal 2
Set-Location blockchain
npm run deploy:local

# Terminal 3
Set-Location frontend
npm run dev
```

After deploying, run `npm run smoke:local` from `blockchain/` to verify registration, reading, and authorized deletion against the live localhost deployment. The deployment script writes the current chain ID, addresses, and confirmed deployment transaction hashes to `frontend/deployments.local.json`; rerun it after restarting the node.

Open the Vite URL printed in Terminal 3 (normally `http://127.0.0.1:5173/`). The Hardhat node, deployment, and browser app use only local chain ID 31337. On connection or registration, the UI asks MetaMask to switch to or add the local Hardhat network if needed; MetaMask still requires user approval. The UI checks for contract bytecode before calls and requests normal MetaMask confirmation for each transaction. It contains no private keys. The test and research commands use their own ephemeral local chains.

Configure MetaMask's local development network as: network name `Hardhat Local`, RPC URL `http://127.0.0.1:8545`, chain ID `31337`, currency symbol `ETH`. Connect only a disposable Hardhat development account. Hardhat prints public test accounts and keys for local use; never use those keys or the local app with a public network.

For Slither, see [security/slither/README.md](security/slither/README.md). It uses Python in `security/.venv`, native solc 0.8.24, and produces raw output plus a JSON summary.

## Experimental Results

The pre-extension baseline is preserved in `reports/baseline/`. The latest recorded run is in `reports/identity-comparison.json` and `.csv`; rerun `npm run research` from `blockchain/` to regenerate it. These are observed local outcomes, not generalized probabilities.

| Experiment | Vulnerable result (gas) | Secure result (gas) |
| --- | --- | --- |
| Unauthorized identity modification | Succeeded | Blocked |
| Unauthorized identity deletion | Succeeded | Blocked |
| Empty identity label / zero commitment | Accepted | Rejected |
| Unauthorized credential issuance | Succeeded | Blocked |
| Unauthorized credential revocation | Succeeded | Blocked |
| Zero credential ID / subject / expiry | Accepted | Rejected |
| Credential expiration boundary | Invalid after expiry | Invalid after expiry |

Consult the generated JSON/CSV for exact transaction hashes, gas values, test counts, and state snapshots. Gas values are run-specific and are not generalized benchmarks. The initial identity-only gas measurements remain preserved in `reports/baseline/`.

The latest observed functional suite contains 20 passing tests. Four distinct unauthorized operations were attempted (identity modification, identity deletion, credential issuance, credential revocation): 4/4 succeeded against vulnerable contracts and 4/4 were blocked by secure contracts. Malformed credential fields were stored by the vulnerable version and rejected by the secure version. See the report's generated timestamp and test status before citing results.

Static analysis: Slither 0.11.6 ran 102 detectors on each contract. Findings: 0 on both identity contracts, 1 low-impact/medium-confidence timestamp finding on the vulnerable credential registry, and 2 equivalent timestamp findings on the secure registry. The findings describe real comparisons against chain time; they are not confirmed access-control exploits. Slither did not flag the missing authorization; the manually reproduced tests establish that flaw, illustrating an analyzer false negative for this labeled case. Full detail and raw outputs are in [security/slither/README.md](security/slither/README.md) and `security/slither/`.

## Limitations and Future Work

The UI rendering and production build are validated. Identity and credential transactions were smoke-tested in the integrated browser using a MetaMask-compatible shim against the local Hardhat JSON-RPC server; the actual MetaMask extension prompt/connection was not verified. The project intentionally omits reentrancy and unbounded-loop DoS demonstrations because these contracts have no external calls or unbounded loops. Static analysis is not proof of security. The identity owner cannot be recovered or transferred, and registry administration is a single deployer address. Production systems need a reviewed governance/recovery model, privacy-preserving proof design, and independent security review.