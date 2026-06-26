import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

/// Deploys EnergiToken with ORACLE_ADDRESS (env) as the oracle, then writes the
/// deployed address + ABI to the mobile app's config so it can read/transact
/// against the contract without any manual copy-pasting.
async function main() {
  const oracleAddress = process.env.ORACLE_ADDRESS;
  if (!oracleAddress) {
    throw new Error("ORACLE_ADDRESS is not set in .env");
  }

  const EnergiToken = await ethers.getContractFactory("EnergiToken");
  const token = await EnergiToken.deploy(oracleAddress);
  await token.waitForDeployment();

  const address = await token.getAddress();
  console.log(`EnergiToken deployed to: ${address}`);
  console.log(`Oracle set to: ${oracleAddress}`);

  const artifact = await import(
    path.join(__dirname, "../artifacts/contracts/EnergiToken.sol/EnergiToken.json")
  );

  const outDir = path.join(__dirname, "../../app/src/config");
  fs.mkdirSync(outDir, { recursive: true });

  const outPath = path.join(outDir, "contract.json");
  fs.writeFileSync(
    outPath,
    JSON.stringify({ address, abi: artifact.abi }, null, 2)
  );

  console.log(`Wrote contract address + ABI to ${outPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
