const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Credential registry security comparison", function () {
  let administrator;
  let issuer;
  let otherIssuer;
  let attacker;
  let subject;
  let vulnerable;
  let secure;

  async function expectRevert(transaction) {
    let failure;
    try {
      const sent = await transaction;
      await sent.wait();
    } catch (error) {
      failure = error;
    }

    expect(failure, "expected the transaction to revert").to.exist;
    expect(failure.shortMessage || failure.message).to.match(/revert/i);
  }

  async function futureExpiry(seconds = 3600) {
    const block = await ethers.provider.getBlock("latest");
    return BigInt(block.timestamp + seconds);
  }

  beforeEach(async function () {
    [administrator, issuer, otherIssuer, attacker, subject] = await ethers.getSigners();

    const Vulnerable = await ethers.getContractFactory("CredentialRegistryVulnerable");
    vulnerable = await Vulnerable.deploy();
    await vulnerable.waitForDeployment();

    const Secure = await ethers.getContractFactory("CredentialRegistrySecure");
    secure = await Secure.deploy();
    await secure.waitForDeployment();
    await secure.connect(administrator).setIssuer(issuer.address, true);
    await secure.connect(administrator).setIssuer(otherIssuer.address, true);
  });

  it("allows an authorized issuer to issue a subject-bound credential", async function () {
    const credentialId = ethers.id("synthetic-credential-authorized");
    await secure.connect(issuer).issueCredential(credentialId, subject.address, await futureExpiry());

    const credential = await secure.getCredential(credentialId);
    expect(credential.subject).to.equal(subject.address);
    expect(credential.issuer).to.equal(issuer.address);
    expect(credential.exists).to.equal(true);
    expect(await secure.verifyCredential(credentialId)).to.equal(true);
  });

  it("permits credential forgery on the vulnerable registry and blocks unauthorized issuance", async function () {
    const credentialId = ethers.id("synthetic-credential-forged");
    const expiresAt = await futureExpiry();
    await vulnerable.connect(attacker).issueCredential(credentialId, subject.address, expiresAt);

    await expectRevert(
      secure.connect(attacker).issueCredential(credentialId, subject.address, expiresAt)
    );

    expect(await vulnerable.verifyCredential(credentialId)).to.equal(true);
    expect((await vulnerable.getCredential(credentialId)).issuer).to.equal(attacker.address);
    expect(await secure.verifyCredential(credentialId)).to.equal(false);
  });

  it("allows unauthorized revocation on the vulnerable registry and blocks it securely", async function () {
    const credentialId = ethers.id("synthetic-credential-revocation");
    const expiresAt = await futureExpiry();
    await vulnerable.connect(issuer).issueCredential(credentialId, subject.address, expiresAt);
    await secure.connect(issuer).issueCredential(credentialId, subject.address, expiresAt);

    await vulnerable.connect(attacker).revokeCredential(credentialId);
    await expectRevert(secure.connect(attacker).revokeCredential(credentialId));

    expect(await vulnerable.verifyCredential(credentialId)).to.equal(false);
    expect(await secure.verifyCredential(credentialId)).to.equal(true);
  });

  it("rejects invalid hashes, subjects, and already-expired credentials", async function () {
    const credentialId = ethers.id("synthetic-validation");
    const expiredAt = BigInt((await ethers.provider.getBlock("latest")).timestamp);

    await expectRevert(
      secure.connect(issuer).issueCredential(ethers.ZeroHash, subject.address, await futureExpiry())
    );
    await expectRevert(
      secure.connect(issuer).issueCredential(credentialId, ethers.ZeroAddress, await futureExpiry())
    );
    await expectRevert(
      secure.connect(issuer).issueCredential(credentialId, subject.address, expiredAt)
    );
  });

  it("accepts malformed credential data in the vulnerable registry", async function () {
    await vulnerable.connect(attacker).issueCredential(
      ethers.ZeroHash,
      ethers.ZeroAddress,
      0
    );
    await expectRevert(
      secure.connect(issuer).issueCredential(ethers.ZeroHash, ethers.ZeroAddress, 0)
    );

    const malformed = await vulnerable.getCredential(ethers.ZeroHash);
    expect(malformed.exists).to.equal(true);
    expect(malformed.subject).to.equal(ethers.ZeroAddress);
    expect(malformed.expiresAt).to.equal(0n);
    expect(await secure.getCredential(ethers.ZeroHash).then((record) => record.exists)).to.equal(false);
  });

  it("rejects duplicate credential identifiers", async function () {
    const credentialId = ethers.id("synthetic-credential-duplicate");
    await secure.connect(issuer).issueCredential(credentialId, subject.address, await futureExpiry());

    await expectRevert(
      secure.connect(issuer).issueCredential(credentialId, subject.address, await futureExpiry())
    );
  });

  it("automatically reports credentials as invalid after expiry in both registries", async function () {
    const credentialId = ethers.id("synthetic-credential-expiry");
    const expiresAt = await futureExpiry(10);
    await secure.connect(issuer).issueCredential(credentialId, subject.address, expiresAt);
    await vulnerable.connect(issuer).issueCredential(credentialId, subject.address, expiresAt);
    expect(await secure.verifyCredential(credentialId)).to.equal(true);
    expect(await vulnerable.verifyCredential(credentialId)).to.equal(true);

    await ethers.provider.send("evm_setNextBlockTimestamp", [Number(expiresAt)]);
    await ethers.provider.send("evm_mine", []);
    expect(await secure.verifyCredential(credentialId)).to.equal(false);
    expect(await vulnerable.verifyCredential(credentialId)).to.equal(false);
  });

  it("restricts issuer authorization changes to the registry administrator", async function () {
    await expectRevert(secure.connect(attacker).setIssuer(attacker.address, true));
    expect(await secure.authorizedIssuers(attacker.address)).to.equal(false);
  });

  it("limits credential revocation to its issuer or the administrator", async function () {
    const credentialId = ethers.id("synthetic-credential-issuer-bound");
    await secure.connect(issuer).issueCredential(credentialId, subject.address, await futureExpiry());

    await expectRevert(secure.connect(otherIssuer).revokeCredential(credentialId));
    await secure.connect(issuer).revokeCredential(credentialId);
    expect(await secure.verifyCredential(credentialId)).to.equal(false);
  });
});