// playbook-task — fluxo de desenvolvimento do playbook como orquestração determinística.
// Disparado pela skill /task (que cria tasks/{id}/ e o brief antes). Doutrina: multi-agents/ARCHITECTURE.md
// e HANDOFF-PROTOCOL.md §4/§6. Decisão: docs/ADR-005-orquestracao-nativa-do-fluxo.md.
//
// O script decide (roteamento, teto do loop, forma da verificação, gate). Os agentes executam e gravam
// os artifacts em tasks/{id}/artifacts/ — o script não toca disco (evidência ISO fica onde está).
// Quem grava run-log.md é a sessão principal (escritor único, GOVERNANCE §4.3) a partir de `events`.
//
// Eficiência de contexto (docs/ADR-009): todo prompt começa pelo texto ESTÁVEL (regras, papel) e termina
// no que varia (task_id, caminhos, issues, checkpoint) — prefixo igual entre agentes do mesmo tipo é
// releitura de cache, não escrita. Os limiares vêm de args.orcamento (bloco orcamento-contexto de
// praticas/00, lido pela skill /task); o script não lê disco.
// Releitura (adendo 2026-10-31 do ADR-009): o custo é contexto × chamadas. Por isso o agente agrupa chamadas
// independentes na mesma resposta, lê artefato de outro papel pelo resumo e pela sua seção, e task complexa
// com grupos de arquivos disjuntos ganha um Coder por grupo, cada um com contexto pequeno.
// Revisão humana e dado pessoal autorizado (docs/ADR-011): com revisão obrigatória, o fluxo aprovado devolve
// `aguardando_revisao_humana`, nunca `done`; dado pessoal autorizado eleva a sensível e força a revisão.

export const meta = {
  name: 'playbook-task',
  description: 'Fluxo do playbook: recon → roteamento → plan → coder → review proporcional ao risco → gate por schema',
  whenToUse: 'Só via skill /task. Exige args.task_id (AAAA-MM-DD_slug) e a pasta tasks/{task_id}/ já criada.',
  phases: [
    { title: 'Recon', detail: 'Architect em modo levantamento: escopo e gatilhos, sem design' },
    { title: 'Plan', detail: 'Spec (se feature não-trivial), design, decomposição' },
    { title: 'Code', detail: 'Coder; Tester em paralelo quando não-trivial' },
    { title: 'Review', detail: 'Voto único; em task sensível, 3 lentes paralelas + refutador cego' },
  ],
}

// ---------- entrada ----------
if (!args || typeof args.task_id !== 'string' || !/^\d{4}-\d{2}-\d{2}_[a-z0-9][a-z0-9-]*$/.test(args.task_id)) {
  throw new Error('args.task_id obrigatório no formato AAAA-MM-DD_slug — use a skill /task, que monta isso')
}
const T = args.task_id
const DIR = `tasks/${T}`
const MAX_ROUNDS = 2            // HANDOFF-PROTOCOL §4.7: 2 reprovações ⇒ o problema não é implementação
const O = (args.orcamento && typeof args.orcamento === 'object') ? args.orcamento : {}
// Fallbacks só para quando a skill não passar o orçamento; o valor oficial é o do perfil (praticas/00).
const MAX_CHECKPOINTS = Number.isInteger(O.checkpoint && O.checkpoint.max_por_fatia) ? O.checkpoint.max_por_fatia : 3
const MAX_PARALELO = Number.isInteger(O.paralelismo_max_agentes) && O.paralelismo_max_agentes > 0 ? O.paralelismo_max_agentes : 4
// Plano da máquina (PLAYBOOK_PLANO, lido pela skill /task). Sem Fable incluído, o Security-SRE vai em Opus por
// chamada: o env do settings não remapeia o alias `fable` de subagente (docs/ADR-010, pendência 8).
const SRE_EM_OPUS = ['pro', 'team-standard', 'enterprise-standard'].includes(args.plano)
let checkpoints = 0             // por task (= por fatia): acima de MAX_CHECKPOINTS a fatia volta ao Planner
const events = []               // a sessão principal anexa isto ao run-log.md
const note = (agent, status, ref, extra) => events.push({ agent, status, ref: ref || '-', ...extra })
// Sensibilidade efetiva: brief OU recon (decisão 2). Vai em TODO retorno, não só no `done`:
// quando o recon eleva, a sessão principal grava `Sensível: sim` no brief — é o brief que o
// hook check-reviewer-gate.mjs e a métrica M2 leem.
// Dado pessoal autorizado (docs/ADR-011 D2): caminho do registro em docs/autorizacoes/, já conferido pela skill.
// Torna a task sensível e a revisão humana obrigatória.
const DADOS_PESSOAIS = typeof args.dados_pessoais === 'string' && args.dados_pessoais.trim() !== '' ? args.dados_pessoais.trim() : null
// Revisão humana (docs/ADR-011 D1): só `dispensada` explícito dispensa; ausente ou valor desconhecido é obrigatória
// (fail-safe). Vai em TODO retorno, como `sensitive`.
const REVISAO_HUMANA = args.revisao_humana === 'dispensada' && !DADOS_PESSOAIS ? 'dispensada' : 'obrigatoria'
let sensitive = args.sensitive === true || DADOS_PESSOAIS !== null
const result = (o) => ({ task_id: T, sensitive, revisao_humana: REVISAO_HUMANA, checkpoints, ...o, events })

// ---------- contratos (HANDOFF-PROTOCOL §3.2 como schema) ----------
const POINTER = {
  type: 'object',
  required: ['agent', 'model', 'task_id', 'status', 'artifact_path', 'files_changed', 'next_agent', 'context_for_next', 'blockers', 'skill_candidates'],
  properties: {
    agent: { type: 'string', description: 'nome-base: coder, reviewer, planner…' },
    model: { type: 'string', description: 'ID exato do modelo em que rodou, lido no system prompt — não o alias da família (ex.: claude-opus-5-5, claude-sonnet-5-5, claude-fable-5-1)' },
    task_id: { type: 'string' },
    status: { type: 'string', enum: ['completed', 'blocked', 'needs_review', 'checkpoint'], description: 'checkpoint = parou no limiar de orçamento com artifact {agente}-checkpoint-NN.md gravado (ADR-009)' },
    artifact_path: { type: 'string' },
    files_changed: { type: 'array', items: { type: 'string' } },
    next_agent: { type: 'string' },
    context_for_next: { type: 'string' },
    blockers: { type: 'array', items: { type: 'string' } },
    skill_candidates: { type: 'array', items: { type: 'string' } },
    // opcionais (HANDOFF-PROTOCOL §3.2, ADR-007): omitidos quando não se aplicam
    provider: { type: 'string', description: 'id do provedor/runtime em que REALMENTE rodou; ausente = claude-code' },
    needs_human: {
      description: 'o blocker exige decisão humana: true (a pergunta está no blocker) ou {question, options?, blocking?}',
      anyOf: [
        { type: 'boolean' },
        {
          type: 'object',
          required: ['question'],
          properties: {
            question: { type: 'string' },
            options: { type: 'array', items: { type: 'string' } },
            blocking: { type: 'boolean', description: 'padrão true: o fluxo depende da resposta para seguir' },
          },
        },
      ],
    },
  },
}
const RECON = {
  type: 'object',
  required: ['complexity', 'sensitive', 'sensitive_reasons', 'needs_spec', 'data_migration', 'files', 'summary'],
  properties: {
    complexity: { type: 'string', enum: ['trivial', 'simples', 'media', 'complexa', 'epica'] },
    sensitive: { type: 'boolean', description: 'toca auth, dados pessoais, dinheiro, superfície externa ou infra/pipeline' },
    sensitive_reasons: { type: 'array', items: { type: 'string' } },
    needs_spec: { type: 'boolean', description: 'feature não-trivial que merece spec formal antes do design (SDD)' },
    data_migration: { type: 'boolean' },
    files: { type: 'array', items: { type: 'string' }, description: 'arquivos que provavelmente mudam' },
    summary: { type: 'string', description: 'uma frase' },
  },
}
const VERDICT = {
  type: 'object',
  required: ['agent', 'aprovado', 'issues', 'artifact_path'],
  properties: {
    agent: { type: 'string' },
    aprovado: { type: 'boolean' },
    issues: {
      type: 'array',
      items: {
        type: 'object',
        required: ['severity', 'summary'],
        properties: {
          severity: { type: 'string', enum: ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] },
          file: { type: 'string' },
          summary: { type: 'string' },
        },
      },
    },
    artifact_path: { type: 'string' },
    escopo_excedido: { type: 'boolean', description: 'opcional (ADR-009): o review estourou o orçamento de contexto; o escopo precisa ser dividido. Nunca é aprovação.' },
  },
}
// Ponteiro do Planner em task complexa: o mesmo contrato + os grupos de arquivos disjuntos que viram um Coder cada.
const PLANNER_POINTER = {
  ...POINTER,
  properties: {
    ...POINTER.properties,
    grupos: {
      type: 'array',
      description: 'só em task complexa: grupos de tasks com arquivos disjuntos, na ordem de execução; um grupo = um Coder. Vazio ou 1 grupo = um Coder só',
      items: {
        type: 'object',
        required: ['slug', 'tasks', 'files'],
        properties: {
          slug: { type: 'string' },
          tasks: { type: 'array', items: { type: 'string' }, description: 'ids das tasks do planner.md (task-001…)' },
          files: { type: 'array', items: { type: 'string' } },
        },
      },
    },
  },
}
const SLICES = {
  type: 'object',
  required: ['slices'],
  properties: {
    slices: {
      type: 'array',
      items: {
        type: 'object',
        required: ['slug', 'objective', 'files'],
        properties: {
          slug: { type: 'string' },
          objective: { type: 'string' },
          files: { type: 'array', items: { type: 'string' } },
        },
      },
    },
  },
}

// ---------- preâmbulo comum a todo agente ----------
// ESTÁVEL: nada de task_id, data, contagem ou caminho aqui (ADR-009, prefixo estável).
const limiarTxt = (() => {
  const c = O.checkpoint && O.checkpoint.tool_calls_por_faixa
  const l = O.comandos_longos || {}
  const s = O.saida_ferramenta || {}
  const faixas = c ? Object.entries(c).map(([k, v]) => `${k} ${v}`).join(', ') : null
  return [
    faixas ? `limiar de checkpoint por tool calls, por faixa de complexidade: ${faixas}` : 'limiares de checkpoint: praticas/00 → bloco orcamento-contexto',
    O.checkpoint && O.checkpoint.contexto_agente_tokens ? `ou contexto acima de ${O.checkpoint.contexto_agente_tokens} tokens` : '',
    l.background_acima_segundos ? `comando com duração esperada acima de ${l.background_acima_segundos} s roda em background com consulta a cada ${l.polling_segundos || '≤120'} s, ou com timeout explícito; nunca passe de ${l.sem_chamada_max_segundos || 270} s sem chamada ao modelo` : '',
    s.leitura_max_linhas_sem_justificativa ? `não leia arquivo inteiro acima de ${s.leitura_max_linhas_sem_justificativa} linhas sem justificativa; saída acima de ${s.saida_para_arquivo_linhas || 150} linhas vai para arquivo em artifacts/` : '',
  ].filter(Boolean).join('; ')
})()
const ART = O.artefatos || {}
const ART_RESUMO = Number.isInteger(ART.resumo_max_linhas) ? ART.resumo_max_linhas : 60
const ART_MAX = Number.isInteger(ART.max_linhas) ? ART.max_linhas : 250
const RULES = `Regras (GOVERNANCE.md §3, §4, §7): opere só no seu escopo; grave TODO o conteúdo no artifact indicado (formato do seu manual em multi-agents/agents/) e devolva SÓ o objeto estruturado pedido; um dono por arquivo; nunca coloque dado real de cliente ou pessoal no artifact; confirme no seu system prompt o modelo que te alimenta e declare-o.
Contexto (praticas/12, docs/ADR-009): busque (rg/grep) antes de ler e leia por faixa de linhas; teste, lint e análise estática só no modo quiet (scripts/quiet/, só falhas e resumo); nunca traga log completo, lockfile, arquivo gerado, minificado ou binário para o contexto; não edite CLAUDE.md, definições de agente nem o contexto da fatia durante a execução — mudança de contexto vira arquivo novo; ${limiarTxt}.
Releitura: cada resposta sua relê todo o contexto, então agrupe na MESMA resposta as chamadas que não dependem uma da outra (várias leituras, buscas, rg) em vez de uma por vez. Artefato de outro papel (spec, design, plano): leia o "## Resumo" e só as seções que o índice "## Seções por papel" aponta para você; o arquivo inteiro só com justificativa. Artefato que você grava abre com "## Resumo" (até ${ART_RESUMO} linhas) e "## Seções por papel" (papel → seções), e não passa de ${ART_MAX} linhas — acima disso, divida em arquivos citados no resumo.
Checkpoint (executores; Reviewer e Security-SRE não usam): ao atingir o limiar, chegue a estado consistente (código compilando, ou mudança pequena isolada e anotada), grave artifacts/{agente}-checkpoint-NN.md pelo modelo de tasks/_TEMPLATE/ e devolva o ponteiro com status "checkpoint" e artifact_path apontando para ele.`

// A parte que varia vem por último: task, caminhos e instruções da vez. A regra do dado pessoal autorizado
// mora aqui e não em RULES: varia por task, e RULES é o prefixo estável (ADR-009).
const DADOS_TXT = DADOS_PESSOAIS
  ? `\nDado pessoal autorizado pelo cliente (${DADOS_PESSOAIS}, praticas/10 §3.1): use só a finalidade, as categorias e os sistemas do registro; prefira execução local que devolve agregado, depois trecho mínimo, nunca o conjunto; nunca grave dado pessoal em artifact, run-log, fixture, teste, log ou commit. Dado sensível (LGPD art. 5º II), de menores e credenciais seguem proibidos: encontrou um, pare e devolva status blocked com needs_human.`
  : ''
const daTask = (instrucoes) => `
## Esta task
Task ${T}. Leia primeiro ${DIR}/brief.md e ${DIR}/artifacts/recon.md (se existir).${DADOS_TXT}
${instrucoes}`

const reviewPrompt = (lens, manual, artifact) => `${RULES}
Você é o ${lens} (multi-agents/agents/${manual}). Revise o diff da task — os arquivos em files_changed do artifact do Coder — com a lente: ${lens}.
A PRIMEIRA LINHA do artifact é exatamente "**Veredito:** APROVADO" ou "**Veredito:** REPROVADO (n issues)" — o hook check-reviewer-gate.mjs depende disso; não use a palavra APROVADO em nenhum outro trecho.
Qualquer issue CRITICAL ou HIGH ⇒ REPROVADO. Não existe "aprovado com ressalvas".
Se o escopo não couber no seu orçamento de contexto, não aprove por amostragem: devolva escopo_excedido: true com aprovado: false, e o orquestrador divide a revisão.
${daTask(`Diff: ${diffRef}. Grave em ${DIR}/artifacts/${artifact}.`)}`
// Onde está o diff: coder.md, ou os coder-gNN.md quando a rodada 1 rodou um Coder por grupo.
let diffRef = `files_changed de ${DIR}/artifacts/coder.md`

// Campos opcionais do ponteiro que a sessão principal precisa ver: onde o agente rodou e se pede decisão humana.
// Vão nos events e no retorno de blocked; nenhum deles muda o roteamento — quem decide o que fazer é a sessão principal.
const pointerExtras = (p) => ({
  ...(typeof p.provider === 'string' && p.provider !== '' ? { provider: p.provider } : {}),
  ...(p.needs_human ? { needs_human: p.needs_human } : {}),
})
// Checkpoint (ADR-009, Frente 5): o agente parou no limiar com o checkpoint gravado. Um agente NOVO do
// mesmo papel continua a partir dele, com o mesmo prompt + o ponteiro do checkpoint. Acima de
// MAX_CHECKPOINTS na task, a fatia está grande demais: devolve `refatiar` e quem decide é o Planner.
const pointer = async (name, prompt, opts) => {
  let p = await agent(prompt, { schema: POINTER, ...opts })
  while (p && p.status === 'checkpoint') {
    note(name, 'checkpoint', p.artifact_path, pointerExtras(p))
    checkpoints++
    if (checkpoints > MAX_CHECKPOINTS) return { ...p, status: 'refatiar' }
    p = await agent(`${prompt}
CONTINUAÇÃO ${checkpoints}: um agente anterior do seu papel parou no limiar de orçamento. Leia ${p.artifact_path} (o checkpoint) e continue de onde ele parou. Não repita leituras já resumidas lá, a menos que precise do trecho exato.`,
    { schema: POINTER, ...opts, label: `${opts.label || name} · continuação ${checkpoints}` })
  }
  if (!p) { note(name, 'sem retorno', '-'); return null }
  note(name, p.status, p.artifact_path, pointerExtras(p))
  return p
}
// Fatia grande demais para os checkpoints permitidos: volta ao Planner (não é reprovação nem bloqueio de código).
const refatiar = (em, p) => result({
  status: 'escalado', para: 'planner', em,
  motivo: `mais de ${MAX_CHECKPOINTS} checkpoint(s) na task — a fatia é grande demais; o Planner fatia de novo (ADR-009)`,
  checkpoint: p.artifact_path,
})
// Teto de agentes simultâneos (perfil do projeto). Acima dele, lotes em sequência — fila custa menos que
// cache reescrito por limite de taxa.
const paralelo = async (jobs) => {
  const out = []
  for (let i = 0; i < jobs.length; i += MAX_PARALELO) out.push(...await parallel(jobs.slice(i, i + MAX_PARALELO)))
  return out
}
const parou = (p) => !p || p.status === 'blocked' || p.status === 'refatiar'
const saida = (em, p) => (p && p.status === 'refatiar' ? refatiar(em, p) : blockedAt(em, p))
// Agente sem retorno ou bloqueado: devolve os blockers dele e, se houver, o pedido de decisão humana.
const blockedAt = (em, p) => result({
  status: 'blocked', em, blockers: p ? p.blockers : ['sem retorno'],
  ...(p && p.needs_human ? { needs_human: p.needs_human } : {}),
})

try {
  // ---------- P1: recon barato ANTES de rotear ----------
  phase('Recon')
  const recon = await agent(`${RULES}
Você é o Architect em MODO LEVANTAMENTO (multi-agents/agents/01-architect.md → "Modo levantamento (recon)"). NÃO projete, NÃO proponha solução.
Leia o brief e o código relevante do repositório e responda só o que o roteamento precisa: complexidade real (épica = não cabe num PR de 200–400 linhas, GOVERNANCE §2.5), se é sensível e por quê, se merece spec formal, se há migração de dados, arquivos prováveis. Grave a linha "Complexidade: <valor>" no levantamento.
${daTask(`Grave o levantamento em ${DIR}/artifacts/recon.md, no máximo 30 linhas.`)}`,
    { agentType: 'architect-opus', schema: RECON, effort: 'low', label: 'recon' })
  if (!recon) throw new Error('recon sem retorno — veja /workflows')
  note('architect(recon)', 'completed', 'artifacts/recon.md')

  sensitive = recon.sensitive || sensitive   // o recon pode elevar; nunca rebaixa
  log(`Recon: ${recon.complexity}${sensitive ? ' · SENSÍVEL' : ''}${recon.needs_spec ? ' · SDD' : ''} · ${recon.files.length} arquivo(s)`)

  // ---------- P5: épica não recebe código — é fatiada ----------
  if (recon.complexity === 'epica') {
    phase('Plan')
    const out = await agent(`${RULES}
Você é o Planner (multi-agents/agents/02-planner.md). O recon classificou a task como ÉPICA.
Fatie em tasks independentes, cada uma cabendo num PR de 200–400 linhas (GOVERNANCE §2.5), com objetivo verificável e arquivos disjuntos entre fatias (GOVERNANCE §4.1). Agrupe as fatias em ondas que respeitem o teto de agentes simultâneos do perfil do projeto.
${daTask(`Grave em ${DIR}/artifacts/planner.md.`)}`,
      { agentType: 'planner-sonnet', schema: SLICES, phase: 'Plan', label: 'fatiar épica' })
    note('planner', out ? 'completed' : 'sem retorno', 'artifacts/planner.md')
    if (!out || !out.slices.length) return result({ status: 'blocked', em: 'planner', blockers: ['fatiamento da épica sem retorno'] })
    return result({
      status: 'fatiada', slices: out ? out.slices : [],
      next: 'Abra uma /task por fatia. A task-mãe não recebe código. Ao fechar cada onda, grave o handoff da sessão (tasks/{id}/handoff/) e retome em sessão nova (ADR-009).',
    })
  }

  // ---------- Plan: só quando não é trivial ----------
  let grupos = null   // task complexa com grupos disjuntos: um Coder por grupo na rodada 1
  if (recon.complexity !== 'trivial') {
    phase('Plan')
    if (recon.needs_spec) {
      const s = await pointer('spec-writer', `${RULES}
Você é o Spec-Writer (multi-agents/agents/09-spec-writer.md). Escreva a spec verificável da task (critérios Given/When/Then, contratos, fora de escopo).
${daTask(`Grave em ${DIR}/artifacts/spec-writer.md.`)}`,
        { agentType: 'spec-writer-opus', phase: 'Plan', label: 'spec' })
      if (parou(s)) return saida('spec-writer', s)
    }
    const a = await pointer('architect', `${RULES}
Você é o Architect (multi-agents/agents/01-architect.md). Projete a solução a partir do brief e do recon, no formato do seu manual.
${daTask(`${recon.needs_spec ? `Use também a spec (${DIR}/artifacts/spec-writer.md). ` : ''}Grave em ${DIR}/artifacts/architect.md.`)}`,
      { agentType: 'architect-opus', phase: 'Plan', label: 'design' })
    if (parou(a)) return saida('architect', a)

    const complexa = recon.complexity === 'complexa'
    const p = await pointer('planner', `${RULES}
Você é o Planner (multi-agents/agents/02-planner.md). Decomponha o design em tarefas sequenciadas com critérios de aceitação.${complexa ? `
Task complexa: agrupe as tarefas em grupos com arquivos DISJUNTOS, na ordem de execução, e devolva-os em "grupos" — cada grupo vira um Coder com contexto próprio. Um grupo só quando a mudança não se divide.` : ''}
${daTask(`Design: ${DIR}/artifacts/architect.md. Grave em ${DIR}/artifacts/planner.md.`)}`,
      { agentType: 'planner-sonnet', phase: 'Plan', label: 'plan', ...(complexa ? { schema: PLANNER_POINTER } : {}) })
    if (parou(p)) return saida('planner', p)
    if (complexa && Array.isArray(p.grupos) && p.grupos.length > 1) grupos = p.grupos
  }

  // ---------- P2: loop com teto ----------
  let verdict = null
  for (let round = 1; round <= MAX_ROUNDS; round++) {
    phase('Code')
    const fix = round > 1
      ? `\nRODADA ${round}: o review REPROVOU. Corrija EXATAMENTE estes issues, nesta ordem de prioridade: ${JSON.stringify(verdict.issues)}`
      : ''
    // Coder em Sonnet por padrão; fatia de alto risco escala para Opus nesta chamada (docs/ADR-010).
    // Rodada > 1 só existe depois de um REPROVADO, que já exige issue CRITICAL ou HIGH.
    const escalaCoder = sensitive || recon.data_migration || recon.complexity === 'complexa' || round > 1
    // Um dono por arquivo (GOVERNANCE §4.1): o Tester só roda em paralelo na rodada 1 de task
    // não-trivial. Fora disso o Coder é o dono também dos testes — senão issue em arquivo de
    // teste na rodada 2 não teria quem corrigisse.
    const testerRuns = recon.complexity !== 'trivial' && round === 1
    const testOwner = testerRuns
      ? 'Não escreva testes — o Tester faz isso em paralelo.'
      : 'O Tester não roda nesta rodada: se a mudança pede teste, ou se algum issue aponta arquivo de teste, o dono é você.'
    const coderOpts = (label) => ({ agentType: 'coder-sonnet', phase: 'Code', label, ...(escalaCoder ? { model: 'opus' } : {}) })
    const coderPrompt = (onde, escopo) => `${RULES}
Você é o Coder (multi-agents/agents/03-coder.md). Implemente a task conforme o plano e grave o artifact com files_changed completo.
${daTask(`Plano: ${recon.complexity === 'trivial' ? 'o brief' : `${DIR}/artifacts/planner.md`}. ${testOwner}${escopo} Grave em ${DIR}/artifacts/${onde}.${fix}`)}`
    // Rodada 1 de task complexa com grupos: um Coder por grupo, em sequência (o grupo seguinte pode usar a
    // interface do anterior). Contexto pequeno por agente em vez de um agente com o diff inteiro (ADR-009).
    // Rodada > 1: um Coder só corrige os issues e consolida o diff em coder.md.
    const porGrupo = grupos && round === 1
    if (grupos && round > 1) diffRef = `files_changed de ${DIR}/artifacts/coder.md`
    const consolida = grupos && round > 1
      ? ' A rodada 1 rodou um Coder por grupo (coder-gNN.md): grave coder.md com files_changed de TODOS os grupos mais as suas correções.'
      : ''
    const jobs = [porGrupo
      ? async () => {
          const feitos = []
          let c = null
          for (let i = 0; i < grupos.length; i++) {
            const g = grupos[i]
            const nn = String(i + 1).padStart(2, '0')
            const antes = feitos.length ? ` Grupos anteriores gravaram ${feitos.join(', ')} — leia o resumo deles só se precisar de uma interface.` : ''
            c = await pointer('coder', coderPrompt(`coder-g${nn}.md`,
              ` Você implementa SÓ o grupo ${nn} "${g.slug}" (tasks ${g.tasks.join(', ')}; arquivos ${g.files.join(', ')}); os outros grupos são de outros Coders.${antes}`),
              coderOpts(`coder r${round} · g${nn}`))
            if (parou(c)) return c
            feitos.push(`${DIR}/artifacts/coder-g${nn}.md`)
          }
          diffRef = `files_changed de ${feitos.join(', ')}`
          return c
        }
      : () => pointer('coder', coderPrompt('coder.md', consolida), coderOpts(`coder r${round}`)),
    ]
    if (testerRuns) {
      jobs.push(() => pointer('tester', `${RULES}
Você é o Tester (multi-agents/agents/05-tester.md). Escreva os testes da task a partir da spec/plano — NÃO a partir da implementação, que está sendo escrita em paralelo agora.
Edite SÓ arquivos de teste (um dono por arquivo, GOVERNANCE §4.1).
${daTask(`Grave em ${DIR}/artifacts/tester.md.`)}`,
        { agentType: 'tester-sonnet', phase: 'Code', label: 'tester' }))
    }
    const done = await paralelo(jobs)            // barreira justificada: o review precisa do código pronto
    const coder = done[0]
    if (parou(coder)) return saida('coder', coder)
    if (done[1] && done[1].status === 'refatiar') return refatiar('tester', done[1])

    // ---------- P3 + P4: verificação proporcional ao risco ----------
    phase('Review')
    if (sensitive) {
      const lenses = (await paralelo([
        () => agent(reviewPrompt('Reviewer — correção, qualidade e arquitetura', '04-reviewer.md', 'reviewer.md'),
          { agentType: 'reviewer-opus', schema: VERDICT, phase: 'Review', label: 'lente: correção' }),
        () => agent(reviewPrompt('Security-SRE — segurança, secrets, supply chain, superfície', '12-security-sre.md', 'security-sre.md'),
          { agentType: 'security-sre-fable', schema: VERDICT, phase: 'Review', label: 'lente: segurança', ...(SRE_EM_OPUS ? { model: 'opus' } : {}) }),
        () => agent(reviewPrompt('Tester — reprodução: rode os testes e tente quebrar o comportamento', '05-tester.md', 'tester-review.md'),
          { agentType: 'tester-sonnet', schema: VERDICT, phase: 'Review', label: 'lente: reprodução' }),
      ])).filter(Boolean)
      lenses.forEach(v => note(v.agent, v.aprovado ? 'APROVADO' : 'REPROVADO', v.artifact_path))
      // Verificador sem retorno é falha de execução, não de implementação: não consome rodada
      // do Coder nem vira `escalado` com diagnóstico falso — é `blocked`, como o refutador cego.
      if (lenses.length < 3) {
        return result({
          status: 'blocked', em: 'lentes', issues: lenses.flatMap(v => v.issues),
          blockers: [`${3 - lenses.length} de 3 lentes sem retorno na rodada ${round} — rode de novo`],
        })
      }
      verdict = { aprovado: lenses.every(v => v.aprovado), issues: lenses.flatMap(v => v.issues), escopo_excedido: lenses.some(v => v.escopo_excedido) }
    } else {
      const v = await agent(reviewPrompt('Reviewer — correção, segurança e qualidade', '04-reviewer.md', 'reviewer.md'),
        { agentType: 'reviewer-opus', schema: VERDICT, phase: 'Review', label: `review r${round}` })
      if (!v) {
        note('reviewer', 'sem retorno', '-')
        return result({ status: 'blocked', em: 'reviewer', blockers: [`Reviewer sem retorno na rodada ${round} — rode de novo`] })
      }
      verdict = v
      note('reviewer', verdict.aprovado ? 'APROVADO' : 'REPROVADO', v.artifact_path)
    }
    // Gate estourou o orçamento: sinal de escopo demais, não de código ruim. Não consome rodada do Coder
    // e nunca vira aprovação — quem divide a revisão é a sessão principal (ADR-009, Frente 5).
    if (verdict.escopo_excedido) {
      return result({
        status: 'blocked', em: 'review', escopo_excedido: true, issues: verdict.issues,
        blockers: ['o review excedeu o orçamento de contexto — divida a revisão (por grupos de files_changed) ou refatie a task'],
      })
    }
    if (verdict.aprovado) break
    log(`Rodada ${round}: REPROVADO (${verdict.issues.length} issue(s))`)
  }

  // ---------- P2: escalonamento ----------
  if (!verdict.aprovado) {
    return result({
      status: 'escalado', para: 'architect', issues: verdict.issues,
      motivo: `REPROVADO em ${MAX_ROUNDS} rodadas — o problema não é implementação (HANDOFF-PROTOCOL §4.7)`,
    })
  }

  // ---------- decisão 3: contra-verificador cego, só em task sensível ----------
  if (sensitive) {
    const blind = await agent(`${RULES}
Você é um Reviewer INDEPENDENTE (multi-agents/agents/04-reviewer.md). NÃO leia reviewer.md, security-sre.md nem tester-review.md da task — você não pode ser ancorado por veredito anterior.
Leia só o brief e o diff (files_changed do artifact do Coder). Sua missão é REFUTAR a aprovação: procure o defeito que passou. Em dúvida, reprove.
Primeira linha do artifact: "**Veredito:** APROVADO" ou "**Veredito:** REPROVADO (n issues)".
${daTask(`Diff: ${diffRef}. Grave em ${DIR}/artifacts/reviewer-cego.md.`)}`,
      { agentType: 'reviewer-opus', schema: VERDICT, phase: 'Review', label: 'refutador cego', effort: 'high' })
    // Fail-closed: sem retorno do refutador, a aprovação não foi contra-verificada — não é `done`.
    if (!blind) {
      note('reviewer(cego)', 'sem retorno', '-')
      return result({
        status: 'blocked', em: 'refutador cego', blockers: ['refutador cego sem retorno — rode de novo ou decida manualmente'],
      })
    }
    note('reviewer(cego)', blind.aprovado ? 'APROVADO' : 'REPROVADO', blind.artifact_path)
    if (!blind.aprovado) {
      return result({
        status: 'divergencia', issues: blind.issues,
        motivo: 'O refutador cego discorda da aprovação — decisão humana (HANDOFF-PROTOCOL §4.8)',
      })
    }
  }

  // ---------- ADR-011 D1: revisão humana ----------
  // O gate dos agentes aprovou. Com revisão obrigatória o script não devolve `done`: quem fecha é o humano,
  // por /task aprovar, e o hook check-reviewer-gate.mjs confere artifacts/revisao-humana.md.
  if (REVISAO_HUMANA === 'obrigatoria') {
    return result({
      status: 'aguardando_revisao_humana', complexity: recon.complexity,
      next: `Revisão humana obrigatória (docs/ADR-011): revise o PR e rode /task aprovar ${T}. O done só vale com ${DIR}/artifacts/revisao-humana.md APROVADO e assinado.`,
    })
  }
  return result({ status: 'done', complexity: recon.complexity })
} catch (e) {
  return result({ status: 'blocked', erro: String((e && e.message) || e) })
}
