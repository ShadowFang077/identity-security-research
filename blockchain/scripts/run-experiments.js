const fs = require("node:fs");
const path = require("node:path");
const { ethers, network } = require("hardhat");

const projectDirectory = path.resolve(__dirname, "..");
const reportsDirectory = path.resolve(projectDirectory, "..", "reports");

async function deploy(name) {
  const Factory = await ethers.getContractFactory(name);
  const contract = await Factory.deploy();
  await contract.waitForDeployment();
  return contract;
}

async function sendAndMeasure(transactionPromise) {
  const transaction = await transactionPromise;
  const receipt = await transaction.wait();
  return {
    transactionHash: transaction.hash,
    gasUsed: receipt.gasUsed.toString()
  };
}

async function attemptAndMeasure(action) {
  let transaction;
  try {
    transaction = await action({ gasLimit: 250000 });
    const receipt = await transaction.wait();
    return {
      success: receipt.status === 1,
      transactionHash: transaction.hash,
      gasUsed: receipt.gasUsed.toString(),
      failure: null
    };
  } catch (error) {
    const receipt = error.receipt;
    return {
      success: false,
      transactionHash: transaction?.hash || receipt?.hash || null,
      gasUsed: receipt?.gasUsed?.toString() || null,
      failure: error.shortMessage || error.reason || error.message
    };
  }
}

function csvCell(value) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

async function main() {
  fs.mkdirSync(reportsDirectory, { recursive: true });
  const testResultsPath = path.join(reportsDirectory, "test-results.json");
  const testResults = fs.existsSync(testResultsPath)
    ? JSON.parse(fs.readFileSync(testResultsPath, "utf8"))
    : { status: "NOT RUN", passing: null, failing: null, countsAvailable: false };

  const [owner, issuer, attacker, subject] = await ethers.getSigners();
  const vulnerable = await deploy("IdentityVulnerable");
  const secure = await deploy("IdentitySecure");
  const vulnerableCredentials = await deploy("CredentialRegistryVulnerable");
  const secureCredentials = await deploy("CredentialRegistrySecure");
  await secureCredentials.connect(owner).setIssuer(issuer.address, true);
  const ownerCommitment = ethers.id("synthetic-research-subject");
  const attackCommitment = ethers.id("synthetic-attacker-value");

  const gas = {};
  let receipt = await sendAndMeasure(
    vulnerable.connect(owner).registerIdentity("synthetic-subject", ownerCommitment)
  );
  gas.vulnerableRegister = receipt.gasUsed;
  receipt = await sendAndMeasure(
    secure.connect(owner).registerIdentity("synthetic-subject", ownerCommitment)
  );
  gas.secureRegister = receipt.gasUsed;

  receipt = await sendAndMeasure(
    vulnerable.connect(owner).updateIdentity(
      owner.address,
      "synthetic-subject-updated",
      ethers.id("synthetic-updated-value")
    )
  );
  gas.vulnerableOwnerUpdate = receipt.gasUsed;
  receipt = await sendAndMeasure(
    secure.connect(owner).updateIdentity(
      owner.address,
      "synthetic-subject-updated",
      ethers.id("synthetic-updated-value")
    )
  );
  gas.secureOwnerUpdate = receipt.gasUsed;

  const vulnerableModificationBefore = await vulnerable.getIdentity(owner.address);
  const secureModificationBefore = await secure.getIdentity(owner.address);
  const vulnerableModification = await attemptAndMeasure((overrides) =>
    vulnerable.connect(attacker).updateIdentity(
      owner.address,
      "attacker-modified",
      attackCommitment,
      overrides
    )
  );
  const secureModification = await attemptAndMeasure((overrides) =>
    secure.connect(attacker).updateIdentity(
      owner.address,
      "attacker-modified",
      attackCommitment,
      overrides
    )
  );
  const vulnerableModifiedIdentity = await vulnerable.getIdentity(owner.address);
  const secureModifiedIdentity = await secure.getIdentity(owner.address);

  const vulnerableDeletionBefore = await vulnerable.verifyIdentity(owner.address);
  const secureDeletionBefore = await secure.verifyIdentity(owner.address);
  const vulnerableDeletion = await attemptAndMeasure((overrides) =>
    vulnerable.connect(attacker).deleteIdentity(owner.address, overrides)
  );
  const secureDeletion = await attemptAndMeasure((overrides) =>
    secure.connect(attacker).deleteIdentity(owner.address, overrides)
  );

  const vulnerableInput = await attemptAndMeasure((overrides) =>
    vulnerable.connect(attacker).registerIdentity("", ethers.ZeroHash, overrides)
  );
  const secureInput = await attemptAndMeasure((overrides) =>
    secure.connect(attacker).registerIdentity("", ethers.ZeroHash, overrides)
  );
  const vulnerableInputIdentity = await vulnerable.getIdentity(attacker.address);
  const secureInputIdentity = await secure.getIdentity(attacker.address);

  const credentialId = ethers.id("synthetic-credential-forgery-experiment");
  const latestBlock = await ethers.provider.getBlock("latest");
  const credentialExpiry = BigInt(latestBlock.timestamp + 3600);
  const vulnerableIssuance = await attemptAndMeasure((overrides) =>
    vulnerableCredentials.connect(attacker).issueCredential(
      credentialId,
      subject.address,
      credentialExpiry,
      overrides
    )
  );
  const secureIssuance = await attemptAndMeasure((overrides) =>
    secureCredentials.connect(attacker).issueCredential(
      credentialId,
      subject.address,
      credentialExpiry,
      overrides
    )
  );
  const vulnerableIssuedCredential = await vulnerableCredentials.getCredential(credentialId);
  const secureIssuedCredential = await secureCredentials.getCredential(credentialId);

  const malformedCredentialId = ethers.ZeroHash;
  const vulnerableInvalidIssuance = await attemptAndMeasure((overrides) =>
    vulnerableCredentials.connect(attacker).issueCredential(
      malformedCredentialId,
      ethers.ZeroAddress,
      0,
      overrides
    )
  );
  const secureInvalidIssuance = await attemptAndMeasure((overrides) =>
    secureCredentials.connect(issuer).issueCredential(
      malformedCredentialId,
      ethers.ZeroAddress,
      0,
      overrides
    )
  );
  const vulnerableMalformedCredential = await vulnerableCredentials.getCredential(malformedCredentialId);
  const secureMalformedCredential = await secureCredentials.getCredential(malformedCredentialId);

  const revocationId = ethers.id("synthetic-credential-revocation-experiment");
  await sendAndMeasure(
    vulnerableCredentials.connect(issuer).issueCredential(revocationId, subject.address, credentialExpiry)
  );
  await sendAndMeasure(
    secureCredentials.connect(issuer).issueCredential(revocationId, subject.address, credentialExpiry)
  );
  const vulnerableRevocation = await attemptAndMeasure((overrides) =>
    vulnerableCredentials.connect(attacker).revokeCredential(revocationId, overrides)
  );
  const secureRevocation = await attemptAndMeasure((overrides) =>
    secureCredentials.connect(attacker).revokeCredential(revocationId, overrides)
  );
  const vulnerableRevokedCredential = await vulnerableCredentials.getCredential(revocationId);
  const secureRevokedCredential = await secureCredentials.getCredential(revocationId);

  const expirationId = ethers.id("synthetic-credential-expiration-experiment");
  const expirationBlock = await ethers.provider.getBlock("latest");
  const expirationTime = BigInt(expirationBlock.timestamp + 300);
  const vulnerableExpirationIssue = await sendAndMeasure(
    vulnerableCredentials.connect(issuer).issueCredential(expirationId, subject.address, expirationTime)
  );
  const secureExpirationIssue = await sendAndMeasure(
    secureCredentials.connect(issuer).issueCredential(expirationId, subject.address, expirationTime)
  );
  const expirationBefore = {
    vulnerable: await vulnerableCredentials.verifyCredential(expirationId),
    secure: await secureCredentials.verifyCredential(expirationId)
  };
  await ethers.provider.send("evm_setNextBlockTimestamp", [Number(expirationTime)]);
  await ethers.provider.send("evm_mine", []);
  const expirationAfter = {
    vulnerable: await vulnerableCredentials.verifyCredential(expirationId),
    secure: await secureCredentials.verifyCredential(expirationId)
  };

  const experiments = [
    {
      id: "unauthorized-modification",
      unauthorized: true,
      vulnerability: "Missing access control permits identity modification",
      contracts: { vulnerable: "IdentityVulnerable", secure: "IdentitySecure" },
      expectedResult: "The attacker changes the vulnerable record; the secure record remains owner-controlled.",
      vulnerable: {
        outcome: vulnerableModification.success ? "SUCCEEDED" : "BLOCKED",
        ...vulnerableModification,
        stateBefore: {
          displayName: vulnerableModificationBefore.displayName,
          commitment: vulnerableModificationBefore.commitment,
          exists: vulnerableModificationBefore.exists
        },
        stateAfter: {
          displayName: vulnerableModifiedIdentity.displayName,
          commitment: vulnerableModifiedIdentity.commitment,
          exists: vulnerableModifiedIdentity.exists
        }
      },
      secure: {
        outcome: secureModification.success ? "SUCCEEDED" : "BLOCKED",
        ...secureModification,
        stateBefore: {
          displayName: secureModificationBefore.displayName,
          commitment: secureModificationBefore.commitment,
          exists: secureModificationBefore.exists
        },
        stateAfter: {
          displayName: secureModifiedIdentity.displayName,
          commitment: secureModifiedIdentity.commitment,
          exists: secureModifiedIdentity.exists
        }
      },
      mitigation: "The secure function requires msg.sender to equal the identity subject."
    },
    {
      id: "unauthorized-deletion",
      unauthorized: true,
      vulnerability: "Missing access control permits identity deletion",
      contracts: { vulnerable: "IdentityVulnerable", secure: "IdentitySecure" },
      expectedResult: "The attacker deletes the vulnerable record; the secure record remains active.",
      vulnerable: {
        outcome: vulnerableDeletion.success ? "SUCCEEDED" : "BLOCKED",
        ...vulnerableDeletion,
        stateBefore: { exists: vulnerableDeletionBefore },
        stateAfter: { exists: await vulnerable.verifyIdentity(owner.address) }
      },
      secure: {
        outcome: secureDeletion.success ? "SUCCEEDED" : "BLOCKED",
        ...secureDeletion,
        stateBefore: { exists: secureDeletionBefore },
        stateAfter: { exists: await secure.verifyIdentity(owner.address) }
      },
      mitigation: "The secure function permits deletion only by the identity subject."
    },
    {
      id: "empty-input-validation",
      vulnerability: "Missing validation accepts an empty name and zero commitment",
      contracts: { vulnerable: "IdentityVulnerable", secure: "IdentitySecure" },
      expectedResult: "The vulnerable registration accepts empty values; secure registration rejects them.",
      vulnerable: {
        outcome: vulnerableInput.success ? "ACCEPTED" : "REJECTED",
        ...vulnerableInput,
        stateAfter: {
          displayName: vulnerableInputIdentity.displayName,
          commitment: vulnerableInputIdentity.commitment,
          exists: vulnerableInputIdentity.exists
        }
      },
      secure: {
        outcome: secureInput.success ? "ACCEPTED" : "REJECTED",
        ...secureInput,
        stateAfter: {
          displayName: secureInputIdentity.displayName,
          commitment: secureInputIdentity.commitment,
          exists: secureInputIdentity.exists
        }
      },
      mitigation: "The secure contract requires a 1-64 byte display name and a nonzero commitment."
    },
    {
      id: "unauthorized-credential-issuance",
      unauthorized: true,
      vulnerability: "Missing issuer authorization permits forged credential issuance",
      contracts: {
        vulnerable: "CredentialRegistryVulnerable",
        secure: "CredentialRegistrySecure"
      },
      expectedResult: "The vulnerable registry accepts the attacker; the secure registry rejects it.",
      vulnerable: {
        outcome: vulnerableIssuance.success ? "SUCCEEDED" : "BLOCKED",
        ...vulnerableIssuance,
        stateAfter: {
          subject: vulnerableIssuedCredential.subject,
          issuer: vulnerableIssuedCredential.issuer,
          expiresAt: vulnerableIssuedCredential.expiresAt.toString(),
          revoked: vulnerableIssuedCredential.revoked,
          exists: vulnerableIssuedCredential.exists,
          verified: await vulnerableCredentials.verifyCredential(credentialId)
        }
      },
      secure: {
        outcome: secureIssuance.success ? "SUCCEEDED" : "BLOCKED",
        ...secureIssuance,
        stateAfter: {
          subject: secureIssuedCredential.subject,
          issuer: secureIssuedCredential.issuer,
          expiresAt: secureIssuedCredential.expiresAt.toString(),
          revoked: secureIssuedCredential.revoked,
          exists: secureIssuedCredential.exists,
          verified: await secureCredentials.verifyCredential(credentialId)
        }
      },
      mitigation: "Only administrator-authorized issuer addresses can issue credentials."
    },
    {
      id: "credential-input-validation",
      vulnerability: "Missing credential validation accepts zero identifiers, zero subjects, and expired credentials",
      contracts: {
        vulnerable: "CredentialRegistryVulnerable",
        secure: "CredentialRegistrySecure"
      },
      expectedResult: "The vulnerable registry stores malformed fields; the secure registry rejects them.",
      vulnerable: {
        outcome: vulnerableInvalidIssuance.success ? "ACCEPTED" : "REJECTED",
        ...vulnerableInvalidIssuance,
        stateBefore: { exists: false },
        stateAfter: {
          subject: vulnerableMalformedCredential.subject,
          issuer: vulnerableMalformedCredential.issuer,
          expiresAt: vulnerableMalformedCredential.expiresAt.toString(),
          exists: vulnerableMalformedCredential.exists
        }
      },
      secure: {
        outcome: secureInvalidIssuance.success ? "ACCEPTED" : "REJECTED",
        ...secureInvalidIssuance,
        stateBefore: { exists: false },
        stateAfter: {
          subject: secureMalformedCredential.subject,
          issuer: secureMalformedCredential.issuer,
          expiresAt: secureMalformedCredential.expiresAt.toString(),
          exists: secureMalformedCredential.exists
        }
      },
      mitigation: "The secure registry checks credential ID, subject, expiry, and duplicate status."
    },
    {
      id: "unauthorized-credential-revocation",
      unauthorized: true,
      vulnerability: "Missing revocation authorization permits denial of credential validity",
      contracts: {
        vulnerable: "CredentialRegistryVulnerable",
        secure: "CredentialRegistrySecure"
      },
      expectedResult: "The vulnerable registry accepts the attacker; the secure registry preserves the credential.",
      vulnerable: {
        outcome: vulnerableRevocation.success ? "SUCCEEDED" : "BLOCKED",
        ...vulnerableRevocation,
        stateAfter: {
          subject: vulnerableRevokedCredential.subject,
          issuer: vulnerableRevokedCredential.issuer,
          revoked: vulnerableRevokedCredential.revoked,
          verified: await vulnerableCredentials.verifyCredential(revocationId)
        }
      },
      secure: {
        outcome: secureRevocation.success ? "SUCCEEDED" : "BLOCKED",
        ...secureRevocation,
        stateAfter: {
          subject: secureRevokedCredential.subject,
          issuer: secureRevokedCredential.issuer,
          revoked: secureRevokedCredential.revoked,
          verified: await secureCredentials.verifyCredential(revocationId)
        }
      },
      mitigation: "Only the credential issuer or registry administrator can revoke a credential."
    },
    {
      id: "credential-expiration",
      vulnerability: "Credential validity must end at the recorded expiration timestamp",
      contracts: {
        vulnerable: "CredentialRegistryVulnerable",
        secure: "CredentialRegistrySecure"
      },
      expectedResult: "Credentials verify before expiration and fail verification at or after expiration.",
      vulnerable: {
        outcome: expirationBefore.vulnerable && !expirationAfter.vulnerable ? "EXPIRED" : "UNEXPECTED",
        success: expirationBefore.vulnerable && !expirationAfter.vulnerable,
        transactionHash: vulnerableExpirationIssue.transactionHash,
        gasUsed: vulnerableExpirationIssue.gasUsed,
        stateBefore: { verified: expirationBefore.vulnerable },
        stateAfter: { verified: expirationAfter.vulnerable, expiresAt: expirationTime.toString() }
      },
      secure: {
        outcome: expirationBefore.secure && !expirationAfter.secure ? "EXPIRED" : "UNEXPECTED",
        success: expirationBefore.secure && !expirationAfter.secure,
        transactionHash: secureExpirationIssue.transactionHash,
        gasUsed: secureExpirationIssue.gasUsed,
        stateBefore: { verified: expirationBefore.secure },
        stateAfter: { verified: expirationAfter.secure, expiresAt: expirationTime.toString() }
      },
      mitigation: "Verification checks block.timestamp against the credential's expiration timestamp."
    }
  ];

  const unauthorizedExperiments = experiments.filter((experiment) => experiment.unauthorized);
  const testExecutionStatus = testResults.exitCode === 0 && testResults.countsAvailable
    ? "PASSED"
    : "NOT RUN";
  for (const experiment of experiments) {
    experiment.testExecutionStatus = testExecutionStatus;
    experiment.actualResult = {
      vulnerableOutcome: experiment.vulnerable.outcome,
      secureOutcome: experiment.secure.outcome
    };
  }
  const report = {
    title: "Identity Contract Security Comparison",
    generatedAt: new Date().toISOString(),
    network: {
      name: network.name,
      chainId: Number((await ethers.provider.getNetwork()).chainId)
    },
    testResults: {
      passing: testResults.passing ?? null,
      failing: testResults.failing ?? null,
      countsAvailable: testResults.countsAvailable ?? false,
      exitCode: testResults.exitCode ?? null
    },
    totals: {
      unauthorizedOperationsAttempted: unauthorizedExperiments.length,
      unauthorizedOperationsSucceededOnVulnerable: unauthorizedExperiments.filter(
        (experiment) => experiment.vulnerable.success
      ).length,
      unauthorizedOperationsBlockedOnSecure: unauthorizedExperiments.filter(
        (experiment) => !experiment.secure.success
      ).length,
      vulnerableUnauthorizedSuccessRate: unauthorizedExperiments.length
        ? unauthorizedExperiments.filter((experiment) => experiment.vulnerable.success).length /
          unauthorizedExperiments.length
        : null,
      secureUnauthorizedBlockRate: unauthorizedExperiments.length
        ? unauthorizedExperiments.filter((experiment) => !experiment.secure.success).length /
          unauthorizedExperiments.length
        : null
    },
    gas,
    notes: [
      "All transactions were sent to the local Hardhat network using synthetic identities.",
      "Identity authorization bypass is represented by the unauthorized identity modification experiment and counted once.",
      "Gas values are from this execution and are not generalized benchmarks."
    ],
    experiments
  };

  const jsonPath = path.join(reportsDirectory, "identity-comparison.json");
  const csvPath = path.join(reportsDirectory, "identity-comparison.csv");
  fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);

  const columns = ["id", "vulnerability", "vulnerable_contract", "secure_contract", "expected_result", "test_status", "vulnerable_outcome", "secure_outcome", "vulnerable_success", "secure_success", "vulnerable_tx", "secure_tx", "vulnerable_gas", "secure_gas", "vulnerable_state_before", "vulnerable_state_after", "secure_state_before", "secure_state_after", "mitigation"];
  const rows = experiments.map((experiment) => [
    experiment.id,
    experiment.vulnerability,
    experiment.contracts.vulnerable,
    experiment.contracts.secure,
    experiment.expectedResult || "See experiment definition and mitigation",
    experiment.testExecutionStatus,
    experiment.vulnerable.outcome,
    experiment.secure.outcome,
    experiment.vulnerable.success,
    experiment.secure.success,
    experiment.vulnerable.transactionHash,
    experiment.secure.transactionHash,
    experiment.vulnerable.gasUsed,
    experiment.secure.gasUsed,
    JSON.stringify(experiment.vulnerable.stateBefore || ""),
    JSON.stringify(experiment.vulnerable.stateAfter || ""),
    JSON.stringify(experiment.secure.stateBefore || ""),
    JSON.stringify(experiment.secure.stateAfter || ""),
    experiment.mitigation
  ]);
  fs.writeFileSync(csvPath, [columns, ...rows].map((row) => row.map(csvCell).join(",")).join("\n") + "\n");

  console.log(`Unauthorized operations succeeded on vulnerable contract: ${report.totals.unauthorizedOperationsSucceededOnVulnerable}/${report.totals.unauthorizedOperationsAttempted}`);
  console.log(`Unauthorized operations blocked on secure contract: ${report.totals.unauthorizedOperationsBlockedOnSecure}/${report.totals.unauthorizedOperationsAttempted}`);
  console.log(`Reports written: ${jsonPath} and ${csvPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});