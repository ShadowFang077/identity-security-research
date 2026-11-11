import json
import subprocess
from datetime import datetime, timezone
from pathlib import Path


SCRIPT_DIRECTORY = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIRECTORY.parents[1]
VENV_SCRIPTS = PROJECT_ROOT / "security" / ".venv" / "Scripts"
SLITHER = VENV_SCRIPTS / "slither.exe"
SOLC = VENV_SCRIPTS / "solc.exe"
CONTRACTS = (
    "IdentityVulnerable",
    "IdentitySecure",
    "CredentialRegistryVulnerable",
    "CredentialRegistrySecure",
)


def main():
    if not SLITHER.exists() or not SOLC.exists():
        raise SystemExit("Slither or solc is missing. Follow security/slither/README.md first.")

    compiler = subprocess.run(
        [str(SOLC), "--version"], capture_output=True, text=True, check=True
    )
    run_summary = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "compiler": compiler.stdout.strip(),
        "contracts": [],
    }

    for contract_name in CONTRACTS:
        source = PROJECT_ROOT / "blockchain" / "contracts" / f"{contract_name}.sol"
        json_path = SCRIPT_DIRECTORY / f"{contract_name}.json"
        text_path = SCRIPT_DIRECTORY / f"{contract_name}.txt"
        command = [
            str(SLITHER),
            str(source),
            "--solc",
            str(SOLC),
            "--json",
            str(json_path),
        ]
        result = subprocess.run(command, capture_output=True, text=True, check=False)
        output = "\n".join(part for part in (result.stdout, result.stderr) if part).strip()
        text_path.write_text(f"$ {' '.join(command)}\n{output}\n", encoding="utf-8")

        if not json_path.exists():
            run_summary["contracts"].append(
                {
                    "contract": contract_name,
                    "analysisSucceeded": False,
                    "returnCode": result.returncode,
                    "error": "Slither did not produce a JSON report.",
                }
            )
            continue

        report = json.loads(json_path.read_text(encoding="utf-8"))
        detectors = report.get("results", {}).get("detectors", [])
        run_summary["contracts"].append(
            {
                "contract": contract_name,
                "analysisSucceeded": report.get("success", False),
                "returnCode": result.returncode,
                "findingCount": len(detectors),
                "findings": [
                    {
                        "check": finding.get("check"),
                        "impact": finding.get("impact"),
                        "confidence": finding.get("confidence"),
                        "description": finding.get("description", "").strip(),
                    }
                    for finding in detectors
                ],
            }
        )
        print(f"{contract_name}: {len(detectors)} finding(s), report success={report.get('success')}")

    summary_path = SCRIPT_DIRECTORY / "summary.json"
    summary_path.write_text(json.dumps(run_summary, indent=2) + "\n", encoding="utf-8")
    print(f"Analysis summary: {summary_path}")

    if any(not contract["analysisSucceeded"] for contract in run_summary["contracts"]):
        raise SystemExit("At least one Slither analysis did not complete successfully.")


if __name__ == "__main__":
    main()