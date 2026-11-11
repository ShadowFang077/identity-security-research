const { ethers } = require("hardhat");
const fs = require("node:fs");
const path = require("node:path");

async function main() {
  const network = await ethers.provider.getNetwork();
  if (network.chainId !== 31337n) {
    throw new Error(`Refusing local deployment on chain ${network.chainId}; expected configured Hardhat chain 31337.`);
  }

  const contracts = [
    "IdentityVulnerable",
    "IdentitySecure",
    "CredentialRegistryVulnerable",
    "CredentialRegistrySecure"
  ];
  const deployments = {};
  const transactions = {};

  for (const contractName of contracts) {
    const Factory = await ethers.getContractFactory(contractName);
    const contract = await Factory.deploy();
    const deploymentTransaction = contract.deploymentTransaction();
    if (!deploymentTransaction) throw new Error(`${contractName} deployment transaction was not created.`);
    const receipt = await deploymentTransaction.wait();
    if (receipt.status !== 1) throw new Error(`${contractName} deployment transaction ${receipt.hash} failed.`);
    const address = await contract.getAddress();
    const bytecode = await ethers.provider.getCode(address);
    if (bytecode === "0x") throw new Error(`${contractName} has no bytecode at ${address} after deployment.`);
    deployments[contractName] = address;
    transactions[contractName] = receipt.hash;
    console.log(`${contractName}: ${address} · deployment confirmed · ${receipt.hash}`);
  }

  const frontendDirectory = path.resolve(__dirname, "..", "..", "frontend");
  fs.mkdirSync(frontendDirectory, { recursive: true });
  fs.writeFileSync(
    path.join(frontendDirectory, "deployments.local.json"),
    `${JSON.stringify({ chainId: Number(network.chainId), contracts: deployments, transactions }, null, 2)}\n`
  );
  console.log(`Local deployment manifest: ${path.join(frontendDirectory, "deployments.local.json")}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});