const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Identity security comparison", function () {
  let alice;
  let attacker;
  let vulnerable;
  let secure;
  const aliceCommitment = ethers.id("synthetic-alice");

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

  beforeEach(async function () {
    [alice, attacker] = await ethers.getSigners();

    const Vulnerable = await ethers.getContractFactory("IdentityVulnerable");
    vulnerable = await Vulnerable.deploy();
    await vulnerable.waitForDeployment();

    const Secure = await ethers.getContractFactory("IdentitySecure");
    secure = await Secure.deploy();
    await secure.waitForDeployment();
  });

  it("registers and verifies an identity on both contracts", async function () {
    await vulnerable.connect(alice).registerIdentity("synthetic-alice", aliceCommitment);
    await secure.connect(alice).registerIdentity("synthetic-alice", aliceCommitment);

    expect(await vulnerable.verifyIdentity(alice.address)).to.equal(true);
    expect(await secure.verifyIdentity(alice.address)).to.equal(true);
    expect((await secure.getIdentity(alice.address)).displayName).to.equal("synthetic-alice");
  });

  it("allows an unauthorized identity modification in the vulnerable contract", async function () {
    await vulnerable.connect(alice).registerIdentity("synthetic-alice", aliceCommitment);

    await vulnerable.connect(attacker).updateIdentity(
      alice.address,
      "attacker-controlled",
      ethers.id("attacker-commitment")
    );

    expect((await vulnerable.getIdentity(alice.address)).displayName).to.equal("attacker-controlled");
  });

  it("blocks an unauthorized identity modification in the secure contract", async function () {
    await secure.connect(alice).registerIdentity("synthetic-alice", aliceCommitment);

    await expectRevert(
      secure.connect(attacker).updateIdentity(
        alice.address,
        "attacker-controlled",
        ethers.id("attacker-commitment")
      )
    );

    expect((await secure.getIdentity(alice.address)).displayName).to.equal("synthetic-alice");
  });

  it("allows an unauthorized identity deletion in the vulnerable contract", async function () {
    await vulnerable.connect(alice).registerIdentity("synthetic-alice", aliceCommitment);
    await vulnerable.connect(attacker).deleteIdentity(alice.address);

    expect(await vulnerable.verifyIdentity(alice.address)).to.equal(false);
  });

  it("blocks an unauthorized identity deletion in the secure contract", async function () {
    await secure.connect(alice).registerIdentity("synthetic-alice", aliceCommitment);

    await expectRevert(
      secure.connect(attacker).deleteIdentity(alice.address)
    );

    expect(await secure.verifyIdentity(alice.address)).to.equal(true);
  });

  it("allows the identity owner to update and delete a secure identity", async function () {
    await secure.connect(alice).registerIdentity("synthetic-alice", aliceCommitment);
    await secure.connect(alice).updateIdentity(
      alice.address,
      "synthetic-alice-updated",
      ethers.id("synthetic-alice-updated")
    );

    expect((await secure.getIdentity(alice.address)).displayName).to.equal("synthetic-alice-updated");
    await secure.connect(alice).deleteIdentity(alice.address);
    expect(await secure.verifyIdentity(alice.address)).to.equal(false);
  });

  it("accepts empty identity data in the vulnerable contract", async function () {
    await vulnerable.connect(alice).registerIdentity("", ethers.ZeroHash);

    const identity = await vulnerable.getIdentity(alice.address);
    expect(identity.exists).to.equal(true);
    expect(identity.displayName).to.equal("");
    expect(identity.commitment).to.equal(ethers.ZeroHash);
  });

  it("rejects empty names and zero commitments in the secure contract", async function () {
    await expectRevert(
      secure.connect(alice).registerIdentity("", aliceCommitment)
    );
    await expectRevert(
      secure.connect(alice).registerIdentity("synthetic-alice", ethers.ZeroHash)
    );

    expect(await secure.verifyIdentity(alice.address)).to.equal(false);
  });

  it("rejects overlong identity labels in the secure contract", async function () {
    const overlongName = "x".repeat(65);
    await vulnerable.connect(alice).registerIdentity(overlongName, aliceCommitment);
    await expectRevert(secure.connect(alice).registerIdentity(overlongName, aliceCommitment));

    expect((await vulnerable.getIdentity(alice.address)).displayName).to.equal(overlongName);
    expect(await secure.verifyIdentity(alice.address)).to.equal(false);
  });

  it("rejects duplicate registration in the secure contract", async function () {
    await secure.connect(alice).registerIdentity("synthetic-alice", aliceCommitment);

    await expectRevert(
      secure.connect(alice).registerIdentity("replacement", ethers.id("replacement"))
    );
    expect((await secure.getIdentity(alice.address)).displayName).to.equal("synthetic-alice");
  });

  it("allows duplicate registration in the vulnerable contract", async function () {
    await vulnerable.connect(alice).registerIdentity("synthetic-alice", aliceCommitment);
    await vulnerable.connect(alice).registerIdentity("replacement", ethers.id("replacement"));

    expect((await vulnerable.getIdentity(alice.address)).displayName).to.equal("replacement");
  });
});