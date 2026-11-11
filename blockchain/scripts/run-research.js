const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const projectDirectory = path.resolve(__dirname, "..");
const reportsDirectory = path.resolve(projectDirectory, "..", "reports");
const hardhatCli = path.join(projectDirectory, "node_modules", "hardhat", "internal", "cli", "cli.js");
const testResultsPath = path.join(reportsDirectory, "test-results.json");

fs.mkdirSync(reportsDirectory, { recursive: true });

function runHardhat(args) {
  const result = spawnSync(process.execPath, [hardhatCli, ...args], {
    cwd: projectDirectory,
    encoding: "utf8"
  });

  process.stdout.write(result.stdout || "");
  process.stderr.write(result.stderr || "");
  return result;
}

const testRun = runHardhat(["test"]);
const testOutput = `${testRun.stdout || ""}\n${testRun.stderr || ""}`;
const passingMatch = testOutput.match(/(\d+) passing/);
const failingMatch = testOutput.match(/(\d+) failing/);
const passing = passingMatch ? Number(passingMatch[1]) : null;
const failing = failingMatch
  ? Number(failingMatch[1])
  : testRun.status === 0 && passing !== null
    ? 0
    : null;
const testResults = {
  executedAt: new Date().toISOString(),
  exitCode: testRun.status,
  passing,
  failing,
  countsAvailable: passing !== null && failing !== null,
  output: testOutput.trim()
};

fs.writeFileSync(testResultsPath, `${JSON.stringify(testResults, null, 2)}\n`);

if (testRun.error) {
  console.error(testRun.error);
  process.exitCode = 1;
} else if (testRun.status !== 0) {
  console.error(`Tests failed; experiment execution was skipped. See ${testResultsPath}`);
  process.exitCode = testRun.status || 1;
} else {
  const experimentRun = runHardhat(["run", "scripts/run-experiments.js"]);
  if (experimentRun.error) {
    console.error(experimentRun.error);
    process.exitCode = 1;
  } else if (experimentRun.status !== 0) {
    process.exitCode = experimentRun.status || 1;
  }
}