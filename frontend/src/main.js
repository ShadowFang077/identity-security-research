import { BrowserProvider, Contract, ZeroAddress, formatEther, id, isAddress } from "ethers";
import "./style.css";

const LOCAL_CHAIN_ID = 31337n;
const identityAbi = [
  "function registerIdentity(string displayName, bytes32 commitment)",
  "function updateIdentity(address subject, string displayName, bytes32 commitment)",
  "function deleteIdentity(address subject)",
  "function getIdentity(address subject) view returns (string displayName, bytes32 commitment, bool exists)",
  "function verifyIdentity(address subject) view returns (bool)"
];
const credentialAbi = [
  "function administrator() view returns (address)",
  "function authorizedIssuers(address issuer) view returns (bool)",
  "function setIssuer(address issuer, bool authorized)",
  "function issueCredential(bytes32 credentialId, address subject, uint64 expiresAt)",
  "function revokeCredential(bytes32 credentialId)",
  "function verifyCredential(bytes32 credentialId) view returns (bool)",
  "function getCredential(bytes32 credentialId) view returns (address subject, address issuer, uint64 expiresAt, bool revoked, bool exists)"
];
const vulnerableCredentialAbi = [
  "function issueCredential(bytes32 credentialId, address subject, uint64 expiresAt)",
  "function revokeCredential(bytes32 credentialId)",
  "function verifyCredential(bytes32 credentialId) view returns (bool)",
  "function getCredential(bytes32 credentialId) view returns (address subject, address issuer, uint64 expiresAt, bool revoked, bool exists)"
];

let provider;
let signer;
let account;
let deployments;
let registrationInProgress = false;

const activity = document.querySelector("#activity-log");
const walletState = document.querySelector("#wallet-state");
const networkState = document.querySelector("#network-state");

function log(message, kind = "") {
  activity.className = `activity-log ${kind}`;
  activity.textContent = message;
}

function registrationTrace(stage, details = {}) {
  if (import.meta.env.DEV) {
    console.info(`[identity-registration] ${stage}`, details);
  }
}

function describeError(error) {
  if (error?.code === "NETWORK_ERROR" && /network changed/i.test(error?.message ?? "")) {
    return "MetaMask changed networks during the request. Retry after Hardhat Local (chain ID 31337) is active.";
  }
  if (error?.code === 4001) return "Request rejected in MetaMask. Approve the wallet request to continue.";
  if (error?.code === -32002) return "A MetaMask request is already pending. Complete or dismiss it before retrying.";
  if (error?.code === "INSUFFICIENT_FUNDS" || /insufficient funds/i.test(error?.message ?? "")) {
    return "Insufficient local test ETH. Use a funded Hardhat development account on chain 31337.";
  }
  const messages = [
    error?.reason,
    error?.info?.error?.message,
    error?.info?.error?.data?.message,
    error?.error?.message,
    error?.shortMessage,
    error?.message
  ].filter(Boolean);
  const detailedMessage = messages.find((message) => !/missing revert data/i.test(message));
  if (/could not decode result data|bad_data|decode.*result/i.test(messages.join(" "))) {
    return "Contract call returned data that does not match the expected ABI. Check the selected network, deployed contract address, and frontend ABI; redeploy if the local node was restarted.";
  }
  if (/ECONNREFUSED|failed to fetch|could not detect network|network error/i.test(messages.join(" "))) {
    return "Hardhat node unavailable. Start it with `npm run node` from blockchain/ and confirm RPC http://127.0.0.1:8545 is reachable.";
  }
  if (error?.code === "CALL_EXCEPTION" || /execution reverted/i.test(messages.join(" "))) {
    return detailedMessage && !/call exception/i.test(detailedMessage)
      ? `Smart contract transaction reverted: ${detailedMessage}`
      : "Smart contract transaction reverted. Check contract requirements and the connected account's authorization.";
  }
  if (detailedMessage) return detailedMessage;
  if (messages.length) {
    return "The local node rejected the transaction. Check the connected account, issuer authorization, and input requirements.";
  }
  return "Transaction failed.";
}

function address(key) {
  const value = deployments?.contracts?.[key];
  if (!value || !isAddress(value)) {
    throw new Error(`Missing ${key} address. Start the local node and run npm run deploy:local.`);
  }
  return value;
}

function contract(key, abi) {
  if (!signer) throw new Error("Wallet not connected. Connect MetaMask on local chain 31337 first.");
  return new Contract(address(key), abi, signer);
}

async function ensureLocalNetwork() {
  if (!provider) throw new Error("Connect MetaMask first.");
  if (!window.ethereum) throw new Error("MetaMask was not detected.");
  let chainId;
  try {
    chainId = BigInt(await window.ethereum.request({ method: "eth_chainId" }));
  } catch (error) {
    throw new Error("Could not read the active MetaMask network. Unlock MetaMask and reconnect the wallet.", { cause: error });
  }
  if (chainId !== LOCAL_CHAIN_ID) {
    const chainId = `0x${LOCAL_CHAIN_ID.toString(16)}`;
    try {
      await window.ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId }]
      });
    } catch (error) {
      if (error.code !== 4902) {
        if (error.code === 4001) {
          throw new Error("Network switch rejected. Select or add Hardhat Local (chain ID 31337) in MetaMask to continue.", { cause: error });
        }
        throw error;
      }

      await window.ethereum.request({
        method: "wallet_addEthereumChain",
        params: [{
          chainId,
          chainName: "Hardhat Local",
          nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
          rpcUrls: ["http://127.0.0.1:8545"]
        }]
      });
      await window.ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId }]
      });
    }
    const switchedChainId = BigInt(await window.ethereum.request({ method: "eth_chainId" }));
    if (switchedChainId !== LOCAL_CHAIN_ID) {
      throw new Error(`Wrong network. MetaMask reports chain ID ${switchedChainId}; select Hardhat Local (31337).`);
    }
  }

  let providerChainId;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    providerChainId = (await provider.getNetwork()).chainId;
    if (providerChainId === LOCAL_CHAIN_ID) break;
  }
  if (providerChainId !== LOCAL_CHAIN_ID) {
    throw new Error(`Wrong network. Ethers reports chain ID ${providerChainId}; select Hardhat Local (31337).`);
  }
  if (!deployments || deployments.chainId !== Number(LOCAL_CHAIN_ID)) {
    throw new Error("No local deployment manifest found. Run npm run deploy:local against Hardhat localhost.");
  }
}

async function ensureWalletConnected() {
  if (!window.ethereum) throw new Error("MetaMask was not detected. Install or enable MetaMask to connect a wallet.");
  if (!provider) provider = new BrowserProvider(window.ethereum, "any");
  let accounts = await provider.send("eth_accounts", []);
  if (!accounts.length) {
    accounts = await provider.send("eth_requestAccounts", []);
  }
  if (!accounts.length) throw new Error("Wallet not connected. Approve the account request in MetaMask.");
  account = accounts[0];
  registrationTrace("Wallet connected", { account });
  await ensureLocalNetwork();
  registrationTrace("Network verified", { chainId: LOCAL_CHAIN_ID.toString() });
  signer = await provider.getSigner(account);
  walletState.textContent = `${account.slice(0, 6)}…${account.slice(-4)}`;
  networkState.textContent = "Hardhat · 31337";
  document.querySelector("#identity-address").value = account;
  document.querySelector("#credential-subject").value = account;
}

async function ensureContractDeployed(key) {
  await ensureLocalNetwork();
  const contractAddress = address(key);
  let code;
  try {
    code = await provider.getCode(contractAddress);
  } catch (error) {
    throw new Error("Hardhat node unavailable while checking the contract deployment.", { cause: error });
  }
  if (code === "0x") {
    throw new Error(`${key} is not deployed at ${contractAddress} on chain 31337. Restart/redeploy with npm run deploy:local from blockchain/.`);
  }
  registrationTrace("Contract deployment verified", {
    contract: key,
    address: contractAddress,
    bytecodeBytes: (code.length - 2) / 2
  });
  return contractAddress;
}

async function transact(label, operation, contractKey) {
  let transaction;
  try {
    await ensureLocalNetwork();
    if (contractKey) await ensureContractDeployed(contractKey);
    registrationTrace("Registration transaction requested", { label });
    transaction = await operation();
    registrationTrace("Transaction hash received", { label, hash: transaction.hash });
    log(`${label}: submitted ${transaction.hash}`, "success");
    const receipt = await transaction.wait();
    if (receipt.status !== 1) {
      registrationTrace("Transaction reverted", {
        label,
        hash: transaction.hash,
        blockNumber: receipt.blockNumber
      });
      const error = new Error(`${label} transaction was mined but reverted.`);
      error.transactionHash = transaction.hash;
      error.receipt = receipt;
      throw error;
    }
    registrationTrace("Transaction confirmed", {
      label,
      hash: transaction.hash,
      blockNumber: receipt.blockNumber
    });
    log(`${label}: confirmed · ${transaction.hash} · ${receipt.gasUsed} gas`, "success");
    return receipt;
  } catch (error) {
    registrationTrace("Transaction failed", {
      label,
      hash: transaction?.hash ?? error?.transactionHash,
      error: describeError(error)
    });
    const hash = transaction?.hash ?? error?.transactionHash;
    const status = hash ? ` · transaction ${hash}${error?.receipt ? " · reverted" : " · confirmation failed"}` : "";
    log(`${label}: ${describeError(error)}${status}`, "failure");
    if (hash && error?.transactionHash !== hash) {
      const reportedError = new Error(describeError(error), { cause: error });
      reportedError.code = error?.code;
      reportedError.transactionHash = hash;
      reportedError.receipt = error?.receipt;
      throw reportedError;
    }
    throw error;
  }
}

async function verifyRegistrationFunds(identity, contractAddress, owner, exists, name) {
  const functionName = exists ? "updateIdentity" : "registerIdentity";
  const args = exists
    ? [owner, name, id(name)]
    : [name, id(name)];
  const data = identity.interface.encodeFunctionData(functionName, args);
  const [balance, gasEstimate, feeData] = await Promise.all([
    provider.getBalance(owner),
    provider.estimateGas({ from: owner, to: contractAddress, data }),
    provider.getFeeData()
  ]);
  const gasPrice = feeData.maxFeePerGas ?? feeData.gasPrice;
  if (balance === 0n) {
    throw new Error("Insufficient local test ETH. Fund this account with a Hardhat development account on chain 31337.");
  }
  if (gasPrice === null) {
    throw new Error("Could not estimate the local transaction fee. Check that Hardhat is running and try again.");
  }
  const estimatedCost = gasEstimate * gasPrice;
  registrationTrace("Local ETH and estimated gas checked", {
    account: owner,
    balance: formatEther(balance),
    estimatedGas: gasEstimate.toString(),
    estimatedMaximumFee: formatEther(estimatedCost)
  });
  if (balance < estimatedCost) {
    throw new Error(`Insufficient local test ETH. Estimated transaction cost is ${formatEther(estimatedCost)} ETH, but the connected account has ${formatEther(balance)} ETH.`);
  }
}

function showResult(element, message) {
  element.textContent = message;
}

function showCaught(error, target) {
  showResult(target, describeError(error));
}

async function connectWallet() {
  try {
    if (!window.ethereum) throw new Error("MetaMask was not detected.");
    if (!provider) provider = new BrowserProvider(window.ethereum, "any");
    await ensureWalletConnected();
    walletState.textContent = `${account.slice(0, 6)}…${account.slice(-4)}`;
    networkState.textContent = "Hardhat · 31337";
    document.querySelector("#attack-subject").value = account;
    document.querySelector("#credential-attack-subject").value = account;
    await refreshIssuerState();
    log(`Connected ${account} on local Hardhat chain 31337.`, "success");
  } catch (error) {
    walletState.textContent = "Wallet not ready";
    networkState.textContent = "Local chain only";
    log(describeError(error), "failure");
  }
}

async function refreshIssuerState() {
  if (!signer) return;
  try {
    await ensureContractDeployed("CredentialRegistrySecure");
    const registry = contract("CredentialRegistrySecure", credentialAbi);
    const isIssuer = await registry.authorizedIssuers(account);
    document.querySelector("#issuer-state").textContent = isIssuer
      ? "Connected wallet is an authorized issuer."
      : "Connected wallet is not an issuer. The deployer can authorize it.";
  } catch (error) {
    document.querySelector("#issuer-state").textContent = describeError(error);
  }
}

document.querySelector("#connect-wallet").addEventListener("click", connectWallet);
document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((item) => item.classList.toggle("active", item === tab));
    document.querySelectorAll(".panel").forEach((panel) => panel.classList.toggle("active", panel.id === tab.dataset.panel));
  });
});

document.querySelector("#identity-register-form button[type='submit']").addEventListener("click", () => {
  registrationTrace("Registration button clicked");
});

document.querySelector("#identity-register-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  registrationTrace("Registration form submitted");
  if (registrationInProgress) {
    log("Identity registration is already in progress. Wait for its confirmation before retrying.", "failure");
    return;
  }
  const name = document.querySelector("#identity-name").value.trim();
  if (!name) return log("A synthetic display label is required.", "failure");
  registrationInProgress = true;
  let transactionReceipt;
  let actionLabel = "Register secure identity";
  try {
    await ensureWalletConnected();
    const registrationAccount = account;
    const registrationSigner = signer;
    const contractAddress = await ensureContractDeployed("IdentitySecure");
    const identity = new Contract(contractAddress, identityAbi, registrationSigner);
    const registrationFunction = identity.interface.getFunction("registerIdentity");
    if (!registrationFunction || registrationFunction.inputs.length !== 2 ||
        registrationFunction.inputs[0].type !== "string" ||
        registrationFunction.inputs[1].type !== "bytes32") {
      throw new Error("IdentitySecure frontend ABI does not match registerIdentity(string,bytes32).");
    }
    registrationTrace("Registration ABI verified", {
      address: contractAddress,
      signature: registrationFunction.format("sighash")
    });
    const exists = await identity.verifyIdentity(registrationAccount);
    registrationTrace("Identity state checked", { account: registrationAccount, exists });
    actionLabel = exists ? "Update secure identity" : "Register secure identity";
    await verifyRegistrationFunds(identity, contractAddress, registrationAccount, exists, name);
    transactionReceipt = await transact(actionLabel, () =>
      exists
        ? identity.updateIdentity(registrationAccount, name, id(name))
        : identity.registerIdentity(name, id(name)),
    "IdentitySecure"
    );
    document.querySelector("#identity-address").value = registrationAccount;
    const updatedIdentity = await identity.getIdentity(registrationAccount);
    if (!updatedIdentity.exists || updatedIdentity.displayName !== name || updatedIdentity.commitment !== id(name)) {
      throw new Error("Transaction confirmed, but the updated identity state did not match the submitted registration.");
    }
    registrationTrace("Updated identity state verified", {
      account: registrationAccount,
      displayName: updatedIdentity.displayName,
      transactionHash: transactionReceipt.hash
    });
    showResult(
      document.querySelector("#identity-result"),
      `Owner: ${registrationAccount}\nLabel: ${updatedIdentity.displayName}\nCommitment: ${updatedIdentity.commitment}`
    );
    log(`${actionLabel}: confirmed · ${transactionReceipt.hash} · updated identity verified`, "success");
  } catch (error) {
    registrationTrace("Registration flow failed", {
      transactionHash: transactionReceipt?.hash,
      error: describeError(error)
    });
    log(
      transactionReceipt
        ? `${actionLabel}: transaction confirmed · ${transactionReceipt.hash} · state verification failed: ${describeError(error)}`
        : error?.transactionHash
          ? `${actionLabel}: transaction ${error.transactionHash}${error?.receipt ? " reverted" : " confirmation failed"}: ${describeError(error)}`
          : `${actionLabel}: ${describeError(error)}`,
      "failure"
    );
  } finally {
    registrationInProgress = false;
  }
});

document.querySelector("#identity-delete").addEventListener("click", async () => {
  try {
    await ensureWalletConnected();
    await ensureContractDeployed("IdentitySecure");
    const identity = contract("IdentitySecure", identityAbi);
    await transact("Delete my secure identity", () => identity.deleteIdentity(account), "IdentitySecure");
    await readIdentity(account);
  } catch (error) {
    log(describeError(error), "failure");
  }
});

async function readIdentity(subject, contractKey = "IdentitySecure") {
  const result = document.querySelector("#identity-result");
  if (!isAddress(subject)) return showResult(result, "Enter a valid address.");
  try {
    await ensureContractDeployed(contractKey);
    const identity = contract(contractKey, identityAbi);
    const record = await identity.getIdentity(subject);
    showResult(result, record.exists
      ? `Owner: ${subject}\nLabel: ${record.displayName}\nCommitment: ${record.commitment}`
      : "No active identity for this address.");
  } catch (error) {
    showCaught(error, result);
  }
}

document.querySelector("#identity-lookup-form").addEventListener("submit", (event) => {
  event.preventDefault();
  readIdentity(document.querySelector("#identity-address").value.trim());
});

document.querySelector("#issuer-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    await ensureWalletConnected();
    await ensureContractDeployed("CredentialRegistrySecure");
    const registry = contract("CredentialRegistrySecure", credentialAbi);
    await transact("Authorize issuer", () => registry.setIssuer(account, true), "CredentialRegistrySecure");
    await refreshIssuerState();
  } catch (error) {
    log(describeError(error), "failure");
  }
});

document.querySelector("#credential-issue-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const label = document.querySelector("#credential-label").value.trim();
  const subject = document.querySelector("#credential-subject").value.trim();
  const days = Number(document.querySelector("#credential-days").value);
  if (!isAddress(subject) || subject === ZeroAddress) return log("Enter a valid nonzero subject address.", "failure");
  if (!label || !Number.isInteger(days) || days < 1 || days > 3650) return log("Enter a synthetic label and validity from 1 to 3650 days.", "failure");
  try {
    await ensureWalletConnected();
    await ensureContractDeployed("CredentialRegistrySecure");
    const registry = contract("CredentialRegistrySecure", credentialAbi);
    const latest = await provider.getBlock("latest");
    const expiresAt = BigInt(latest.timestamp) + BigInt(days * 86400);
    const credentialId = id(label);
    await transact("Issue credential", () => registry.issueCredential(credentialId, subject, expiresAt), "CredentialRegistrySecure");
    document.querySelector("#credential-inspect-label").value = label;
    await inspectCredential(label);
  } catch (error) {
    log(describeError(error), "failure");
  }
});

async function inspectCredential(label) {
  const result = document.querySelector("#credential-result");
  try {
    await ensureContractDeployed("CredentialRegistrySecure");
    const registry = contract("CredentialRegistrySecure", credentialAbi);
    const credentialId = id(label.trim());
    const [record, valid] = await Promise.all([
      registry.getCredential(credentialId),
      registry.verifyCredential(credentialId)
    ]);
    showResult(result, record.exists
      ? `Status: ${valid ? "VALID" : record.revoked ? "REVOKED" : "EXPIRED"}\nSubject: ${record.subject}\nIssuer: ${record.issuer}\nExpires: ${new Date(Number(record.expiresAt) * 1000).toLocaleString()}`
      : "Credential not found.");
  } catch (error) {
    showCaught(error, result);
  }
}

document.querySelector("#credential-inspect-form").addEventListener("submit", (event) => {
  event.preventDefault();
  inspectCredential(document.querySelector("#credential-inspect-label").value);
});

document.querySelector("#credential-revoke").addEventListener("click", async () => {
  const label = document.querySelector("#credential-inspect-label").value.trim();
  if (!label) return log("Enter a credential label first.", "failure");
  try {
    await ensureWalletConnected();
    await ensureContractDeployed("CredentialRegistrySecure");
    const registry = contract("CredentialRegistrySecure", credentialAbi);
    await transact("Revoke credential", () => registry.revokeCredential(id(label)), "CredentialRegistrySecure");
    await inspectCredential(label);
  } catch (error) {
    log(describeError(error), "failure");
  }
});

async function runIdentityAttack(contractKey, action) {
  const target = document.querySelector("#attack-subject").value.trim();
  const name = document.querySelector("#attack-name").value.trim();
  if (!isAddress(target) || target === ZeroAddress) return log("Enter a valid nonzero target address.", "failure");
  try {
    await ensureWalletConnected();
    await ensureContractDeployed(contractKey);
    const identity = contract(contractKey, identityAbi);
    if (action === "modify") {
      await transact(`${contractKey} identity modification`, () => identity.updateIdentity(target, name, id(name)), contractKey);
    } else {
      await transact(`${contractKey} identity deletion`, () => identity.deleteIdentity(target), contractKey);
    }
    await readIdentity(target, contractKey);
  } catch (error) {
    log(`${contractKey}: ${describeError(error)}`, "failure");
    await readIdentity(target, contractKey);
  }
}

document.querySelector("#attack-vulnerable").addEventListener("click", () => runIdentityAttack("IdentityVulnerable", "modify"));
document.querySelector("#attack-secure").addEventListener("click", () => runIdentityAttack("IdentitySecure", "modify"));
document.querySelector("#delete-vulnerable").addEventListener("click", () => runIdentityAttack("IdentityVulnerable", "delete"));
document.querySelector("#delete-secure").addEventListener("click", () => runIdentityAttack("IdentitySecure", "delete"));
document.querySelector("#seed-identity-both").addEventListener("click", async () => {
  if (!account) return log("Connect a local wallet first.", "failure");
  const name = `synthetic-target-${account.slice(2, 8).toLowerCase()}`;
  try {
    await ensureWalletConnected();
    await ensureContractDeployed("IdentityVulnerable");
    await ensureContractDeployed("IdentitySecure");
    const vulnerable = contract("IdentityVulnerable", identityAbi);
    const secure = contract("IdentitySecure", identityAbi);
    if (!(await vulnerable.verifyIdentity(account))) {
      await transact("Seed vulnerable identity as its owner", () => vulnerable.registerIdentity(name, id(name)), "IdentityVulnerable");
    }
    if (!(await secure.verifyIdentity(account))) {
      await transact("Seed secure identity as its owner", () => secure.registerIdentity(name, id(name)), "IdentitySecure");
    }
    document.querySelector("#attack-subject").value = account;
    log(`Identity target seeded in both registries for ${account}. Switch to another local account before testing unauthorized actions.`, "success");
  } catch (error) {
    log(describeError(error), "failure");
  }
});

async function runCredentialAttack(contractKey) {
  const subject = document.querySelector("#credential-attack-subject").value.trim();
  const label = document.querySelector("#credential-attack-label").value.trim();
  if (!isAddress(subject) || subject === ZeroAddress || !label) return log("Enter a valid subject and synthetic credential label.", "failure");
  try {
    await ensureWalletConnected();
    await ensureContractDeployed(contractKey);
    const registry = contract(
      contractKey,
      contractKey === "CredentialRegistrySecure" ? credentialAbi : vulnerableCredentialAbi
    );
    const latest = await provider.getBlock("latest");
    await transact(`${contractKey} credential issuance`, () =>
      registry.issueCredential(id(label), subject, BigInt(latest.timestamp + 3600)),
    contractKey);
    const verified = await registry.verifyCredential(id(label));
    log(`${contractKey}: credential ${verified ? "verified" : "not valid"}.`, verified ? "success" : "failure");
  } catch (error) {
    log(`${contractKey}: ${describeError(error)}`, "failure");
  }
}

document.querySelector("#credential-forge-vulnerable").addEventListener("click", () => runCredentialAttack("CredentialRegistryVulnerable"));
document.querySelector("#credential-forge-secure").addEventListener("click", () => runCredentialAttack("CredentialRegistrySecure"));
document.querySelector("#seed-credential-both").addEventListener("click", async () => {
  const subject = document.querySelector("#credential-attack-subject").value.trim();
  const label = document.querySelector("#credential-attack-label").value.trim();
  if (!isAddress(subject) || subject === ZeroAddress || !label) return log("Enter a valid subject and synthetic credential label.", "failure");
  try {
    await ensureWalletConnected();
    await ensureContractDeployed("CredentialRegistryVulnerable");
    await ensureContractDeployed("CredentialRegistrySecure");
    const expiry = BigInt((await provider.getBlock("latest")).timestamp + 3600);
    const credentialId = id(label);
    const vulnerable = contract("CredentialRegistryVulnerable", vulnerableCredentialAbi);
    const secure = contract("CredentialRegistrySecure", credentialAbi);
    await transact("Seed vulnerable credential as issuer", () => vulnerable.issueCredential(credentialId, subject, expiry), "CredentialRegistryVulnerable");
    await transact("Seed secure credential as authorized issuer", () => secure.issueCredential(credentialId, subject, expiry), "CredentialRegistrySecure");
    log(`Credential ${credentialId} seeded in both registries. Switch to a different local account to test revocation.`, "success");
  } catch (error) {
    log(describeError(error), "failure");
  }
});

async function runCredentialRevocation(contractKey) {
  const label = document.querySelector("#credential-attack-label").value.trim();
  if (!label) return log("Enter a synthetic credential label first.", "failure");
  try {
    await ensureWalletConnected();
    await ensureContractDeployed(contractKey);
    const abi = contractKey === "CredentialRegistrySecure" ? credentialAbi : vulnerableCredentialAbi;
    const registry = contract(contractKey, abi);
    await transact(`${contractKey} revocation`, () => registry.revokeCredential(id(label)), contractKey);
    const verified = await registry.verifyCredential(id(label));
    log(`${contractKey}: credential ${verified ? "still verifies" : "is no longer valid"}.`, verified ? "failure" : "success");
  } catch (error) {
    log(`${contractKey}: ${describeError(error)}`, "failure");
  }
}

document.querySelector("#revoke-credential-vulnerable").addEventListener("click", () => runCredentialRevocation("CredentialRegistryVulnerable"));
document.querySelector("#revoke-credential-secure").addEventListener("click", () => runCredentialRevocation("CredentialRegistrySecure"));
document.querySelector("#clear-log").addEventListener("click", () => log("Transaction trace cleared."));

window.ethereum?.on?.("accountsChanged", async (accounts) => {
  if (!accounts?.length) {
    account = undefined;
    signer = undefined;
    walletState.textContent = "Wallet disconnected";
    document.querySelector("#issuer-state").textContent = "Issuer status not checked.";
    log("Wallet disconnected.");
    return;
  }

  try {
    account = accounts[0];
    signer = await provider.getSigner(account);
    walletState.textContent = `${account.slice(0, 6)}…${account.slice(-4)}`;
    document.querySelector("#identity-address").value = account;
    document.querySelector("#credential-subject").value = account;
    await refreshIssuerState();
    log(`Active account changed to ${account}. Experiment target fields were preserved.`, "success");
  } catch (error) {
    log(describeError(error), "failure");
  }
});
window.ethereum?.on?.("chainChanged", (chainId) => {
  const activeChainId = BigInt(chainId);
  registrationTrace("MetaMask network changed", { chainId: activeChainId.toString() });
  networkState.textContent = activeChainId === LOCAL_CHAIN_ID
    ? "Hardhat · 31337"
    : `Wrong network · ${activeChainId}`;
  if (activeChainId !== LOCAL_CHAIN_ID) {
    document.querySelector("#issuer-state").textContent = "Switch MetaMask to Hardhat Local (chain ID 31337) to use local contracts.";
  }
  // Keep the transaction activity message independent from informational network events.
});

fetch("/deployments.local.json")
  .then((response) => {
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  })
  .then((manifest) => {
    if (manifest.chainId !== Number(LOCAL_CHAIN_ID)) {
      throw new Error(`Manifest chain ID ${manifest.chainId} does not match configured Hardhat chain ${LOCAL_CHAIN_ID}.`);
    }
    deployments = manifest;
    log("Local contract manifest loaded. Connect MetaMask on chain 31337.");
  })
  .catch((error) => {
    deployments = undefined;
    log(`Could not load local contract deployment configuration (${error.message}). Start Hardhat localhost and run npm run deploy:local from blockchain/.`, "failure");
  });