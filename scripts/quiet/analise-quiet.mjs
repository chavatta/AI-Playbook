#!/usr/bin/env node
// Wrapper: analise em modo quiet (só falhas e resumo). Comando em praticas/00 → comandos_quiet.analise. Ver run-quiet.mjs.
import { main } from "./run-quiet.mjs";
process.exit(await main("analise", process.argv.slice(2)));
