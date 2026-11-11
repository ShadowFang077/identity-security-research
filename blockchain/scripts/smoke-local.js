const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { ethers } = require("hardhat");

async function main() {
  const network = await ethers.provider.getNetwork();
  assert.equal(network.chainId, 31337n, "Expected local Hardhat chain ID 31337.");

  const manifestPath = path.resolve(__dirname, "..", "..", "frontend", "deployments.local.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  assert.equal(manifest.chainId, Number(network.chainId), "Deployment manifest chain ID does not match the live node.");

  const signers = await ethers.getSigners();
  const identityAddress = manifest.contracts?.IdentitySecure;
  assert.ok(identityAddress, "IdentitySecure is missing from frontend/deployments.local.json.");
  assert.notEqual(await ethers.provider.getCode(identityAddress), "0x", "IdentitySecure is not deployed at its manifest address.");

  const identity = await ethers.getContractAt("IdentitySecure", identityAddress);
  let owner;
  for (const signer of signers) {
    if (!(await identity.verifyIdentity(await signer.getAddress()))) {
      owner = signer;
      break;
    }
  }
  assert.ok(owner, "No unused Hardhat account is available for the registration smoke test.");
  const ownerAddress = await owner.getAddress();
  const connectedIdentity = identity.connect(owner);
  const label = `smoke-test-${Date.now()}`;
  const commitment = ethers.id(label);

  const registration = await connectedIdentity.registerIdentity(label, commitment);
  const registrationReceipt = await registration.wait();
  assert.equal(registrationReceipt.status, 1, "Registration transaction did not confirm successfully.");

  const record = await identity.getIdentity(ownerAddress);
  assert.equal(record.exists, true, "Registered identity was not readable.");
  assert.equal(record.displayName, label, "Registered identity label did not match.");
  assert.equal(record.commitment, commitment, "Registered identity commitment did not match.");

  const deletion = await connectedIdentity.deleteIdentity(ownerAddress);
  const deletionReceipt = await deletion.wait();
  assert.equal(deletionReceipt.status, 1, "Deletion transaction did not confirm successfully.");
  assert.equal(await identity.verifyIdentity(ownerAddress), false, "Identity still exists after deletion.");

  console.log(`Registration confirmed: ${registrationReceipt.hash}`);
  console.log(`Identity read verified for ${ownerAddress}.`);
  console.log(`Deletion confirmed: ${deletionReceipt.hash}`);
  console.log("Local identity registration/read/deletion smoke test passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
