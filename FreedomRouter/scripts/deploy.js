const hre = require("hardhat");
require("dotenv").config();

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deploying FreedomRouter v4 (Proxy mode)...\n");
  console.log("Deployer:", deployer.address);

  const balance = await hre.ethers.provider.getBalance(deployer.address);
  console.log("Balance:", hre.ethers.formatEther(balance), "BNB\n");

  const config = {
    tokenManagerV1: "0xEC4549caDcE5DA21Df6E6422d448034B5233bFbC",
    tokenManagerV2: "0x5c952063c7fc8610FFDB798152D69F0B9550762b",
    helper3: "0xF251F83e40a78868FcfA3FA4599Dad6494E46034",
  };

  // 1. 部署 Implementation
  const Impl = await hre.ethers.getContractFactory("FreedomRouterImpl");
  const impl = await Impl.deploy();
  await impl.waitForDeployment();
  const implAddr = await impl.getAddress();
  console.log("Implementation:", implAddr);

  // 2. 编码 initialize calldata (v4: 增加 helper3 参数)
  const initData = impl.interface.encodeFunctionData("initialize", [
    deployer.address,
    config.tokenManagerV1,
    config.tokenManagerV2,
    config.helper3,
  ]);

  // 3. 部署 Proxy
  const Proxy = await hre.ethers.getContractFactory("FreedomRouter");
  const proxy = await Proxy.deploy(implAddr, initData);
  await proxy.waitForDeployment();
  const proxyAddr = await proxy.getAddress();
  console.log("Proxy:", proxyAddr);

  // 验证
  const router = await hre.ethers.getContractAt("FreedomRouterImpl", proxyAddr);
  const tmV1 = await router.tokenManagerV1();
  const tmV2 = await router.tokenManagerV2();
  const h3 = await router.tmHelper3();
  const owner = await router.owner();

  console.log("\n配置:");
  console.log("  TokenManager V1:", tmV1);
  console.log("  TokenManager V2:", tmV2);
  console.log("  Helper3:", h3);
  console.log("  Owner:", owner);

  const fs = require("fs");
  fs.writeFileSync("deployment.json", JSON.stringify({
    version: 4,
    proxy: proxyAddr,
    implementation: implAddr,
    deployer: deployer.address,
    timestamp: new Date().toISOString(),
    config
  }, null, 2));

  console.log("\nDone");
}

main()
  .then(() => process.exit(0))
  .catch(console.error);
