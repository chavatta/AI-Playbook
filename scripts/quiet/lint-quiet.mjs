#!/usr/bin/env node
// Wrapper: lint em modo quiet (só falhas e resumo). Comando em praticas/00 → comandos_quiet.lint. Ver run-quiet.mjs.
import { main } from "./run-quiet.mjs";
process.exit(await main("lint", process.argv.slice(2)));
