# 02 — Modularização

> Pergunta que este documento responde: **onde cortar o sistema em módulos — e como saber se o corte está certo?**
>
> Princípio-mãe: **alta coesão dentro, baixo acoplamento entre.** Um corte é bom quando as coisas que mudam juntas ficam juntas, e uma mudança comum não atravessa fronteiras.
>
> **Dono:** Tech Lead · **Revisão:** anual · **Última revisão:** 2026-08-31

---

## Critérios para cortar

### 1. Corte por domínio de negócio, não por camada técnica
- `billing/`, `auth/`, `catalog/` envelhecem melhor que `controllers/`, `services/`, `models/` globais.
- Camadas técnicas podem existir **dentro** de cada módulo de domínio (vertical slice).
- Teste do corte: "adicionar o campo X na fatura" deveria tocar 1 módulo. Se toca 4, o corte é por camada e o custo de mudança está espalhado.

### 2. Módulos profundos, interfaces rasas (Ousterhout)
- O melhor módulo esconde muita complexidade atrás de uma interface pequena.
- Módulo raso (interface do tamanho da implementação, ex.: wrapper que só repassa chamadas) adiciona custo cognitivo sem esconder nada — inline-o.

### 3. Dependências apontam numa direção só
- Domínio não conhece infraestrutura; infraestrutura conhece domínio (dependency inversion na fronteira).
- Ciclo de dependência entre módulos = os dois são um módulo só mal dividido. Quebre o ciclo ou funda os módulos.

### 4. Fronteira = contrato explícito
- Cada módulo expõe uma API pública explícita (index/barrel, interface, eventos); o resto é privado.
- Se outros módulos importam arquivos internos livremente, não existe fronteira — existe uma pasta.

### 5. Common Closure: o que muda junto, mora junto
- Agrupe pelo motivo de mudança, não pela semelhança de forma.
- Dois trechos parecidos que evoluem por razões diferentes **não** devem ser unificados (ver [01-clean-code](01-clean-code.md), regra da abstração errada).

---

## Escada de modularização (evolua nesta ordem)

| Estágio | Quando | Custo |
|---------|--------|-------|
| **1. Monolito modular** | Default para qualquer sistema novo | Baixo — fronteiras são pastas + convenção |
| **2. Pacotes/workspaces internos** | Fronteiras estáveis, precisa de enforcement (lint de import, build separado) | Médio |
| **3. Serviços separados** | Motivo **operacional** concreto: escala independente, isolamento de falha, deploy independente por time | Alto — rede, versionamento, observabilidade distribuída |

> **Anti-padrão nº 1: microsserviços prematuros.** Fronteira de rede é a mais cara que existe — só pague por ela quando um requisito operacional real exigir. Um monolito modular bem cortado migra para serviços depois; um distribuído mal cortado ("monolito distribuído") não volta atrás barato.

---

## Sinais de que o corte está errado

- **Shotgun surgery** — uma mudança pequena toca N módulos.
- **Feature envy** — módulo A passa mais tempo mexendo nos dados de B do que nos próprios.
- **Ciclos de import** entre módulos.
- **Interface que vaza implementação** — trocar o banco/lib interna quebra os consumidores.
- **Módulo "core"/"shared" que cresce sem parar** — depósito de tudo que ninguém soube posicionar.

## Sinais de que o corte está certo

- Uma feature típica toca 1–2 módulos.
- Dá para explicar a responsabilidade de cada módulo em 1 frase sem "e".
- Times/agentes diferentes trabalham em módulos diferentes sem conflito de merge (`GOVERNANCE.md §4` — um dono por arquivo).
- Testes de um módulo rodam sem subir o resto do sistema.

---

## Checklist para o Architect

- [ ] Corte por domínio (vertical), não só por camada técnica.
- [ ] Cada módulo: responsabilidade em 1 frase; API pública explícita.
- [ ] Grafo de dependências acíclico e apontando para o domínio.
- [ ] Nenhum módulo raso (wrapper sem valor).
- [ ] Fronteira de rede só com justificativa operacional documentada em ADR.
- [ ] "Shared/common" tem dono e critério de entrada — não é depósito.

---

## Fontes

- John Ousterhout — *A Philosophy of Software Design* (deep modules)
- Robert C. Martin — *Clean Architecture* (direção de dependências, Common Closure Principle)
- Sam Newman — *Monolith to Microservices* (quando e como extrair serviços)
- Simon Brown — *Modular Monoliths* (monolito modular como default)
