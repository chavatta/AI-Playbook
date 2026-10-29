#!/usr/bin/env node
// Wrapper: teste em modo quiet (só falhas e resumo). Comando em praticas/00 → comandos_quiet.teste. Ver run-quiet.mjs.
import { main } from "./run-quiet.mjs";
process.exit(await main("teste", process.argv.slice(2)));
