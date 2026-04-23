#!/usr/bin/env node

import process from "node:process";
import { buildImplementationDelegationPrompt } from "../src/delegation.js";

function printHelp() {
  process.stdout.write(
    [
      "Usage:",
      "  node scripts/delegate-implementation.js --figma-url <url> --target-package <package> [--component-name <name>]",
      "",
      "Example:",
      "  node scripts/delegate-implementation.js \\",
      "    --figma-url \"https://www.figma.com/design/ExampleFileKey123/Example-File?node-id=123-456&m=dev\" \\",
      "    --target-package \"com.example.feature.preview\" \\",
      "    --component-name \"ExampleBasicNavi\"",
      "",
    ].join("\n")
  );
}

function parseArgs(argv) {
  const options = {};

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (token === "--help" || token === "-h") {
      options.help = true;
      continue;
    }

    if (!token.startsWith("--")) {
      throw new Error(`Unexpected argument: ${token}`);
    }

    const key = token.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for --${key}`);
    }

    options[key] = value;
    index += 1;
  }

  return options;
}

try {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printHelp();
    process.exit(0);
  }

  const prompt = buildImplementationDelegationPrompt({
    figmaUrl: args["figma-url"],
    targetPackage: args["target-package"],
    componentName: args["component-name"],
  });

  process.stdout.write(`${prompt}\n`);
} catch (error) {
  process.stderr.write(`${error.message}\n\n`);
  printHelp();
  process.exit(1);
}
