#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createFigmaCompactionServer } from "./server.js";

const server = createFigmaCompactionServer();
const transport = new StdioServerTransport();
await server.connect(transport);
