import { expect } from "chai";
import { ethers } from "hardhat";
import { EnergiToken } from "../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

describe("EnergiToken", () => {
  let token: EnergiToken;
  let owner: HardhatEthersSigner;
  let oracle: HardhatEthersSigner;
  let alice: HardhatEthersSigner;
  let bob: HardhatEthersSigner;

  beforeEach(async () => {
    [owner, oracle, alice, bob] = await ethers.getSigners();
    const EnergiToken = await ethers.getContractFactory("EnergiToken");
    token = await EnergiToken.deploy(oracle.address);
    await token.waitForDeployment();
  });

  it("has 0 decimals, the right name and symbol", async () => {
    expect(await token.name()).to.equal("EnergiToken");
    expect(await token.symbol()).to.equal("ENGY");
    expect(await token.decimals()).to.equal(0);
  });

  it("lets the oracle mint watt-hours and emits Minted", async () => {
    await expect(token.connect(oracle).mint(alice.address, 1000))
      .to.emit(token, "Minted")
      .withArgs(alice.address, 1000);
    expect(await token.balanceOf(alice.address)).to.equal(1000);
  });

  it("lets the oracle burn consumed watt-hours and emits Consumed", async () => {
    await token.connect(oracle).mint(alice.address, 1000);
    await expect(token.connect(oracle).burnConsumed(alice.address, 400))
      .to.emit(token, "Consumed")
      .withArgs(alice.address, 400);
    expect(await token.balanceOf(alice.address)).to.equal(600);
  });

  it("reverts when a non-oracle tries to mint", async () => {
    await expect(token.connect(alice).mint(alice.address, 1000)).to.be.revertedWith(
      "EnergiToken: caller is not the oracle"
    );
  });

  it("reverts when a non-oracle tries to burn", async () => {
    await token.connect(oracle).mint(alice.address, 1000);
    await expect(token.connect(alice).burnConsumed(alice.address, 100)).to.be.revertedWith(
      "EnergiToken: caller is not the oracle"
    );
  });

  it("allows holders to transfer credit peer-to-peer", async () => {
    await token.connect(oracle).mint(alice.address, 1000);
    await token.connect(alice).transfer(bob.address, 300);
    expect(await token.balanceOf(alice.address)).to.equal(700);
    expect(await token.balanceOf(bob.address)).to.equal(300);
  });

  it("lets the owner rotate the oracle, and the old oracle loses access", async () => {
    await expect(token.connect(owner).setOracle(bob.address))
      .to.emit(token, "OracleUpdated")
      .withArgs(bob.address);

    await expect(token.connect(oracle).mint(alice.address, 100)).to.be.revertedWith(
      "EnergiToken: caller is not the oracle"
    );
    await expect(token.connect(bob).mint(alice.address, 100)).to.not.be.reverted;
  });

  it("reverts when a non-owner tries to rotate the oracle", async () => {
    await expect(token.connect(alice).setOracle(bob.address)).to.be.revertedWithCustomError(
      token,
      "OwnableUnauthorizedAccount"
    );
  });
});
