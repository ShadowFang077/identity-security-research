require("@nomicfoundation/hardhat-ethers");

module.exports = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200
      }
    }
  },
  networks: {
    hardhat: {
      chainId: 31337,
      throwOnTransactionFailures: false
    },
    localhost: {
      url: "http://127.0.0.1:8545",
      chainId: 31337
    }
  }
};